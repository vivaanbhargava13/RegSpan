import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { N8nWebhookError, triggerN8nIngestion } from "@/lib/n8n";
import { workspaceQuotaConfiguration } from "@/lib/rateLimit";

export type QueueDocumentProcessingResult = {
  ok: boolean;
  jobId?: string;
  replayed?: boolean;
  error?: string;
  code?: string;
  status?: number;
};

type JobStartResult = { job_id: string; status: string; replayed: boolean };

export function processingError(message: string) {
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
  if (message.includes("workspace_processing_limit_reached")) {
    return {
      status: 429,
      error: "Workspace processing limit reached.",
      code: "workspace_processing_limit_reached",
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

export async function markProcessingTriggerFailed(
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

export async function queueDocumentProcessing({
  supabase,
  correlationId,
  documentId,
  workspaceId,
  idempotencyKey,
}: {
  supabase: SupabaseClient;
  correlationId: string;
  documentId: string;
  workspaceId: string;
  idempotencyKey: string;
}): Promise<QueueDocumentProcessingResult> {
  const { data, error } = await supabase.rpc("start_processing_job_with_quota_v1", {
    p_workspace_id: workspaceId,
    p_document_id: documentId,
    p_status: "Queued",
    p_step: "Awaiting n8n ingestion",
    p_idempotency_key: idempotencyKey.slice(0, 128),
    p_request_id: correlationId,
    p_max_active_jobs: workspaceQuotaConfiguration().maxActiveProcessingJobs,
  });

  if (error) {
    const mapped = processingError(error.message);
    console.error("[RegSpan ingestion] Queue request rejected", {
      correlationId,
      documentId,
      code: mapped.code,
      error: error.message,
    });
    return { ok: false, error: mapped.error, code: mapped.code, status: mapped.status };
  }

  const result = data as JobStartResult;
  if (result.replayed) {
    return {
      ok: result.status !== "Failed",
      jobId: result.job_id,
      replayed: true,
      error: result.status === "Failed"
        ? "The processing webhook could not be triggered."
        : undefined,
      code: result.status === "Failed" ? "processing_trigger_failed" : undefined,
    };
  }

  try {
    await triggerN8nIngestion({
      jobId: result.job_id,
      documentId,
      workspaceId,
      correlationId,
    });
    return { ok: true, jobId: result.job_id };
  } catch (triggerError) {
    const webhookError = triggerError instanceof N8nWebhookError
      ? triggerError
      : new N8nWebhookError("network");
    console.error("[RegSpan ingestion] n8n webhook trigger failed", {
      correlationId,
      jobId: result.job_id,
      documentId,
      kind: webhookError.kind,
      upstreamStatus: webhookError.upstreamStatus,
    });
    await markProcessingTriggerFailed(supabase, result.job_id, documentId, workspaceId);
    return {
      ok: false,
      jobId: result.job_id,
      error: webhookError.kind === "configuration"
        ? "Document processing is not configured on the server."
        : "The processing webhook could not be triggered.",
      code: "processing_trigger_failed",
    };
  }
}
