import { NextResponse } from "next/server";
import {
  authenticateRequest,
  DocumentRequestError,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
  PDF_MIME_TYPE,
  sanitizePdfFilename,
  validatePdfFile,
} from "@/lib/documentSecurity";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  let supabase;
  let actorUserId: string | null = null;
  let workspaceId: string | null = null;
  let documentId: string | null = null;
  let storagePath: string | null = null;

  try {
    supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    actorUserId = actor.user.id;
    workspaceId = await getActorWorkspaceId(supabase, actor.user.id);

    const formData = await request.formData();
    const file = await validatePdfFile(formData.get("file"));
    const documentType = String(formData.get("documentType") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    const allowedDocumentTypes = new Set([
      "Incident Response",
      "Vendor Oversight",
      "Privacy",
      "Disposal",
      "Information Security",
      "Other",
    ]);
    if (!allowedDocumentTypes.has(documentType)) {
      throw new DocumentRequestError(
        "Select a valid document type.",
        400,
        "invalid_document_type",
      );
    }
    if (notes.length > 4000) {
      throw new DocumentRequestError(
        "Notes cannot exceed 4,000 characters.",
        400,
        "notes_too_long",
      );
    }

    documentId = crypto.randomUUID();
    const filename = sanitizePdfFilename(file.name);
    storagePath = `${workspaceId}/${documentId}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(storagePath, file, {
        contentType: PDF_MIME_TYPE,
        upsert: false,
      });

    if (uploadError) {
      console.error("[RegSpan documents] Storage upload failed", {
        correlationId,
        documentId,
        error: uploadError.message,
      });
      throw new Error("storage_upload_failed");
    }

    const { error: insertError } = await supabase.from("documents").insert({
      id: documentId,
      workspace_id: workspaceId,
      filename,
      document_type: documentType,
      notes: notes || null,
      status: "Uploaded",
      chunks_label: "Pending",
      storage_path: storagePath,
      file_size: file.size,
      mime_type: PDF_MIME_TYPE,
      uploaded_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("[RegSpan documents] Metadata insert failed", {
        correlationId,
        documentId,
        error: insertError.message,
      });
      await supabase.storage.from("documents").remove([storagePath]);
      throw new Error("metadata_insert_failed");
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.upload",
      outcome: "success",
      workspaceId,
      actorUserId,
      targetType: "document",
      targetId: documentId,
      metadata: { file_size: file.size, mime_type: PDF_MIME_TYPE },
    });

    return NextResponse.json({ ok: true, documentId }, { status: 201 });
  } catch (error) {
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
