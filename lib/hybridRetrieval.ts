import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolvePersistedDocumentChunkProvenance,
} from "@/lib/documentSource";
import { EmbeddingProcessingError, type EmbeddingProvider } from "@/lib/embeddings";
import {
  buildRequirementKeywordProfile,
  mergeHybridCandidates,
  rerankRequirementCandidates,
} from "@/lib/hybridReranking";
import type { RegSpRequirement } from "@/lib/regSpRequirements";
import {
  retrieveRelevantChunks,
  type RetrievedChunk,
} from "@/lib/retrieval";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type RetrieveRequirementHybridChunksInput = {
  workspaceId: string;
  requirement: RegSpRequirement;
  topK?: number;
  semanticPoolSize?: number;
  keywordPoolSize?: number;
  analysisRunId?: string | null;
  supabase?: SupabaseClient;
  provider?: EmbeddingProvider;
};

type KeywordChunkRow = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown> | null;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
};

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeIlikeTerm(term: string) {
  return term.replace(/[,%]/g, " ").trim();
}

function keywordText(row: KeywordChunkRow) {
  const metadata = row.metadata ?? {};
  return normalize([
    row.content,
    row.section_path,
    metadata.section_path,
    metadata.section_heading,
    metadata.parent_heading,
    metadata.evidence_reason,
  ].filter(Boolean).join(" "));
}

function countKeywordMatches(text: string, terms: string[]) {
  return terms.filter((term) => text.includes(normalize(term))).length;
}

async function fetchKeywordRows({
  supabase,
  workspaceId,
  terms,
  limit,
  documentIds,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  terms: string[];
  limit: number;
  documentIds?: string[] | null;
}) {
  const queryTerms = terms
    .map(escapeIlikeTerm)
    .filter((term) => term.length >= 4)
    .slice(0, 12);
  const selectColumns = "id, document_id, chunk_index, content, metadata, page_start, page_end, section_path";

  if (queryTerms.length > 0) {
    const clauses = queryTerms.flatMap((term) => [
      `content.ilike.%${term}%`,
      `section_path.ilike.%${term}%`,
    ]);
    let query = supabase
      .from("document_chunks")
      .select(selectColumns)
      .eq("workspace_id", workspaceId)
      .or(clauses.join(","))
      .limit(Math.max(limit * 4, 80));
    if (documentIds) query = query.in("document_id", documentIds);
    const { data, error } = await query;

    if (!error) {
      return (data ?? []) as KeywordChunkRow[];
    }
  }

  let query = supabase
    .from("document_chunks")
    .select(selectColumns)
    .eq("workspace_id", workspaceId)
    .limit(Math.max(limit * 4, 120));
  if (documentIds) query = query.in("document_id", documentIds);
  const { data, error } = await query;

  if (error) {
    throw new EmbeddingProcessingError(
      "keyword_retrieval_failed",
      "Keyword document chunks could not be retrieved.",
      500,
    );
  }

  return (data ?? []) as KeywordChunkRow[];
}

async function hydrateKeywordCandidates({
  supabase,
  workspaceId,
  rows,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  rows: KeywordChunkRow[];
}): Promise<RetrievedChunk[]> {
  if (rows.length === 0) {
    return [];
  }

  const documentIds = Array.from(new Set(rows.map((row) => row.document_id)));
  const { data: documents, error } = await supabase
    .from("documents")
    .select("id, filename, document_type, notes")
    .eq("workspace_id", workspaceId)
    .in("id", documentIds);

  if (error) {
    throw new EmbeddingProcessingError(
      "keyword_document_metadata_failed",
      "Keyword document metadata could not be loaded.",
      500,
    );
  }

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

  return rows.map((row) => {
    const metadata = row.metadata ?? {};
    const document = documentsById.get(row.document_id);
    const evidenceReason = typeof metadata.evidence_reason === "string"
      ? metadata.evidence_reason
      : null;
    const embeddingInput = typeof metadata.embedding_input === "string"
      ? metadata.embedding_input
      : null;
    const provenance = resolvePersistedDocumentChunkProvenance({
      metadata,
      documentId: row.document_id,
      workspaceId,
      fallback: {
        filename: document?.filename ?? null,
        documentType: document?.documentType,
        notes: document?.notes,
        sectionPath: row.section_path,
        contentPreview: row.content,
        evidenceReason,
      },
    });

    return {
      chunk_id: row.id,
      document_id: row.document_id,
      filename: document?.filename ?? null,
      page_start: row.page_start,
      page_end: row.page_end,
      chunk_index: row.chunk_index,
      section_path: row.section_path,
      content_preview: row.content,
      similarity: 0,
      evidence_reason: evidenceReason,
      embedding_input: embeddingInput,
      source_type: provenance.sourceType,
      evidence_role: provenance.evidenceRole,
      rerank_score: null,
      rerank_reason: null,
    };
  });
}

async function retrieveKeywordCandidates({
  supabase,
  workspaceId,
  requirement,
  keywordPoolSize,
  documentIds,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  requirement: RegSpRequirement;
  keywordPoolSize: number;
  documentIds?: string[] | null;
}) {
  const profile = buildRequirementKeywordProfile(requirement);
  const rows = await fetchKeywordRows({
    supabase,
    workspaceId,
    terms: profile.keywordTerms,
    limit: keywordPoolSize,
    documentIds,
  });

  const rankedRows = rows
    .map((row) => ({
      row,
      matchCount: countKeywordMatches(keywordText(row), profile.keywordTerms),
    }))
    .filter((item) => item.matchCount > 0)
    .sort((left, right) => right.matchCount - left.matchCount)
    .slice(0, keywordPoolSize)
    .map((item) => item.row);

  return hydrateKeywordCandidates({ supabase, workspaceId, rows: rankedRows });
}

export async function retrieveRequirementHybridChunks({
  workspaceId,
  requirement,
  topK = 15,
  semanticPoolSize = 30,
  keywordPoolSize = 40,
  supabase = getServerSupabaseAdminClient(),
  provider,
  analysisRunId = null,
}: RetrieveRequirementHybridChunksInput): Promise<RetrievedChunk[]> {
  let snapshotDocumentIds: string[] | null = null;
  if (analysisRunId) {
    const { data, error } = await supabase
      .from("analysis_run_documents")
      .select("document_id")
      .eq("analysis_run_id", analysisRunId)
      .eq("workspace_id", workspaceId)
      .not("document_id", "is", null);
    if (error) {
      throw new EmbeddingProcessingError(
        "analysis_snapshot_lookup_failed",
        "Analysis document snapshot could not be loaded.",
        500,
      );
    }
    snapshotDocumentIds = (data ?? [])
      .map((row) => row.document_id as string | null)
      .filter((documentId): documentId is string => Boolean(documentId));
  }
  const semanticCandidates = await retrieveRelevantChunks({
    workspaceId,
    queryText: requirement.retrievalQuery,
    topK: Math.max(topK, semanticPoolSize),
    supabase,
    provider,
    analysisRunId,
  });
  const keywordCandidates = await retrieveKeywordCandidates({
    supabase,
    workspaceId,
    requirement,
    keywordPoolSize,
    documentIds: snapshotDocumentIds,
  });
  const mergedCandidates = mergeHybridCandidates(semanticCandidates, keywordCandidates);

  return rerankRequirementCandidates(requirement, mergedCandidates, topK);
}
