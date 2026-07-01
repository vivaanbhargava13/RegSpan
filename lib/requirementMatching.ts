import type { RetrievedChunk } from "@/lib/retrieval";
import type { RegSpRequirement } from "@/lib/regSpRequirements";
import { detectNegativeEvidence } from "./negativeEvidence";

export type EvidenceGrade = "direct" | "partial" | "background" | "irrelevant";
export type RequirementDebugStatus = "strong_match" | "partial_match" | "weak_match" | "no_match";

export type GradedEvidenceChunk = RetrievedChunk & {
  grade: EvidenceGrade;
  grade_reason: string;
  negative_evidence: boolean;
  negative_evidence_reason: string | null;
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

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countSignalMatches(text: string, signals: string[]) {
  const matched = signals.filter((signal) => {
    const normalizedSignal = normalize(signal);
    return normalizedSignal && text.includes(normalizedSignal);
  });

  return {
    count: matched.length,
    matched,
  };
}

function hasAnySignal(text: string, signals: string[]) {
  return countSignalMatches(text, signals).count > 0;
}

function chunkText(chunk: RetrievedChunk) {
  return normalize([
    chunk.filename,
    chunk.section_path,
    chunk.evidence_reason,
    chunk.content_preview,
  ].filter(Boolean).join(" "));
}

export function gradeRetrievedChunk(
  requirement: RegSpRequirement,
  chunk: RetrievedChunk,
): GradedEvidenceChunk {
  const text = chunkText(chunk);
  const negativeEvidence = detectNegativeEvidence(text, [
    ...requirement.directSignals,
    ...requirement.actionSignals,
    ...requirement.topicSignals,
    ...requirement.partialSignals,
  ]);
  const direct = countSignalMatches(text, requirement.directSignals);
  const action = countSignalMatches(text, requirement.actionSignals);
  const partial = countSignalMatches(text, requirement.partialSignals);
  const background = countSignalMatches(text, requirement.backgroundSignals);
  const hasExplicitAction = action.count > 0;
  const hasVendorIncidentHandlingContext = requirement.id !== "vendor_incident_handling"
    || (
      hasAnySignal(text, ["vendor", "service provider", "third party", "supplier"])
      && hasAnySignal(text, [
        "incident",
        "breach",
        "notification",
        "notify",
        "report",
        "reporting",
        "escalation",
        "escalate",
        "coordinate",
        "coordination",
        "contract",
        "responsibilities",
      ])
    );

  if (negativeEvidence.isNegativeEvidence) {
    return {
      ...chunk,
      grade: "irrelevant",
      grade_reason:
        `Negative evidence: chunk states this requirement is absent or out of scope (${negativeEvidence.matchedPhrase} ${negativeEvidence.matchedSignal}).`,
      negative_evidence: true,
      negative_evidence_reason:
        `${negativeEvidence.matchedPhrase} near ${negativeEvidence.matchedSignal}`,
    };
  }

  if (hasExplicitAction && hasVendorIncidentHandlingContext && direct.count >= 2) {
    return {
      ...chunk,
      grade: "direct",
      grade_reason: `Direct evidence signals matched: ${[
        ...direct.matched,
        ...action.matched.slice(0, 2),
      ].join(", ")}.`,
      negative_evidence: false,
      negative_evidence_reason: null,
    };
  }

  if (
    direct.count >= 1 ||
    (hasExplicitAction && partial.count >= 1) ||
    partial.count >= 2 ||
    (partial.count >= 1 && background.count >= 1)
  ) {
    return {
      ...chunk,
      grade: "partial",
      grade_reason: `Partial evidence signals matched: ${[
        ...direct.matched,
        ...action.matched.slice(0, 2),
        ...partial.matched,
        ...background.matched.slice(0, 1),
      ].join(", ")}.`,
      negative_evidence: false,
      negative_evidence_reason: null,
    };
  }

  if (partial.count === 1 || background.count >= 2) {
    return {
      ...chunk,
      grade: "background",
      grade_reason: `Background context signals matched: ${[
        ...partial.matched,
        ...background.matched,
      ].join(", ")}.`,
      negative_evidence: false,
      negative_evidence_reason: null,
    };
  }

  return {
    ...chunk,
    grade: "irrelevant",
    grade_reason:
      "Candidate was retrieved semantically, but it does not contain enough requirement-specific signals for this debug grader.",
    negative_evidence: false,
    negative_evidence_reason: null,
  };
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

export function isValidEvidenceGrade(value: string): value is EvidenceGrade {
  return ["direct", "partial", "background", "irrelevant"].includes(value);
}

export function isValidRequirementStatus(value: string): value is RequirementDebugStatus {
  return ["strong_match", "partial_match", "weak_match", "no_match"].includes(value);
}
