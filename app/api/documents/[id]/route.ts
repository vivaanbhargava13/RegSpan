import { NextResponse } from "next/server";
import {
  authorizeDocumentRequest,
  DocumentRequestError,
  documentErrorResponse,
  getCorrelationId,
  isUuid,
} from "@/lib/documentSecurity";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  const correlationId = getCorrelationId(request);
  const { id } = await params;
  let supabase;
  let stage = "initialize_admin_client";

  try {
    supabase = getServerSupabaseAdminClient();
    stage = "authorize_document";
    const { actor, document } = await authorizeDocumentRequest(supabase, request, id);
    stage = "delete_database_rows";
    const { data: deletedStoragePath, error: deleteError } = await supabase.rpc(
      "delete_document_and_derived",
      { p_workspace_id: document.workspace_id, p_document_id: document.id },
    );

    if (deleteError) {
      console.error("[RegSpan documents] Transactional delete failed", {
        correlationId,
        documentId: document.id,
        stage,
        error: deleteError.message,
      });

      if (deleteError.message.includes("processing_in_progress")) {
        throw new DocumentRequestError(
          "Document processing could not be cancelled. Please try again or contact support.",
          409,
          "processing_cancellation_required",
        );
      }
      throw new Error("document_delete_failed");
    }

    stage = "delete_storage_object";
    let cleanupWarning = false;
    if (deletedStoragePath) {
      const { error: storageError } = await supabase.storage
        .from("documents")
        .remove([deletedStoragePath as string]);
      cleanupWarning = Boolean(storageError);
      if (storageError) {
        console.error("[RegSpan documents] Deleted-row storage cleanup failed", {
          correlationId,
          documentId: document.id,
          stage,
          error: storageError.message,
        });
      }
    }

    stage = "write_audit_event";
    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.delete",
      outcome: cleanupWarning ? "partial" : "success",
      workspaceId: document.workspace_id,
      actorUserId: actor.user.id,
      targetType: "document",
      targetId: document.id,
      metadata: {
        storage_cleanup_pending: cleanupWarning,
        delete_cancels_active_jobs_if_present: true,
      },
    });

    return NextResponse.json({ ok: true, cleanupWarning });
  } catch (error) {
    console.error("[RegSpan documents] Delete request failed", {
      correlationId,
      documentId: id,
      stage,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    if (supabase) {
      await recordSecurityAuditEvent(supabase, {
        request,
        correlationId,
        action: "document.delete",
        outcome: "failure",
        targetType: "document",
        targetId: isUuid(id) ? id : null,
        metadata: { failing_stage: stage },
      });
    }
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
