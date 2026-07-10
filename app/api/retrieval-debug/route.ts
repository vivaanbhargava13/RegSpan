import { NextResponse } from "next/server";
import {
  authenticateRequest,
  DocumentRequestError,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { createEmbeddingProvider, EmbeddingProcessingError } from "@/lib/embeddings";
import { loadWorkspaceExternalAiProcessingPolicy } from "@/lib/aiProcessingPolicy";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import {
  parseRetrievalDebugRequest,
  RetrievalDebugValidationError,
} from "@/lib/retrievalDebug";
import { areInternalDebugRoutesEnabled } from "@/lib/securityFeatureFlags";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function retrievalDebugErrorResponse(error: unknown) {
  if (error instanceof RetrievalDebugValidationError) {
    return {
      status: 400,
      body: { ok: false, error: error.publicMessage, code: error.code },
    };
  }

  if (error instanceof EmbeddingProcessingError) {
    return {
      status: error.status,
      body: { ok: false, error: error.safeMessage, code: error.code },
    };
  }

  return documentErrorResponse(error);
}

function omitEmbeddingInput<T extends { embedding_input?: unknown }>(value: T) {
  const { embedding_input: omittedEmbeddingInput, ...safeValue } = value;
  void omittedEmbeddingInput;
  return safeValue;
}

function sanitizeRetrievalDebugResults(results: Awaited<ReturnType<typeof retrieveRelevantChunks>>) {
  return results.map(omitEmbeddingInput);
}

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  let documentId: string | null = null;

  try {
    if (!areInternalDebugRoutesEnabled()) {
      console.warn("[RegSpan retrieval] Debug route blocked", {
        correlationId,
        enabled: false,
      });
      return NextResponse.json(
        { ok: false, error: "Not found.", code: "not_found" },
        { status: 404 },
      );
    }

    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
    const workspaceAiPolicy = await loadWorkspaceExternalAiProcessingPolicy({
      supabase,
      workspaceId,
    });
    const embeddingProvider = createEmbeddingProvider(
      process.env,
      fetch,
      workspaceAiPolicy,
    );
    const parsed = parseRetrievalDebugRequest(await request.json());
    documentId = parsed.documentId;

    if (parsed.documentId) {
      const { data: document, error: documentError } = await supabase
        .from("documents")
        .select("id")
        .eq("id", parsed.documentId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (documentError) {
        console.error("[RegSpan retrieval] Document filter lookup failed", {
          correlationId,
          documentId: parsed.documentId,
          workspaceId,
          error: documentError.message,
        });
        throw new DocumentRequestError(
          "Unable to verify the document filter.",
          500,
          "document_filter_lookup_failed",
        );
      }

      if (!document) {
        throw new DocumentRequestError(
          "Document filter not found.",
          404,
          "document_filter_not_found",
        );
      }
    }

    const results = await retrieveRelevantChunks({
      workspaceId,
      queryText: parsed.query,
      topK: parsed.topK,
      documentId: parsed.documentId,
      supabase,
      provider: embeddingProvider,
    });

    console.info("[RegSpan retrieval] Debug query completed", {
      correlationId,
      workspaceId,
      documentId: parsed.documentId,
      topK: parsed.topK,
      resultCount: results.length,
    });

    return NextResponse.json({
      ok: true,
      query: parsed.query,
      topK: parsed.topK,
      documentId: parsed.documentId,
      results: sanitizeRetrievalDebugResults(results),
    });
  } catch (error) {
    console.error("[RegSpan retrieval] Debug query failed", {
      correlationId,
      documentId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    const response = retrievalDebugErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
