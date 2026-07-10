"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { PageToolbar } from "@/components/PageHeader";
import { Card, Surface } from "@/components/Surface";
import { RiskBadge, RunStatusBadge, StatusBadge } from "@/components/StatusBadge";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";
import {
  REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID,
  REG_SP_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY,
} from "@/lib/regulatoryControlFramework";
import {
  buildMarkdownReport,
  REPORT_WORKSPACE_FALLBACK,
  workspaceReportName,
} from "@/lib/findingsReport";
import { getCurrentWorkspace } from "@/lib/workspaces";

type AnalysisRun = {
  id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  requirement_count: number;
  finding_count: number;
  error_message: string | null;
  created_at: string;
};

type FindingEvidence = {
  id: string;
  relationship: string | null;
  quote: string | null;
  evidence_quote: string | null;
  reason: string | null;
  confidence: string | null;
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
};

type Finding = {
  id: string;
  requirement_id: string | null;
  requirement_name: string | null;
  status: "covered" | "partial" | "missing" | "conflicting" | "needs_review";
  severity: "critical" | "high" | "medium" | "low" | "info";
  confidence: "high" | "medium" | "low" | null;
  summary: string | null;
  remediation: string | null;
  rationale: string | null;
  evidence: FindingEvidence[];
};

type FindingsResponse = {
  ok?: boolean;
  error?: string;
  latestRun?: AnalysisRun | null;
  findings?: Finding[];
  hasProcessedEvidence?: boolean;
  processedDocumentCount?: number | null;
};

type GenerateResponse = {
  ok?: boolean;
  error?: string;
};

const DEFAULT_VISIBLE_EVIDENCE_COUNT = 4;

const findingAccentClasses: Record<Finding["status"], string> = {
  covered: "bg-app-success",
  partial: "bg-app-warning",
  missing: "bg-app-danger",
  conflicting: "bg-app-danger",
  needs_review: "bg-app-review",
};

