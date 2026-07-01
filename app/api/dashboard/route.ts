import { NextResponse } from "next/server";
import {
  authenticateRequest,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { loadDashboardData } from "@/lib/dashboardData";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const correlationId = getCorrelationId(request);

  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const dashboard = await loadDashboardData({ supabase, workspaceId });

    return NextResponse.json({
      ok: true,
      dashboard,
    });
  } catch (error) {
    console.error("[RegSpan dashboard] Dashboard lookup failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
