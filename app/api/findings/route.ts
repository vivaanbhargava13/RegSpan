import { NextResponse } from "next/server";
import {
  authenticateRequest,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
    const actor = await authenticateRequest(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const processedEvidenceAvailable = await hasProcessedEvidence(supabase, workspaceId);

    const { data: latestRun, error: runError } = await supabase
      .from("analysis_runs")
      .select("id, workspace_id, status, started_at, completed_at, generated_by, requirement_count, finding_count, error_message, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (runError) {
      throw new Error("analysis_run_lookup_failed");
    }

    if (!latestRun) {
      return NextResponse.json({
        ok: true,
        latestRun: null,
        findings: [],
        hasProcessedEvidence: processedEvidenceAvailable,
      });
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
        .eq("workspace_id", workspaceId)
        .in("finding_id", findingIds);

      if (evidenceError) {
        throw new Error("finding_evidence_lookup_failed");
      }

      evidenceByFindingId = (evidence ?? []).reduce<Record<string, unknown[]>>((grouped, item) => {
        const findingId = item.finding_id as string;
        grouped[findingId] ??= [];
        grouped[findingId].push(item);
        return grouped;
      }, {});
    }

    return NextResponse.json({
      ok: true,
      latestRun,
      findings: (findings ?? []).map((finding) => ({
        ...finding,
        evidence: evidenceByFindingId[finding.id as string] ?? [],
      })),
      hasProcessedEvidence: processedEvidenceAvailable,
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
