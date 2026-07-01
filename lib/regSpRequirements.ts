export type RegSpRequirementId =
  | "written_incident_response_program"
  | "unauthorized_access_detection_escalation"
  | "customer_notification_unauthorized_access"
  | "regulator_law_enforcement_notification"
  | "vendor_incident_handling"
  | "customer_information_safeguards"
  | "evidence_log_preservation"
  | "remediation_recovery_validation";

export type RegSpRequirement = {
  id: RegSpRequirementId;
  title: string;
  description: string;
  retrievalQuery: string;
  directSignals: string[];
  actionSignals: string[];
  topicSignals: string[];
  partialSignals: string[];
  backgroundSignals: string[];
  negativeSignals?: string[];
};

export const REG_SP_REQUIREMENTS: RegSpRequirement[] = [
  {
    id: "written_incident_response_program",
    title: "Written incident response program",
    description:
      "The organization maintains a written incident response program or plan for cybersecurity events involving customer information.",
    retrievalQuery:
      "written incident response program plan cybersecurity incident response policy customer information responsibilities procedures",
    directSignals: [
      "incident response program",
      "incident response plan",
      "written incident response",
      "response procedures",
      "incident response policy",
    ],
    actionSignals: ["maintain", "written", "plan", "program", "procedures", "policy"],
    topicSignals: ["incident response", "cybersecurity incident", "customer information", "response team"],
    partialSignals: ["cybersecurity incident", "security incident", "response team", "incident management"],
    backgroundSignals: ["program", "policy", "procedure", "roles", "responsibilities"],
  },
  {
    id: "unauthorized_access_detection_escalation",
    title: "Unauthorized access detection and escalation",
    description:
      "The organization detects, triages, classifies, and escalates unauthorized access or use of sensitive customer information.",
    retrievalQuery:
      "detect unauthorized access sensitive customer information classify escalate major incident triage severity",
    directSignals: [
      "unauthorized access",
      "unauthorized use",
      "detect unauthorized",
      "incident escalation",
      "escalate",
      "severity",
    ],
    actionSignals: ["detect", "triage", "classify", "escalate", "severity", "major incident"],
    topicSignals: ["unauthorized access", "sensitive customer information", "incident escalation", "major incident"],
    partialSignals: ["triage", "classification", "major incident", "security event", "alert"],
    backgroundSignals: ["detect", "monitor", "analyze", "investigate", "incident"],
  },
  {
    id: "customer_notification_unauthorized_access",
    title: "Customer notification after unauthorized access",
    description:
      "The organization notifies affected customers after unauthorized access to or use of sensitive customer information when notice is required.",
    retrievalQuery:
      "notify affected customers unauthorized access sensitive customer information breach notification timing content notice",
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
      "consumers",
      "notice",
      "sensitive customer information",
      "sensitive information",
      "personal information",
      "customer information",
      "unauthorized access",
      "breach notification",
    ],
    actionSignals: [
      "notify",
      "notification",
      "notice",
      "affected customers",
      "affected individuals",
      "affected people",
      "consumers",
      "breach notification",
    ],
    topicSignals: [
      "customer notification",
      "affected customers",
      "affected individuals",
      "unauthorized access",
      "personal information",
      "sensitive customer information",
    ],
    partialSignals: [
      "notice",
      "notification",
      "customer information",
      "personal information",
      "sensitive information",
      "unauthorized use",
      "affected individuals",
    ],
    backgroundSignals: ["communications", "legal", "privacy", "incident response"],
  },
  {
    id: "regulator_law_enforcement_notification",
    title: "Regulator and law enforcement notification",
    description:
      "The organization notifies regulators, law enforcement, or other authorities where required by law, contract, or incident severity.",
    retrievalQuery:
      "notify regulators law enforcement authorities required reporting legal compliance incident notification",
    directSignals: [
      "regulator",
      "regulatory notification",
      "law enforcement",
      "authorities",
      "required by law",
      "reporting requirement",
    ],
    actionSignals: ["notify", "notification", "report", "reporting", "required", "law enforcement"],
    topicSignals: ["regulator", "law enforcement", "authorities", "required by law", "external notification"],
    partialSignals: ["legal", "compliance", "external notification", "government", "agency"],
    backgroundSignals: ["notification", "reporting", "escalation", "incident"],
  },
  {
    id: "vendor_incident_handling",
    title: "Service provider and vendor incident handling",
    description:
      "The organization requires service providers or vendors to report, escalate, and coordinate incidents affecting customer information.",
    retrievalQuery:
      "vendor service provider incident handling breach notification third party escalation customer information",
    directSignals: [
      "vendor notification",
      "service provider notification",
      "vendor incident",
      "third party incident",
      "vendor breach",
      "service provider breach",
      "third party breach",
      "vendor escalation",
      "service provider escalation",
      "third party escalation",
      "vendor reporting",
      "service provider reporting",
      "service provider responsibilities",
      "breach notification",
    ],
    actionSignals: [
      "notify",
      "notification",
      "report",
      "reporting",
      "escalate",
      "escalation",
      "coordinate",
      "coordination",
      "contract",
      "responsibilities",
      "breach",
      "incident handling",
    ],
    topicSignals: [
      "vendor",
      "service provider",
      "third party",
      "vendor incident",
      "service provider notification",
      "contract responsibilities",
    ],
    partialSignals: ["vendor", "third party", "supplier", "contract", "oversight"],
    backgroundSignals: ["incident", "customer information", "escalation", "notification"],
  },
  {
    id: "customer_information_safeguards",
    title: "Safeguards and access controls for customer information",
    description:
      "The organization uses administrative, technical, or physical safeguards and access controls to protect customer information.",
    retrievalQuery:
      "safeguards access controls customer information protect encryption monitoring authentication least privilege",
    directSignals: [
      "access controls",
      "customer information",
      "safeguards",
      "least privilege",
      "encryption",
      "authentication",
    ],
    actionSignals: ["protect", "safeguard", "control", "restrict", "encrypt", "authenticate", "monitor"],
    topicSignals: ["safeguards", "access controls", "customer information", "least privilege", "encryption"],
    partialSignals: ["monitoring", "authorization", "protect", "controls", "security controls"],
    backgroundSignals: ["information security", "privacy", "data protection", "confidentiality"],
  },
  {
    id: "evidence_log_preservation",
    title: "Evidence and log preservation",
    description:
      "The organization preserves logs, records, forensic evidence, and other incident materials needed for investigation and review.",
    retrievalQuery:
      "preserve logs evidence forensic records chain of custody incident investigation retention",
    directSignals: [
      "collect and preserve data",
      "preserve logs",
      "preserve evidence",
      "evidence preservation",
      "log evidence",
      "log all evidence",
      "potential evidence",
      "evidence was acquired",
      "forensic evidence",
      "chain of custody",
      "incident records",
      "investigation records",
      "records integrity",
      "log retention",
      "provenance",
    ],
    actionSignals: [
      "preserve",
      "retain",
      "collect",
      "document",
      "chain of custody",
      "forensic",
      "provenance",
    ],
    topicSignals: ["logs", "evidence", "forensic", "chain of custody", "incident records", "investigation records"],
    partialSignals: ["logs", "evidence", "records", "forensic", "retention", "investigation records"],
    backgroundSignals: ["investigation", "analysis", "documentation", "incident"],
  },
  {
    id: "remediation_recovery_validation",
    title: "Remediation and recovery validation",
    description:
      "The organization tracks remediation, validates recovery, and confirms corrective actions after an incident or vulnerability.",
    retrievalQuery:
      "remediation recovery validation corrective actions vulnerabilities tracked closure testing restoration",
    directSignals: [
      "remediation",
      "confirm remediation",
      "recovery validation",
      "recovery capabilities",
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
    actionSignals: [
      "remediate",
      "remediation",
      "confirm",
      "validate",
      "track",
      "test",
      "verify",
      "corrective action",
      "corrective actions",
    ],
    topicSignals: [
      "remediation",
      "recovery",
      "validation",
      "vulnerability remediation",
      "corrective actions",
      "lessons learned",
    ],
    partialSignals: [
      "recovery",
      "restoration",
      "closure",
      "testing",
      "lessons learned",
      "vulnerability scan",
      "recovery capabilities",
    ],
    backgroundSignals: ["vulnerability", "incident", "action plan", "follow up"],
  },
];

export function getRegSpRequirement(requirementId: string) {
  return REG_SP_REQUIREMENTS.find((requirement) => requirement.id === requirementId) ?? null;
}
