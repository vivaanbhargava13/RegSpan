import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEmbeddingProvider,
  EmbeddingProcessingError,
  type EmbeddingProvider,
} from "@/lib/embeddings";
import { isUuid } from "@/lib/documentSecurity";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export type RetrievedChunk = {
  chunk_id: string;
  document_id: string;
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  chunk_index: number;
  section_path: string | null;
  content_preview: string;
  similarity: number;
};

type RetrieveRelevantChunksInput = {
  workspaceId: string;
  queryText: string;
  topK?: number;
  documentId?: string | null;
  supabase?: SupabaseClient;
  provider?: EmbeddingProvider;
};

export async function retrieveRelevantChunks({
  workspaceId,
  queryText,
  topK = 10,
  documentId = null,
  supabase = getServerSupabaseAdminClient(),
  provider = createEmbeddingProvider(),
}: RetrieveRelevantChunksInput): Promise<RetrievedChunk[]> {
  const normalizedQuery = queryText.trim();
  if (!isUuid(workspaceId) || (documentId !== null && !isUuid(documentId))) {
    throw new EmbeddingProcessingError(
      "invalid_retrieval_scope",
      "The retrieval scope is invalid.",
      400,
    );
  }
  if (!normalizedQuery || normalizedQuery.length > 8_000) {
    throw new EmbeddingProcessingError(
      "invalid_retrieval_query",
      "The retrieval query is invalid.",
      400,
    );
  }
  if (!Number.isInteger(topK) || topK < 1 || topK > 50) {
    throw new EmbeddingProcessingError(
      "invalid_retrieval_limit",
      "The retrieval result limit is invalid.",
      400,
    );
  }

  const [queryEmbedding] = await provider.embedTexts([normalizedQuery]);
  const { data, error } = await supabase.rpc("match_document_chunks_v1", {
    p_workspace_id: workspaceId,
    p_query_embedding: queryEmbedding,
    p_top_k: topK,
    p_document_id: documentId,
    p_embedding_model: provider.model,
  });

  if (error) {
    throw new EmbeddingProcessingError(
      "retrieval_failed",
      "Relevant document chunks could not be retrieved.",
      500,
    );
  }

  return (data ?? []) as RetrievedChunk[];
}
