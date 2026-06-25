import { NextResponse } from "next/server";
import {
  authenticateRequest,
  DocumentRequestError,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { EmbeddingProcessingError } from "@/lib/embeddings";
import { retrieveRelevantChunks } from "@/lib/retrieval";
import {
  parseRetrievalDebugRequest,
  RetrievalDebugValidationError,
} from "@/lib/retrievalDebug";
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

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);
  let documentId: string | null = null;

  try {
    const supabase = getServerSupabaseAdminClient();
    const actor = await authenticateRequest(supabase, request);
    const workspaceId = await getActorWorkspaceId(supabase, actor.user.id);
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
      results,
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
