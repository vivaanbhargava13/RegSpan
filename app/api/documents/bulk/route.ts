import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateRequest,
  DocumentRequestError,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
  isUuid,
  type AuthorizedDocument,
} from "@/lib/documentSecurity";
import { N8nWebhookError, triggerN8nIngestion } from "@/lib/n8n";
import {
  checkRateLimit,
  rateLimitErrorResponse,
  workspaceQuotaConfiguration,
} from "@/lib/rateLimit";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type BulkAction = "delete" | "process";
type BulkScope = "all" | "selected";
type BulkDocumentResult = {
  documentId: string;
  ok: boolean;
  jobId?: string;
  cleanupWarning?: boolean;
  error?: string;
  code?: string;
};
type JobStartResult = { job_id: string; status: string; replayed: boolean };

const MAX_SELECTED_DOCUMENTS = 100;

function jsonError(error: string, code: string, status: number) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

function processingError(message: string) {
  if (message.includes("processing_in_progress")) {
    return {
      error: "This document is already being processed.",
      code: "processing_already_in_progress",
    };
  }
  if (message.includes("processing_rate_limited")) {
    return {
      error: "Please wait a few seconds before processing again.",
      code: "processing_rate_limited",
    };
  }
  if (message.includes("workspace_processing_limit_reached")) {
    return {
      error: "Workspace processing limit reached.",
      code: "workspace_processing_limit_reached",
    };
  }
  if (message.includes("invalid_idempotency_key")) {
    return {
      error: "The processing request is invalid.",
      code: "invalid_request",
    };
  }
  return {
    error: "The document could not be queued.",
    code: "processing_enqueue_failed",
  };
}

function parseBulkRequest(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DocumentRequestError(
      "Send a JSON object with action and scope.",
      400,
      "invalid_request_body",
    );
  }

  const payload = body as Record<string, unknown>;
  const action = payload.action;
  const scope = payload.scope;
  const documentIds = Array.isArray(payload.documentIds)
    ? payload.documentIds
    : [];

  if (action !== "delete" && action !== "process") {
    throw new DocumentRequestError(
      "Choose a valid bulk action.",
      400,
      "invalid_bulk_action",
    );
  }
  if (scope !== "all" && scope !== "selected") {
    throw new DocumentRequestError(
      "Choose a valid bulk scope.",
      400,
      "invalid_bulk_scope",
    );
  }

  if (scope === "selected") {
    if (documentIds.length === 0) {
      throw new DocumentRequestError(
        "Select at least one document.",
        400,
        "no_documents_selected",
      );
    }
    if (documentIds.length > MAX_SELECTED_DOCUMENTS) {
      throw new DocumentRequestError(
        `Select ${MAX_SELECTED_DOCUMENTS} or fewer documents at a time.`,
        400,
        "too_many_documents",
      );
    }
  }

  const normalizedDocumentIds = Array.from(new Set(documentIds.map((id) => String(id))));
  if (scope === "selected" && normalizedDocumentIds.some((id) => !isUuid(id))) {
    throw new DocumentRequestError("Document not found.", 404, "document_not_found");
  }

  return {
    action,
    scope,
    documentIds: normalizedDocumentIds,
  } satisfies { action: BulkAction; scope: BulkScope; documentIds: string[] };
}

async function loadWorkspaceDocuments({
  supabase,
  workspaceId,
  scope,
  documentIds,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  scope: BulkScope;
  documentIds: string[];
}) {
  let query = supabase
    .from("documents")
    .select("id, workspace_id, filename, status, storage_path, document_type, notes")
    .eq("workspace_id", workspaceId);

  if (scope === "selected") {
    query = query.in("id", documentIds);
  } else {
    query = query.order("uploaded_at", { ascending: false });
  }

  const { data, error } = await query;
  if (error) {
    console.error("[RegSpan documents] Bulk document lookup failed", {
      workspaceId,
      error: error.message,
    });
    throw new DocumentRequestError(
      "Unable to load documents for this workspace.",
      500,
      "document_lookup_failed",
    );
  }

  const documents = (data ?? []) as AuthorizedDocument[];
  if (scope === "selected" && documents.length !== documentIds.length) {
    throw new DocumentRequestError("Document not found.", 404, "document_not_found");
  }

  return documents;
}

async function deleteDocument({
  supabase,
  correlationId,
  document,
}: {
  supabase: SupabaseClient;
  correlationId: string;
  document: AuthorizedDocument;
}): Promise<BulkDocumentResult> {
  const { data: deletedStoragePath, error: deleteError } = await supabase.rpc(
    "delete_document_and_derived",
    { p_workspace_id: document.workspace_id, p_document_id: document.id },
  );

  if (deleteError) {
    console.error("[RegSpan documents] Bulk transactional delete failed", {
      correlationId,
      documentId: document.id,
      error: deleteError.message,
    });
    return {
      documentId: document.id,
      ok: false,
      error: "Document delete failed.",
      code: deleteError.message.includes("processing_in_progress")
        ? "processing_cancellation_required"
        : "document_delete_failed",
    };
  }

  let cleanupWarning = false;
  if (deletedStoragePath) {
    const { error: storageError } = await supabase.storage
      .from("documents")
      .remove([deletedStoragePath as string]);
    cleanupWarning = Boolean(storageError);
    if (storageError) {
      console.error("[RegSpan documents] Bulk storage cleanup failed", {
        correlationId,
        documentId: document.id,
        error: storageError.message,
      });
    }
  }

  return { documentId: document.id, ok: true, cleanupWarning };
}

