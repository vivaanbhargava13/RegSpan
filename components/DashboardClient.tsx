"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";

type DashboardAnalysisRun = {
  id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  requirement_count: number;
  finding_count: number;
  error_message: string | null;
  created_at: string;
};

type DashboardFinding = {
  id: string;
  requirement_name: string | null;
  status: "covered" | "partial" | "missing" | "conflicting" | "needs_review";
  severity: "critical" | "high" | "medium" | "low" | "info";
  summary: string | null;
  remediation: string | null;
  rationale: string | null;
};

type DashboardData = {
  latestRun: DashboardAnalysisRun | null;
  latestCompletedRun: DashboardAnalysisRun | null;
  findings: DashboardFinding[];
  metrics: {
    totalFindings: number;
    coveredFindings: number;
    openFindings: number;
    highRiskOpen: number;
    needsReview: number;
    complianceScore: number | null;
  };
  documents: {
    totalDocuments: number;
    processedDocuments: number;
    percentage: number | null;
  };
};

type DashboardResponse = {
  ok?: boolean;
  error?: string;
  dashboard?: DashboardData;
};

function humanize(value: string | null | undefined) {
  return (value ?? "unknown")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function severityRank(severity: DashboardFinding["severity"]) {
  return {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  }[severity];
}

function statusRank(status: DashboardFinding["status"]) {
  return {
    conflicting: 0,
    missing: 1,
    partial: 2,
    needs_review: 3,
    covered: 4,
  }[status];
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

function DashboardMetricLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl transition hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      {children}
    </Link>
  );
}

function EmptyState({ dashboard }: { dashboard: DashboardData }) {
  const latestRun = dashboard.latestRun;

  if (dashboard.documents.totalDocuments === 0) {
    return (
      <div className="app-empty-state">
        <h2 className="text-base font-semibold text-app-text">No documents uploaded yet</h2>
        <p className="mt-2 text-sm text-app-muted">
          Upload policy and procedure PDFs to start building your Reg S-P evidence set.
        </p>
        <Button href="/documents" variant="appPrimary" className="mt-4">
          Upload documents
        </Button>
      </div>
    );
  }

  if (dashboard.documents.processedDocuments === 0) {
    return (
      <div className="app-empty-state">
        <h2 className="text-base font-semibold text-app-text">Documents are waiting to be processed</h2>
        <p className="mt-2 text-sm text-app-muted">
          Reprocess uploaded documents so RegSpan can extract evidence before running findings analysis.
        </p>
        <Button href="/documents" variant="appPrimary" className="mt-4">
          Go to documents
        </Button>
      </div>
    );
  }

  if (latestRun?.status === "running") {
    return (
      <div className="rounded-2xl border border-app-accent/20 bg-app-accent-soft px-5 py-4 text-sm leading-6 text-app-accent">
        Findings analysis is currently running. Completed-run metrics will update after it finishes.
      </div>
    );
  }

  if (latestRun?.status === "failed" && !dashboard.latestCompletedRun) {
    return (
      <div className="rounded-2xl border border-app-danger/20 bg-app-danger-soft px-5 py-4 text-sm leading-6 text-app-danger">
        The latest findings analysis failed{latestRun.error_message ? `: ${latestRun.error_message}` : "."}
      </div>
    );
  }

  if (!dashboard.latestCompletedRun) {
    return (
      <div className="app-empty-state">
        <h2 className="text-base font-semibold text-app-text">No findings analysis yet</h2>
        <p className="mt-2 text-sm text-app-muted">
          Processed documents are available. Run analysis from the findings page to populate dashboard metrics.
        </p>
        <Button href="/findings" variant="appPrimary" className="mt-4">
          Go to findings
        </Button>
      </div>
    );
  }

  if (latestRun?.status === "failed") {
    return (
      <div className="rounded-2xl border border-app-warning/20 bg-app-warning-soft px-5 py-4 text-sm leading-6 text-app-warning">
        The latest run failed, so the dashboard is showing the most recent completed analysis from{" "}
        {formatDate(dashboard.latestCompletedRun.completed_at)}.
      </div>
    );
  }

  return null;
}

