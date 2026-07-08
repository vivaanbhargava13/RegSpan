import type { RegSpRequirement, RegSpRequirementId } from "./regSpRequirements";

export const REG_SP_SOURCE_KEY = "sec_34_100155";

export const REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID: Record<string, RegSpRequirementId> = {
  written_incident_response_program: "written_incident_response_program",
  unauthorized_access_detection_escalation: "incident_assessment_containment_control",
  customer_notification_unauthorized_access: "customer_notification_unauthorized_access",
  customer_notification_content: "customer_notification_content",
  vendor_incident_handling: "service_provider_incident_oversight_notice",
  customer_information_safeguards: "safeguards_customer_information",
  disposal_consumer_customer_information: "disposal_consumer_customer_information",
  written_compliance_records: "written_compliance_records",
  evidence_log_preservation: "incident_evidence_log_preservation",
  regulator_law_enforcement_notification: "regulator_law_enforcement_notification_coordination",
  remediation_recovery_validation: "response_recovery_remediation_validation",
};

export const REG_SP_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY: Partial<Record<RegSpRequirementId, RegSpRequirementId>> = {
  incident_assessment_containment_control: "unauthorized_access_detection_escalation",
  service_provider_incident_oversight_notice: "vendor_incident_handling",
  safeguards_customer_information: "customer_information_safeguards",
  incident_evidence_log_preservation: "evidence_log_preservation",
  regulator_law_enforcement_notification_coordination: "regulator_law_enforcement_notification",
  response_recovery_remediation_validation: "remediation_recovery_validation",
};

export type RegulatoryControlElement = {
  id: string;
  elementKey: string;
  label: string;
  description: string;
  required: boolean;
  evidenceQuestion: string | null;
  missingIfAbsent: boolean;
  displayOrder: number;
  metadata: Record<string, unknown>;
};

export type RegulatoryControlCitation = {
  id: string;
  controlElementId: string | null;
  sourceChunkId: string;
  citationType: "primary" | "supporting" | "definition" | "exception";
  citationNote: string | null;
  displayOrder: number;
  metadata: Record<string, unknown>;
  sourceChunk: {
    id: string;
    chunkIndex: number;
    pageStart: number;
    pageEnd: number;
    heading: string | null;
    parentHeading: string | null;
    sectionPath: string | null;
    chunkKind: string;
    content: string;
    synopsis: string | null;
    metadata: Record<string, unknown>;
  } | null;
};

export type RegulatoryControl = {
  id: string;
  controlKey: RegSpRequirementId;
  name: string;
  regulation: string;
  sourceKey: string;
  category: string | null;
  summary: string;
  regulatoryRole: RegSpRequirement["regulatoryRole"];
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  displayOrder: number;
  metadata: Record<string, unknown>;
  elements: RegulatoryControlElement[];
  citations: RegulatoryControlCitation[];
};

function stringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function canonicalControlKeyForRequirement(requirement: RegSpRequirement) {
  return REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID[requirement.id] ?? requirement.id;
}

export function legacyRequirementIdForCopy(requirementId: RegSpRequirementId) {
  return REG_SP_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY[requirementId] ?? requirementId;
}

export function regulatoryControlToRegSpRequirement(control: RegulatoryControl): RegSpRequirement {
  const metadata = control.metadata;
  const evidenceCriteria = (
    metadata.evidenceCriteria
    && typeof metadata.evidenceCriteria === "object"
    && !Array.isArray(metadata.evidenceCriteria)
  )
    ? metadata.evidenceCriteria as RegSpRequirement["evidenceCriteria"]
    : {
      lookFor: control.summary,
      strongEvidence: control.summary,
      partialEvidence: `Some evidence addresses ${control.name}, but one or more required elements are unclear.`,
      missingOrNegativeEvidence: `The reviewed documents do not clearly address ${control.name}.`,
    };
  const coverageElements = control.elements.length > 0
    ? control.elements.map((element) => ({
      id: element.elementKey,
      label: element.label,
      requiredForCovered: element.required,
      signals: stringArray(element.metadata.signals, []),
    }))
    : [];
  const requiredElementsForCovered = coverageElements
    .filter((element) => element.requiredForCovered)
    .map((element) => element.id);

  return {
    id: control.controlKey,
    title: control.name,
    description: control.summary || control.name,
    sourceBasis: stringValue(metadata.sourceBasis, "SEC Release No. 34-100155, Regulation S-P final rule."),
    regulatoryRole: control.regulatoryRole,
    mvpScope: metadata.mvpScope === "supporting" || metadata.mvpScope === "future" ? metadata.mvpScope : "mvp",
    riskSeverity: control.severity,
    evidenceCriteria,
    coverageElements,
    requiredElementsForCovered,
    optionalElements: coverageElements
      .filter((element) => !element.requiredForCovered)
      .map((element) => element.id),
    strongEvidenceGuidance: evidenceCriteria.strongEvidence,
    partialEvidenceGuidance: evidenceCriteria.partialEvidence,
    missingEvidenceGuidance: evidenceCriteria.missingOrNegativeEvidence,
    retrievalQuery: stringValue(metadata.retrievalQuery, control.summary),
    directSignals: stringArray(metadata.directSignals, []),
    actionSignals: stringArray(metadata.actionSignals, []),
    topicSignals: stringArray(metadata.topicSignals, []),
    partialSignals: stringArray(metadata.partialSignals, []),
    backgroundSignals: stringArray(metadata.backgroundSignals, []),
    negativeSignals: stringArray(metadata.negativeSignals, []),
  };
}