async function markTriggerFailed(
  supabase: SupabaseClient,
  jobId: string,
  documentId: string,
  workspaceId: string,
) {
  const failedAt = new Date().toISOString();
  await Promise.all([
    supabase
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
      .in("status", ["Queued", "Processing", "Reprocessing"]),
    supabase
      .from("documents")
      .update({ status: "Failed", chunks_label: "Pending" })
      .eq("id", documentId)
      .eq("workspace_id", workspaceId),
  ]);
}

async function processDocument({
  supabase,
  correlationId,
  document,
}: {
  supabase: SupabaseClient;
  correlationId: string;
  document: AuthorizedDocument;
}): Promise<BulkDocumentResult> {
  const { data, error } = await supabase.rpc("start_processing_job_with_quota_v1", {
    p_workspace_id: document.workspace_id,
    p_document_id: document.id,
    p_status: "Queued",
    p_step: "Awaiting n8n ingestion",
    p_idempotency_key: `${correlationId}:${document.id}`.slice(0, 128),
    p_request_id: correlationId,
    p_max_active_jobs: workspaceQuotaConfiguration().maxActiveProcessingJobs,
  });

  if (error) {
    const mapped = processingError(error.message);
    console.error("[RegSpan ingestion] Bulk queue request rejected", {
      correlationId,
      documentId: document.id,
      code: mapped.code,
      error: error.message,
    });
    return { documentId: document.id, ok: false, ...mapped };
  }

  const result = data as JobStartResult;
  if (result.replayed) {
    return {
      documentId: document.id,
      ok: result.status !== "Failed",
      jobId: result.job_id,
      error: result.status === "Failed"
        ? "The processing webhook could not be triggered."
        : undefined,
      code: result.status === "Failed" ? "processing_trigger_failed" : undefined,
    };
  }

  try {
    await triggerN8nIngestion({
      jobId: result.job_id,
      documentId: document.id,
      workspaceId: document.workspace_id,
      correlationId,
    });
    return { documentId: document.id, ok: true, jobId: result.job_id };
  } catch (triggerError) {
    const webhookError = triggerError instanceof N8nWebhookError
      ? triggerError
      : new N8nWebhookError("network");
    console.error("[RegSpan ingestion] Bulk n8n webhook trigger failed", {
      correlationId,
      jobId: result.job_id,
      documentId: document.id,
      kind: webhookError.kind,
      upstreamStatus: webhookError.upstreamStatus,
    });
    await markTriggerFailed(supabase, result.job_id, document.id, document.workspace_id);
    return {
      documentId: document.id,
      ok: false,
      jobId: result.job_id,
      error: webhookError.kind === "configuration"
        ? "Document processing is not configured on the server."
        : "The processing webhook could not be triggered.",
      code: "processing_trigger_failed",
    };
  }
}

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  let supabase;
  let actorUserId: string | null = null;
  let workspaceId: string | null = null;
  let action: BulkAction | null = null;

  try {
    supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    actorUserId = actor.user.id;
    workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const parsed = parseBulkRequest(await request.json());
    action = parsed.action;
    await checkRateLimit({
      request,
      category: "document_bulk_action",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId,
      identifier: parsed.action,
    });
    const documents = await loadWorkspaceDocuments({
      supabase,
      workspaceId,
      scope: parsed.scope,
      documentIds: parsed.documentIds,
    });
    if (parsed.action === "process") {
      await checkRateLimit({
        request,
        category: "workspace_processing_request",
        supabase,
        correlationId,
        userId: actor.user.id,
        workspaceId,
        cost: documents.length,
      });
    }

    const results: BulkDocumentResult[] = [];
    for (const document of documents) {
      results.push(parsed.action === "delete"
        ? await deleteDocument({ supabase, correlationId, document })
        : await processDocument({ supabase, correlationId, document }));
    }

    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: parsed.action === "delete"
        ? "document.bulk_delete"
        : "document.bulk_process",
      outcome: failed > 0 ? "partial" : "success",
      workspaceId,
      actorUserId,
      targetType: "document",
      metadata: {
        scope: parsed.scope,
        requested_count: documents.length,
        succeeded,
        failed,
      },
    });

    return NextResponse.json({
      ok: true,
      action: parsed.action,
      scope: parsed.scope,
      requestedCount: documents.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    const rateLimited = rateLimitErrorResponse(error);
    if (rateLimited) {
      return NextResponse.json(rateLimited.body, {
        status: rateLimited.status,
        headers: rateLimited.headers,
      });
    }

    console.error("[RegSpan documents] Bulk action failed", {
      correlationId,
      action,
      workspaceId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    if (supabase) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: action === "delete"
          ? "document.bulk_delete"
          : "document.bulk_process",
        outcome: "failure",
        workspaceId,
        actorUserId,
        targetType: "document",
      });
    }
    const response = documentErrorResponse(error);
    return jsonError(response.body.error, response.body.code, response.status);
  }
}
