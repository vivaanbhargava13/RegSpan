import { NextResponse } from "next/server";
import {
  authorizeDocumentRequest,
  documentErrorResponse,
  getCorrelationId,
  isUuid,
} from "@/lib/documentSecurity";
import { deleteDocumentForWorkspace } from "@/lib/documentDeletion";
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
    stage = "delete_document_and_derived";
    const { cleanupWarning } = await deleteDocumentForWorkspace({
      supabase,
      correlationId,
      workspaceId: document.workspace_id,
      documentId: document.id,
    });

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
