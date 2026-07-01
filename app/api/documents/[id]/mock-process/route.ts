import { NextResponse } from "next/server";
import { createMockChunks, createMockHierarchy } from "@/lib/ingestion";
import {
  authorizeDocumentRequest,
  documentErrorResponse,
  getCorrelationId,
  isUuid,
} from "@/lib/documentSecurity";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { isMockProcessingRouteEnabled } from "@/lib/securityFeatureFlags";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
type JobStartResult = { job_id: string; status: string; replayed: boolean };

function processingError(message: string) {
  if (message.includes("processing_in_progress")) {
    return { status: 409, error: "This document is already being processed.", code: "processing_in_progress" };
  }
  if (message.includes("processing_rate_limited")) {
    return { status: 429, error: "Please wait a few seconds before processing again.", code: "rate_limited" };
  }
  if (message.includes("invalid_idempotency_key")) {
    return { status: 400, error: "The processing request is invalid.", code: "invalid_request" };
  }
  return { status: 500, error: "Mock processing could not be started.", code: "processing_failed" };
}

export async function POST(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request);
  const { id } = await params;
  let supabase;
  let jobId: string | null = null;
  let authorized: Awaited<ReturnType<typeof authorizeDocumentRequest>> | null = null;

  try {
    if (!isMockProcessingRouteEnabled()) {
      console.warn("[RegSpan ingestion] Mock processing route blocked", {
        correlationId,
        documentId: isUuid(id) ? id : null,
        enabled: false,
      });
      return NextResponse.json(
        { ok: false, error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    supabase = getServerSupabaseAdminClient();
    authorized = await authorizeDocumentRequest(supabase, request, id);
    const { actor, document } = authorized;
    const suppliedKey = request.headers.get("idempotency-key")?.trim();
    const idempotencyKey = suppliedKey && suppliedKey.length <= 128
      ? suppliedKey
      : correlationId;

    const { data: startData, error: startError } = await supabase.rpc(
      "start_processing_job",
      {
        p_workspace_id: document.workspace_id,
        p_document_id: document.id,
        p_status: "Processing",
        p_step: "Creating mock chunks",
        p_idempotency_key: idempotencyKey,
        p_request_id: correlationId,
      },
    );

    if (startError) {
      console.error("[RegSpan ingestion] Mock start failed", {
        correlationId,
        documentId: document.id,
        error: startError.message,
      });
      const mapped = processingError(startError.message);
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.mock_process",
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

    const startResult = startData as JobStartResult;
    jobId = startResult.job_id;
    const chunks = createMockChunks(document);
    const hierarchy = createMockHierarchy(document);
    const { data: chunkCount, error: completionError } = await supabase.rpc(
      "complete_mock_processing",
      {
        p_workspace_id: document.workspace_id,
        p_document_id: document.id,
        p_job_id: jobId,
        p_chunks: chunks,
        p_hierarchy: hierarchy.hierarchy_json,
      },
    );

    if (completionError) {
      throw new Error(`mock_completion_failed:${completionError.message}`);
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.mock_process",
      outcome: "success",
      workspaceId: document.workspace_id,
      actorUserId: actor.user.id,
      targetType: "document",
      targetId: document.id,
      metadata: {
        job_id: jobId,
        chunk_count: chunkCount,
        replayed: startResult.replayed,
      },
    });

    return NextResponse.json({
      ok: true,
      jobId,
      chunkCount: Number(chunkCount),
      replayed: startResult.replayed,
    });
  } catch (error) {
    console.error("[RegSpan ingestion] Mock processing failed", {
      correlationId,
      documentId: id,
      jobId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (supabase && authorized && jobId) {
      const failedAt = new Date().toISOString();
      await supabase
        .from("processing_jobs")
        .update({
          status: "Failed",
          step: "Mock processing failed",
          error_message: "Mock processing failed.",
          completed_at: failedAt,
          updated_at: failedAt,
        })
        .eq("id", jobId)
        .in("status", ["Queued", "Processing", "Reprocessing"]);
      await supabase
        .from("documents")
        .update({ status: "Failed", chunks_label: "Pending" })
        .eq("id", authorized.document.id)
        .eq("workspace_id", authorized.document.workspace_id);
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.mock_process",
        outcome: "failure",
        workspaceId: authorized.document.workspace_id,
        actorUserId: authorized.actor.user.id,
        targetType: "document",
        targetId: authorized.document.id,
        metadata: { code: "processing_failed", job_id: jobId },
      });
    } else if (supabase) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.mock_process",
        outcome: "failure",
        workspaceId: authorized?.document.workspace_id,
        actorUserId: authorized?.actor.user.id,
        targetType: "document",
        targetId: isUuid(id) ? id : null,
        metadata: { code: "processing_failed" },
      });
    }

    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
