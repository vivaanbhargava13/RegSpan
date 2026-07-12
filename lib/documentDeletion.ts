import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DocumentRequestError } from "@/lib/documentSecurity";

export type DeleteDocumentResult = { cleanupWarning: boolean };

export async function deleteDocumentForWorkspace({
  supabase,
  correlationId,
  workspaceId,
  documentId,
}: {
  supabase: SupabaseClient;
  correlationId: string;
  workspaceId: string;
  documentId: string;
}): Promise<DeleteDocumentResult> {
  const { data: deletedStoragePath, error: deleteError } = await supabase.rpc(
    "delete_document_and_derived",
    { p_workspace_id: workspaceId, p_document_id: documentId },
  );

  if (deleteError) {
    console.error("[RegSpan documents] Transactional delete failed", {
      correlationId,
      documentId,
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

  let cleanupWarning = false;
  if (deletedStoragePath) {
    const { error: storageError } = await supabase.storage
      .from("documents")
      .remove([deletedStoragePath as string]);
    cleanupWarning = Boolean(storageError);
    if (storageError) {
      console.error("[RegSpan documents] Deleted-row storage cleanup failed", {
        correlationId,
        documentId,
        error: storageError.message,
      });
    }
  }

  return { cleanupWarning };
}
