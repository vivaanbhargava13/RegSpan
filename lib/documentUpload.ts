import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DocumentRequestError,
  PDF_MIME_TYPE,
  sanitizePdfFilename,
  validatePdfFile,
} from "@/lib/documentSecurity";
import {
  queueDocumentProcessing,
  type QueueDocumentProcessingResult,
} from "@/lib/documentProcessing";

export const DEFAULT_DOCUMENT_TYPE = "Information Security";
const ALLOWED_DOCUMENT_TYPES = new Set([
  "Incident Response",
  "Vendor Oversight",
  "Privacy",
  "Disposal",
  DEFAULT_DOCUMENT_TYPE,
  "Other",
]);

export type UploadedDocumentResult = {
  documentId: string;
  filename: string;
  processing: QueueDocumentProcessingResult;
};

export async function uploadDocumentForWorkspace({
  supabase,
  correlationId,
  workspaceId,
  file: suppliedFile,
  documentType: suppliedDocumentType,
  notes: suppliedNotes,
}: {
  supabase: SupabaseClient;
  correlationId: string;
  workspaceId: string;
  file: FormDataEntryValue | null;
  documentType?: string | null;
  notes?: string | null;
}): Promise<UploadedDocumentResult> {
  const file = await validatePdfFile(suppliedFile);
  const documentType = ALLOWED_DOCUMENT_TYPES.has(suppliedDocumentType?.trim() ?? "")
    ? suppliedDocumentType!.trim()
    : DEFAULT_DOCUMENT_TYPE;
  const notes = suppliedNotes?.trim() ?? "";
  if (notes.length > 4_000) {
    throw new DocumentRequestError(
      "Notes cannot exceed 4,000 characters.",
      400,
      "notes_too_long",
    );
  }

  const documentId = crypto.randomUUID();
  const filename = sanitizePdfFilename(file.name);
  const storagePath = `${workspaceId}/${documentId}/${filename}`;

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

  const processing = await queueDocumentProcessing({
    supabase,
    correlationId,
    documentId,
    workspaceId,
    idempotencyKey: `${correlationId}:upload:${documentId}`,
  });

  return { documentId, filename, processing };
}
