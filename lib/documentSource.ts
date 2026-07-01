export type DocumentSourceType =
  | "client_policy"
  | "client_procedure"
  | "vendor_contract"
  | "regulatory_guidance"
  | "control_framework"
  | "sample_template"
  | "unknown";

export type EvidenceRole =
  | "organization_evidence"
  | "requirement_reference"
  | "supporting_context";

type DocumentSourceInput = {
  filename?: string | null;
  documentType?: string | null;
  notes?: string | null;
  sectionPath?: string | null;
  contentPreview?: string | null;
  evidenceReason?: string | null;
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

const regulatoryGuidanceSignals = [
  /\bregulation\s+s\s*p\b/,
  /\breg\s+s\s*p\b/,
  /\bsec\b.*\b(safeguards|privacy|cybersecurity|rule|regulation|guidance)\b/,
  /\bftc\b/,
  /\bfederal trade commission\b/,
  /\bcisa\b/,
  /\bffiec\b/,
  /\bfinra\b/,
  /\bfederal government\b/,
  /\bus government\b/,
  /\bgovernment\s+(cybersecurity\s+)?(incident|vulnerability)\s+response\s+playbooks?\b/,
  /\b(cybersecurity|incident|vulnerability)\s+response\s+playbooks?\b.*\bfederal\b/,
  /\bfederal\b.*\b(cybersecurity|incident|vulnerability)\s+response\s+playbooks?\b/,
  /\bagency guidance\b/,
  /\bregulatory guidance\b/,
  /\bsupervisory guidance\b/,
  /\bexamination manual\b/,
  /\badvisory\b/,
  /\bcompliance guide\b/,
  /\bplaybook\b.*\b(government|agency|federal|cisa|nist)\b/,
];

const contentControlFrameworkSignals = [
  /\bnist\b/,
  /\bsp\s*800\b/,
  /\bcybersecurity framework\b/,
  /\bffiec\b/,
  /\bfinra\b.*\b(cybersecurity|controls?|report|checklist|framework)\b/,
  /\bcore cybersecurity controls?\b/,
];

const contentRegulatoryGuidanceSignals = [
  /\bregulation\s+s\s*p\b/,
  /\breg\s+s\s*p\b/,
  /\bfederal trade commission\b/,
  /\bftc\b/,
  /\bcisa\b/,
  /\bffiec\b/,
  /\bfinra\b/,
  /\bgovernment\s+(cybersecurity\s+)?(incident|vulnerability)\s+response\s+playbooks?\b/,
  /\b(cybersecurity|incident|vulnerability)\s+response\s+playbooks?\b.*\bfederal\b/,
  /\bfederal\b.*\b(cybersecurity|incident|vulnerability)\s+response\s+playbooks?\b/,
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

export function inferDocumentSourceType(input: DocumentSourceInput): DocumentSourceType {
  const text = sourceText(input);
  if (!text) {
    return "unknown";
  }

  const descriptor = descriptorText(input);
  const contentHint = contentHintText(input);
  const explicitMetadata = explicitMetadataText(input);

  if (hasAny(descriptor, controlFrameworkSignals)) {
    return "control_framework";
  }
  if (hasAny(descriptor, regulatoryGuidanceSignals)) {
    return "regulatory_guidance";
  }
  if (hasAny(contentHint, contentControlFrameworkSignals)) {
    return "control_framework";
  }
  if (hasAny(contentHint, contentRegulatoryGuidanceSignals)) {
    return "regulatory_guidance";
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