export function DashboardClient() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoading(true);
    setError("");

    try {
      const token = await getAccessToken();
      const response = await fetch("/api/dashboard", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await response.json()) as DashboardResponse;
      if (!response.ok || !body.ok || !body.dashboard) {
        throw new Error(body.error || "Unable to load dashboard.");
      }
      setDashboard(body.dashboard);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  const prioritizedFindings = useMemo(() => {
    return [...(dashboard?.findings ?? [])]
      .filter((finding) => finding.status !== "covered")
      .sort((left, right) =>
        severityRank(left.severity) - severityRank(right.severity) ||
        statusRank(left.status) - statusRank(right.status) ||
        (left.requirement_name ?? "").localeCompare(right.requirement_name ?? ""),
      )
      .slice(0, 5);
  }, [dashboard]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Overview"
        title="Reg S-P readiness overview"
        description="See processed documents, latest findings, and review progress in one place."
      />

      {isLoading ? (
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading workspace dashboard…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger">
          {error}
        </div>
      ) : dashboard ? (
        <>
          <section aria-label="Workspace metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <DashboardMetricLink href="/findings">
              <MetricCard
                label="Compliance score"
                value={dashboard.metrics.complianceScore === null ? "—" : `${dashboard.metrics.complianceScore}%`}
                tooltip="Covered findings divided by total findings in the latest completed analysis run."
                tooltipPlacement="right"
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/findings">
              <MetricCard
                label="Open findings"
                value={String(dashboard.metrics.openFindings)}
                tone={dashboard.metrics.openFindings > 0 ? "warning" : "default"}
                tooltip="Findings from the latest completed analysis where status is not covered."
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/findings">
              <MetricCard
                label="High-risk open"
                value={String(dashboard.metrics.highRiskOpen)}
                tone={dashboard.metrics.highRiskOpen > 0 ? "danger" : "default"}
                tooltip="Non-covered findings with high or critical risk if missing."
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/findings">
              <MetricCard
                label="Needs review"
                value={String(dashboard.metrics.needsReview)}
                tone={dashboard.metrics.needsReview > 0 ? "warning" : "default"}
                tooltip="Findings where the evidence is unclear and should be reviewed by a person."
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/documents">
              <MetricCard
                label="Documents processed"
                value={`${dashboard.documents.processedDocuments}/${dashboard.documents.totalDocuments}`}
                tooltip="Processed documents divided by all documents currently uploaded to this workspace."
                tooltipPlacement="left"
              />
            </DashboardMetricLink>
          </section>

          <EmptyState dashboard={dashboard} />

          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.3fr]">
            <div className="app-card p-5 lg:p-6">
              <h2 className="app-section-title">Latest analysis</h2>
              <div className="mt-5 space-y-3 text-sm leading-6 text-app-muted">
                <p className="rounded-xl border border-app-border bg-app-elevated/70 px-4 py-3.5">
                  Latest completed analysis:{" "}
                  <span className="font-semibold text-app-text">
                    {formatDate(dashboard.latestCompletedRun?.completed_at)}
                  </span>
                </p>
                <p className="rounded-xl border border-app-border bg-app-elevated/70 px-4 py-3.5">
                  Latest run status:{" "}
                  <span className="font-semibold text-app-text">
                    {dashboard.latestRun ? humanize(dashboard.latestRun.status) : "No run yet"}
                  </span>
                </p>
                <p className="rounded-xl border border-app-border bg-app-elevated/70 px-4 py-3.5">
                  Documents processed:{" "}
                  <span className="font-semibold text-app-text">
                    {dashboard.documents.processedDocuments} of {dashboard.documents.totalDocuments}
                  </span>
                  {dashboard.documents.percentage !== null ? ` (${dashboard.documents.percentage}%)` : ""}
                </p>
              </div>
            </div>

            <div>
              <div className="mb-4 flex items-center justify-between gap-3 px-1">
                <h2 className="app-section-title">Findings needing attention</h2>
                <Link href="/findings" className="text-xs font-semibold text-app-accent hover:text-app-accent-hover">
                  View all findings
                </Link>
              </div>
              {prioritizedFindings.length === 0 ? (
                <div className="app-card p-5 text-sm leading-6 text-app-muted">
                  No open findings from the latest completed analysis.
                </div>
              ) : (
                <DataTable columns={["Requirement", "Status", "Risk"]} minWidth="min-w-[640px]">
                  {prioritizedFindings.map((finding) => (
                    <tr key={finding.id}>
                      <td className="px-4 py-4">
                        <p className="font-medium text-app-text">{finding.requirement_name ?? "Untitled requirement"}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-app-muted">{finding.summary}</p>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge>{humanize(finding.status)}</StatusBadge>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge>{humanize(finding.severity)}</StatusBadge>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
