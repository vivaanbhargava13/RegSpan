export type ReportAnalysisRun = {
  requirement_count: number;
  completed_at: string | null;
};

export type ReportFindingEvidence = {
  relationship: string | null;
  quote: string | null;
  evidence_quote: string | null;
  reason: string | null;
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
};

export type ReportFinding = {
  requirement_id: string | null;
  requirement_name: string | null;
  status: "covered" | "partial" | "missing" | "conflicting" | "needs_review";
  severity: "critical" | "high" | "medium" | "low" | "info";
  summary: string | null;
  remediation: string | null;
  rationale: string | null;
  evidence: ReportFindingEvidence[];
};

export const REPORT_WORKSPACE_FALLBACK = "Current workspace";
const REPORT_SOURCE_EXCERPT_LIMIT = 3;

const REPORT_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID: Record<string, string> = {
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

const REPORT_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY: Record<string, string> = {
  incident_assessment_containment_control: "unauthorized_access_detection_escalation",
  service_provider_incident_oversight_notice: "vendor_incident_handling",
  safeguards_customer_information: "customer_information_safeguards",
  incident_evidence_log_preservation: "evidence_log_preservation",
  regulator_law_enforcement_notification_coordination: "regulator_law_enforcement_notification",
  response_recovery_remediation_validation: "remediation_recovery_validation",
};

const reviewDetailByRequirementId: Record<string, string> = {
  written_incident_response_program: "the written incident response program and its customer-information scope",
  unauthorized_access_detection_escalation:
    "incident assessment, customer-information impact analysis, containment, and control steps",
  customer_notification_unauthorized_access:
    "the customer-notification trigger, substantial-harm analysis, and timing standard",
  customer_notification_content:
    "the required customer-notice content, including affected information, protective steps, and contact information",
  regulator_law_enforcement_notification:
    "regulator, law-enforcement, or external notification decisioning and ownership",
  vendor_incident_handling:
    "vendor or service-provider notice, cooperation, remediation, and recovery obligations",
  customer_information_safeguards:
    "safeguards and access controls for customer information",
  disposal_consumer_customer_information:
    "secure disposal requirements for consumer or customer information",
  written_compliance_records:
    "written compliance records, retention, and accessibility requirements",
  evidence_log_preservation:
    "incident log, evidence preservation, and chain-of-custody requirements",
  remediation_recovery_validation:
    "remediation tracking, recovery steps, and validation requirements",
};

function humanize(value: string | null | undefined) {
  return (value ?? "unknown")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function requirementControlKey(requirementId: string | null | undefined) {
  if (!requirementId) return null;
  return REPORT_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID[requirementId] ?? requirementId;
}

function requirementCopyId(requirementId: string | null | undefined) {
  if (!requirementId) return null;
  return REPORT_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY[requirementId] ?? requirementId;
}

function requirementBasis(finding: ReportFinding) {
  const controlKey = requirementControlKey(finding.requirement_id);
  return {
    href: controlKey ? `/controls#control-${controlKey}` : "/controls",
    label: finding.requirement_name ?? "Untitled requirement",
  };
}

function formatReportDate(value: string | null) {
  if (!value) return "Not completed";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPageRange(evidence: ReportFindingEvidence) {
  if (evidence.page_start && evidence.page_end && evidence.page_start !== evidence.page_end) {
    return `Pages ${evidence.page_start}-${evidence.page_end}`;
  }
  if (evidence.page_start) return `Page ${evidence.page_start}`;
  return "Page not available";
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function reportTextValue(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export function workspaceReportName(workspaceName: string | null | undefined) {
  return workspaceName?.trim() || REPORT_WORKSPACE_FALLBACK;
}

function reviewDetailForFinding(finding: ReportFinding) {
  const requirementId = requirementCopyId(finding.requirement_id);
  if (requirementId && reviewDetailByRequirementId[requirementId]) {
    return reviewDetailByRequirementId[requirementId];
  }

  return finding.requirement_name
    ? finding.requirement_name.toLowerCase()
    : "the missing requirement details";
}

function cleanCoveredRationale(value: string) {
  return value
    .replace(
      /\s*Related documents say they do not cover this requirement, which appears to be a scope limitation for those documents rather than a contradiction\./g,
      "",
    )
    .trim();
}

function fallbackSummary(finding: ReportFinding) {
  switch (finding.status) {
    case "covered":
      return "Covered in reviewed documents.";
    case "partial":
      return "Partially covered; details remain open.";
    case "needs_review":
      return "Reviewer confirmation required.";
    case "conflicting":
      return "Conflicting document language found.";
    case "missing":
      return "No clear client policy evidence found.";
  }
}

function fallbackRationale(finding: ReportFinding) {
  const requirementName = finding.requirement_name ?? "this requirement";

  switch (finding.status) {
    case "covered":
      return `Reviewed client evidence supports ${requirementName}.`;
    case "partial":
      return `Reviewed client evidence addresses part of ${requirementName}, but the cited materials do not confirm every required detail.`;
    case "needs_review":
      return `Reviewed client evidence is related to ${requirementName}, but a reviewer should confirm whether another policy contains the missing detail.`;
    case "conflicting":
      return `Reviewed client evidence contains inconsistent language for ${requirementName}.`;
    case "missing":
      return `RegSpan did not find clear client policy evidence for ${requirementName}.`;
  }
}

function reportSummary(finding: ReportFinding) {
  const summary = reportTextValue(finding.summary, fallbackSummary(finding));
  const rawRationale = finding.status === "covered"
    ? cleanCoveredRationale(reportTextValue(finding.rationale, ""))
    : reportTextValue(finding.rationale, "");

  if (rawRationale && normalizeText(summary) === normalizeText(rawRationale)) {
    return fallbackSummary(finding);
  }

  return summary;
}

function reportRationale(finding: ReportFinding) {
  const rawRationale = reportTextValue(finding.rationale, fallbackRationale(finding));
  const rationale = finding.status === "covered" ? cleanCoveredRationale(rawRationale) : rawRationale;
  const summary = reportTextValue(finding.summary, "");

  if (normalizeText(summary) === normalizeText(rationale)) {
    return fallbackRationale(finding);
  }

  return rationale || fallbackRationale(finding);
}

function reportRemediation(finding: ReportFinding) {
  if (finding.status === "covered") {
    return "Continue maintaining this procedure and confirm related procedures point to it during the next review.";
  }

  if (finding.status === "needs_review") {
    return `Add or point to the procedure that defines ${reviewDetailForFinding(finding)}. A reviewer should confirm whether another policy already contains this detail.`;
  }

  return reportTextValue(finding.remediation, "No recommendation available.");
}

function requirementTerms(finding: ReportFinding) {
  return normalizeText([
    finding.requirement_name,
    finding.requirement_id,
    reviewDetailForFinding(finding),
  ].filter(Boolean).join(" "))
    .split(" ")
    .filter((term) => term.length >= 5 && !["requirement", "reviewed", "documents"].includes(term));
}

function hasQuote(evidence: ReportFindingEvidence) {
  return Boolean((evidence.quote ?? evidence.evidence_quote)?.trim());
}

function isGenericSectionOnly(evidence: ReportFindingEvidence) {
  if (hasQuote(evidence)) return false;
  const sectionPath = normalizeText(evidence.section_path);
  return /\b(title|purpose|overview|introduction|scope|table of contents)\b/.test(sectionPath);
}

function reportEvidenceScore(finding: ReportFinding, evidence: ReportFindingEvidence) {
  const quote = evidence.quote ?? evidence.evidence_quote ?? "";
  const text = normalizeText([
    evidence.filename,
    evidence.section_path,
    evidence.reason,
    quote,
  ].filter(Boolean).join(" "));
  const terms = requirementTerms(finding);
  const relationshipScore = evidence.relationship === "supports"
    ? 90
    : evidence.relationship === "partially_supports"
      ? 70
      : evidence.relationship === "background_context"
        ? 25
        : 10;
  const termScore = terms.filter((term) => text.includes(term)).length * 10;
  const quoteScore = hasQuote(evidence) ? 80 : -35;
  const genericPenalty = isGenericSectionOnly(evidence) ? -90 : 0;
  const limitationPenalty = finding.status === "covered" && evidence.relationship === "negative_evidence" ? -120 : 0;
  const serviceProviderBoost = requirementCopyId(finding.requirement_id) === "vendor_incident_handling"
    && /\b(vendor|supplier|service provider|third party|third-party)\b/.test(text)
    ? 60
    : 0;

  return relationshipScore + termScore + quoteScore + genericPenalty + limitationPenalty + serviceProviderBoost;
}

export function reportEvidenceForFinding(finding: ReportFinding) {
  const ranked = [...finding.evidence].sort(
    (left, right) => reportEvidenceScore(finding, right) - reportEvidenceScore(finding, left),
  );
  const conclusionRelevant = finding.status === "covered"
    ? ranked.filter((evidence) => evidence.relationship !== "negative_evidence")
    : ranked;
  const nonGeneric = conclusionRelevant.filter((evidence) => !isGenericSectionOnly(evidence));
  const pool = nonGeneric.length > 0 ? nonGeneric : conclusionRelevant;
  return pool.slice(0, REPORT_SOURCE_EXCERPT_LIMIT);
}

function reportEvidenceLine(evidence: ReportFindingEvidence) {
  const location = [
    evidence.filename ?? "Untitled document",
    formatPageRange(evidence),
    evidence.section_path,
  ].filter(Boolean).join(" - ");
  const quote = evidence.quote ?? evidence.evidence_quote;
  return quote ? `${location}: "${quote}"` : location;
}

export function buildMarkdownReport({
  latestRun,
  findings,
  processedDocumentCount,
  workspaceName,
}: {
  latestRun: ReportAnalysisRun | null;
  findings: ReportFinding[];
  processedDocumentCount: number | null;
  workspaceName: string;
}) {
  const totalRequirements = latestRun?.requirement_count ?? findings.length;
  const covered = findings.filter((finding) => finding.status === "covered").length;
  const open = findings.filter((finding) => finding.status !== "covered").length;
  const highRisk = findings.filter((finding) =>
    finding.status !== "covered" && (finding.severity === "critical" || finding.severity === "high")
  ).length;
  const needsReview = findings.filter((finding) => finding.status === "needs_review").length;
  const lines = [
    "# RegSpan Reg S-P Analysis Report",
    "",
    `Workspace: ${workspaceReportName(workspaceName)}`,
    `Analysis completed: ${formatReportDate(latestRun?.completed_at ?? null)}`,
    `Documents reviewed: ${processedDocumentCount ?? "Processed documents"}`,
    `Requirements reviewed: ${totalRequirements}`,
    `Covered: ${covered}`,
    `Open findings: ${open}`,
    `High-risk open: ${highRisk}`,
    `Needs reviewer confirmation: ${needsReview}`,
    "",
    "## Findings",
  ];

  if (findings.length === 0) {
    lines.push("", "No findings were returned for the latest analysis.");
  }

  for (const finding of findings) {
    const basis = requirementBasis(finding);
    lines.push(
      "",
      `### ${finding.requirement_name ?? "Untitled requirement"}`,
      `Reg S-P basis: ${basis.label} (${basis.href})`,
      `Status: ${humanize(finding.status)}`,
    );

    if (finding.status !== "covered") {
      lines.push(`Risk if unresolved: ${humanize(finding.severity)}`);
    }

    lines.push(
      "",
      `Summary: ${reportSummary(finding)}`,
      "",
      `What RegSpan found: ${reportRationale(finding)}`,
      "",
      `Recommended next step: ${reportRemediation(finding)}`,
      "",
      "Client source excerpts:",
    );

    const evidence = reportEvidenceForFinding(finding);
    if (evidence.length === 0) {
      lines.push("- No client source excerpts were stored for this finding.");
    } else {
      for (const item of evidence) {
        lines.push(`- ${reportEvidenceLine(item)}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
