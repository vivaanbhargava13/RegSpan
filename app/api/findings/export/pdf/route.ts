import { NextResponse } from "next/server";
import { authenticateRequestOrSession, documentErrorResponse, getActorWorkspaceId, getCorrelationId } from "@/lib/documentSecurity";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";
import { loadWorkspaceFindings } from "@/lib/findingsData";
import { createAssessmentReport, type AssessmentFinding } from "@/lib/assessmentReport";
import { renderAssessmentPdf } from "@/lib/assessmentPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const correlationId = getCorrelationId(request);
  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequestOrSession(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    // Client query parameters and bodies never select the workspace or supply report data.
    const data = await loadWorkspaceFindings(supabase, workspaceId);
    if (!data.latestRun) return NextResponse.json({ error: "No completed analysis is available to export." }, { status: 409 });
    // Pin the displayed run: a new analysis may have completed after the toolbar loaded.
    const requestedRun = new URL(request.url).searchParams.get("runId");
    if (requestedRun && requestedRun !== data.latestRun.id) return NextResponse.json({ error: "The completed analysis has changed. Refresh Analysis before exporting." }, { status: 409 });
    const { data: workspace, error } = await supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle();
    if (error || !workspace) throw new Error("workspace_lookup_failed");
    let report;
    try {
      report = createAssessmentReport({ workspaceName: workspace.name?.trim() || "Current workspace", workspaceId,
        run: data.latestRun, findings: data.findings as AssessmentFinding[], documents: data.reviewedDocuments });
    } catch {
      return NextResponse.json({ error: "The completed analysis is incomplete or inconsistent and cannot be exported." }, { status: 409 });
    }
    const pdf = await renderAssessmentPdf(report);
    return new Response(new Uint8Array(pdf), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="regspan-reg-s-p-assessment.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("[RegSpan PDF export] Export failed", { correlationId, error: error instanceof Error ? error.message : "unknown_error" });
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status, headers: { "Cache-Control": "no-store" } });
  }
}
