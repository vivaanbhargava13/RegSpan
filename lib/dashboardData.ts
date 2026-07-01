import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateDashboardFindingMetrics,
  calculateDocumentProgress,
  type DashboardFindingMetricInput,
} from "@/lib/dashboardMetrics";

export type DashboardAnalysisRun = {
  id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  requirement_count: number;
  finding_count: number;
  error_message: string | null;
  created_at: string;
};

export type DashboardFinding = DashboardFindingMetricInput & {
  id: string;
  requirement_name: string | null;
  summary: string | null;
  remediation: string | null;
  rationale: string | null;
};

export type DashboardData = {
  latestRun: DashboardAnalysisRun | null;
  latestCompletedRun: DashboardAnalysisRun | null;
  findings: DashboardFinding[];
  metrics: ReturnType<typeof calculateDashboardFindingMetrics>;
  documents: ReturnType<typeof calculateDocumentProgress>;
};

async function getDocumentCounts(supabase: SupabaseClient, workspaceId: string) {
  const [{ count: totalCount, error: totalError }, { count: processedCount, error: processedError }] =
    await Promise.all([
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      supabase
        .from("documents")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "Processed"),
    ]);

  if (totalError || processedError) {
    throw new Error("dashboard_document_counts_failed");
  }

  return calculateDocumentProgress({
    totalDocuments: totalCount ?? 0,
    processedDocuments: processedCount ?? 0,
  });
}

async function getLatestRun(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, status, started_at, completed_at, requirement_count, finding_count, error_message, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DashboardAnalysisRun>();

  if (error) {
    throw new Error("dashboard_latest_run_failed");
  }

  return data ?? null;
}

async function getLatestCompletedRun(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("id, status, started_at, completed_at, requirement_count, finding_count, error_message, created_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<DashboardAnalysisRun>();

  if (error) {
    throw new Error("dashboard_latest_completed_run_failed");
  }

  return data ?? null;
}

async function getFindingsForRun(
  supabase: SupabaseClient,
  workspaceId: string,
  analysisRunId: string | null,
) {
  if (!analysisRunId) return [];

  const { data, error } = await supabase
    .from("findings")
    .select("id, requirement_name, status, severity, confidence, summary, remediation, rationale, created_at")
    .eq("workspace_id", workspaceId)
    .eq("analysis_run_id", analysisRunId)
    .order("requirement_name", { ascending: true });

  if (error) {
    throw new Error("dashboard_findings_failed");
  }

  return (data ?? []).map((finding) => ({
    id: finding.id as string,
    requirement_name: (finding.requirement_name as string | null) ?? null,
    status: finding.status as DashboardFinding["status"],
    severity: finding.severity as DashboardFinding["severity"],
    summary: (finding.summary as string | null) ?? null,
    remediation: (finding.remediation as string | null) ?? null,
    rationale: (finding.rationale as string | null) ?? null,
  }));
}

export async function loadDashboardData({
  supabase,
  workspaceId,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
}): Promise<DashboardData> {
  const [documents, latestRun, latestCompletedRun] = await Promise.all([
    getDocumentCounts(supabase, workspaceId),
    getLatestRun(supabase, workspaceId),
    getLatestCompletedRun(supabase, workspaceId),
  ]);
  const findings = await getFindingsForRun(
    supabase,
    workspaceId,
    latestCompletedRun?.id ?? null,
  );

  return {
    latestRun,
    latestCompletedRun,
    findings,
    metrics: calculateDashboardFindingMetrics(findings),
    documents,
  };
}
