import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addOptionalChunkSynopses } from "@/lib/chunkContext";
import {
  loadWorkspaceExternalAiProcessingPolicy,
} from "@/lib/aiProcessingPolicy";
import {
  inferDocumentSourceType,
  inferEvidenceRole,
} from "@/lib/documentSource";
import {
  getCorrelationId,
  isUuid,
  MAX_DOCUMENT_BYTES,
} from "@/lib/documentSecurity";
import { authenticateIngestionWorker } from "@/lib/ingestionWorker";
import { WorkerSecretConfigurationError } from "@/lib/ingestionWorkerAuth";
import {
  assertSupportedPdf,
  buildDeterministicChunks,
  extractPdfPages,
  PdfProcessingError,
  PDF_EXTRACTION_VERSION,
} from "@/lib/pdfIngestion";
import { embedDocumentChunks } from "@/lib/chunkEmbeddings";
import { createEmbeddingProvider, EmbeddingProcessingError } from "@/lib/embeddings";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

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
  filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  document_type: string | null;
  notes: string | null;
};

type WorkerResult = {
  result: "claimed" | "resumed" | "chunks_stored" | "completed" | "already_completed";
  job_status: "Processing" | "Processed";
  chunk_count?: number;
  embedding_count?: number;
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
  safeMessage: string,
) {
  const { error } = await supabase.rpc("fail_ingestion_job_v1", {
    p_job_id: payload.jobId,
    p_document_id: payload.documentId,
    p_workspace_id: payload.workspaceId,
    p_error_message: safeMessage,
  });

  if (error) {
    console.error("[RegSpan worker] Failed to persist worker failure", {
      correlationId: payload.correlationId,
      jobId: payload.jobId,
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      stage: "mark_failed",
      error: error.message,
    });
  }
}

