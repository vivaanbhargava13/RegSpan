import type { RetrievedChunk } from "@/lib/retrieval";
import type { RegSpRequirement } from "@/lib/regSpRequirements";
import {
  classifierInputForChunk,
  classifyRequirementEvidenceHeuristically,
  createRequirementEvidenceClassifier,
  type RequirementEvidenceClassification,
  type RequirementEvidenceClassifier,
  type RequirementEvidenceClassifierProvider,
  type RequirementEvidenceConfidence,
  type RequirementEvidenceRelationship,
} from "./requirementEvidenceClassifier";

export type EvidenceGrade = "direct" | "partial" | "background" | "irrelevant";
export type RequirementDebugStatus = "strong_match" | "partial_match" | "weak_match" | "no_match";

export type GradedEvidenceChunk = RetrievedChunk & {
  grade: EvidenceGrade;
  grade_reason: string;
  negative_evidence: boolean;
  negative_evidence_reason: string | null;
  evidence_relationship: RequirementEvidenceRelationship;
  classifier_confidence: RequirementEvidenceConfidence;
  requirement_supported: boolean;
  control_absent_or_out_of_scope: boolean;
  covered_elements: string[];
  missing_elements: string[];
  vague_elements: string[];
  supporting_quote: string | null;
  classifier_provider: RequirementEvidenceClassifierProvider;
};

export type RequirementMatchResult = {
  requirement: RegSpRequirement;
  status: RequirementDebugStatus;
  status_reason: string;
  direct: GradedEvidenceChunk[];
  partial: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
  irrelevant: GradedEvidenceChunk[];
};

const gradeRank: Record<EvidenceGrade, number> = {
  direct: 0,
  partial: 1,
  background: 2,
  irrelevant: 3,
};

function gradeFromRelationship(relationship: RequirementEvidenceRelationship): EvidenceGrade {
  switch (relationship) {
    case "supports":
      return "direct";
    case "partially_supports":
      return "partial";
    case "background_context":
      return "background";
    case "negative_evidence":
    case "irrelevant":
      return "irrelevant";
  }
}

function chunkWithClassification(
  chunk: RetrievedChunk,
  classification: RequirementEvidenceClassification,
): GradedEvidenceChunk {
  const grade = gradeFromRelationship(classification.relationship);
  const negativeEvidence = classification.relationship === "negative_evidence"
    || classification.control_absent_or_out_of_scope;

  return {
    ...chunk,
    grade,
    grade_reason: classification.reason,
    negative_evidence: negativeEvidence,
    negative_evidence_reason: negativeEvidence ? classification.reason : null,
    evidence_relationship: classification.relationship,
    classifier_confidence: classification.confidence,
    requirement_supported: classification.requirement_supported,
    control_absent_or_out_of_scope: classification.control_absent_or_out_of_scope,
    covered_elements: classification.covered_elements,
    missing_elements: classification.missing_elements,
    vague_elements: classification.vague_elements,
    supporting_quote: classification.supporting_quote,
    classifier_provider: classification.classifier_provider,
  };
}

export function gradeRetrievedChunk(
  requirement: RegSpRequirement,
  chunk: RetrievedChunk,
): GradedEvidenceChunk {
  const classification = classifyRequirementEvidenceHeuristically(
    classifierInputForChunk(requirement, chunk),
    "heuristic",
  );
  return chunkWithClassification(chunk, classification);
}