function humanize(value: string | null | undefined) {
  return (value ?? "unknown")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function requirementControlKey(requirementId: string | null | undefined) {
  if (!requirementId) return null;
  return REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID[requirementId] ?? requirementId;
}

function requirementCopyId(requirementId: string | null | undefined) {
  if (!requirementId) return null;
  return REG_SP_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY[
    requirementId as keyof typeof REG_SP_LEGACY_REQUIREMENT_ID_BY_CONTROL_KEY
  ] ?? requirementId;
}

function requirementBasis(finding: Finding) {
  const controlKey = requirementControlKey(finding.requirement_id);
  return {
    href: controlKey ? `/controls#control-${controlKey}` : "/controls",
    label: finding.requirement_name ?? "Untitled requirement",
  };
}

function formatDate(value: string | null) {
  if (!value) return "Not completed";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatPageRange(evidence: FindingEvidence) {
  if (evidence.page_start && evidence.page_end && evidence.page_start !== evidence.page_end) {
    return `Pages ${evidence.page_start}–${evidence.page_end}`;
  }
  if (evidence.page_start) return `Page ${evidence.page_start}`;
  return "Page not available";
}

function evidenceSortRank(evidence: FindingEvidence) {
  if (evidence.relationship === "supports") return 0;
  if (evidence.relationship === "partially_supports") return 1;
  if (evidence.relationship === "negative_evidence" && evidence.reason?.startsWith("The firm appears not to have")) {
    return 2;
  }
  if (evidence.relationship === "negative_evidence") return 3;
  if (evidence.relationship === "background_context") return 4;
  return 5;
}

function sortedEvidence(evidence: FindingEvidence[]) {
  return [...evidence].sort((left, right) => evidenceSortRank(left) - evidenceSortRank(right));
}

function evidenceRelationshipLabel(relationship: string | null) {
  switch (relationship) {
    case "supports":
      return "Supports this conclusion";
    case "partially_supports":
      return "Partially supports this conclusion";
    case "negative_evidence":
      return "Document limitation";
    case "background_context":
      return "Related context";
    default:
      return "Document excerpt";
  }
}

function whyItMattersForFinding(finding: Finding) {
  switch (requirementCopyId(finding.requirement_id)) {
    case "written_incident_response_program":
      return "Reg S-P expects firms to maintain written procedures for responding to incidents involving customer information. A clear program helps teams act consistently when an event occurs.";
    case "unauthorized_access_detection_escalation":
      return "Unauthorized access can become a customer-information incident quickly. Clear detection, triage, and escalation steps help the firm make timely decisions.";
    case "customer_notification_unauthorized_access":
      return "Reg S-P expects firms to be prepared to notify affected individuals when unauthorized access or use involves sensitive customer information and notice is required.";
    case "customer_notification_content":
      return "Clear notice-content procedures help affected individuals understand what happened, what information was involved, whom to contact, and what protective steps they can take.";
    case "regulator_law_enforcement_notification":
      return "Some incidents may involve regulator, law-enforcement, contractual, or public-safety coordination. Documented decision rules reduce delay and confusion during an incident.";
    case "vendor_incident_handling":
      return "Service providers may handle customer information or support critical systems. Clear service-provider obligations help the firm get timely notice, cooperation, and remediation.";
    case "customer_information_safeguards":
      return "Safeguards and access protections help prevent unauthorized access to customer information and support the firm’s written information-security program.";
    case "disposal_consumer_customer_information":
      return "Secure disposal helps prevent customer or consumer information from being exposed after records, media, devices, or paper files are no longer needed.";
    case "written_compliance_records":
      return "Written records help the firm show how it complied with its safeguards, disposal, incident-response, and notification procedures during later review.";
    case "evidence_log_preservation":
      return "Preserving logs, records, and forensic evidence helps the firm investigate incidents, support notification decisions, and demonstrate what happened.";
    case "remediation_recovery_validation":
      return "Tracking remediation and validating recovery helps ensure incidents and vulnerabilities are actually resolved, not just closed administratively.";
    default:
      return "This requirement is part of the Reg S-P review baseline. Clear written evidence helps the firm show how the requirement is handled in practice.";
  }
}

function findingBadges(finding: Finding) {
  const statusBadge = <StatusBadge>{humanize(finding.status)}</StatusBadge>;

  if (finding.status === "covered") {
    return statusBadge;
  }

  return (
    <>
      {statusBadge}
      <RiskBadge label={`Risk if unresolved: ${humanize(finding.severity)}`} value={finding.severity} />
    </>
  );
}

function evidenceSummary(evidence: FindingEvidence[]) {
  const documentCount = new Set(evidence.map((item) => item.filename).filter(Boolean)).size;
  const sectionCount = evidence.length;
  if (sectionCount === 0) return "No client source excerpts stored for this finding";
  const documentLabel = `${documentCount || 1} ${documentCount === 1 ? "document" : "documents"}`;
  const sectionLabel = `${sectionCount} cited ${sectionCount === 1 ? "section" : "sections"}`;
  return `Client evidence from ${documentLabel}, ${sectionLabel}`;
}

function EvidenceCard({ evidence, subdued = false }: { evidence: FindingEvidence; subdued?: boolean }) {
  return (
    <div className={`rounded-md border px-4 py-3 ${
      subdued
        ? "border-app-border bg-app-elevated/40 opacity-85"
        : "border-app-border bg-app-surface"
    }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-full">
          <p className="break-words text-sm font-semibold text-app-text [overflow-wrap:anywhere]">
            {evidence.filename ?? "Untitled document"}
          </p>
          {evidence.section_path ? (
            <p className="mt-1 break-words text-xs font-medium text-app-muted [overflow-wrap:anywhere]">{evidence.section_path}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 text-xs font-semibold text-app-subtle">
          <span className="rounded-md border border-app-border bg-app-elevated px-2 py-1">
            {formatPageRange(evidence)}
          </span>
          <span className="rounded-md border border-app-border bg-app-elevated px-2 py-1">
            {evidenceRelationshipLabel(evidence.relationship)}
          </span>
        </div>
      </div>
      {evidence.quote || evidence.evidence_quote ? (
        <blockquote className="mt-3 break-words border-l-2 border-app-accent/45 bg-app-elevated/45 py-2 pl-3 pr-3 text-sm leading-6 text-app-text [overflow-wrap:anywhere]">
          “{evidence.quote ?? evidence.evidence_quote}”
        </blockquote>
      ) : null}
      {evidence.reason ? (
        <p className="mt-3 break-words text-xs leading-5 text-app-muted [overflow-wrap:anywhere]">{evidence.reason}</p>
      ) : null}
    </div>
  );
}

async function getAccessToken() {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase is not configured for this environment.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error(error?.message || "Your session has expired. Log in again.");
  }
  return data.session.access_token;
}

async function loadWorkspaceReportName() {
  const supabase = getBrowserSupabaseClient();
  if (!supabase) {
    return REPORT_WORKSPACE_FALLBACK;
  }

  try {
    const workspace = await getCurrentWorkspace(supabase);
    return workspaceReportName(workspace.name);
  } catch {
    return REPORT_WORKSPACE_FALLBACK;
  }
}

export function FindingsClient() {
  const [latestRun, setLatestRun] = useState<AnalysisRun | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [hasProcessedEvidence, setHasProcessedEvidence] = useState(false);
  const [processedDocumentCount, setProcessedDocumentCount] = useState<number | null>(null);
  const [workspaceName, setWorkspaceName] = useState(REPORT_WORKSPACE_FALLBACK);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reportMessage, setReportMessage] = useState("");

  const metrics = useMemo(() => {
    const openCount = findings.filter((finding) => finding.status !== "covered").length;
    const highRiskCount = findings.filter((finding) =>
      finding.status !== "covered" && (finding.severity === "critical" || finding.severity === "high")
    ).length;
    const coveredCount = findings.filter((finding) => finding.status === "covered").length;
    const needsReviewCount = findings.filter((finding) => finding.status === "needs_review").length;
    return { openCount, highRiskCount, coveredCount, needsReviewCount };
  }, [findings]);

  const reviewedDocumentLabel = processedDocumentCount ?? 0;
  const reviewedRequirementLabel = latestRun?.requirement_count ?? 10;

  useEffect(() => {
    void loadFindings();
  }, []);

  async function loadFindings() {
    setIsLoading(true);
    setError("");

    try {
      const [token, nextWorkspaceName] = await Promise.all([
        getAccessToken(),
        loadWorkspaceReportName(),
      ]);
      setWorkspaceName(nextWorkspaceName);
      const response = await fetch("/api/findings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as FindingsResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Unable to load findings.");
      }
      setLatestRun(body.latestRun ?? null);
      setFindings(body.findings ?? []);
      setHasProcessedEvidence(Boolean(body.hasProcessedEvidence));
      setProcessedDocumentCount(body.processedDocumentCount ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load findings.");
    } finally {
      setIsLoading(false);
    }
  }

  async function runAnalysis() {
    if (isGenerating) return;
    setIsGenerating(true);
    setError("");
    setMessage("RegSpan is reviewing documents ready for analysis against the Reg S-P baseline.");
    setReportMessage("");

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/findings/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      const body = (await response.json()) as GenerateResponse;
      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Findings generation failed.");
      }
      setMessage("Analysis completed.");
      await loadFindings();
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? `${generateError.message} Try again after confirming at least one document is ready for analysis.`
          : "Findings generation failed. Try again after confirming at least one document is ready for analysis.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyReport() {
    setReportMessage("");
    setError("");
    const markdown = buildMarkdownReport({ latestRun, findings, processedDocumentCount, workspaceName });

    try {
      await navigator.clipboard.writeText(markdown);
      setReportMessage("Report copied to clipboard.");
    } catch {
      setError("Unable to copy the report. Use Export Markdown instead.");
    }
  }

  function exportMarkdownReport() {
    setReportMessage("");
    const markdown = buildMarkdownReport({ latestRun, findings, processedDocumentCount, workspaceName });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "regspan-reg-s-p-analysis-report.md";
    link.click();
    URL.revokeObjectURL(url);
    setReportMessage("Markdown report exported.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Findings"
        title="Reg S-P analysis"
        description="Review requirement-level findings, source excerpts, and next steps for the current workspace."
        actions={(
          <Button
            type="button"
            variant="appPrimary"
            onClick={runAnalysis}
            disabled={isGenerating || isLoading || !hasProcessedEvidence}
            title={!hasProcessedEvidence ? "Prepare at least one document before running Analysis." : undefined}
          >
            {isGenerating ? "Reviewing documents…" : "Run Analysis"}
          </Button>
        )}
      />

      <Surface as="section" padding="none" className="overflow-hidden">
        <div className="border-b border-app-border px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-app-text">Latest analysis summary</h2>
              <p className="mt-1 text-xs leading-5 text-app-muted">
                {latestRun
                  ? `Started ${formatDate(latestRun.started_at)}. Completed ${formatDate(latestRun.completed_at)}.`
                  : "Run Analysis to generate requirement-level findings."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {latestRun ? <RunStatusBadge value={latestRun.status} /> : <StatusBadge>Not run</StatusBadge>}
              {latestRun ? <StatusBadge showDot={false}>{`${latestRun.finding_count} findings`}</StatusBadge> : null}
            </div>
          </div>
        </div>
        <div className="grid divide-y divide-app-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-6">
          {[
            { label: "Documents reviewed", value: reviewedDocumentLabel, tone: "text-app-text" },
            { label: "Requirements reviewed", value: reviewedRequirementLabel, tone: "text-app-text" },
            { label: "Covered", value: metrics.coveredCount, tone: "text-app-success" },
            { label: "Open findings", value: metrics.openCount, tone: "text-app-text" },
            { label: "High risk open", value: metrics.highRiskCount, tone: "text-app-danger" },
            { label: "Needs review", value: metrics.needsReviewCount, tone: "text-app-review" },
          ].map((metric) => (
            <div key={metric.label} className="px-4 py-3 sm:px-5">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-app-subtle">
                {metric.label}
              </span>
              <strong className={`mt-1 block text-xl font-semibold tracking-[-0.02em] ${metric.tone}`}>
                {metric.value}
              </strong>
            </div>
          ))}
        </div>
      </Surface>

      {findings.length > 0 ? (
        <Card as="section" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-app-text">Report export</h2>
            <p className="mt-1 text-xs leading-5 text-app-muted">
              Copy or export the current analysis workpaper for audit review.
            </p>
          </div>
          <PageToolbar>
            <Button type="button" variant="appSecondary" onClick={copyReport}>
              Copy report
            </Button>
            <Button type="button" variant="appSecondary" onClick={exportMarkdownReport}>
              Export Markdown
            </Button>
          </PageToolbar>
        </Card>
      ) : null}

      {latestRun?.error_message ? (
        <Alert tone="danger">{latestRun.error_message}</Alert>
      ) : null}

      {message ? <Alert tone="success">{message}</Alert> : null}

      {reportMessage ? <Alert tone="success">{reportMessage}</Alert> : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {isLoading ? (
        <Surface className="flex items-center gap-3 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading analysis results…
        </Surface>
      ) : !hasProcessedEvidence ? (
        <EmptyState title="No documents ready for analysis yet">
          <p>Prepare at least one document before running Analysis.</p>
        </EmptyState>
      ) : findings.length === 0 ? (
        <EmptyState title="No findings generated yet">
          <p>Run Analysis to evaluate the current workspace documents against the Reg S-P baseline.</p>
        </EmptyState>
      ) : (
        <section className="space-y-4" aria-label="Analysis results">
          {findings.map((finding) => {
            const basis = requirementBasis(finding);

            return (
              <Surface
                key={finding.id}
                as="article"
                padding="none"
                className="relative overflow-hidden border-app-border-strong shadow-app-card"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-1 ${findingAccentClasses[finding.status]}`}
                />
                <div className="border-b border-app-border bg-app-elevated/60 px-5 py-4 pl-6 lg:px-6 lg:pl-7">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-app-subtle">
                        Requirement basis
                      </p>
                      <h2 className="mt-1 text-base font-semibold tracking-[-0.01em] text-app-text">
                        {finding.requirement_name ?? "Untitled requirement"}
                      </h2>
                      <p className="mt-2 text-xs font-medium leading-5 text-app-muted">
                        {basis.label}
                      </p>
                      <p className="mt-3 max-w-4xl text-sm leading-6 text-app-muted">
                        {finding.summary}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {findingBadges(finding)}
                    </div>
                  </div>
                </div>

                <div className="space-y-4 p-5 pl-6 lg:p-6 lg:pl-7">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <section className="min-w-0">
                      <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-app-subtle">
                        What RegSpan found
                      </h3>
                      <p className="mt-2 break-words text-sm leading-6 text-app-muted [overflow-wrap:anywhere]">{finding.rationale}</p>
                    </section>
                    <section className="min-w-0">
                      <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-app-subtle">
                        Why it matters
                      </h3>
                      <p className="mt-2 break-words text-sm leading-6 text-app-muted [overflow-wrap:anywhere]">{whyItMattersForFinding(finding)}</p>
                    </section>
                    <section className="min-w-0">
                      <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-app-subtle">
                        Recommended next step
                      </h3>
                      <p className="mt-2 break-words text-sm leading-6 text-app-muted [overflow-wrap:anywhere]">{finding.remediation}</p>
                    </section>
                  </div>

                  <div className="rounded-md border border-app-border bg-app-elevated/45 px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-xs font-bold uppercase tracking-[0.1em] text-app-subtle">
                          Reg S-P basis
                        </h3>
                        <p className="mt-1 break-words text-sm font-medium text-app-text [overflow-wrap:anywhere]">{basis.label}</p>
                      </div>
                      <Button href={basis.href} variant="appSecondary">
                        View Requirement
                      </Button>
                    </div>
                  </div>

                  <div>
                    <h3 className="sr-only">Client source excerpts</h3>
                    {finding.evidence.length === 0 ? (
                      <p className="rounded-md border border-app-border bg-app-elevated/60 px-4 py-3 text-sm text-app-muted">
                        No client source excerpts were stored for this finding.
                      </p>
                    ) : (
                      <EvidenceList evidence={finding.evidence} />
                    )}
                  </div>
                </div>
              </Surface>
            );
          })}
        </section>
      )}
    </div>
  );
}

