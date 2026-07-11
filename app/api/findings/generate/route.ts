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
import {
  checkRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rateLimit";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function findingsGenerationErrorResponse(error: unknown) {
  if (error instanceof FindingsGenerationError) {
    return {
      status: error.status,
      body: { ok: false, state: "failed", error: error.publicMessage, code: error.code },
    };
  }

  if (error instanceof EmbeddingProcessingError) {
    return {
      status: error.status,
      body: { ok: false, state: "configuration_error", error: error.safeMessage, code: error.code },
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
    await checkRateLimit({
      request,
      category: "findings_generate",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId,
    });

    const result = await generateFindingsForWorkspace({
      workspaceId,
      actorUserId,
      supabase,
    });

    if (result.state === "reused_active_run") {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "findings.generate.reused_active_run",
        outcome: "success",
        workspaceId,
        actorUserId,
        targetType: "analysis_run",
        targetId: result.analysisRunId,
      });
      return NextResponse.json({
        ok: true,
        state: "reused_active_run",
        analysisRunId: result.analysisRunId,
      }, { status: 202 });
    }

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
      state: "completed",
      startedState: result.startedState,
      analysisRunId: result.analysisRunId,
      requirementCount: result.requirementCount,
      findingCount: result.findingCount,
      reviewedDocumentCount: result.reviewedDocumentCount,
    });
  } catch (error) {
    const rateLimited = rateLimitErrorResponse(error);
    if (rateLimited) {
      return NextResponse.json({
        ...rateLimited.body,
        state: rateLimited.status === 429 ? "rate_limited" : "configuration_error",
      }, {
        status: rateLimited.status,
        headers: rateLimited.headers,
      });
    }

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
