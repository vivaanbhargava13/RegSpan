import { NextResponse } from "next/server";
import {
  authorizeDocumentRequest,
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

  try {
    supabase = getServerSupabaseAdminClient();
    const { actor, document } = await authorizeDocumentRequest(supabase, request, id);
    const { data: deletedStoragePath, error: deleteError } = await supabase.rpc(
      "delete_document_and_derived",
      { p_workspace_id: document.workspace_id, p_document_id: document.id },
    );

    if (deleteError) {
      console.error("[RegSpan documents] Transactional delete failed", {
        correlationId,
        documentId: document.id,
        error: deleteError.message,
      });
      throw new Error("document_delete_failed");
    }

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
          error: storageError.message,
        });
      }
    }

    await recordSecurityAuditEvent(supabase, {
      request,
      correlationId,
      action: "document.delete",
      outcome: cleanupWarning ? "partial" : "success",
      workspaceId: document.workspace_id,
      actorUserId: actor.user.id,
      targetType: "document",
      targetId: document.id,
      metadata: { storage_cleanup_pending: cleanupWarning },
    });

    return NextResponse.json({ ok: true, cleanupWarning });
  } catch (error) {
    console.error("[RegSpan documents] Delete request failed", {
      correlationId,
      documentId: id,
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
      });
    }
    const response = documentErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
