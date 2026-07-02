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

function sentenceList(values: string[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

const foundElementCopy: Partial<Record<RegSpRequirementId, Record<string, string>>> = {
  written_incident_response_program: {
    written_program: "maintains a written incident response program or equivalent standard",
    customer_information_scope: "applies the response process to customer information",
    response_recovery_responsibilities: "defines response and recovery responsibilities",
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: "requires assessment of the nature and scope of unauthorized access or use",
    customer_information_systems: "addresses affected customer information systems or information types",
    containment_control: "requires containment or control steps",
  },
  customer_notification_unauthorized_access: {
    unauthorized_access_or_use: "addresses unauthorized access to or use of sensitive customer information",
    notice_trigger: "defines when customer notice is required",
    notice_trigger_standard: "defines when customer notice is required",
    notice_timing: "defines the timing for customer notice",
  },
  customer_notification_content: {
    incident_description: "describes what happened",
    information_involved: "identifies the sensitive customer information involved",
    protective_steps: "includes protective steps for affected individuals",
    contact_information: "provides contact information for questions",
  },
  vendor_incident_handling: {
    service_provider_scope: "applies to service providers or vendors handling customer information",
    notice_to_firm: "requires vendors or service providers to notify the firm",
    cooperation_remediation: "requires cooperation with investigation, remediation, or recovery",
  },
  customer_information_safeguards: {
    customer_information_scope: "applies safeguards to customer information",
    safeguards_controls: "describes safeguards or access controls",
  },
  disposal_consumer_customer_information: {
    disposal_scope: "applies disposal requirements to consumer or customer information",
    secure_disposal_method: "defines secure disposal or destruction methods",
  },
  written_compliance_records: {
    compliance_record_scope: "requires written compliance records",
    notice_determination_records: "documents incident or notification decisions and notices",
    retention_accessibility: "defines retention or accessible storage",
  },
  evidence_log_preservation: {
    incident_materials: "preserves incident logs, evidence, or investigation records",
    integrity_or_chain_of_custody: "maintains evidence integrity or chain of custody",
  },
  remediation_recovery_validation: {
    recovery_steps: "defines recovery steps",
    remediation_tracking: "tracks remediation or corrective actions",
    validation_testing: "validates recovery or remediation",
  },
  regulator_law_enforcement_notification: {
    external_notification_decisioning: "defines external notification decisioning",
    legal_compliance_owner: "assigns legal or compliance ownership",
  },
};

const missingElementCopy: Partial<Record<RegSpRequirementId, Record<string, string>>> = {
  written_incident_response_program: {
    written_program: "a maintained written incident response program or equivalent policy",
    customer_information_scope: "that the program applies to customer information",
    response_recovery_responsibilities: "response and recovery responsibilities",
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: "how the firm assesses the nature and scope of unauthorized access or use",
    customer_information_systems: "how affected customer information systems or information types are identified",
    containment_control: "required containment or control steps",
  },
  customer_notification_unauthorized_access: {
    unauthorized_access_or_use: "language tying notice to unauthorized access or use of sensitive customer information",
    notice_trigger: "the decision standard for when notice is required, including substantial harm or inconvenience",
    notice_trigger_standard: "the decision standard for when notice is required, including substantial harm or inconvenience",
    notice_timing: "the required timing for notice",
  },
  customer_notification_content: {
    incident_description: "notice language describing what happened",
    information_involved: "notice language identifying the sensitive customer information involved",
    protective_steps: "protective steps or resources for affected individuals",
    contact_information: "required contact information for questions",
  },
  vendor_incident_handling: {
    service_provider_scope: "coverage for service providers or vendors handling customer information",
    notice_to_firm: "vendor or service-provider notice to the firm",
    cooperation_remediation: "vendor cooperation with investigation, remediation, or recovery",
  },
  customer_information_safeguards: {
    customer_information_scope: "that the safeguards apply to customer information",
    safeguards_controls: "administrative, technical, or physical safeguards",
  },
  disposal_consumer_customer_information: {
    disposal_scope: "consumer or customer information disposal scope",
    secure_disposal_method: "secure disposal, destruction, shredding, wiping, or sanitization methods",
  },
  written_compliance_records: {
    compliance_record_scope: "written records documenting Reg S-P compliance",
    notice_determination_records: "incident or notification determinations and notice records",
    retention_accessibility: "retention period or accessible storage requirements",
  },
  evidence_log_preservation: {
    incident_materials: "how logs, evidence, or investigation records must be preserved",
    integrity_or_chain_of_custody: "evidence integrity or chain-of-custody requirements",
  },
  remediation_recovery_validation: {
    recovery_steps: "required recovery steps",
    remediation_tracking: "remediation or corrective-action tracking",
    validation_testing: "how recovery or remediation must be validated",
  },
  regulator_law_enforcement_notification: {
    external_notification_decisioning: "who decides when external notification is required",
    legal_compliance_owner: "legal or compliance ownership for external notification decisions",
  },
};

type ElementPhraseMode = "found" | "missing" | "partial";

const partialElementCopy: Partial<Record<RegSpRequirementId, Record<string, string>>> = {
  written_incident_response_program: {
    written_program: "a written incident response program or equivalent standard",
    customer_information_scope: "customer-information scope",
    response_recovery_responsibilities: "response and recovery responsibilities",
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: "incident assessment",
    customer_information_systems: "affected customer information systems or information types",
    containment_control: "containment or control steps",
  },
  customer_notification_unauthorized_access: {
    unauthorized_access_or_use: "customer notification after unauthorized access or use",
    notice_trigger: "customer-notice decisioning",
    notice_trigger_standard: "customer-notice decisioning",
    notice_timing: "customer-notice timing",
  },
  customer_notification_content: {
    incident_description: "incident-description content",
    information_involved: "identification of affected sensitive customer information",
    protective_steps: "protective steps for affected individuals",
    contact_information: "contact information for questions",
  },
  vendor_incident_handling: {
    service_provider_scope: "service-provider or vendor incident scope",
    notice_to_firm: "vendor or service-provider notice to the firm",
    cooperation_remediation: "vendor cooperation with investigation, remediation, or recovery",
  },
  customer_information_safeguards: {
    customer_information_scope: "safeguards for customer information",
    safeguards_controls: "administrative, technical, or physical safeguards",
  },
  disposal_consumer_customer_information: {
    disposal_scope: "consumer or customer information disposal scope",
    secure_disposal_method: "secure disposal or destruction methods",
  },
  written_compliance_records: {
    compliance_record_scope: "written compliance records",
    notice_determination_records: "incident or notification decision records",
    retention_accessibility: "record retention or accessible storage",
  },
  evidence_log_preservation: {
    incident_materials: "evidence and log preservation",
    integrity_or_chain_of_custody: "evidence integrity or chain of custody",
  },
  remediation_recovery_validation: {
    recovery_steps: "recovery steps",
    remediation_tracking: "remediation or corrective-action tracking",
    validation_testing: "recovery or remediation validation",
  },
  regulator_law_enforcement_notification: {
    external_notification_decisioning: "external notification decisioning",
    legal_compliance_owner: "legal or compliance ownership",
  },
};

function elementPhrase(requirement: RegSpRequirement, elementId: string, mode: ElementPhraseMode) {
  const map = mode === "found"
    ? foundElementCopy
    : mode === "partial"
      ? partialElementCopy
      : missingElementCopy;
  return map[requirement.id]?.[elementId]
    ?? foundElementCopy[requirement.id]?.[elementId]
    ?? elementLabel(requirement, elementId).replace(/^(Defines|Requires|Applies|Identifies|Includes|Provides)\s+/i, "").toLowerCase();
}

function renderedElementList(
  requirement: RegSpRequirement,
  elementIds: string[],
  mode: ElementPhraseMode,
) {
  return sentenceList(elementIds.map((elementId) => elementPhrase(requirement, elementId, mode)));
}

function coveredFindingSentence(requirement: RegSpRequirement, coveredRequired: string[]) {
  const elements = renderedElementList(requirement, coveredRequired, "found");
  if (!elements) return "The reviewed policy defines the main elements of this requirement.";

  switch (requirement.id) {
    case "customer_information_safeguards":
      return `The reviewed policy ${elements}.`;
    case "vendor_incident_handling":
      return `The reviewed policy ${elements}.`;
    case "written_compliance_records":
      return `The reviewed policy ${elements}.`;
    case "customer_notification_content":
      return `The reviewed policy defines notice-content requirements that ${elements}.`;
    case "disposal_consumer_customer_information":
      return `The reviewed policy ${elements}.`;
    default:
      return `The reviewed policy defines the main elements of this requirement and ${elements}.`;
  }
}

function partialMissingSentence(requirement: RegSpRequirement, missingRequired: string[]) {
  const elements = renderedElementList(requirement, missingRequired, "missing");
  if (!elements) return "Some required details are still unclear.";

  switch (requirement.id) {
    case "customer_notification_content":
      return `RegSpan did not find clear language requiring the notice to include ${elements}.`;
    case "customer_notification_unauthorized_access":
      return `RegSpan did not find clear language defining ${elements}.`;
    case "disposal_consumer_customer_information":
      return `RegSpan did not find clear disposal language covering ${elements}.`;
    case "written_compliance_records":
      return `RegSpan did not find clear recordkeeping language covering ${elements}.`;
    case "vendor_incident_handling":
      return `RegSpan did not find clear service-provider language covering ${elements}.`;
    default:
      return `RegSpan did not find clear language covering ${elements}.`;
  }
}

function partialRemediationForRequirement(requirement: RegSpRequirement) {
  switch (requirement.id) {
    case "customer_notification_content":
      return "The reviewed documents mention this area, but they do not clearly define notice-content requirements. Add requirements covering what happened, what information was involved, what the firm is doing, how affected individuals can get help, protective steps, and required contact information.";
    case "customer_notification_unauthorized_access":
      return "The reviewed documents mention this area, but they do not clearly define the full notification trigger and timing. Clarify the decision standard for when notice is required, including sensitive customer information, substantial harm or inconvenience, and required timing.";
    case "disposal_consumer_customer_information":
      return "The reviewed documents mention this area, but they do not clearly define disposal requirements. Define how consumer and customer information must be securely disposed of, who owns the process, and what records or vendor handoffs are required.";
    case "written_compliance_records":
      return "The reviewed documents mention this area, but they do not clearly define required compliance records. Define what records must be retained, who owns them, how long they are retained, and where they remain accessible.";
    case "vendor_incident_handling":
      return "The reviewed documents mention this area, but they do not clearly define service-provider incident obligations. Add vendor notice, cooperation, investigation, remediation, recovery, and timing requirements.";
    default:
      return `The reviewed documents mention this area, but they do not clearly define all required elements. Add the missing details described in the finding and identify the owner, timing, approvals, escalation, handoffs, and records where applicable.`;
  }
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
    return partialRemediationForRequirement(requirement);
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
  const coveredSummary = coveredFindingSentence(requirement, coveredRequired);
  const missingSummary = partialMissingSentence(requirement, missingRequired);
  const vagueSummary = partialMissingSentence(requirement, vagueRequired);
  const parts: string[] = [];

  if (status === "covered") {
    if (supportQuote) {
      parts.push(`${supportDocument} states: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} defines the main elements of this requirement.`);
    }
    if (coveredRequired.length > 0) {
      parts.push(coveredSummary);
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
    if (coveredRequired.length > 0) {
      parts.push(coveredSummary);
    }
    if (missingRequired.length > 0) {
      parts.push(missingSummary);
    } else if (vagueRequired.length > 0) {
      parts.push(vagueSummary);
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
    const covered = renderedElementList(requirement, chunk.covered_elements ?? [], "found");
    return covered.length > 0
      ? `This section ${covered}. ${reason}`
      : `This section is relevant to the requirement. ${reason}`;
  }
  if (chunk.evidence_relationship === "partially_supports") {
    const covered = renderedElementList(requirement, chunk.covered_elements ?? [], "partial");
    const missing = renderedElementList(requirement, chunk.missing_elements ?? [], "missing");
    return [
      covered.length > 0
        ? `This section discusses ${covered}${missing.length > 0 ? "," : "."}`
        : missing.length > 0
          ? "This section mentions this topic,"
          : "This section is related to this requirement.",
      missing.length > 0 ? `but it does not clearly define ${missing}.` : null,
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
