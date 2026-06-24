import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCorrelationId, isUuid } from "@/lib/documentSecurity";
import { authenticateIngestionWorker } from "@/lib/ingestionWorker";
import { WorkerSecretConfigurationError } from "@/lib/ingestionWorkerAuth";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

const MAX_WORKER_BODY_BYTES = 8 * 1024;
const PROCESSABLE_STATUSES = new Set(["Queued", "Processing", "Reprocessing"]);

type WorkerPayload = {
  jobId: string;
  documentId: string;
  workspaceId: string;
  correlationId: string;
};

type WorkerJob = {
  id: string;
  document_id: string;
  workspace_id: string;
  status: string;
};

type WorkerDocument = {
  id: string;
  workspace_id: string;
};

type WorkerResult = {
  result: "completed" | "already_completed";
  job_status: "Processed";
  replayed: boolean;
};

function jsonError(status: number, error: string, code: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function isWorkerPayload(value: unknown): value is WorkerPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.jobId === "string" &&
    isUuid(payload.jobId) &&
    typeof payload.documentId === "string" &&
    isUuid(payload.documentId) &&
    typeof payload.workspaceId === "string" &&
    isUuid(payload.workspaceId) &&
    typeof payload.correlationId === "string" &&
    payload.correlationId.trim().length > 0 &&
    payload.correlationId.length <= 128
  );
}

function isValidationError(message: string) {
  return [
    "job_not_found",
    "document_not_found",
    "job_document_mismatch",
    "job_workspace_mismatch",
    "document_workspace_mismatch",
    "invalid_job_state",
  ].some((code) => message.includes(code));
}

async function markWorkerFailure(
  supabase: SupabaseClient,
  payload: WorkerPayload,
) {
  const { error } = await supabase.rpc("fail_ingestion_job_v1", {
    p_job_id: payload.jobId,
    p_document_id: payload.documentId,
    p_workspace_id: payload.workspaceId,
    p_error_message: "Placeholder ingestion worker failed.",
  });

  if (error) {
    console.error("[RegSpan worker] Failed to persist worker failure", {
      correlationId: payload.correlationId,
      jobId: payload.jobId,
      documentId: payload.documentId,
      stage: "mark_failed",
      error: error.message,
    });
  }
}

