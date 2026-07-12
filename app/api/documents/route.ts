import { NextResponse } from "next/server";
import {
  authenticateRequest,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
  PDF_MIME_TYPE,
  validatePdfFile,
} from "@/lib/documentSecurity";
import { uploadDocumentForWorkspace } from "@/lib/documentUpload";
import {
  checkRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rateLimit";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  let supabase;
  let actorUserId: string | null = null;
  let workspaceId: string | null = null;
  let documentId: string | null = null;

  try {
    supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    actorUserId = actor.user.id;
    workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const formData = await request.formData();
    const file = await validatePdfFile(formData.get("file"));
    await checkRateLimit({
      request,
      category: "document_upload",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId,
    });
    await checkRateLimit({
      request,
      category: "workspace_document_upload",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId,
    });
    await checkRateLimit({
      request,
      category: "workspace_upload_bytes",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId,
      cost: file.size,
    });
    await checkRateLimit({
      request,
      category: "workspace_processing_request",
      supabase,
      correlationId,
      userId: actor.user.id,
      workspaceId,
    });
    const uploadedDocument = await uploadDocumentForWorkspace({
      supabase,
      correlationId,
      workspaceId,
      file,
      documentType: String(formData.get("documentType") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    });
    documentId = uploadedDocument.documentId;
    const processingResult = uploadedDocument.processing;

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.upload",
      outcome: "success",
      workspaceId,
      actorUserId,
      targetType: "document",
      targetId: documentId,
      metadata: {
        file_size: file.size,
        mime_type: PDF_MIME_TYPE,
        processing_queued: processingResult.ok,
        processing_code: processingResult.code ?? null,
      },
    });

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.process.auto_requested",
      outcome: processingResult.ok ? "success" : "failure",
      workspaceId,
      actorUserId,
      targetType: processingResult.jobId ? "processing_job" : "document",
      targetId: processingResult.jobId ?? documentId,
      metadata: {
        document_id: documentId,
        code: processingResult.code ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      documentId,
      processingQueued: processingResult.ok,
      processingError: processingResult.ok ? null : processingResult.error,
    }, { status: 201 });
  } catch (error) {
    const rateLimited = rateLimitErrorResponse(error);
    if (rateLimited) {
      return NextResponse.json(rateLimited.body, {
        status: rateLimited.status,
        headers: rateLimited.headers,
      });
    }

    console.error("[RegSpan documents] Upload request failed", {
      correlationId,
      documentId,
      error: error instanceof Error ? error.message : "unknown_error",
    });

    if (supabase) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.upload",
        outcome: "failure",
        workspaceId,
        actorUserId,
        targetType: "document",
        targetId: documentId,
      });
    }

    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
