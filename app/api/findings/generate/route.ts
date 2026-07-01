import { NextResponse } from "next/server";
import {
  authenticateRequest,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { EmbeddingProcessingError } from "@/lib/embeddings";
import {
  FindingsGenerationError,
  generateFindingsForWorkspace,
} from "@/lib/findingsGeneration";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function findingsGenerationErrorResponse(error: unknown) {
  if (error instanceof FindingsGenerationError) {
    return {
      status: error.status,
      body: { ok: false, error: error.publicMessage, code: error.code },
    };
  }

  if (error instanceof EmbeddingProcessingError) {
    return {
      status: error.status,
      body: { ok: false, error: error.safeMessage, code: error.code },
    };
  }

  return documentErrorResponse(error);
}

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  let workspaceId: string | null = null;
  let actorUserId: string | null = null;

  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    actorUserId = actor.user.id;
    workspaceId = await getActorWorkspaceId(supabase, actor.user.id);

    const result = await generateFindingsForWorkspace({
      workspaceId,
      actorUserId,
      supabase,
    });

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "findings.generate",
      outcome: "success",
      workspaceId,
      actorUserId,
      targetType: "analysis_run",
      targetId: result.analysisRunId,
      metadata: {
        requirement_count: result.requirementCount,
        finding_count: result.findingCount,
      },
    });

    return NextResponse.json({
      ok: true,
      analysisRunId: result.analysisRunId,
      requirementCount: result.requirementCount,
      findingCount: result.findingCount,
    });
  } catch (error) {
    console.error("[RegSpan findings] Findings generation failed", {
      correlationId,
      workspaceId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    if (workspaceId || actorUserId) {
      try {
        const supabase = getServerSupabaseAdminClient();
        await recordSecurityAuditEvent(supabase, {
          request,
          correlationId,
          action: "findings.generate",
          outcome: "failure",
          workspaceId,
          actorUserId,
          targetType: "analysis_run",
          metadata: {
            code: error instanceof FindingsGenerationError ? error.code : "findings_generation_failed",
          },
        });
      } catch {
        // Best-effort audit logging only; preserve the safe API error below.
      }
    }
    const response = findingsGenerationErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
