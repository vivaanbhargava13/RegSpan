"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import { EmptyState as SharedEmptyState } from "@/components/EmptyState";
import { MetricTile } from "@/components/MetricTile";
import { PageHeader } from "@/components/PageHeader";
import { RiskBadge, RunStatusBadge, StatusBadge } from "@/components/StatusBadge";
import { Surface } from "@/components/Surface";
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
      className="relative z-0 block overflow-visible rounded-lg transition-colors hover:z-50 focus-within:z-50 focus-visible:z-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      {children}
    </Link>
  );
}

function ReadinessState({ dashboard }: { dashboard: DashboardData }) {
  const latestRun = dashboard.latestRun;

  if (dashboard.documents.totalDocuments === 0) {
    return (
      <SharedEmptyState
        action={(
          <Button href="/documents" variant="appPrimary">
            Upload documents
          </Button>
        )}
        eyebrow="Readiness blocker"
        title="No documents uploaded yet"
      >
        <p>
          Upload policy and procedure PDFs to start building your Reg S-P evidence set.
        </p>
      </SharedEmptyState>
    );
  }

  if (dashboard.documents.processedDocuments === 0) {
    return (
      <SharedEmptyState
        action={(
          <Button href="/documents" variant="appPrimary">
            Go to documents
          </Button>
        )}
        eyebrow="Readiness blocker"
        title="Documents need source text preparation"
      >
        <p>
          Prepare source text from uploaded documents before running analysis.
        </p>
      </SharedEmptyState>
    );
  }

  if (latestRun?.status === "running") {
    return (
      <Alert tone="info">
        Analysis is currently running. Completed analysis metrics will update after it finishes.
      </Alert>
    );
  }

  if (latestRun?.status === "failed" && !dashboard.latestCompletedRun) {
    return (
      <Alert tone="danger">
        The latest findings analysis failed{latestRun.error_message ? `: ${latestRun.error_message}` : "."}
      </Alert>
    );
  }

  if (!dashboard.latestCompletedRun) {
    return (
      <SharedEmptyState
        action={(
          <Button href="/findings" variant="appPrimary">
            Go to Analysis
          </Button>
        )}
        eyebrow="Analysis not started"
        title="No analysis results yet"
      >
        <p>
          Documents are Ready for Analysis. Run Analysis to populate dashboard metrics.
        </p>
      </SharedEmptyState>
    );
  }

  if (latestRun?.status === "failed") {
    return (
      <Alert tone="warning">
        The latest run failed, so the dashboard is showing the most recent completed analysis from{" "}
        {formatDate(dashboard.latestCompletedRun.completed_at)}.
      </Alert>
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
        description="See documents ready for analysis, latest findings, and review progress in one place."
      />

      {isLoading ? (
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading workspace dashboard…
        </div>
      ) : error ? (
        <Alert tone="danger">{error}</Alert>
      ) : dashboard ? (
        <>
          <section aria-label="Workspace metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <DashboardMetricLink href="/findings">
              <MetricTile
                label="Compliance score"
                value={dashboard.metrics.complianceScore === null ? "—" : `${dashboard.metrics.complianceScore}%`}
                tooltip="Covered findings divided by total findings in the latest completed analysis run."
                tooltipPlacement="right"
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/findings">
              <MetricTile
                label="Open findings"
                value={String(dashboard.metrics.openFindings)}
                tone={dashboard.metrics.openFindings > 0 ? "warning" : "default"}
                tooltip="Findings from the latest completed analysis where status is not covered."
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/findings">
              <MetricTile
                label="High-risk open"
                value={String(dashboard.metrics.highRiskOpen)}
                tone={dashboard.metrics.highRiskOpen > 0 ? "danger" : "default"}
                tooltip="Non-covered findings with high or critical risk if missing."
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/findings">
              <MetricTile
                label="Needs review"
                value={String(dashboard.metrics.needsReview)}
                tone={dashboard.metrics.needsReview > 0 ? "review" : "default"}
                tooltip="Findings where the evidence is unclear and should be reviewed by a person."
              />
            </DashboardMetricLink>
            <DashboardMetricLink href="/documents">
              <MetricTile
                label="Ready for Analysis"
                value={`${dashboard.documents.processedDocuments}/${dashboard.documents.totalDocuments}`}
                tooltip="Documents Ready for Analysis divided by all documents currently uploaded to this workspace."
                tooltipPlacement="left"
              />
            </DashboardMetricLink>
          </section>

          <ReadinessState dashboard={dashboard} />

          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.3fr]">
            <Surface as="section" padding="lg">
              <h2 className="app-section-title">Latest analysis</h2>
              <dl className="mt-5 divide-y divide-app-border text-sm">
                <div className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[minmax(0,0.8fr)_1fr]">
                  <dt className="font-medium text-app-muted">Latest completed analysis</dt>
                  <dd className="font-semibold text-app-text">
                    {formatDate(dashboard.latestCompletedRun?.completed_at)}
                  </dd>
                </div>
                <div className="grid gap-1 py-3 sm:grid-cols-[minmax(0,0.8fr)_1fr]">
                  <dt className="font-medium text-app-muted">Latest run status</dt>
                  <dd>
                    {dashboard.latestRun ? (
                      <RunStatusBadge value={dashboard.latestRun.status} />
                    ) : (
                      <StatusBadge>No run yet</StatusBadge>
                    )}
                  </dd>
                </div>
                <div className="grid gap-1 py-3 last:pb-0 sm:grid-cols-[minmax(0,0.8fr)_1fr]">
                  <dt className="font-medium text-app-muted">Ready for Analysis</dt>
                  <dd className="font-semibold text-app-text">
                    {dashboard.documents.processedDocuments} of {dashboard.documents.totalDocuments}
                    {dashboard.documents.percentage !== null ? ` (${dashboard.documents.percentage}%)` : ""}
                  </dd>
                </div>
              </dl>
            </Surface>

            <div>
              <div className="mb-4 flex items-center justify-between gap-3 px-1">
                <h2 className="app-section-title">Findings needing attention</h2>
                <Link href="/findings" className="text-xs font-semibold text-app-accent hover:text-app-accent-hover">
                  View all findings
                </Link>
              </div>
              {prioritizedFindings.length === 0 ? (
                <Surface className="text-sm leading-6 text-app-muted">
                  No open findings from the latest completed analysis.
                </Surface>
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
                        <RiskBadge value={finding.severity} />
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
