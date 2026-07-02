import type { GradedEvidenceChunk } from "./requirementMatching";
import type { RegSpRequirement, RegSpRequirementId } from "./regSpRequirements";

export type FindingStatus = "covered" | "partial" | "missing" | "conflicting" | "needs_review";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";
export type NegativeEvidenceScope = "organization_level_negative" | "document_scope_limitation";

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
  "customer_notification_content",
  "vendor_incident_handling",
  "customer_information_safeguards",
  "disposal_consumer_customer_information",
  "written_compliance_records",
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

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkInterpretationText(chunk: GradedEvidenceChunk) {
  return normalize([
    chunk.supporting_quote,
    chunk.negative_evidence_reason,
    chunk.grade_reason,
    chunk.content_preview,
    chunk.section_path,
    chunk.filename,
  ].filter(Boolean).join(" "));
}

export function classifyNegativeEvidenceScope(
  chunk: GradedEvidenceChunk,
): NegativeEvidenceScope {
  const text = chunkInterpretationText(chunk);
  const filename = normalize(chunk.filename);
  const sectionPath = normalize(chunk.section_path);
  const documentScopePatterns = [
    /\bthis\s+(policy|procedure|document|standard|addendum|guide|checklist|section|runbook)\b.{0,120}\b(does not|doesn t|do not|does not fully|does not establish|does not define|does not address|does not authorize|does not require|does not replace|is not intended|not intended)\b/,
    /\b(outside|out of)\s+the\s+scope\s+of\s+this\s+(policy|procedure|document|standard|addendum|guide|checklist|section|runbook)\b/,
    /\b(this|the)\s+(policy|procedure|document|standard|addendum|guide|checklist|section|runbook)\b.{0,120}\b(scope|scoped|limited|limitation)\b/,
    /\b(reserved for|handled in|addressed in)\s+(a\s+)?(separate|another|other)\s+(policy|procedure|document|standard|governance document)\b/,
  ];
  const organizationNegativePatterns = [
    /\b(the\s+)?(firm|organization|company|enterprise)\s+(does not|doesn t|do not|has not|hasn t|will not|does not maintain|does not perform|does not require|has not established)\b/,
    /\bno\s+(formal\s+)?(process|procedure|program|policy|control|standard|customer notification procedure|incident response program)\s+(exists|exist|has been established|is maintained|is required)\b/,
    /\bthere\s+is\s+no\s+(formal\s+)?(process|procedure|program|policy|control|standard)\b/,
    /\bmanagement\s+has\s+not\s+assigned\s+responsibility\b/,
    /\bthe\s+control\s+is\s+not\s+required\s+by\s+the\s+(firm|organization|company|enterprise)\b/,
  ];

  if (organizationNegativePatterns.some((pattern) => pattern.test(text))) {
    return "organization_level_negative";
  }

  if (
    documentScopePatterns.some((pattern) => pattern.test(text)) ||
    (filename.includes("acceptable use") && text.includes("does not")) ||
    (filename.includes("procedure") && (text.includes("does not define") || text.includes("does not establish"))) ||
    (sectionPath.includes("scope") && text.includes("does not"))
  ) {
    return "document_scope_limitation";
  }

  return "organization_level_negative";
}

function textForWeighting(chunk: GradedEvidenceChunk) {
  return normalize([
    chunk.filename,
    chunk.section_path,
    chunk.grade_reason,
    chunk.content_preview,
  ].filter(Boolean).join(" "));
}

function signalWeight(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const text = textForWeighting(chunk);
  const signals = [
    ...(requirement.directSignals ?? []),
    ...(requirement.actionSignals ?? []),
    ...(requirement.topicSignals ?? []),
  ].map(normalize).filter(Boolean);
  return signals.filter((signal) => text.includes(signal)).length;
}

function evidenceWeight(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const text = textForWeighting(chunk);
  let weight = chunk.rerank_score ?? 0;
  if (isDirectSupport(chunk)) weight += 120;
  if (isPartialSupport(chunk)) weight += 70;
  if (isBackgroundContext(chunk)) weight += 20;
  if (isExplicitNegativeEvidence(chunk)) {
    weight += classifyNegativeEvidenceScope(chunk) === "organization_level_negative" ? 90 : 25;
  }
  weight += signalWeight(requirement, chunk) * 8;
  if (chunk.classifier_confidence === "high") weight += 10;
  if (text.includes("incident response policy") || text.includes("response standard")) weight += 18;
  if (text.includes("privacy policy") || text.includes("safeguards program")) weight += 12;
  if (text.includes("acceptable use")) weight -= 25;
  if (text.includes("scope") || text.includes("limitation")) weight -= 8;
  return weight;
}

