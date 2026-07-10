import { NextResponse } from "next/server";
import {
  authorizeDocumentRequest,
  documentErrorResponse,
  getCorrelationId,
  isUuid,
  PDF_MIME_TYPE,
  sanitizePdfFilename,
  validatePdfFile,
} from "@/lib/documentSecurity";
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
  let replacementPath: string | null = null;

  try {
    supabase = getServerSupabaseAdminClient();
    const { actor, document } = await authorizeDocumentRequest(supabase, request, id);
    checkRateLimit({
      request,
      category: "document_replace",
      userId: actor.user.id,
      workspaceId: document.workspace_id,
      identifier: document.id,
    });
    const formData = await request.formData();
    const file = await validatePdfFile(formData.get("file"));
    const filename = sanitizePdfFilename(file.name);
    replacementPath = `${document.workspace_id}/${document.id}/${filename}`;

    if (replacementPath === document.storage_path) {
      replacementPath = `${document.workspace_id}/${document.id}/${crypto.randomUUID()}-${filename}`;
    }

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(replacementPath, file, { contentType: PDF_MIME_TYPE, upsert: false });
    if (uploadError) {
      console.error("[RegSpan documents] Replacement upload failed", {
        correlationId,
        documentId: document.id,
        error: uploadError.message,
      });
      throw new Error("replacement_upload_failed");
    }

    const { data: previousPath, error: replaceError } = await supabase.rpc(
      "replace_document_and_clear_derived",
      {
        p_workspace_id: document.workspace_id,
        p_document_id: document.id,
        p_filename: filename,
        p_document_type: document.document_type ?? "Other",
        p_notes: document.notes,
        p_storage_path: replacementPath,
        p_file_size: file.size,
        p_mime_type: PDF_MIME_TYPE,
      },
    );

    if (replaceError) {
      console.error("[RegSpan documents] Transactional replace failed", {
        correlationId,
        documentId: document.id,
        error: replaceError.message,
      });
      await supabase.storage.from("documents").remove([replacementPath]);
      throw new Error("replacement_metadata_failed");
    }

    let cleanupWarning = false;
    if (previousPath && previousPath !== replacementPath) {
      const { error: cleanupError } = await supabase.storage
        .from("documents")
        .remove([previousPath as string]);
      cleanupWarning = Boolean(cleanupError);
      if (cleanupError) {
        console.error("[RegSpan documents] Previous object cleanup failed", {
          correlationId,
          documentId: document.id,
          error: cleanupError.message,
        });
      }
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.replace",
      outcome: cleanupWarning ? "partial" : "success",
      workspaceId: document.workspace_id,
      actorUserId: actor.user.id,
      targetType: "document",
      targetId: document.id,
      metadata: { storage_cleanup_pending: cleanupWarning, file_size: file.size },
    });

    return NextResponse.json({ ok: true, cleanupWarning });
  } catch (error) {
    const rateLimited = rateLimitErrorResponse(error);
    if (rateLimited) {
      return NextResponse.json(rateLimited.body, {
        status: rateLimited.status,
        headers: rateLimited.headers,
      });
    }

    console.error("[RegSpan documents] Replace request failed", {
      correlationId,
      documentId: id,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    if (supabase) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.replace",
        outcome: "failure",
        targetType: "document",
        targetId: isUuid(id) ? id : null,
      });
    }
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
