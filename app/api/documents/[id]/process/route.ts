import { NextResponse } from "next/server";
import {
  authorizeDocumentRequest,
  documentErrorResponse,
  getCorrelationId,
  isUuid,
} from "@/lib/documentSecurity";
import { queueDocumentProcessing } from "@/lib/documentProcessing";
import {
  checkRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rateLimit";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request);
  const { id } = await params;
  let supabase;

  try {
    supabase = getServerSupabaseAdminClient();
    const { actor, document } = await authorizeDocumentRequest(supabase, request, id);
    await checkRateLimit({
      request,
      category: "document_reprocess",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId: document.workspace_id,
      identifier: document.id,
    });
    await checkRateLimit({
      request,
      category: "workspace_processing_request",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId: document.workspace_id,
    });
    const suppliedKey = request.headers.get("idempotency-key")?.trim();
    const idempotencyKey = suppliedKey && suppliedKey.length <= 128
      ? suppliedKey
      : correlationId;

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.process.requested",
      outcome: "success",
      workspaceId: document.workspace_id,
      actorUserId: actor.user.id,
      targetType: "document",
      targetId: document.id,
      metadata: { idempotency_key_present: Boolean(suppliedKey) },
    });

    const result = await queueDocumentProcessing({
      supabase,
      correlationId,
      documentId: document.id,
      workspaceId: document.workspace_id,
      idempotencyKey,
    });

    if (!result.ok && result.code !== "processing_trigger_failed") {
      const mapped = {
        status: result.status ?? 500,
        error: result.error ?? "The document could not be queued.",
        code: result.code ?? "processing_enqueue_failed",
      };
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.rejected",
        outcome: "failure",
        workspaceId: document.workspace_id,
        actorUserId: actor.user.id,
        targetType: "document",
        targetId: document.id,
        metadata: { code: mapped.code },
      });
      return NextResponse.json(
        { ok: false, error: mapped.error, code: mapped.code },
        { status: mapped.status },
      );
    }

    if (result.replayed) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.idempotent_replay",
        outcome: result.ok ? "success" : "failure",
        workspaceId: document.workspace_id,
        actorUserId: actor.user.id,
        targetType: "processing_job",
        targetId: result.jobId ?? null,
        metadata: { document_id: document.id },
      });

      if (!result.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: result.error ?? "The processing webhook could not be triggered.",
            code: result.code ?? "processing_trigger_failed",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true, jobId: result.jobId, replayed: true });
    }

    if (result.ok) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.webhook_triggered",
        outcome: "success",
        workspaceId: document.workspace_id,
        actorUserId: actor.user.id,
        targetType: "processing_job",
        targetId: result.jobId ?? null,
        metadata: { document_id: document.id },
      });

      return NextResponse.json({ ok: true, jobId: result.jobId });
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.process.webhook_failed",
      outcome: "failure",
      workspaceId: document.workspace_id,
      actorUserId: actor.user.id,
      targetType: "processing_job",
      targetId: result.jobId ?? null,
      metadata: { document_id: document.id, code: result.code },
    });

    return NextResponse.json(
      {
        ok: false,
        error: result.error ?? "The processing webhook could not be triggered.",
        code: result.code ?? "processing_trigger_failed",
      },
      { status: result.error?.includes("not configured") ? 503 : 502 },
    );
  } catch (error) {
    const rateLimited = rateLimitErrorResponse(error);
    if (rateLimited) {
      return NextResponse.json(rateLimited.body, {
        status: rateLimited.status,
        headers: rateLimited.headers,
      });
    }

    console.error("[RegSpan ingestion] Processing request rejected", {
      correlationId,
      documentId: id,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    if (supabase) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.rejected",
        outcome: "failure",
        targetType: "document",
        targetId: isUuid(id) ? id : null,
        metadata: { code: "authorization_or_validation_failed" },
      });
    }
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
