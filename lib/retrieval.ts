import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createEmbeddingProvider,
  EmbeddingProcessingError,
  type EmbeddingProvider,
} from "@/lib/embeddings";
import type { WorkspaceExternalAiProcessingPolicy } from "@/lib/aiProcessingPolicy";
import {
  resolvePersistedDocumentChunkProvenance,
  type DocumentSourceType,
  type EvidenceRole,
} from "@/lib/documentSource";
import { isUuid } from "@/lib/documentSecurity";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export type RetrievedChunk = {
  chunk_id: string;
  rank?: number | null;
  document_id: string;
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  chunk_index: number;
  section_path: string | null;
  content_preview: string;
  similarity: number;
  evidence_reason: string | null;
  embedding_input: string | null;
  source_type: DocumentSourceType;
  evidence_role: EvidenceRole;
  rerank_score: number | null;
  rerank_reason: string | null;
};

type RetrieveRelevantChunksInput = {
  workspaceId: string;
  queryText: string;
  topK?: number;
  documentId?: string | null;
  analysisRunId?: string | null;
  supabase?: SupabaseClient;
  provider?: EmbeddingProvider;
  workspacePolicy?: WorkspaceExternalAiProcessingPolicy;
};

export async function retrieveRelevantChunks(input: RetrieveRelevantChunksInput): Promise<RetrievedChunk[]> {
  const {
    workspaceId,
    queryText,
    topK = 10,
    documentId = null,
    analysisRunId = null,
    supabase = getServerSupabaseAdminClient(),
  } = input;
  const normalizedQuery = queryText.trim();
  if (!isUuid(workspaceId)
    || (documentId !== null && !isUuid(documentId))
    || (analysisRunId !== null && !isUuid(analysisRunId))) {
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

  const provider = input.provider
    ?? createEmbeddingProvider(process.env, fetch, input.workspacePolicy);

  const [queryEmbedding] = await provider.embedTexts([normalizedQuery]);
  const { data, error } = analysisRunId
    ? await supabase.rpc("match_analysis_run_document_chunks_v1", {
      p_analysis_run_id: analysisRunId,
      p_workspace_id: workspaceId,
      p_query_embedding: queryEmbedding,
      p_top_k: topK,
      p_embedding_model: provider.model,
    })
    : await supabase.rpc("match_document_chunks_v1", {
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

  const results = (data ?? []) as Omit<
    RetrievedChunk,
    "evidence_reason" | "embedding_input" | "source_type" | "evidence_role" | "rerank_score" | "rerank_reason"
  >[];
  if (results.length === 0) {
    return [];
  }

  const chunkIds = results.map((result) => result.chunk_id);
  const documentIds = Array.from(new Set(results.map((result) => result.document_id)));
  const { data: chunkMetadata, error: metadataError } = await supabase
    .from("document_chunks")
    .select("id, metadata")
    .eq("workspace_id", workspaceId)
    .in("id", chunkIds);

  if (metadataError) {
    throw new EmbeddingProcessingError(
      "retrieval_metadata_failed",
      "Retrieved chunk metadata could not be loaded.",
      500,
    );
  }

  const { data: documents, error: documentsError } = await supabase
    .from("documents")
    .select("id, filename, document_type, notes")
    .eq("workspace_id", workspaceId)
    .in("id", documentIds);

  if (documentsError) {
    throw new EmbeddingProcessingError(
      "retrieval_document_metadata_failed",
      "Retrieved document metadata could not be loaded.",
      500,
    );
  }

  const metadataByChunkId = new Map(
    (chunkMetadata ?? []).map((chunk) => [
      chunk.id as string,
      (chunk.metadata ?? {}) as Record<string, unknown>,
    ]),
  );
  const documentsById = new Map(
    (documents ?? []).map((document) => [
      document.id as string,
      {
        filename: document.filename as string | null,
        documentType: document.document_type as string | null,
        notes: document.notes as string | null,
      },
    ]),
  );

  return results.map((result, index) => {
    const metadata = metadataByChunkId.get(result.chunk_id) ?? {};
    const document = documentsById.get(result.document_id);
    const evidenceReason = typeof metadata.evidence_reason === "string"
      ? metadata.evidence_reason
      : null;
    const embeddingInput = typeof metadata.embedding_input === "string"
      ? metadata.embedding_input
      : null;
    const provenance = resolvePersistedDocumentChunkProvenance({
      metadata,
      documentId: result.document_id,
      workspaceId,
      fallback: {
        filename: document?.filename ?? result.filename,
        documentType: document?.documentType,
        notes: document?.notes,
        sectionPath: result.section_path,
        contentPreview: result.content_preview,
        evidenceReason,
      },
    });

    return {
      ...result,
      rank: index + 1,
      evidence_reason: evidenceReason,
      embedding_input: embeddingInput,
      source_type: provenance.sourceType,
      evidence_role: provenance.evidenceRole,
      rerank_score: null,
      rerank_reason: null,
    };
  });
}
