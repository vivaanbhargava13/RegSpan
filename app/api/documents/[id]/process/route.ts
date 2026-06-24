import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authorizeDocumentRequest,
  documentErrorResponse,
  getCorrelationId,
  isUuid,
} from "@/lib/documentSecurity";
import { N8nWebhookError, triggerN8nIngestion } from "@/lib/n8n";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
type JobStartResult = { job_id: string; status: string; replayed: boolean };

function processingError(message: string) {
  if (message.includes("processing_in_progress")) {
    return {
      status: 409,
      error: "This document is already being processed.",
      code: "processing_already_in_progress",
    };
  }
  if (message.includes("processing_rate_limited")) {
    return {
      status: 429,
      error: "Please wait a few seconds before processing again.",
      code: "processing_rate_limited",
    };
  }
  if (message.includes("invalid_idempotency_key")) {
    return {
      status: 400,
      error: "The processing request is invalid.",
      code: "invalid_request",
    };
  }
  return {
    status: 500,
    error: "The document could not be queued.",
    code: "processing_enqueue_failed",
  };
}

async function markTriggerFailed(
  supabase: SupabaseClient,
  jobId: string,
  documentId: string,
  workspaceId: string,
) {
  const failedAt = new Date().toISOString();
  const { error: jobError } = await supabase
    .from("processing_jobs")
    .update({
      status: "Failed",
      step: "n8n webhook trigger failed",
      error_message: "Processing trigger failed.",
      completed_at: failedAt,
      updated_at: failedAt,
    })
    .eq("id", jobId)
    .eq("document_id", documentId)
    .eq("workspace_id", workspaceId)
    .in("status", ["Queued", "Processing", "Reprocessing"]);

  const { error: documentError } = await supabase
    .from("documents")
    .update({ status: "Failed", chunks_label: "Pending" })
    .eq("id", documentId)
    .eq("workspace_id", workspaceId);

  if (jobError || documentError) {
    console.error("[RegSpan ingestion] Failed to persist webhook failure state", {
      jobId,
      documentId,
      jobError: jobError?.message,
      documentError: documentError?.message,
    });
  }
}
export async function POST(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request);
  const { id } = await params;
  let supabase;

  try {
    supabase = getServerSupabaseAdminClient();
    const { actor, document } = await authorizeDocumentRequest(supabase, request, id);
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

    const { data, error } = await supabase.rpc("start_processing_job", {
      p_workspace_id: document.workspace_id,
      p_document_id: document.id,
      p_status: "Queued",
      p_step: "Awaiting n8n ingestion",
      p_idempotency_key: idempotencyKey,
      p_request_id: correlationId,
    });

    if (error) {
      const mapped = processingError(error.message);
      console.error("[RegSpan ingestion] Queue request rejected", {
        correlationId,
        documentId: document.id,
        code: mapped.code,
        error: error.message,
      });
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

    const result = data as JobStartResult;
    if (result.replayed) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.idempotent_replay",
        outcome: result.status === "Failed" ? "failure" : "success",
        workspaceId: document.workspace_id,
        actorUserId: actor.user.id,
        targetType: "processing_job",
        targetId: result.job_id,
        metadata: { document_id: document.id, job_status: result.status },
      });

      if (result.status === "Failed") {
        return NextResponse.json(
          {
            ok: false,
            error: "The processing webhook could not be triggered.",
            code: "processing_trigger_failed",
          },
          { status: 502 },
        );
      }

      return NextResponse.json({ ok: true, jobId: result.job_id, replayed: true });
    }

    try {
      const triggerResult = await triggerN8nIngestion({
        jobId: result.job_id,
        documentId: document.id,
        workspaceId: document.workspace_id,
        correlationId,
      });

      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.webhook_triggered",
        outcome: "success",
        workspaceId: document.workspace_id,
        actorUserId: actor.user.id,
        targetType: "processing_job",
        targetId: result.job_id,
        metadata: { document_id: document.id, upstream_status: triggerResult.status },
      });

      return NextResponse.json({ ok: true, jobId: result.job_id });
    } catch (triggerError) {
      const webhookError = triggerError instanceof N8nWebhookError
        ? triggerError
        : new N8nWebhookError("network");
      console.error("[RegSpan ingestion] n8n webhook trigger failed", {
        correlationId,
        jobId: result.job_id,
        documentId: document.id,
        kind: webhookError.kind,
        upstreamStatus: webhookError.upstreamStatus,
      });

      await markTriggerFailed(
        supabase,
        result.job_id,
        document.id,
        document.workspace_id,
      );
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.process.webhook_failed",
        outcome: "failure",
        workspaceId: document.workspace_id,
        actorUserId: actor.user.id,
        targetType: "processing_job",
        targetId: result.job_id,
        metadata: {
          document_id: document.id,
          failure_kind: webhookError.kind,
          upstream_status: webhookError.upstreamStatus ?? null,
        },
      });

      const isConfigurationError = webhookError.kind === "configuration";
      return NextResponse.json(
        {
          ok: false,
          error: isConfigurationError
            ? "Document processing is not configured on the server."
            : "The processing webhook could not be triggered.",
          code: "processing_trigger_failed",
        },
        { status: isConfigurationError ? 503 : 502 },
      );
    }
  } catch (error) {
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