export async function POST(request: Request) {
  const processingStartedAt = Date.now();
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
      .eq("document_id", payload.documentId)
      .eq("workspace_id", payload.workspaceId)
      .maybeSingle<WorkerJob>();

    if (jobError) {
      throw new Error(`job_lookup_failed:${jobError.message}`);
    }

    stage = "load_document";
    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id, workspace_id, filename, storage_path, mime_type, file_size, document_type, notes")
      .eq("id", payload.documentId)
      .eq("workspace_id", payload.workspaceId)
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
        workspaceId: payload.workspaceId,
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

    console.info("[RegSpan worker] Worker request accepted", {
      correlationId,
      jobId: payload.jobId,
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      stage: "accepted",
    });

    stage = "claim_job";
    const { data: claimData, error: claimError } = await supabase.rpc(
      "claim_ingestion_job_v1",
      {
        p_job_id: payload.jobId,
        p_document_id: payload.documentId,
        p_workspace_id: payload.workspaceId,
        p_correlation_id: correlationId,
      },
    );

    if (claimError) {
      if (isValidationError(claimError.message)) {
        console.warn("[RegSpan worker] Transactional validation rejected", {
          correlationId,
          jobId: payload.jobId,
          documentId: payload.documentId,
          workspaceId: payload.workspaceId,
          stage,
          code: claimError.code,
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
      console.error("[RegSpan worker] Job claim failed", {
        correlationId,
        jobId: payload.jobId,
        documentId: payload.documentId,
        workspaceId: payload.workspaceId,
        stage,
        code: claimError.code,
      });
      throw new Error("job_claim_failed");
    }

    const claimResult = claimData as WorkerResult;
    if (claimResult.result === "already_completed") {
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
          chunk_count: claimResult.chunk_count ?? null,
          replayed: true,
          extraction_version: PDF_EXTRACTION_VERSION,
        },
      });
      return NextResponse.json({
        ok: true,
        jobId: payload.jobId,
        status: "already_completed",
        chunkCount: claimResult.chunk_count ?? null,
        replayed: true,
      });
    }

    console.info("[RegSpan worker] Processing job claimed", {
      correlationId,
      jobId: payload.jobId,
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      stage,
      resumed: claimResult.result === "resumed",
    });

    stage = "validate_document_type";
    assertSupportedPdf(document.filename ?? "", document.mime_type);

    if (!document.storage_path) {
      throw new PdfProcessingError(
        "storage_path_missing",
        "The PDF storage object is unavailable.",
        422,
      );
    }

    stage = "download_private_document";
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("documents")
      .download(document.storage_path);

    if (downloadError || !fileBlob) {
      console.error("[RegSpan worker] Private document download failed", {
        correlationId,
        jobId: payload.jobId,
        documentId: payload.documentId,
        workspaceId: payload.workspaceId,
        stage,
        code: downloadError?.name ?? "missing_blob",
      });
      throw new PdfProcessingError(
        "storage_download_failed",
        "The PDF could not be downloaded for processing.",
        502,
      );
    }

    if (
      fileBlob.size === 0 ||
      fileBlob.size > MAX_DOCUMENT_BYTES ||
      (document.file_size !== null && document.file_size > MAX_DOCUMENT_BYTES) ||
      (fileBlob.type.length > 0 && fileBlob.type !== "application/pdf")
    ) {
      throw new PdfProcessingError(
        "invalid_pdf_size",
        "The PDF file size is invalid for processing.",
        422,
      );
    }

    stage = "extract_pdf_text";
    const pages = await extractPdfPages(
      new Uint8Array(await fileBlob.arrayBuffer()),
    );

    stage = "build_document_chunks";
    const documentSourceType = inferDocumentSourceType({
      filename: document.filename,
      documentType: document.document_type,
      notes: document.notes,
      sectionPath: null,
      contentPreview: null,
      evidenceReason: null,
    });
    const evidenceRole = inferEvidenceRole({
      filename: document.filename,
      documentType: document.document_type,
      notes: document.notes,
      sectionPath: null,
      contentPreview: null,
      evidenceReason: null,
    });
    const { chunks, hierarchy } = buildDeterministicChunks({
      pages,
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      jobId: payload.jobId,
      filename: document.filename ?? "document.pdf",
      documentType: document.document_type,
      sourceType: documentSourceType,
      evidenceRole,
    });
    const workspaceAiPolicy = await loadWorkspaceExternalAiProcessingPolicy({
      supabase,
      workspaceId: payload.workspaceId,
    });
    const contextChunks = await addOptionalChunkSynopses({
      chunks,
      workspacePolicy: workspaceAiPolicy,
    });

    stage = "store_document_chunks";
    const { data: storageData, error: storageError } = await supabase.rpc(
      "store_ingestion_chunks_for_embedding_v1",
      {
        p_job_id: payload.jobId,
        p_document_id: payload.documentId,
        p_workspace_id: payload.workspaceId,
        p_chunks: contextChunks,
        p_hierarchy: hierarchy,
      },
    );

    if (storageError) {
      if (isValidationError(storageError.message)) {
        console.warn("[RegSpan worker] Chunk storage transaction rejected", {
          correlationId,
          jobId: payload.jobId,
          documentId: payload.documentId,
          workspaceId: payload.workspaceId,
          stage,
          code: storageError.code,
        });
        await recordSecurityAuditEvent(supabase, {
          request,
          correlationId,
          action: "ingestion.worker.validation_mismatch",
          outcome: "failure",
          workspaceId: payload.workspaceId,
          targetType: "processing_job",
          targetId: payload.jobId,
          metadata: { document_id: payload.documentId, code: "completion_rejected" },
        });
        return jsonError(409, "The processing job changed state.", "job_state_changed");
      }
      console.error("[RegSpan worker] Chunk storage transaction failed", {
        correlationId,
        jobId: payload.jobId,
        documentId: payload.documentId,
        workspaceId: payload.workspaceId,
        stage,
        code: storageError.code,
      });
      throw new Error("chunk_storage_failed");
    }

    const storageResult = storageData as WorkerResult;
    if (storageResult.result === "already_completed") {
      return NextResponse.json({
        ok: true,
        jobId: payload.jobId,
        status: "already_completed",
        chunkCount: storageResult.chunk_count ?? null,
        replayed: true,
      });
    }

    stage = "generate_chunk_embeddings";
    const embeddingResult = await embedDocumentChunks({
      supabase,
      workspaceId: payload.workspaceId,
      documentId: payload.documentId,
      workspacePolicy: workspaceAiPolicy,
      provider: createEmbeddingProvider(process.env, fetch, workspaceAiPolicy),
    });

    console.info("[RegSpan worker] Chunk embeddings stored", {
      correlationId,
      jobId: payload.jobId,
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      stage,
      chunkCount: embeddingResult.chunkCount,
      embeddedCount: embeddingResult.embeddedCount,
      skippedCount: embeddingResult.skippedCount,
      embeddingProvider: embeddingResult.provider,
      embeddingModel: embeddingResult.model,
    });

    stage = "finalize_ingestion_embeddings";
    const { data: completionData, error: completionError } = await supabase.rpc(
      "finalize_ingestion_embeddings_v1",
      {
        p_job_id: payload.jobId,
        p_document_id: payload.documentId,
        p_workspace_id: payload.workspaceId,
        p_embedding_model: embeddingResult.model,
      },
    );

    if (completionError) {
      console.error("[RegSpan worker] Embedding finalization failed", {
        correlationId,
        jobId: payload.jobId,
        documentId: payload.documentId,
        workspaceId: payload.workspaceId,
        stage,
        code: completionError.code,
      });
      throw new Error("embedding_finalization_failed");
    }

    const result = completionData as WorkerResult;
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
        chunk_count: result.chunk_count ?? chunks.length,
        embedding_count: result.embedding_count ?? embeddingResult.chunkCount,
        embedded_count: embeddingResult.embeddedCount,
        skipped_embedding_count: embeddingResult.skippedCount,
        embedding_provider: embeddingResult.provider,
        embedding_model: embeddingResult.model,
        page_count: pages.length,
        extraction_version: PDF_EXTRACTION_VERSION,
      },
    });

    console.info("[RegSpan worker] PDF ingestion completed", {
      correlationId,
      jobId: payload.jobId,
      documentId: payload.documentId,
      workspaceId: payload.workspaceId,
      stage: "completed",
      chunkCount: result.chunk_count ?? chunks.length,
      embeddingCount: result.embedding_count ?? embeddingResult.chunkCount,
      embeddedCount: embeddingResult.embeddedCount,
      skippedEmbeddingCount: embeddingResult.skippedCount,
      pageCount: pages.length,
      replayed: result.replayed,
    });

    return NextResponse.json({
      ok: true,
      jobId: payload.jobId,
      status: result.result,
      chunkCount: result.chunk_count ?? chunks.length,
      pageCount: pages.length,
      replayed: result.replayed,
    });
  } catch (error) {
    const elapsedMs = Date.now() - processingStartedAt;
    console.error("[RegSpan worker] Worker request failed", {
      correlationId,
      jobId: payload?.jobId,
      documentId: payload?.documentId,
      workspaceId: payload?.workspaceId,
      stage,
      code: error instanceof PdfProcessingError || error instanceof EmbeddingProcessingError
        ? error.code
        : "worker_failed",
      elapsedMs,
    });

    if (supabase && payload) {
      const safeMessage = error instanceof PdfProcessingError || error instanceof EmbeddingProcessingError
        ? error.safeMessage
        : "Document ingestion failed.";
      const errorCode = error instanceof PdfProcessingError || error instanceof EmbeddingProcessingError
        ? error.code
        : "worker_failed";
      await markWorkerFailure(supabase, payload, safeMessage);
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "ingestion.worker.failed",
        outcome: "failure",
        workspaceId: payload.workspaceId,
        targetType: "processing_job",
        targetId: payload.jobId,
        metadata: {
          document_id: payload.documentId,
          failing_stage: stage,
          code: errorCode,
          elapsed_ms: elapsedMs,
          ...(error instanceof PdfProcessingError ? error.safeMetadata : {}),
        },
      });

      if (error instanceof PdfProcessingError || error instanceof EmbeddingProcessingError) {
        return jsonError(error.status, error.safeMessage, error.code);
      }
    }

    return jsonError(500, "The ingestion worker failed.", "worker_failed");
  }
}