export async function POST(request: Request) {
  let correlationId = getCorrelationId(request);
  let stage = "initialize_admin_client";
  let supabase;
  let payload: WorkerPayload | null = null;

  try {
    supabase = getServerSupabaseAdminClient();
    stage = "authenticate_worker";

    let isAuthorized = false;
    try {
      isAuthorized = authenticateIngestionWorker(request);
    } catch (error) {
      if (error instanceof WorkerSecretConfigurationError) {
        console.error("[RegSpan worker] Worker secret is not configured", {
          correlationId,
          stage,
        });
        await recordSecurityAuditEvent(supabase, {
          request,
          correlationId,
          action: "ingestion.worker.failed",
          outcome: "failure",
          targetType: "processing_job",
          metadata: { code: "worker_not_configured", failing_stage: stage },
        });
        return jsonError(
          500,
          "The ingestion worker is not configured.",
          "worker_not_configured",
        );
      }
      throw error;
    }

    if (!isAuthorized) {
      console.warn("[RegSpan worker] Unauthorized worker request", {
        correlationId,
        stage,
      });
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.unauthorized",
        outcome: "failure",
        targetType: "processing_job",
        metadata: { failing_stage: stage },
      });
      return jsonError(401, "Unauthorized.", "unauthorized");
    }

    stage = "validate_request_body";
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json" ||
      (Number.isFinite(contentLength) && contentLength > MAX_WORKER_BODY_BYTES)
    ) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.validation_mismatch",
        outcome: "failure",
        targetType: "processing_job",
        metadata: { code: "invalid_request", failing_stage: stage },
      });
      return jsonError(400, "The worker request is invalid.", "invalid_request");
    }

    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.validation_mismatch",
        outcome: "failure",
        targetType: "processing_job",
        metadata: { code: "invalid_json", failing_stage: stage },
      });
      return jsonError(400, "The worker request is invalid.", "invalid_request");
    }

    if (!isWorkerPayload(requestBody)) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.validation_mismatch",
        outcome: "failure",
        targetType: "processing_job",
        metadata: { code: "invalid_payload", failing_stage: stage },
      });
      return jsonError(400, "The worker request is invalid.", "invalid_request");
    }

    payload = requestBody;
    correlationId = payload.correlationId;
    stage = "load_job";
    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("id, document_id, workspace_id, status")
      .eq("id", payload.jobId)
      .maybeSingle<WorkerJob>();

    if (jobError) {
      throw new Error(`job_lookup_failed:${jobError.message}`);
    }

    stage = "load_document";
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id, workspace_id")
      .eq("id", payload.documentId)
      .maybeSingle<WorkerDocument>();

    if (documentError) {
      throw new Error(`document_lookup_failed:${documentError.message}`);
    }

    stage = "validate_job_document_workspace";
    const validationCode = !job
      ? "job_not_found"
      : !document
        ? "document_not_found"
        : job.document_id !== payload.documentId
          ? "job_document_mismatch"
          : job.workspace_id !== payload.workspaceId
            ? "job_workspace_mismatch"
            : document.workspace_id !== payload.workspaceId
              ? "document_workspace_mismatch"
              : null;

    if (validationCode) {
      console.warn("[RegSpan worker] Worker validation rejected", {
        correlationId,
        jobId: payload.jobId,
        documentId: payload.documentId,
        stage,
        code: validationCode,
      });
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.validation_mismatch",
        outcome: "failure",
        workspaceId: isUuid(payload.workspaceId) ? payload.workspaceId : null,
        targetType: "processing_job",
        targetId: payload.jobId,
        metadata: { document_id: payload.documentId, code: validationCode },
      });
      return jsonError(404, "The processing job was not found.", "job_validation_failed");
    }

    // The validation branch above returns for either missing row. Keep this
    // explicit guard so TypeScript preserves that invariant below.
    if (!job || !document) {
      return jsonError(404, "The processing job was not found.", "job_validation_failed");
    }

    if (job.status !== "Processed" && !PROCESSABLE_STATUSES.has(job.status)) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.validation_mismatch",
        outcome: "failure",
        workspaceId: payload.workspaceId,
        targetType: "processing_job",
        targetId: payload.jobId,
        metadata: { document_id: payload.documentId, code: "invalid_job_state" },
      });
      return jsonError(
        409,
        "The processing job is not in a processable state.",
        "invalid_job_state",
      );
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "ingestion.worker.accepted",
      outcome: "success",
      workspaceId: payload.workspaceId,
      targetType: "processing_job",
      targetId: payload.jobId,
      metadata: { document_id: payload.documentId, initial_status: job.status },
    });

    stage = "process_placeholder";
    const { data, error: processError } = await supabase.rpc(
      "process_ingestion_job_placeholder",
      {
        p_job_id: payload.jobId,
        p_document_id: payload.documentId,
        p_workspace_id: payload.workspaceId,
        p_correlation_id: correlationId,
      },
    );

    if (processError) {
      if (isValidationError(processError.message)) {
        console.warn("[RegSpan worker] Transactional validation rejected", {
          correlationId,
          jobId: payload.jobId,
          documentId: payload.documentId,
          stage,
          error: processError.message,
        });
        await recordSecurityAuditEvent(supabase, {
          request,
          correlationId,
          action: "ingestion.worker.validation_mismatch",
          outcome: "failure",
          workspaceId: payload.workspaceId,
          targetType: "processing_job",
          targetId: payload.jobId,
          metadata: { document_id: payload.documentId, code: "transaction_rejected" },
        });
        return jsonError(409, "The processing job changed state.", "job_state_changed");
      }
      throw new Error(`placeholder_processing_failed:${processError.message}`);
    }

    const result = data as WorkerResult;
    stage = "write_completion_audit";
    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "ingestion.worker.completed",
      outcome: "success",
      workspaceId: payload.workspaceId,
      targetType: "processing_job",
      targetId: payload.jobId,
      metadata: {
        document_id: payload.documentId,
        replayed: result.replayed,
        placeholder: true,
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: payload.jobId,
      status: result.result,
      replayed: result.replayed,
    });
  } catch (error) {
    console.error("[RegSpan worker] Worker request failed", {
      correlationId,
      jobId: payload?.jobId,
      documentId: payload?.documentId,
      stage,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (supabase && payload) {
      await markWorkerFailure(supabase, payload);
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.failed",
        outcome: "failure",
        workspaceId: payload.workspaceId,
        targetType: "processing_job",
        targetId: payload.jobId,
        metadata: { document_id: payload.documentId, failing_stage: stage },
      });
    }

    return jsonError(500, "The ingestion worker failed.", "worker_failed");
  }
}
