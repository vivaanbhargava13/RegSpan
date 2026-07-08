export type RegSpRequirementId =
  | "written_incident_response_program"
  | "incident_assessment_containment_control"
  | "unauthorized_access_detection_escalation"
  | "customer_notification_unauthorized_access"
  | "customer_notification_content"
  | "service_provider_incident_oversight_notice"
  | "vendor_incident_handling"
  | "safeguards_customer_information"
  | "customer_information_safeguards"
  | "disposal_consumer_customer_information"
  | "written_compliance_records"
  | "incident_evidence_log_preservation"
  | "evidence_log_preservation"
  | "response_recovery_remediation_validation"
  | "remediation_recovery_validation"
  | "regulator_law_enforcement_notification_coordination"
  | "regulator_law_enforcement_notification";

export type RegSpRequirementRole = "direct_reg_s_p" | "supporting_control" | "future_scope";
export type RegSpRequirementMvpScope = "mvp" | "supporting" | "future";

export type RegSpEvidenceCriteria = {
  lookFor: string;
  strongEvidence: string;
  partialEvidence: string;
  missingOrNegativeEvidence: string;
};

export type RegSpCoverageElement = {
  id: string;
  label: string;
  requiredForCovered: boolean;
  signals: string[];
};

export type RegSpRequirement = {
  id: RegSpRequirementId;
  title: string;
  description: string;
  sourceBasis: string;
  regulatoryRole: RegSpRequirementRole;
  mvpScope: RegSpRequirementMvpScope;
  evidenceCriteria: RegSpEvidenceCriteria;
  coverageElements: RegSpCoverageElement[];
  requiredElementsForCovered: string[];
  optionalElements: string[];
  strongEvidenceGuidance: string;
  partialEvidenceGuidance: string;
  missingEvidenceGuidance: string;
  retrievalQuery: string;
  directSignals: string[];
  actionSignals: string[];
  topicSignals: string[];
  partialSignals: string[];
  backgroundSignals: string[];
  negativeSignals?: string[];
};

type RegSpRequirementDefinition = Omit<
  RegSpRequirement,
  | "requiredElementsForCovered"
  | "optionalElements"
  | "strongEvidenceGuidance"
  | "partialEvidenceGuidance"
  | "missingEvidenceGuidance"
>;

function defineRequirement(requirement: RegSpRequirementDefinition): RegSpRequirement {
  return {
    ...requirement,
    requiredElementsForCovered: requirement.coverageElements
      .filter((element) => element.requiredForCovered)
      .map((element) => element.id),
    optionalElements: requirement.coverageElements
      .filter((element) => !element.requiredForCovered)
      .map((element) => element.id),
    strongEvidenceGuidance: requirement.evidenceCriteria.strongEvidence,
    partialEvidenceGuidance: requirement.evidenceCriteria.partialEvidence,
    missingEvidenceGuidance: requirement.evidenceCriteria.missingOrNegativeEvidence,
  };
}

