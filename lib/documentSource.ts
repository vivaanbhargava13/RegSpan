export type DocumentSourceType =
  | "client_policy"
  | "client_procedure"
  | "client_standard"
  | "vendor_contract"
  | "regulatory_guidance"
  | "control_framework"
  | "sample_template"
  | "unknown";

export type EvidenceRole =
  | "organization_evidence"
  | "requirement_reference"
  | "supporting_context";

export type DocumentSourceInput = {
  filename?: string | null;
  documentType?: string | null;
  notes?: string | null;
  sectionPath?: string | null;
  contentPreview?: string | null;
  evidenceReason?: string | null;
};

export type ResolvedDocumentChunkProvenance = {
  sourceType: DocumentSourceType;
  evidenceRole: EvidenceRole;
  source: "persisted" | "inferred";
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[_./()[\]{}:-]/g, " ")
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceText(input: DocumentSourceInput) {
  return normalize([
    input.filename,
    input.documentType,
    input.notes,
    input.sectionPath,
    input.contentPreview,
    input.evidenceReason,
  ].filter(Boolean).join(" "));
}

function descriptorText(input: DocumentSourceInput) {
  return normalize([
    input.filename,
    input.documentType,
    input.notes,
  ].filter(Boolean).join(" "));
}

function documentIdentityText(input: DocumentSourceInput) {
  return normalize([
    input.filename,
    input.documentType,
  ].filter(Boolean).join(" "));
}

function explicitMetadataText(input: DocumentSourceInput) {
  return normalize([
    input.documentType,
    input.notes,
    input.sectionPath,
    input.contentPreview,
  ].filter(Boolean).join(" "));
}

