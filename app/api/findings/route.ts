import { NextResponse } from "next/server";
import {
  authenticateRequestOrSession,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type FindingEvidenceRow = {
  id: string;
  finding_id: string;
  document_id: string | null;
  chunk_id: string | null;
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
  created_at: string | null;
};

type AnalysisRunRow = {
  id: string;
  workspace_id: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  generated_by: string | null;
  requirement_count: number;
  finding_count: number;
  error_message: string | null;
  created_at: string;
};

type AnalysisRunDocumentRow = {
  document_id: string | null;
  filename: string | null;
  document_status: string | null;
  uploaded_at: string | null;
  created_at: string | null;
};

type AnalysisReportState = {
  active_run: AnalysisRunRow | null;
  latest_run: AnalysisRunRow | null;
  invalid_latest_run: {
    id: string;
    completed_at: string | null;
    error_message: string | null;
  } | null;
};

function evidenceForClient(row: FindingEvidenceRow) {
  return {
    id: row.id,
    finding_id: row.finding_id,
    document_id: row.document_id,
    chunk_id: row.chunk_id,
    relationship: row.relationship,
    quote: row.quote,
    evidence_quote: row.evidence_quote,
    source_quote: row.quote?.trim() ? row.quote : row.evidence_quote,
    reason: row.reason,
    confidence: row.confidence,
    filename: row.filename,
    page_start: row.page_start,
    page_end: row.page_end,
    section_path: row.section_path,
    chunk_index: row.chunk_index,
    created_at: row.created_at,
  };
}

async function hasProcessedEvidence(supabase: ReturnType<typeof getServerSupabaseAdminClient>, workspaceId: string) {
  const { data, error } = await supabase
    .from("document_chunks")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (error) {
    throw new Error("processed_evidence_lookup_failed");
  }

  return (data ?? []).length > 0;
}

export async function GET(request: Request) {
  const correlationId = getCorrelationId(request);

  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequestOrSession(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const processedEvidenceAvailable = await hasProcessedEvidence(supabase, workspaceId);
    const { data: reportStateData, error: reportStateError } = await supabase.rpc(
      "get_analysis_report_state_v1",
      { p_workspace_id: workspaceId },
    );

    if (reportStateError || !reportStateData) {
      throw new Error("analysis_run_lookup_failed");
    }

    const reportState = reportStateData as AnalysisReportState;
    const latestRun = reportState.latest_run;
    const activeRun = reportState.active_run;
    const latestCompletedAt = latestRun?.completed_at ? new Date(latestRun.completed_at).getTime() : 0;
    const invalidCompletedAt = reportState.invalid_latest_run?.completed_at
      ? new Date(reportState.invalid_latest_run.completed_at).getTime()
      : 0;
    const invalidLatestRun = invalidCompletedAt > latestCompletedAt ? reportState.invalid_latest_run : null;

    if (!latestRun) {
      return NextResponse.json({
        ok: true,
        latestRun: null,
        activeRun,
        invalidLatestRun,
        findings: [],
        hasProcessedEvidence: processedEvidenceAvailable,
        processedDocumentCount: 0,
        reviewedDocuments: [],
      });
    }

    const { data: reviewedDocuments, error: reviewedDocumentsError } = await supabase
      .from("analysis_run_documents")
      .select("document_id, filename, document_status, uploaded_at, created_at")
      .eq("workspace_id", workspaceId)
      .eq("analysis_run_id", latestRun.id)
      .order("filename", { ascending: true });

    if (reviewedDocumentsError) {
      throw new Error("analysis_run_documents_lookup_failed");
    }

    const { data: findings, error: findingsError } = await supabase
      .from("findings")
      .select("id, analysis_run_id, workspace_id, requirement_id, requirement_name, status, severity, confidence, summary, remediation, rationale, created_at")
      .eq("workspace_id", workspaceId)
      .eq("analysis_run_id", latestRun.id)
      .order("requirement_name", { ascending: true });

    if (findingsError) {
      throw new Error("findings_lookup_failed");
    }

    const findingIds = (findings ?? []).map((finding) => finding.id as string);
    let evidenceByFindingId: Record<string, unknown[]> = {};
    if (findingIds.length > 0) {
      const { data: evidence, error: evidenceError } = await supabase
        .from("finding_evidence")
        .select("id, finding_id, document_id, chunk_id, relationship, quote, evidence_quote, reason, confidence, filename, page_start, page_end, section_path, chunk_index, created_at")
        .in("finding_id", findingIds)
        .order("created_at", { ascending: true });

      if (evidenceError) {
        throw new Error("finding_evidence_lookup_failed");
      }

      evidenceByFindingId = ((evidence ?? []) as FindingEvidenceRow[]).reduce<Record<string, unknown[]>>((grouped, item) => {
        const findingId = item.finding_id;
        grouped[findingId] ??= [];
        grouped[findingId].push(evidenceForClient(item));
        return grouped;
      }, {});
    }

    return NextResponse.json({
      ok: true,
      latestRun,
      activeRun,
      invalidLatestRun,
      findings: (findings ?? []).map((finding) => ({
        ...finding,
        evidence: evidenceByFindingId[finding.id as string] ?? [],
      })),
      hasProcessedEvidence: processedEvidenceAvailable,
      processedDocumentCount: (reviewedDocuments ?? []).length,
      reviewedDocuments: (reviewedDocuments ?? []) as AnalysisRunDocumentRow[],
    });
  } catch (error) {
    console.error("[RegSpan findings] Findings lookup failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