function EvidenceList({ evidence }: { evidence: FindingEvidence[] }) {
  const orderedEvidence = sortedEvidence(evidence);

  return (
    <details className="rounded-md border border-app-border bg-app-elevated/35">
      <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 text-sm font-semibold text-app-text transition hover:bg-app-elevated sm:flex-row sm:items-center sm:justify-between">
        <span className="min-w-0">Client source excerpts</span>
        <span className="min-w-0 break-words text-xs font-medium text-app-subtle [overflow-wrap:anywhere]">
          {evidenceSummary(orderedEvidence)} · View supporting document excerpts
        </span>
      </summary>
      <div className="space-y-3 border-t border-app-border p-3">
        {orderedEvidence.slice(0, DEFAULT_VISIBLE_EVIDENCE_COUNT).map((item) => (
          <EvidenceCard
            key={item.id}
            evidence={item}
            subdued={item.relationship === "background_context" || item.relationship === "irrelevant"}
          />
        ))}
        {orderedEvidence.length > DEFAULT_VISIBLE_EVIDENCE_COUNT ? (
          <details className="rounded-md border border-app-border bg-app-surface/70">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-app-muted transition hover:bg-app-elevated hover:text-app-text">
              Show additional source excerpts ({orderedEvidence.length - DEFAULT_VISIBLE_EVIDENCE_COUNT} more)
            </summary>
            <div className="space-y-3 border-t border-app-border p-3">
              {orderedEvidence.slice(DEFAULT_VISIBLE_EVIDENCE_COUNT).map((item) => (
                <EvidenceCard
                  key={item.id}
                  evidence={item}
                  subdued={item.relationship === "background_context" || item.relationship === "irrelevant"}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </details>
  );
}