function contentHintText(input: DocumentSourceInput) {
  return normalize([
    input.sectionPath,
    input.contentPreview,
    input.evidenceReason,
  ].filter(Boolean).join(" "));
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const explicitSourceTypeSignals: Array<[DocumentSourceType, RegExp[]]> = [
  ["client_policy", [
    /\bdocument\s+class\s+client\s+policy\b/,
    /\bsource\s*type\s*client\s*policy\b/,
    /\bsource\s*type\s*organization\s*policy\b/,
  ]],
  ["client_procedure", [
    /\bdocument\s+class\s+client\s+procedure\b/,
    /\bsource\s*type\s*client\s*procedure\b/,
    /\bsource\s*type\s*organization\s*procedure\b/,
  ]],
  ["client_standard", [
    /\bdocument\s+class\s+client\s+standard\b/,
    /\bsource\s*type\s*client\s*standard\b/,
    /\bsource\s*type\s*organization\s*standard\b/,
  ]],
  ["vendor_contract", [
    /\bdocument\s+class\s+vendor\s+contract\b/,
    /\bdocument\s+class\s+vendor\s+contract\s+addendum\b/,
    /\bdocument\s+class\s+third\s+party\s+security\s+incident\s+addendum\b/,
    /\bsource\s*type\s*vendor\s*contract\b/,
    /\bsource\s*type\s*service\s*provider\s*contract\b/,
  ]],
  ["regulatory_guidance", [/\bsource\s*type\s*regulatory\s*guidance\b/]],
  ["control_framework", [/\bsource\s*type\s*control\s*framework\b/]],
  ["sample_template", [/\bsource\s*type\s*sample\s*template\b/]],
  ["unknown", [/\bsource\s*type\s*unknown\b/]],
];

const controlFrameworkSignals = [
  /\bnist\b/,
  /\bsp\s*800\b/,
  /\bcybersecurity framework\b/,
  /\bcsf\b/,
  /\biso\s*2700[12]\b/,
  /\bcis\s+controls?\b/,
  /\bcobit\b/,
  /\bcontrol framework\b/,
  /\bframework profile\b/,
  /\bcore cybersecurity controls?\b/,
  /\bcybersecurity controls?\b.*\bchecklist\b/,
  /\bffiec\b.*\b(cybersecurity|assessment|maturity|control|baseline)\b/,
  /\bfinra\b.*\b(cybersecurity|controls?|report|checklist|framework)\b/,
];

const regulatoryPublisherSignals = [
  /\bsecurities and exchange commission\b/,
  /\bsec\b/,
  /\bfederal trade commission\b/,
  /\bftc\b/,
  /\bcisa\b/,
  /\bffiec\b/,
  /\bfinra\b/,
];

const regulatoryPublicationSignals = [
  /\bfinal rule\b/,
  /\badopting release\b/,
  /\bcommission release\b/,
  /\brelease no\b/,
  /\bofficial (?:rule|guidance)\b/,
  /\bfederal register\b/,
  /\bsafeguards rule\b/,
  /\bcompliance guide\b/,
  /\bexamination manual\b/,
  /\b(?:federal government|us government)\b.*\b(?:cybersecurity\s+)?(?:incident(?:\s+and\s+vulnerability)?|vulnerability)\s+response\s+playbooks?\b/,
  /\b(?:cybersecurity|incident(?:\s+and\s+vulnerability)?|vulnerability)\s+response\s+playbooks?\b.*\b(?:federal|government|cisa)\b/,
];

const contentControlFrameworkSignals = [
  /\bnist\b/,
  /\bsp\s*800\b/,
  /\bcybersecurity framework\b/,
  /\bffiec\b/,
  /\bfinra\b.*\b(cybersecurity|controls?|report|checklist|framework)\b/,
  /\bcore cybersecurity controls?\b/,
];

const sampleTemplateSignals = [
  /\bsample\b/,
  /\btemplate\b/,
  /\bexample\b/,
  /\bmodel policy\b/,
  /\bstarter\b/,
  /\bdraft\b/,
];

const vendorContractSignals = [
  /\bvendor\b.*\b(contract|agreement|msa|sla|dpa|addendum|schedule)\b/,
  /\bsupplier\b.*\b(contract|agreement|addendum|schedule|incident notice)\b/,
  /\bservice provider\b.*\b(contract|agreement|responsibilities|addendum)\b/,
  /\bthird party\b.*\b(contract|agreement|risk management|notification)\b/,
  /\bthird party security incident addendum\b/,
  /\bsecurity incident addendum\b/,
  /\bcontract addendum\b/,
  /\bmaster service agreement\b/,
  /\bdata processing agreement\b/,
  /\bvendor agreement\b/,
  /\bsecurity addendum\b/,
];

const clientProcedureSignals = [
  /\bprocedure\b/,
  /\bprocedures\b/,
  /\brunbook\b/,
  /\bsop\b/,
  /\bstandard operating procedure\b/,
  /\bresponse procedure\b/,
  /\bescalation procedure\b/,
  /\bincident response playbook\b/,
];

const clientPolicySignals = [
  /\bpolicy\b/,
  /\bpolicies\b/,
  /\bprogram\b/,
  /\bplan\b/,
  /\bstandard\b/,
  /\binformation security program\b/,
  /\bincident response plan\b/,
  /\bprivacy program\b/,
  /\bsafeguards program\b/,
];

function hasRegulatoryPublicationIdentity(value: string) {
  return hasAny(value, [/\bfederal register\b/]) || (
    hasAny(value, regulatoryPublisherSignals)
    && hasAny(value, regulatoryPublicationSignals)
  );
}

export function inferDocumentSourceType(input: DocumentSourceInput): DocumentSourceType {
  const text = sourceText(input);
  if (!text) {
    return "unknown";
  }

  const descriptor = descriptorText(input);
  const identity = documentIdentityText(input);
  const contentHint = contentHintText(input);
  const explicitMetadata = explicitMetadataText(input);

  if (hasAny(descriptor, controlFrameworkSignals)) {
    return "control_framework";
  }
  if (hasRegulatoryPublicationIdentity(identity)) {
    return "regulatory_guidance";
  }
  if (hasAny(contentHint, contentControlFrameworkSignals)) {
    return "control_framework";
  }
  for (const [sourceType, patterns] of explicitSourceTypeSignals) {
    if (hasAny(explicitMetadata, patterns)) {
      return sourceType;
    }
  }
  if (hasAny(descriptor, sampleTemplateSignals)) {
    return "sample_template";
  }
  if (hasAny(descriptor, vendorContractSignals) || hasAny(contentHint, vendorContractSignals)) {
    return "vendor_contract";
  }
  if (hasAny(descriptor, clientProcedureSignals)) {
    return "client_procedure";
  }
  if (hasAny(descriptor, clientPolicySignals)) {
    return "client_policy";
  }

  return "unknown";
}

export function evidenceRoleForSourceType(sourceType: DocumentSourceType): EvidenceRole {
  if (
    sourceType === "client_policy"
    || sourceType === "client_procedure"
    || sourceType === "client_standard"
    || sourceType === "vendor_contract"
  ) {
    return "organization_evidence";
  }

  if (sourceType === "regulatory_guidance" || sourceType === "control_framework") {
    return "requirement_reference";
  }

  return "supporting_context";
}

export function inferEvidenceRole(input: DocumentSourceInput): EvidenceRole {
  const sourceType = inferDocumentSourceType(input);
  if (sourceType === "regulatory_guidance" || sourceType === "control_framework") {
    return "requirement_reference";
  }

  const explicitMetadata = explicitMetadataText(input);
  if (/\bevidence\s+role\s+organization\s+evidence\b/.test(explicitMetadata)) {
    return "organization_evidence";
  }

  return evidenceRoleForSourceType(sourceType);
}

export function resolveDocumentSource(input: DocumentSourceInput) {
  const sourceType = inferDocumentSourceType(input);
  return {
    sourceType,
    evidenceRole: inferEvidenceRole(input),
  };
}

function isDocumentSourceType(value: unknown): value is DocumentSourceType {
  return value === "client_policy"
    || value === "client_procedure"
    || value === "client_standard"
    || value === "vendor_contract"
    || value === "regulatory_guidance"
    || value === "control_framework"
    || value === "sample_template"
    || value === "unknown";
}

function isEvidenceRole(value: unknown): value is EvidenceRole {
  return value === "organization_evidence"
    || value === "requirement_reference"
    || value === "supporting_context";
}

/**
 * Resolves provenance only from metadata loaded from the server-controlled
 * document_chunks table. The document/workspace identifiers and canonical
 * source-type/role pairing prevent arbitrary document fields from changing a
 * persisted regulatory or client classification during retrieval.
 */
export function resolvePersistedDocumentChunkProvenance({
  metadata,
  documentId,
  workspaceId,
  fallback,
}: {
  metadata: Record<string, unknown> | null | undefined;
  documentId: string;
  workspaceId: string;
  fallback: DocumentSourceInput;
}): ResolvedDocumentChunkProvenance {
  const sourceType = metadata?.source_type;
  const evidenceRole = metadata?.evidence_role;
  const hasMatchingScope = metadata?.document_id === documentId
    && metadata?.workspace_id === workspaceId;

  if (
    hasMatchingScope
    && isDocumentSourceType(sourceType)
    && isEvidenceRole(evidenceRole)
    && evidenceRoleForSourceType(sourceType) === evidenceRole
  ) {
    return {
      sourceType,
      evidenceRole,
      source: "persisted",
    };
  }

  const inferredSourceType = inferDocumentSourceType(fallback);
  return {
    sourceType: inferredSourceType,
    evidenceRole: inferEvidenceRole(fallback),
    source: "inferred",
  };
}
