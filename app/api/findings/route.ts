import { NextResponse } from "next/server";
import {
  authenticateRequestOrSession,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";
import { loadWorkspaceFindings } from "@/lib/findingsData";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const correlationId = getCorrelationId(request);
  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequestOrSession(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    return NextResponse.json(await loadWorkspaceFindings(supabase, workspaceId));
  } catch (error) {
    console.error("[RegSpan findings] Findings lookup failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