export function aggregateRequirementStatus(
  gradedChunks: GradedEvidenceChunk[],
): Pick<RequirementMatchResult, "status" | "status_reason"> {
  const directCount = gradedChunks.filter((chunk) => chunk.grade === "direct").length;
  const directOrganizationEvidenceCount = gradedChunks.filter(
    (chunk) => chunk.grade === "direct" && chunk.evidence_role === "organization_evidence",
  ).length;
  const directReferenceEvidenceCount = gradedChunks.filter(
    (chunk) => chunk.grade === "direct" && chunk.evidence_role === "requirement_reference",
  ).length;
  const partialCount = gradedChunks.filter((chunk) => chunk.grade === "partial").length;
  const backgroundCount = gradedChunks.filter((chunk) => chunk.grade === "background").length;

  if (directCount >= 1) {
    if (directOrganizationEvidenceCount === 0) {
      return {
        status: "strong_match",
        status_reason:
          `Direct candidate evidence was found, but it is ${
            directReferenceEvidenceCount > 0 ? "guidance/reference evidence" : "supporting context"
          } only. Treat this as a strong debug match, not proof of client compliance.`,
      };
    }

    return {
      status: "strong_match",
      status_reason:
        "At least one retrieved candidate was graded as direct organization evidence for this debug requirement.",
    };
  }

  if (partialCount >= 2 || (partialCount >= 1 && backgroundCount >= 2)) {
    return {
      status: "partial_match",
      status_reason:
        "No direct candidate evidence was found, but multiple partial/background candidates may be relevant.",
    };
  }

  if (partialCount >= 1 || backgroundCount >= 1) {
    return {
      status: "weak_match",
      status_reason:
        "Retrieved candidates provide context, but not enough candidate evidence for a stronger debug match.",
    };
  }

  return {
    status: "no_match",
    status_reason:
      "No retrieved candidates were graded as direct, partial, or useful background evidence.",
  };
}

export function buildRequirementMatchResult(
  requirement: RegSpRequirement,
  chunks: RetrievedChunk[],
): RequirementMatchResult {
  const graded = chunks
    .map((chunk) => gradeRetrievedChunk(requirement, chunk))
    .sort((left, right) => {
      const gradeDelta = gradeRank[left.grade] - gradeRank[right.grade];
      if (gradeDelta !== 0) return gradeDelta;
      const leftRerank = left.rerank_score ?? 0;
      const rightRerank = right.rerank_score ?? 0;
      const rerankDelta = rightRerank - leftRerank;
      if (rerankDelta !== 0) return rerankDelta;
      return right.similarity - left.similarity;
    });
  const { status, status_reason } = aggregateRequirementStatus(graded);

  return {
    requirement,
    status,
    status_reason,
    direct: graded.filter((chunk) => chunk.grade === "direct"),
    partial: graded.filter((chunk) => chunk.grade === "partial"),
    background: graded.filter((chunk) => chunk.grade === "background"),
    irrelevant: graded.filter((chunk) => chunk.grade === "irrelevant"),
  };
}

export async function buildRequirementMatchResultWithClassifier(
  requirement: RegSpRequirement,
  chunks: RetrievedChunk[],
  classifier: RequirementEvidenceClassifier = createRequirementEvidenceClassifier(),
): Promise<RequirementMatchResult> {
  const graded = (await Promise.all(chunks.map(async (chunk) => {
    const classification = await classifier.classify(classifierInputForChunk(requirement, chunk));
    return chunkWithClassification(chunk, classification);
  }))).sort((left, right) => {
    const gradeDelta = gradeRank[left.grade] - gradeRank[right.grade];
    if (gradeDelta !== 0) return gradeDelta;
    const leftRerank = left.rerank_score ?? 0;
    const rightRerank = right.rerank_score ?? 0;
    const rerankDelta = rightRerank - leftRerank;
    if (rerankDelta !== 0) return rerankDelta;
    return right.similarity - left.similarity;
  });
  const { status, status_reason } = aggregateRequirementStatus(graded);

  return {
    requirement,
    status,
    status_reason,
    direct: graded.filter((chunk) => chunk.grade === "direct"),
    partial: graded.filter((chunk) => chunk.grade === "partial"),
    background: graded.filter((chunk) => chunk.grade === "background"),
    irrelevant: graded.filter((chunk) => chunk.grade === "irrelevant"),
  };
}

export function isValidEvidenceGrade(value: string): value is EvidenceGrade {
  return ["direct", "partial", "background", "irrelevant"].includes(value);
}

export function isValidRequirementStatus(value: string): value is RequirementDebugStatus {
  return ["strong_match", "partial_match", "weak_match", "no_match"].includes(value);
}