function sortByEvidenceWeight(requirement: RegSpRequirement, chunks: GradedEvidenceChunk[]) {
  return [...chunks].sort(
    (left, right) => evidenceWeight(requirement, right) - evidenceWeight(requirement, left),
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function elementLabel(requirement: RegSpRequirement, elementId: string) {
  return requirement.coverageElements.find((element) => element.id === elementId)?.label ?? elementId;
}

function elementList(requirement: RegSpRequirement, elementIds: string[]) {
  return elementIds.map((elementId) => elementLabel(requirement, elementId));
}

function sentenceList(values: string[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function coverageForChunks(requirement: RegSpRequirement, chunks: GradedEvidenceChunk[]) {
  const coveredRequired = uniqueStrings(chunks.flatMap((chunk) => chunk.covered_elements ?? []))
    .filter((elementId) => requirement.requiredElementsForCovered.includes(elementId));
  const vagueRequired = uniqueStrings(chunks.flatMap((chunk) => chunk.vague_elements ?? []))
    .filter((elementId) => requirement.requiredElementsForCovered.includes(elementId));
  const missingRequired = requirement.requiredElementsForCovered.filter(
    (elementId) => !coveredRequired.includes(elementId),
  );

  return {
    coveredRequired,
    missingRequired,
    vagueRequired,
    hasFullRequiredCoverage: missingRequired.length === 0,
  };
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
      return "Appears covered based on reviewed documents.";
    case "partial":
      return "Partially covered based on reviewed documents.";
    case "missing":
      return "RegSpan did not find clear evidence that this control is defined.";
    case "conflicting":
      return "Reviewed documents appear to conflict on whether this control is defined.";
    case "needs_review":
      return "The evidence is unclear and should be reviewed by a person.";
  }
}

export function remediationForFinding(requirement: RegSpRequirement, status: FindingStatus) {
  if (status === "covered") {
    return "Keep the cited policy or procedure current. Consider cross-referencing it from related security and compliance documents so users know where this control is defined.";
  }

  const base = `Update the organization’s documentation to clearly address this requirement: ${requirement.description}`;
  if (status === "conflicting") {
    return `${base} Resolve the contradiction between the documents and identify which policy or procedure is authoritative.`;
  }
  if (status === "partial") {
    return `${base} Add the missing owner, timing, approval, escalation, handoff, or follow-up details where applicable.`;
  }
  if (status === "needs_review") {
    return `${base} Have a compliance or security owner confirm whether the cited document is intended to satisfy this requirement.`;
  }
  return `${base} Create or update a written policy or procedure that defines responsibility, timing, required steps, and records to retain.`;
}

function reviewedDocumentLabel(chunk: GradedEvidenceChunk | undefined) {
  return chunk?.filename ? `The reviewed document ${chunk.filename}` : "A reviewed document";
}

function quoteSummary(chunk: GradedEvidenceChunk | undefined) {
  const quote = chunk?.supporting_quote?.trim();
  if (!quote) return null;
  return quote.length > 180 ? `${quote.slice(0, 177).trim()}…` : quote;
}

function whatWeFoundForFinding({
  requirement,
  status,
  direct,
  partial,
  background,
  organizationNegative,
  documentScopeLimitations,
  ignoredReferenceCount,
  coveredRequired,
  missingRequired,
  vagueRequired,
}: {
  requirement: RegSpRequirement;
  status: FindingStatus;
  direct: GradedEvidenceChunk[];
  partial: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
  organizationNegative: GradedEvidenceChunk[];
  documentScopeLimitations: GradedEvidenceChunk[];
  ignoredReferenceCount: number;
  coveredRequired: string[];
  missingRequired: string[];
  vagueRequired: string[];
}) {
  const strongestSupport = direct[0] ?? partial[0];
  const strongestLimitation = documentScopeLimitations[0];
  const strongestOrganizationNegative = organizationNegative[0];
  const supportQuote = quoteSummary(strongestSupport);
  const limitationQuote = quoteSummary(strongestLimitation);
  const organizationNegativeQuote = quoteSummary(strongestOrganizationNegative);
  const supportDocument = reviewedDocumentLabel(strongestSupport);
  const limitationDocument = reviewedDocumentLabel(strongestLimitation);
  const negativeDocument = reviewedDocumentLabel(strongestOrganizationNegative);
  const coveredLabels = elementList(requirement, coveredRequired);
  const missingLabels = elementList(requirement, missingRequired);
  const vagueLabels = elementList(requirement, vagueRequired);
  const parts: string[] = [];

  if (status === "covered") {
    if (supportQuote) {
      parts.push(`${supportDocument} states: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} provides reviewed evidence for the required elements.`);
    }
    if (coveredLabels.length > 0) {
      parts.push(`Reviewed evidence covers: ${sentenceList(coveredLabels)}.`);
    }
    if (documentScopeLimitations.length > 0) {
      parts.push("Related documents say they do not cover this control, which appears to be a scope limitation for those documents rather than a contradiction.");
    }
  }

  if (status === "partial") {
    if (supportQuote) {
      parts.push(`${supportDocument} mentions this area: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} mentions this area, but the reviewed evidence does not clearly define the full process.`);
    }
    if (coveredLabels.length > 0) {
      parts.push(`Reviewed evidence covers: ${sentenceList(coveredLabels)}.`);
    }
    if (missingLabels.length > 0) {
      parts.push(`RegSpan did not find clear evidence for: ${sentenceList(missingLabels)}.`);
    } else if (vagueLabels.length > 0) {
      parts.push(`Some required elements are still vague: ${sentenceList(vagueLabels)}.`);
    } else {
      parts.push("Important details such as ownership, timing, approvals, escalation, or follow-up may still need to be documented.");
    }
    if (documentScopeLimitations.length > 0) {
      parts.push("Some related documents limit their own scope, so they should not be treated as organization-wide contradictions by themselves.");
    }
  }

  if (status === "conflicting") {
    if (supportQuote) {
      parts.push(`${supportDocument} appears to support this control: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} appears to support this control.`);
    }
    if (organizationNegativeQuote) {
      parts.push(`${negativeDocument} appears to contradict that support: “${organizationNegativeQuote}”`);
    } else {
      parts.push(`${negativeDocument} appears to say the firm does not maintain or perform this control.`);
    }
    parts.push("A reviewer should confirm which document is authoritative.");
  }

  if (status === "missing") {
    if (organizationNegativeQuote) {
      parts.push(`${negativeDocument} states: “${organizationNegativeQuote}”`);
      parts.push("RegSpan did not find stronger reviewed policy evidence showing this control is defined.");
    } else {
      parts.push("RegSpan did not find clear policy or procedure language in the reviewed documents that defines this control.");
    }
  }

  if (status === "needs_review") {
    if (documentScopeLimitations.length > 0 && !strongestSupport) {
      if (limitationQuote) {
        parts.push(`${limitationDocument} says it does not cover this control: “${limitationQuote}”`);
      } else {
        parts.push(`${limitationDocument} says it does not cover this control.`);
      }
      parts.push("That may describe the limits of that document rather than proof that the firm lacks the control.");
    } else if (background.length > 0) {
      parts.push("RegSpan found related context, but it was not specific enough to show whether this control is defined.");
    } else {
      parts.push("The reviewed evidence was not clear enough to determine whether this control is defined.");
    }
  }

  if (ignoredReferenceCount > 0) {
    parts.push("Public guidance or other reference material was not treated as proof that the firm has this control.");
  }

  return parts.join(" ");
}

function evidenceReasonForStorage(
  requirement: RegSpRequirement,
  chunk: GradedEvidenceChunk,
  negativeScopeByChunkId: Map<string, NegativeEvidenceScope>,
) {
  const reason = chunk.grade_reason
    .replace(/\bthe chunk\b/gi, "the cited text")
    .replace(/\bchunk\b/gi, "cited text")
    .trim();
  const negativeScope = negativeScopeByChunkId.get(chunk.chunk_id);
  if (negativeScope === "organization_level_negative") {
    return `The firm appears not to have this control: ${reason}`;
  }
  if (negativeScope === "document_scope_limitation") {
    return `This document says it does not cover this control: ${reason}`;
  }
  if (chunk.evidence_relationship === "supports") {
    const covered = elementList(requirement, chunk.covered_elements ?? []);
    return covered.length > 0
      ? `This section supports: ${sentenceList(covered)}. ${reason}`
      : `This section supports this requirement. ${reason}`;
  }
  if (chunk.evidence_relationship === "partially_supports") {
    const covered = elementList(requirement, chunk.covered_elements ?? []);
    const missing = elementList(requirement, chunk.missing_elements ?? []);
    return [
      covered.length > 0
        ? `This section partially addresses: ${sentenceList(covered)}.`
        : "This section partially addresses this requirement.",
      missing.length > 0 ? `Missing or unclear: ${sentenceList(missing)}.` : null,
      reason,
    ].filter(Boolean).join(" ");
  }
  if (chunk.evidence_relationship === "background_context") {
    return `Background: ${reason}`;
  }
  return reason;
}

function evidenceForStorage(
  requirement: RegSpRequirement,
  chunks: GradedEvidenceChunk[],
  negativeScopeByChunkId: Map<string, NegativeEvidenceScope>,
): GeneratedFindingEvidence[] {
  return chunks.slice(0, 6).map((chunk) => ({
    chunk_id: chunk.chunk_id,
    document_id: chunk.document_id,
    relationship: chunk.evidence_relationship,
    quote: chunk.supporting_quote,
    reason: evidenceReasonForStorage(requirement, chunk, negativeScopeByChunkId),
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
  const negativeScopeByChunkId = new Map(
    negative.map((chunk) => [chunk.chunk_id, classifyNegativeEvidenceScope(chunk)]),
  );
  const organizationNegative = negative.filter(
    (chunk) => negativeScopeByChunkId.get(chunk.chunk_id) === "organization_level_negative",
  );
  const documentScopeLimitations = negative.filter(
    (chunk) => negativeScopeByChunkId.get(chunk.chunk_id) === "document_scope_limitation",
  );
  const ignoredReferenceCount = gradedChunks.length - organizationChunks.length;
  const strongestDirect = sortByEvidenceWeight(requirement, direct);
  const strongestPartial = sortByEvidenceWeight(requirement, partial);
  const strongestOrganizationNegative = sortByEvidenceWeight(requirement, organizationNegative);
  const strongestDocumentScopeLimitations = sortByEvidenceWeight(requirement, documentScopeLimitations);
  const strongestBackground = sortByEvidenceWeight(requirement, background);
  const supportingEvidence = [...strongestDirect, ...strongestPartial];
  const coverage = coverageForChunks(requirement, supportingEvidence);
  const supportChunksWithCoveredElements = supportingEvidence.filter((chunk) => (chunk.covered_elements ?? []).length > 0);
  const hasDirectSupport = strongestDirect.length > 0;
  const hasComplementarySupport = supportChunksWithCoveredElements.length >= 2;
  const hasMeaningfulElementSupport = coverage.coveredRequired.length > 0;

  let status: FindingStatus;
  if (coverage.hasFullRequiredCoverage && (hasDirectSupport || hasComplementarySupport) && strongestOrganizationNegative.length > 0) {
    status = "conflicting";
  } else if (coverage.hasFullRequiredCoverage && (hasDirectSupport || hasComplementarySupport)) {
    status = "covered";
  } else if (strongestPartial.length > 0 && strongestOrganizationNegative.length > 0) {
    status = "needs_review";
  } else if (strongestPartial.length > 0 || hasMeaningfulElementSupport) {
    status = "partial";
  } else if (strongestOrganizationNegative.length > 0) {
    status = "missing";
  } else if (strongestDocumentScopeLimitations.length > 0) {
    status = "needs_review";
  } else if (strongestBackground.length > 0) {
    status = "needs_review";
  } else {
    status = "missing";
  }

  const evidence = [
    ...strongestDirect,
    ...strongestPartial,
    ...strongestOrganizationNegative,
    ...strongestDocumentScopeLimitations,
    ...strongestBackground,
  ];
  return {
    requirement_id: requirement.id,
    requirement_name: requirement.title,
    status,
    severity: severityForStatus(requirement, status),
    confidence: confidenceForStatus(status, evidence),
    summary: statusSummary(requirement, status),
    remediation: remediationForFinding(requirement, status),
    rationale: whatWeFoundForFinding({
      requirement,
      status,
      direct,
      partial,
      background,
      organizationNegative,
      documentScopeLimitations,
      ignoredReferenceCount,
      coveredRequired: coverage.coveredRequired,
      missingRequired: coverage.missingRequired,
      vagueRequired: coverage.vagueRequired,
    }),
    evidence: evidenceForStorage(requirement, evidence, negativeScopeByChunkId),
  };
}
