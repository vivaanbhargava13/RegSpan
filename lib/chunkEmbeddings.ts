import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEmbeddingProvider,
  EmbeddingProcessingError,
  MAX_EMBEDDING_BATCH_SIZE,
  planEmbeddingUpdates,
  type EmbeddableChunk,
  type EmbeddingProvider,
  type ExistingChunkEmbedding,
} from "@/lib/embeddings";

type EmbedDocumentChunksInput = {
  supabase: SupabaseClient;
  workspaceId: string;
  documentId: string;
  provider?: EmbeddingProvider;
};

export type EmbedDocumentChunksResult = {
  provider: string;
  model: string;
  chunkCount: number;
  embeddedCount: number;
  skippedCount: number;
};

export async function embedDocumentChunks({
  supabase,
  workspaceId,
  documentId,
  provider = createEmbeddingProvider(),
}: EmbedDocumentChunksInput): Promise<EmbedDocumentChunksResult> {
  const { data: chunkData, error: chunkError } = await supabase
    .from("document_chunks")
    .select("id, content, content_hash")
    .eq("workspace_id", workspaceId)
    .eq("document_id", documentId)
    .order("chunk_index", { ascending: true });

  if (chunkError) {
    throw new EmbeddingProcessingError(
      "embedding_chunk_lookup_failed",
      "Document chunks could not be prepared for embedding.",
      500,
    );
  }

  const chunks = (chunkData ?? []) as Array<{
    id: string;
    content: string;
    content_hash: string | null;
  }>;

  if (chunks.length === 0 || chunks.some((chunk) => !chunk.content_hash)) {
    throw new EmbeddingProcessingError(
      "embedding_chunk_metadata_missing",
      "Document chunks are missing retrieval metadata.",
      500,
    );
  }

  const embeddableChunks = chunks as EmbeddableChunk[];
  const { data: embeddingData, error: embeddingError } = await supabase
    .from("chunk_embeddings")
    .select("chunk_id, content_hash, embedding_model")
    .eq("workspace_id", workspaceId)
    .eq("document_id", documentId)
    .eq("embedding_model", provider.model);

  if (embeddingError) {
    throw new EmbeddingProcessingError(
      "embedding_state_lookup_failed",
      "Existing chunk embeddings could not be checked.",
      500,
    );
  }

  const pendingChunks = planEmbeddingUpdates(
    embeddableChunks,
    (embeddingData ?? []) as ExistingChunkEmbedding[],
    provider.model,
  );

  let embeddedCount = 0;
  for (let start = 0; start < pendingChunks.length; start += MAX_EMBEDDING_BATCH_SIZE) {
    const batch = pendingChunks.slice(start, start + MAX_EMBEDDING_BATCH_SIZE);
    const vectors = await provider.embedTexts(batch.map((chunk) => chunk.content));
    const rows = batch.map((chunk, index) => ({
      chunk_id: chunk.id,
      workspace_id: workspaceId,
      document_id: documentId,
      embedding: vectors[index],
      embedding_model: provider.model,
      content_hash: chunk.content_hash,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await supabase
      .from("chunk_embeddings")
      .upsert(rows, { onConflict: "chunk_id,embedding_model" });

    if (upsertError) {
      throw new EmbeddingProcessingError(
        "embedding_storage_failed",
        "Chunk embeddings could not be stored.",
        500,
      );
    }
    embeddedCount += rows.length;
  }

  return {
    provider: provider.provider,
    model: provider.model,
    chunkCount: chunks.length,
    embeddedCount,
    skippedCount: chunks.length - embeddedCount,
  };
}
