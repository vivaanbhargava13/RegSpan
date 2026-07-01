"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";

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
  chunk_index: number | null;
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
};

type GenerateResponse = {
  ok?: boolean;
  error?: string;
};

const statusClasses: Record<Finding["status"], string> = {
  covered: "border-app-success/20 bg-app-success-soft text-app-success",
  partial: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  missing: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  conflicting: "border-app-danger/25 bg-app-danger-soft text-app-danger",
  needs_review: "border-app-review/20 bg-app-review-soft text-app-review",
};

const severityClasses: Record<Finding["severity"], string> = {
  critical: "border-app-danger/25 bg-app-danger-soft text-app-danger",
  high: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  medium: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  low: "border-app-review/20 bg-app-review-soft text-app-review",
  info: "border-app-success/20 bg-app-success-soft text-app-success",
};

function humanize(value: string | null | undefined) {
  return (value ?? "unknown")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
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

export function FindingsClient() {
  const [latestRun, setLatestRun] = useState<AnalysisRun | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [hasProcessedEvidence, setHasProcessedEvidence] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const metrics = useMemo(() => {
    const openCount = findings.filter((finding) => finding.status !== "covered").length;
    const highRiskCount = findings.filter((finding) =>
      finding.severity === "critical" || finding.severity === "high"
    ).length;
    const coveredCount = findings.filter((finding) => finding.status === "covered").length;
    return { openCount, highRiskCount, coveredCount };
  }, [findings]);

  useEffect(() => {
    void loadFindings();
  }, []);

  async function loadFindings() {
    setIsLoading(true);
    setError("");

    try {
      const token = await getAccessToken();
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
    setMessage("");

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
      setMessage("Findings analysis completed.");
      await loadFindings();
    } catch (generateError) {
      setError(
        generateError instanceof Error
          ? generateError.message
          : "Findings generation failed.",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Findings"
        title="Reg S-P findings"
        description="Generate durable requirement-level findings from classified organization evidence and citations."
        actions={(
          <Button
            type="button"
            variant="appPrimary"
            onClick={runAnalysis}
            disabled={isGenerating || isLoading || !hasProcessedEvidence}
          >
            {isGenerating ? "Generating…" : "Run analysis"}
          </Button>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Open findings", value: metrics.openCount, tone: "text-app-text", marker: "bg-app-accent" },
          { label: "High risk", value: metrics.highRiskCount, tone: "text-app-danger", marker: "bg-app-danger" },
          { label: "Covered", value: metrics.coveredCount, tone: "text-app-success", marker: "bg-app-success" },
        ].map((metric) => (
          <div key={metric.label} className="app-card-subtle relative overflow-hidden px-4 py-4 shadow-sm">
            <span aria-hidden="true" className={`absolute inset-y-4 left-0 w-0.5 rounded-r-full ${metric.marker}`} />
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-app-subtle">
              {metric.label}
            </span>
            <strong className={`mt-2 block text-2xl font-semibold tracking-[-0.03em] ${metric.tone}`}>
              {metric.value}
            </strong>
          </div>
        ))}
      </div>

      {latestRun ? (
        <section className="app-card p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-app-text">Latest analysis run</h2>
              <p className="mt-1 text-sm text-app-muted">
                Started {formatDate(latestRun.started_at)} · Completed {formatDate(latestRun.completed_at)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge>{humanize(latestRun.status)}</StatusBadge>
              <StatusBadge>{`${latestRun.finding_count} findings`}</StatusBadge>
            </div>
          </div>
          {latestRun.error_message ? (
            <p className="mt-4 rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger">
              {latestRun.error_message}
            </p>
          ) : null}
        </section>
      ) : null}

      {message ? (
        <div className="rounded-xl border border-app-success/20 bg-app-success-soft px-4 py-3 text-sm font-medium text-app-success">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading generated findings…
        </div>
      ) : !hasProcessedEvidence ? (
        <div className="app-empty-state">
          <h2 className="text-base font-semibold text-app-text">No processed evidence yet</h2>
          <p className="mt-2 text-sm text-app-muted">
            Upload and process at least one PDF before generating findings.
          </p>
        </div>
      ) : findings.length === 0 ? (
        <div className="app-empty-state">
          <h2 className="text-base font-semibold text-app-text">No findings generated yet</h2>
          <p className="mt-2 text-sm text-app-muted">
            Run analysis to evaluate the current workspace documents against the Reg S-P baseline.
          </p>
        </div>
      ) : (
        <section className="space-y-4" aria-label="Generated findings">
          {findings.map((finding) => (
            <article key={finding.id} className="app-card overflow-hidden">
              <div className="border-b border-app-border bg-app-elevated/65 px-5 py-4 lg:px-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-app-text">
                      {finding.requirement_name ?? "Untitled requirement"}
                    </h2>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-app-muted">
                      {finding.summary}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${statusClasses[finding.status]}`}>
                      {humanize(finding.status)}
                    </span>
                    <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${severityClasses[finding.severity]}`}>
                      {humanize(finding.severity)}
                    </span>
                    <StatusBadge>{humanize(finding.confidence)}</StatusBadge>
                  </div>
                </div>
              </div>

              <div className="space-y-4 p-5 lg:p-6">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                    <h3 className="text-sm font-semibold text-app-text">Rationale</h3>
                    <p className="mt-2 text-sm leading-6 text-app-muted">{finding.rationale}</p>
                  </div>
                  <div className="rounded-xl border border-app-border bg-app-surface px-4 py-3">
                    <h3 className="text-sm font-semibold text-app-text">Remediation</h3>
                    <p className="mt-2 text-sm leading-6 text-app-muted">{finding.remediation}</p>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-app-text">Evidence citations</h3>
                  {finding.evidence.length === 0 ? (
                    <p className="mt-2 rounded-xl border border-app-border bg-app-elevated/60 px-4 py-3 text-sm text-app-muted">
                      No organization evidence citation was stored for this finding.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {finding.evidence.map((evidence) => (
                        <div key={evidence.id} className="rounded-xl border border-app-border bg-app-elevated/55 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-app-subtle">
                            <span>{evidence.filename ?? "Untitled document"}</span>
                            <span>·</span>
                            <span>{formatPageRange(evidence)}</span>
                            <span>·</span>
                            <span>Chunk {evidence.chunk_index ?? "—"}</span>
                            <span>·</span>
                            <span>{humanize(evidence.relationship)}</span>
                          </div>
                          {evidence.section_path ? (
                            <p className="mt-2 text-xs font-medium text-app-muted">{evidence.section_path}</p>
                          ) : null}
                          {evidence.quote || evidence.evidence_quote ? (
                            <blockquote className="mt-3 border-l-2 border-app-accent/50 pl-3 text-sm leading-6 text-app-text">
                              “{evidence.quote ?? evidence.evidence_quote}”
                            </blockquote>
                          ) : null}
                          {evidence.reason ? (
                            <p className="mt-3 text-xs leading-5 text-app-muted">{evidence.reason}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