export const REG_SP_REQUIREMENTS: RegSpRequirement[] = [
  defineRequirement({
    id: "written_incident_response_program",
    title: "Written incident response program",
    description:
      "The reviewed documents appear to maintain written policies and procedures for an incident response program reasonably designed to detect, respond to, and recover from unauthorized access to or use of customer information.",
    sourceBasis: "Amended Regulation S-P safeguards rule, 17 CFR 248.30(a)(3).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Written incident response policy, plan, program, standard, or procedure covering customer information.",
      strongEvidence: "A maintained written program or equivalent policy/standard with ownership, approval, review, roles, escalation, notice, response, and recovery responsibilities.",
      partialEvidence: "Incident response procedures are mentioned, but ownership, approval, customer-information scope, or recovery responsibilities are unclear.",
      missingOrNegativeEvidence: "The documents say the firm has no incident response program, or only contain generic incident references without a written customer-information response process.",
    },
    coverageElements: [
      {
        id: "written_program",
        label: "Maintains a written incident response program or equivalent policy",
        requiredForCovered: true,
        signals: ["written incident response", "incident response program", "incident response plan", "incident response policy", "response standard"],
      },
      {
        id: "customer_information_scope",
        label: "Applies to customer information or customer information systems",
        requiredForCovered: true,
        signals: ["customer information", "customer records", "sensitive customer information", "customer information systems"],
      },
      {
        id: "response_recovery_responsibilities",
        label: "Defines response and recovery responsibilities",
        requiredForCovered: true,
        signals: ["respond", "response", "recover", "recovery", "roles", "responsibilities", "escalation", "remediation"],
      },
    ],
    retrievalQuery:
      "written incident response program plan cybersecurity incident response policy cyber event response standard customer information responsibilities procedures",
    directSignals: [
      "incident response program",
      "incident response plan",
      "written incident response",
      "written cyber event response standard",
      "cyber event response standard",
      "cybersecurity event response standard",
      "security incident response standard",
      "incident response standard",
      "cyber event response procedure",
      "breach response standard",
      "response standard for cyber events",
      "response procedures",
      "incident response policy",
    ],
    actionSignals: [
      "maintain",
      "maintains",
      "written",
      "approved by",
      "reviewed annually",
      "assigns decision authority",
      "describes escalation",
      "notice decisions",
      "evidence custody",
      "corrective action tracking",
      "restoration assurance",
      "final review",
      "plan",
      "program",
      "standard",
      "procedures",
      "policy",
    ],
    topicSignals: [
      "incident response",
      "cyber event response",
      "cybersecurity incident",
      "customer information",
      "response team",
      "supplier coordination",
      "escalation",
      "remediation",
      "recovery",
    ],
    partialSignals: ["cybersecurity incident", "security incident", "response team", "incident management"],
    backgroundSignals: ["program", "policy", "procedure", "roles", "responsibilities"],
  }),
  defineRequirement({
    id: "unauthorized_access_detection_escalation",
    title: "Incident assessment, containment, and control",
    description:
      "The reviewed documents appear to define how the firm assesses the nature and scope of unauthorized access or use of customer information and takes steps to contain and control the incident.",
    sourceBasis: "Amended Regulation S-P incident response program elements, 17 CFR 248.30(a)(3)(i) and (ii).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Assessment of customer-information incidents, affected systems/data, containment, control, escalation, and severity procedures.",
      strongEvidence: "Procedures require assessing the incident scope, identifying customer information systems and information types, escalating decisions, and taking containment/control actions.",
      partialEvidence: "Detection, escalation, or containment appears in isolation, but assessment of customer information scope or control actions is incomplete.",
      missingOrNegativeEvidence: "The documents say assessment or containment is not defined, or only describe generic monitoring without incident response steps.",
    },
    coverageElements: [
      {
        id: "assesses_scope",
        label: "Assesses the nature and scope of unauthorized access or use",
        requiredForCovered: true,
        signals: ["assess the nature and scope", "nature and scope", "assess", "triage", "classify"],
      },
      {
        id: "customer_information_systems",
        label: "Identifies affected customer information systems or information types",
        requiredForCovered: true,
        signals: ["customer information systems", "types of customer information", "customer information", "sensitive customer information"],
      },
      {
        id: "containment_control",
        label: "Requires containment or control steps",
        requiredForCovered: true,
        signals: ["contain and control", "containment", "control", "eradication", "isolate", "mitigate"],
      },
    ],
    retrievalQuery:
      "unauthorized access use customer information assess nature scope contain control customer information systems data types triage severity escalation",
    directSignals: [
      "unauthorized access",
      "unauthorized use",
      "assess the nature and scope",
      "nature and scope",
      "customer information systems",
      "types of customer information",
      "contain and control",
      "containment",
      "incident escalation",
      "escalate",
      "severity",
    ],
    actionSignals: ["assess", "detect", "triage", "classify", "escalate", "contain", "control", "severity"],
    topicSignals: ["unauthorized access", "unauthorized use", "customer information", "customer information systems", "incident escalation", "containment"],
    partialSignals: ["triage", "classification", "major incident", "security event", "alert", "monitoring"],
    backgroundSignals: ["detect", "monitor", "analyze", "investigate", "incident"],
  }),
  defineRequirement({
    id: "customer_notification_unauthorized_access",
    title: "Customer notification trigger and timing",
    description:
      "The reviewed documents appear to define when affected individuals must be notified after unauthorized access to or use of sensitive customer information, including the substantial harm or inconvenience standard and the 30-day outside timing requirement.",
    sourceBasis: "Amended Regulation S-P customer notification rule, 17 CFR 248.30(a)(4)(i).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Notification procedures triggered by unauthorized access/use of sensitive customer information reasonably likely to cause substantial harm or inconvenience.",
      strongEvidence: "Procedures require notice as soon as practicable and no later than 30 days after awareness, unless the firm determines sensitive customer information was not or is not reasonably likely to be used in a way that would result in substantial harm or inconvenience.",
      partialEvidence: "Customer or individual notice is mentioned, but timing, sensitive customer information, harm/inconvenience analysis, or exception criteria are missing.",
      missingOrNegativeEvidence: "The documents say customer notification is not defined, or only mention breach notice generically without a trigger and timing standard.",
    },
    coverageElements: [
      {
        id: "unauthorized_access_or_use",
        label: "Addresses unauthorized access to or use of sensitive customer information",
        requiredForCovered: true,
        signals: ["unauthorized access", "unauthorized use", "sensitive customer information"],
      },
      {
        id: "notice_trigger_standard",
        label: "Defines the customer-notice decision standard",
        requiredForCovered: true,
        signals: ["substantial harm", "substantial inconvenience", "reasonably likely", "notice is required", "determines"],
      },
      {
        id: "notice_timing",
        label: "Defines customer-notice timing",
        requiredForCovered: true,
        signals: ["as soon as practicable", "not later than 30 days", "30 days", "without unreasonable delay"],
      },
    ],
    retrievalQuery:
      "notify affected customers individuals unauthorized access use sensitive customer information substantial harm inconvenience as soon as practicable 30 days breach notification timing",
    directSignals: [
      "notify affected customers",
      "notify affected individuals",
      "notify affected people",
      "notify individuals",
      "notify people",
      "notify consumers",
      "customer notification",
      "affected customers",
      "affected individuals",
      "affected people",
      "customer breach notice",
      "customer breach notices",
      "sensitive customer information",
      "substantial harm",
      "substantial inconvenience",
      "as soon as practicable",
      "not later than 30 days",
      "30 days",
      "unauthorized access",
      "unauthorized use",
      "breach notification",
    ],
    actionSignals: ["notify", "notification", "notice", "affected customers", "affected individuals", "breach notification"],
    topicSignals: ["customer notification", "affected customers", "affected individuals", "unauthorized access", "sensitive customer information", "substantial harm", "30 days"],
    partialSignals: ["notice", "notification", "customer information", "personal information", "sensitive information", "unauthorized use", "affected individuals"],
    backgroundSignals: ["communications", "legal", "privacy", "incident response"],
  }),
  defineRequirement({
    id: "customer_notification_content",
    title: "Customer notification content",
    description:
      "The reviewed documents appear to define the required content of notices to affected individuals, including incident details, affected data, contact information, and protective steps.",
    sourceBasis: "Amended Regulation S-P notice contents, 17 CFR 248.30(a)(4)(iv).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Notice templates or procedures covering incident description, type of sensitive information, incident date/range when known, contact information, account review, fraud alerts, credit reports, and identity-theft resources.",
      strongEvidence: "A notice template or procedure lists required notice elements and protective steps for affected individuals.",
      partialEvidence: "The documents mention notifying affected individuals but do not define the notice contents.",
      missingOrNegativeEvidence: "The documents say notice content is not defined or leave notice details entirely to ad hoc legal review.",
    },
    coverageElements: [
      {
        id: "incident_description",
        label: "Requires a description of the incident",
        requiredForCovered: true,
        signals: ["description of the incident", "describe the incident", "what happened", "incident description"],
      },
      {
        id: "information_involved",
        label: "Identifies the sensitive customer information involved",
        requiredForCovered: true,
        signals: ["type of sensitive customer information", "information involved", "data elements", "personal information involved"],
      },
      {
        id: "protective_steps",
        label: "Includes protective steps or resources for affected individuals",
        requiredForCovered: true,
        signals: ["fraud alert", "credit report", "identity theft", "account statements", "protective steps", "suspicious activity"],
      },
      {
        id: "contact_information",
        label: "Provides contact information for questions",
        requiredForCovered: false,
        signals: ["contact information", "telephone number", "email address", "contact us"],
      },
    ],
    retrievalQuery:
      "customer notification notice contents incident description type of sensitive customer information date contact information fraud alert credit report identity theft FTC",
    directSignals: [
      "notice contents",
      "type of sensitive customer information",
      "incident date",
      "date range",
      "contact information",
      "fraud alert",
      "credit report",
      "identity theft",
      "federal trade commission",
      "FTC",
      "account statements",
      "suspicious activity",
    ],
    actionSignals: ["describe", "include", "explain", "recommend", "contact", "report"],
    topicSignals: ["notice", "affected individual", "sensitive customer information", "fraud alert", "credit report", "identity theft"],
    partialSignals: ["notice", "notification", "template", "legal review", "communications"],
    backgroundSignals: ["customer communications", "privacy", "breach response", "incident communications"],
  }),
  defineRequirement({
    id: "vendor_incident_handling",
    title: "Service provider incident oversight and notice",
    description:
      "The reviewed documents appear to require service provider oversight, protection of customer information, and prompt service-provider notice to the firm after a breach involving customer information systems.",
    sourceBasis: "Amended Regulation S-P service provider provisions, 17 CFR 248.30(a)(5).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Service-provider due diligence, monitoring, contractual controls, customer-information protection, and breach notice to the firm no later than 72 hours after awareness.",
      strongEvidence: "Vendor or service-provider policies/contracts require protection of customer information, prompt breach notice to the firm, cooperation, and support for affected-individual notification.",
      partialEvidence: "Vendor oversight or cybersecurity requirements exist, but 72-hour notice, customer-information scope, or notification support is missing.",
      missingOrNegativeEvidence: "The documents say supplier incident reporting is not required or do not define vendor breach reporting/cooperation obligations.",
    },
    coverageElements: [
      {
        id: "service_provider_scope",
        label: "Applies to service providers or vendors handling customer information",
        requiredForCovered: true,
        signals: ["service provider", "vendor", "supplier", "third party", "customer information system"],
      },
      {
        id: "notice_to_firm",
        label: "Requires service-provider notice to the firm",
        requiredForCovered: true,
        signals: ["notify", "notification", "report", "reporting", "prompt notice", "72 hours", "no later than 72 hours"],
      },
      {
        id: "cooperation_remediation",
        label: "Requires cooperation, investigation, remediation, or recovery support",
        requiredForCovered: true,
        signals: ["cooperate", "cooperation", "investigation", "remediation", "recovery", "coordinate", "coordination"],
      },
    ],
    retrievalQuery:
      "service provider vendor supplier breach security customer information system 72 hours notify covered institution due diligence monitoring incident handling",
    directSignals: [
      "service provider notification",
      "service providers must notify",
      "service provider breach",
      "service provider responsibilities",
      "service provider oversight",
      "due diligence and monitoring",
      "no later than 72 hours",
      "72 hours",
      "vendor notification",
      "vendor incident",
      "vendor breach",
      "vendor reporting",
      "supplier shall notify",
      "supplier must notify",
      "supplier incident reporting",
      "supplier reporting",
      "supplier notification",
      "supplier notification obligations",
      "prompt notice",
      "customer information system",
      "contract must require notice",
      "contract must require reporting",
      "cooperate with investigation",
      "cooperate with remediation",
      "cooperate with recovery",
    ],
    actionSignals: ["notify", "notification", "report", "reporting", "monitor", "oversight", "due diligence", "coordinate", "coordination", "cooperate", "contract", "protect"],
    topicSignals: ["vendor", "service provider", "third party", "supplier", "covered supplier", "customer information", "customer information system", "breach"],
    partialSignals: ["vendor", "third party", "supplier", "contract", "oversight", "cybersecurity requirements"],
    backgroundSignals: ["incident", "customer information", "escalation", "notification"],
  }),
  defineRequirement({
    id: "customer_information_safeguards",
    title: "Safeguards for customer information",
    description:
      "The reviewed documents appear to define administrative, technical, and physical safeguards reasonably designed to protect customer records and information.",
    sourceBasis: "Regulation S-P safeguards rule, 17 CFR 248.30(a)(1) and amended customer-information scope in 17 CFR 248.30(d)(5).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Written safeguards covering administrative, technical, and physical controls for customer records and information, including information handled by or on behalf of the firm.",
      strongEvidence: "Policies define safeguards such as access controls, authentication, encryption, monitoring, least privilege, vendor controls, and physical/administrative protections for customer information.",
      partialEvidence: "Security controls are described, but the link to customer information or administrative/technical/physical safeguards is incomplete.",
      missingOrNegativeEvidence: "The documents say customer-information safeguards are not maintained or contain only generic security principles without customer-information controls.",
    },
    coverageElements: [
      {
        id: "customer_information_scope",
        label: "Applies safeguards to customer records or information",
        requiredForCovered: true,
        signals: ["customer information", "customer records and information", "customer records", "customer data"],
      },
      {
        id: "safeguards_controls",
        label: "Defines administrative, technical, or physical safeguards",
        requiredForCovered: true,
        signals: ["safeguards", "administrative safeguards", "technical safeguards", "physical safeguards", "access controls", "least privilege", "encryption", "authentication"],
      },
    ],
    retrievalQuery:
      "safeguards administrative technical physical access controls customer information protect encryption monitoring authentication least privilege",
    directSignals: [
      "access controls",
      "customer information",
      "customer records and information",
      "safeguards",
      "administrative safeguards",
      "technical safeguards",
      "physical safeguards",
      "least privilege",
      "encryption",
      "authentication",
    ],
    actionSignals: ["protect", "safeguard", "control", "restrict", "encrypt", "authenticate", "monitor"],
    topicSignals: ["safeguards", "access controls", "customer information", "least privilege", "encryption"],
    partialSignals: ["monitoring", "authorization", "protect", "controls", "security controls"],
    backgroundSignals: ["information security", "privacy", "data protection", "confidentiality"],
  }),
  defineRequirement({
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    description:
      "The reviewed documents appear to require proper disposal of consumer information and customer information using reasonable measures to protect against unauthorized access or use during disposal.",
    sourceBasis: "Amended Regulation S-P disposal rule, 17 CFR 248.30(b).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Records retention, media sanitization, secure destruction, disposal vendors, disposal approvals, and protection against unauthorized access/use during disposal.",
      strongEvidence: "Policies require secure disposal/destruction of paper, electronic, media, device, consumer report, and customer-information records with controls or vendor oversight.",
      partialEvidence: "Retention or deletion is mentioned, but secure disposal measures or customer/consumer information scope is unclear.",
      missingOrNegativeEvidence: "The documents say disposal is not defined or only reference retention without secure destruction or disposal controls.",
    },
    coverageElements: [
      {
        id: "disposal_scope",
        label: "Applies to consumer information or customer information",
        requiredForCovered: true,
        signals: ["consumer information", "customer information", "customer records", "consumer report information"],
      },
      {
        id: "secure_disposal_method",
        label: "Requires proper disposal or secure destruction",
        requiredForCovered: true,
        signals: ["properly dispose", "secure disposal", "secure destruction", "media sanitization", "destroy", "shred", "wipe", "sanitize", "disposal"],
      },
    ],
    retrievalQuery:
      "properly dispose consumer information customer information secure disposal destruction media sanitization records retention unauthorized access use disposal",
    directSignals: [
      "properly dispose",
      "consumer information",
      "customer information",
      "secure disposal",
      "secure destruction",
      "media sanitization",
      "records disposal",
      "destroy records",
      "shred",
      "wipe",
      "unauthorized access",
      "disposal",
    ],
    actionSignals: ["dispose", "destroy", "shred", "wipe", "sanitize", "delete", "protect"],
    topicSignals: ["disposal", "consumer information", "customer information", "records", "media", "destruction"],
    partialSignals: ["retention", "deletion", "records", "archive", "destruction"],
    backgroundSignals: ["records management", "retention", "privacy", "data lifecycle"],
  }),
  defineRequirement({
    id: "written_compliance_records",
    title: "Written records documenting compliance",
    description:
      "The reviewed documents appear to require written records documenting compliance with the safeguards and disposal rules, including incident response and notice determinations.",
    sourceBasis: "Amended Regulation S-P recordkeeping requirements, including 17 CFR 248.30(c).",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Recordkeeping procedures for safeguards/disposal compliance, incident response determinations, notice decisions, Attorney General delay documentation, notices sent, and versions of policies/procedures.",
      strongEvidence: "Policies identify required records, retention period, ownership, accessible storage, incident determinations, notice copies, and written procedures to preserve compliance evidence.",
      partialEvidence: "Incident records or logs are mentioned, but records documenting Regulation S-P safeguards/disposal compliance are incomplete.",
      missingOrNegativeEvidence: "The documents say compliance records are not maintained or only mention operational tickets without retention or required written documentation.",
    },
    coverageElements: [
      {
        id: "compliance_record_scope",
        label: "Requires written records documenting Reg S-P compliance",
        requiredForCovered: true,
        signals: ["written records documenting compliance", "records documenting compliance", "maintain written records", "make and maintain written records"],
      },
      {
        id: "notice_determination_records",
        label: "Documents incident or notification determinations and notices",
        requiredForCovered: true,
        signals: ["determination made", "notice transmitted", "copy of any notice", "customer-notice determinations", "incident-response determinations"],
      },
      {
        id: "retention_accessibility",
        label: "Defines retention period or accessible storage",
        requiredForCovered: true,
        signals: ["six years", "retention period", "easily accessible place", "accessible storage", "retain"],
      },
    ],
    retrievalQuery:
      "written records documenting compliance safeguards disposal incident response determinations customer notification notice copies attorney general delay records retention six years",
    directSignals: [
      "written records documenting compliance",
      "records documenting compliance",
      "maintain written records",
      "make and maintain written records",
      "notice transmitted",
      "copy of any notice",
      "determination made",
      "attorney general",
      "six years",
      "easily accessible place",
      "policies and procedures in effect",
    ],
    actionSignals: ["maintain", "preserve", "document", "retain", "record", "copy"],
    topicSignals: ["records", "compliance", "safeguards", "disposal", "notice", "incident response", "retention"],
    partialSignals: ["records", "logs", "incident records", "retention", "documentation"],
    backgroundSignals: ["documentation", "records management", "audit trail", "evidence"],
  }),
  defineRequirement({
    id: "evidence_log_preservation",
    title: "Incident evidence and log preservation",
    description:
      "The reviewed documents appear to preserve logs, records, forensic evidence, and other incident materials that support investigation and later compliance documentation.",
    sourceBasis: "Supporting control for the amended incident response and recordkeeping requirements; not a standalone quoted Regulation S-P notice obligation.",
    regulatoryRole: "supporting_control",
    mvpScope: "supporting",
    evidenceCriteria: {
      lookFor: "Procedures to preserve logs, forensic data, incident records, chain of custody, investigation notes, and evidence needed for review.",
      strongEvidence: "Policies require collecting and preserving incident evidence, logs, investigation records, and chain-of-custody or provenance information.",
      partialEvidence: "Logs or evidence are mentioned, but retention, ownership, or incident use is unclear.",
      missingOrNegativeEvidence: "The documents say evidence preservation is not defined or only describe monitoring without retaining incident materials.",
    },
    coverageElements: [
      {
        id: "incident_materials",
        label: "Preserves logs, evidence, or investigation records",
        requiredForCovered: true,
        signals: ["preserve logs", "preserve evidence", "incident records", "investigation records", "forensic evidence", "log retention"],
      },
      {
        id: "integrity_or_chain_of_custody",
        label: "Maintains evidence integrity or chain of custody",
        requiredForCovered: false,
        signals: ["chain of custody", "records integrity", "provenance", "custody"],
      },
    ],
    retrievalQuery:
      "preserve logs evidence forensic records chain of custody incident investigation retention",
    directSignals: [
      "collect and preserve data",
      "preserve logs",
      "preserve evidence",
      "evidence preservation",
      "log evidence",
      "potential evidence",
      "forensic evidence",
      "chain of custody",
      "incident records",
      "investigation records",
      "records integrity",
      "log retention",
      "provenance",
    ],
    actionSignals: ["preserve", "retain", "collect", "document", "chain of custody", "forensic", "provenance"],
    topicSignals: ["logs", "evidence", "forensic", "chain of custody", "incident records", "investigation records"],
    partialSignals: ["logs", "evidence", "records", "forensic", "retention", "investigation records"],
    backgroundSignals: ["investigation", "analysis", "documentation", "incident"],
  }),
  defineRequirement({
    id: "remediation_recovery_validation",
    title: "Response recovery and remediation validation",
    description:
      "The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.",
    sourceBasis: "Amended Regulation S-P incident response program recovery requirement, 17 CFR 248.30(a)(3), with remediation validation treated as supporting implementation evidence.",
    regulatoryRole: "direct_reg_s_p",
    mvpScope: "mvp",
    evidenceCriteria: {
      lookFor: "Recovery procedures, remediation tracking, corrective actions, restored asset verification, vulnerability retesting, lessons learned, and closure validation.",
      strongEvidence: "Policies require recovery actions and confirmation that remediation or corrective action is completed and validated after incidents or vulnerabilities.",
      partialEvidence: "Recovery or remediation is mentioned, but validation, testing, ownership, or closure evidence is unclear.",
      missingOrNegativeEvidence: "The documents say recovery validation is not required or only describe informal restoration without confirmation or follow-up.",
    },
    coverageElements: [
      {
        id: "recovery_steps",
        label: "Defines recovery after unauthorized access or use",
        requiredForCovered: true,
        signals: ["recover from unauthorized access", "recover from unauthorized use", "recovery", "restore", "restoration"],
      },
      {
        id: "remediation_tracking",
        label: "Tracks remediation or corrective actions",
        requiredForCovered: true,
        signals: ["remediation tracking", "track remediation", "corrective action", "corrective actions", "vulnerability remediation"],
      },
      {
        id: "validation_testing",
        label: "Validates recovery or remediation",
        requiredForCovered: true,
        signals: ["validate recovery", "confirm remediation", "verify restored assets", "follow-up vulnerability scan", "repeated testing", "validation"],
      },
    ],
    retrievalQuery:
      "respond recover remediation validation corrective actions vulnerabilities tracked closure testing restoration customer information incident response",
    directSignals: [
      "recover from unauthorized access",
      "recover from unauthorized use",
      "recovery validation",
      "recovery capabilities",
      "confirm remediation",
      "corrective action",
      "corrective actions",
      "validate recovery",
      "verify restored assets",
      "vulnerability remediation",
      "follow-up vulnerability scan",
      "repeated testing",
      "track remediation",
      "remediation tracking",
      "lessons learned",
    ],
    actionSignals: ["recover", "remediate", "remediation", "confirm", "validate", "track", "test", "verify", "corrective action"],
    topicSignals: ["recovery", "remediation", "validation", "vulnerability remediation", "corrective actions", "lessons learned"],
    partialSignals: ["recovery", "restoration", "closure", "testing", "lessons learned", "vulnerability scan"],
    backgroundSignals: ["vulnerability", "incident", "action plan", "follow up"],
  }),
  defineRequirement({
    id: "regulator_law_enforcement_notification",
    title: "Regulator and law enforcement notification coordination",
    description:
      "The reviewed documents appear to define how the firm coordinates regulator, law enforcement, contractual, or supervisory notifications when other laws, contracts, or incident circumstances require them.",
    sourceBasis: "Supporting control. The 2024 Regulation S-P amendments include customer notice and Attorney General delay provisions, but do not create a broad standalone regulator/law-enforcement notification requirement in this MVP map.",
    regulatoryRole: "supporting_control",
    mvpScope: "supporting",
    evidenceCriteria: {
      lookFor: "Procedures for legal/compliance review of regulator, law-enforcement, contractual, supervisory, or Attorney General delay issues.",
      strongEvidence: "Policies define legal/compliance ownership, escalation criteria, external reporting decisioning, and coordination with customer-notice timing.",
      partialEvidence: "External reporting is mentioned, but triggers, owner, timing, or relationship to customer notice is unclear.",
      missingOrNegativeEvidence: "The documents say regulator or law-enforcement reporting is not defined, or contain no external notification decision process.",
    },
    coverageElements: [
      {
        id: "external_notification_decisioning",
        label: "Defines external notification decisioning",
        requiredForCovered: true,
        signals: ["regulator", "regulatory notification", "law enforcement", "authorities", "attorney general", "external notification"],
      },
      {
        id: "legal_compliance_owner",
        label: "Assigns legal or compliance ownership",
        requiredForCovered: false,
        signals: ["legal", "compliance", "privacy counsel", "general counsel", "owner"],
      },
    ],
    retrievalQuery:
      "regulator law enforcement authorities required reporting legal compliance incident notification attorney general delay public safety national security",
    directSignals: [
      "regulator",
      "regulatory notification",
      "regulator reports",
      "law enforcement",
      "law enforcement reports",
      "authorities",
      "attorney general",
      "public safety",
      "national security",
      "required by law",
      "reporting requirement",
    ],
    actionSignals: ["notify", "notification", "report", "reporting", "required", "law enforcement", "delay"],
    topicSignals: ["regulator", "law enforcement", "authorities", "required by law", "external notification", "attorney general"],
    partialSignals: ["legal", "compliance", "external notification", "government", "agency"],
    backgroundSignals: ["notification", "reporting", "escalation", "incident"],
  }),
];

export const REG_SP_REQUIREMENT_FUTURE_SCOPE = [
  {
    id: "annual_privacy_notice_exception",
    title: "Annual privacy notice exception",
    sourceBasis: "2024 amendments conform annual privacy notice delivery provisions to the GLBA statutory exception.",
    reasonDeferred:
      "Deferred from the incident-response MVP because it concerns privacy notice delivery mechanics, not document evidence for safeguards/incident response findings.",
  },
  {
    id: "transfer_agent_applicability",
    title: "Transfer agent applicability",
    sourceBasis: "2024 amendments extend safeguards requirements to transfer agents and define transfer-agent customer information.",
    reasonDeferred:
      "Deferred from the MVP until RegSpan supports entity-type scoping and applicability questions for transfer agents.",
  },
] as const;

export function getRegSpRequirement(requirementId: string) {
  return REG_SP_REQUIREMENTS.find((requirement) => requirement.id === requirementId) ?? null;
}
