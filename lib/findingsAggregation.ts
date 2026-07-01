import type { GradedEvidenceChunk } from "./requirementMatching";
import type { RegSpRequirement, RegSpRequirementId } from "./regSpRequirements";

export type FindingStatus = "covered" | "partial" | "missing" | "conflicting" | "needs_review";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";

export type GeneratedFindingEvidence = {
  chunk_id: string;
  document_id: string;
  relationship: GradedEvidenceChunk["evidence_relationship"];
  quote: string | null;
  reason: string;
  confidence: GradedEvidenceChunk["classifier_confidence"];
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
  chunk_index: number;
};

export type GeneratedRequirementFinding = {
  requirement_id: RegSpRequirementId;
  requirement_name: string;
  status: FindingStatus;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  summary: string;
  remediation: string;
  rationale: string;
  evidence: GeneratedFindingEvidence[];
};

const highImpactRequirements = new Set<RegSpRequirementId>([
  "written_incident_response_program",
  "customer_notification_unauthorized_access",
  "regulator_law_enforcement_notification",
  "vendor_incident_handling",
  "customer_information_safeguards",
]);

function organizationEvidence(chunks: GradedEvidenceChunk[]) {
  return chunks.filter((chunk) => chunk.evidence_role === "organization_evidence");
}

function isDirectSupport(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "supports" && chunk.requirement_supported;
}

function isPartialSupport(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "partially_supports";
}

function isBackgroundContext(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "background_context";
}

function isExplicitNegativeEvidence(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "negative_evidence"
    && chunk.control_absent_or_out_of_scope;
}

function confidenceForStatus(status: FindingStatus, evidence: GradedEvidenceChunk[]): FindingConfidence {
  const hasHighConfidenceEvidence = evidence.some(
    (chunk) => chunk.classifier_confidence === "high",
  );
  const hasMediumConfidenceEvidence = evidence.some(
    (chunk) => chunk.classifier_confidence === "medium",
  );

  if (status === "missing" && evidence.length === 0) return "medium";
  if (status === "needs_review") return "low";
  if (hasHighConfidenceEvidence) return "high";
  if (hasMediumConfidenceEvidence || evidence.length > 0) return "medium";
  return "low";
}

function severityForStatus(requirement: RegSpRequirement, status: FindingStatus): FindingSeverity {
  if (status === "covered") return "info";
  if (status === "needs_review") return "medium";
  if (status === "partial") return highImpactRequirements.has(requirement.id) ? "high" : "medium";
  if (status === "conflicting") return highImpactRequirements.has(requirement.id) ? "critical" : "high";
  if (status === "missing") return highImpactRequirements.has(requirement.id) ? "high" : "medium";
  return "medium";
}

function statusSummary(requirement: RegSpRequirement, status: FindingStatus) {
  switch (status) {
    case "covered":
      return `${requirement.title} appears covered by organization evidence.`;
    case "partial":
      return `${requirement.title} is only partially supported by organization evidence.`;
    case "missing":
      return `No organization evidence currently supports ${requirement.title}.`;
    case "conflicting":
      return `${requirement.title} has both supporting and explicit negative organization evidence.`;
    case "needs_review":
      return `${requirement.title} has ambiguous organization evidence that needs reviewer confirmation.`;
  }
}

export function remediationForFinding(requirement: RegSpRequirement, status: FindingStatus) {
  if (status === "covered") {
    return "Retain the cited policy evidence and confirm it remains current during the next review cycle.";
  }

  const base = `Update the organization’s documentation to explicitly address: ${requirement.description}`;
  if (status === "conflicting") {
    return `${base} Resolve conflicting language that states the control is absent, delegated, excluded, or out of scope.`;
  }
  if (status === "partial") {
    return `${base} Clarify ownership, required actions, timing, escalation paths, and evidence retention where applicable.`;
  }
  if (status === "needs_review") {
    return `${base} Have a reviewer confirm whether the cited context is intended to satisfy this requirement.`;
  }
  return `${base} Add policy or procedure language and cite the governing document section.`;
}

function rationaleForFinding({
  status,
  direct,
  partial,
  background,
  negative,
  ignoredReferenceCount,
}: {
  status: FindingStatus;
  direct: GradedEvidenceChunk[];
  partial: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
  negative: GradedEvidenceChunk[];
  ignoredReferenceCount: number;
}) {
  const parts = [
    `Status ${status} was assigned using organization evidence only.`,
    `${direct.length} direct, ${partial.length} partial, ${background.length} background, and ${negative.length} explicit negative organization-evidence candidates were found.`,
  ];
  if (ignoredReferenceCount > 0) {
    parts.push(`${ignoredReferenceCount} reference/supporting-context candidates were ignored for compliance status.`);
  }
  if (negative.length > 0) {
    parts.push("Negative evidence was counted only when the chunk explicitly stated absence, exclusion, delegation, or out-of-scope language for this requirement.");
  }
  return parts.join(" ");
}

function evidenceForStorage(chunks: GradedEvidenceChunk[]): GeneratedFindingEvidence[] {
  return chunks.slice(0, 6).map((chunk) => ({
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    relationship: chunk.evidence_relationship,
    quote: chunk.supporting_quote,
    reason: chunk.grade_reason,
    confidence: chunk.classifier_confidence,
    filename: chunk.filename,
    page_start: chunk.page_start,
    page_end: chunk.page_end,
    section_path: chunk.section_path,
    chunk_index: chunk.chunk_index,
  }));
}

export function aggregateFindingForRequirement(
  requirement: RegSpRequirement,
  gradedChunks: GradedEvidenceChunk[],
): GeneratedRequirementFinding {
  const organizationChunks = organizationEvidence(gradedChunks);
  const direct = organizationChunks.filter(isDirectSupport);
  const partial = organizationChunks.filter(isPartialSupport);
  const background = organizationChunks.filter(isBackgroundContext);
  const negative = organizationChunks.filter(isExplicitNegativeEvidence);
  const ignoredReferenceCount = gradedChunks.length - organizationChunks.length;

  let status: FindingStatus;
  if (direct.length > 0 && negative.length > 0) {
    status = "conflicting";
  } else if (direct.length > 0) {
    status = "covered";
  } else if (partial.length > 0) {
    status = "partial";
  } else if (negative.length > 0) {
    status = "missing";
  } else if (background.length > 0) {
    status = "needs_review";
  } else {
    status = "missing";
  }

  const evidence = [...direct, ...partial, ...negative, ...background];
  return {
    requirement_id: requirement.id,
    requirement_name: requirement.title,
    status,
    severity: severityForStatus(requirement, status),
    confidence: confidenceForStatus(status, evidence),
    summary: statusSummary(requirement, status),
    remediation: remediationForFinding(requirement, status),
    rationale: rationaleForFinding({
      status,
      direct,
      partial,
      background,
      negative,
      ignoredReferenceCount,
    }),
    evidence: evidenceForStorage(evidence),
  };
}
