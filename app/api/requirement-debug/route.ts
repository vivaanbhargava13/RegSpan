import { NextResponse } from "next/server";
import {
  authenticateRequest,
  documentErrorResponse,
  getActorWorkspaceId,
  getCorrelationId,
} from "@/lib/documentSecurity";
import { EmbeddingProcessingError } from "@/lib/embeddings";
import { retrieveRequirementHybridChunks } from "@/lib/hybridRetrieval";
import { createRequirementEvidenceClassifier } from "@/lib/requirementEvidenceClassifier";
import { buildRequirementMatchResultWithClassifier } from "@/lib/requirementMatching";
import {
  getRegSpRequirement,
  REG_SP_REQUIREMENTS,
} from "@/lib/regSpRequirements";
import { areInternalDebugRoutesEnabled } from "@/lib/securityFeatureFlags";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEFAULT_REQUIREMENT_TOP_K = 15;
const MAX_REQUIREMENT_TOP_K = 25;

class RequirementDebugRequestError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(publicMessage);
    this.name = "RequirementDebugRequestError";
  }
}

function parseRequirementDebugRequest(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new RequirementDebugRequestError(
      "Send a JSON object with a requirementId.",
      "invalid_request_body",
    );
  }

  const payload = body as Record<string, unknown>;
  const requirementId = typeof payload.requirementId === "string"
    ? payload.requirementId.trim()
    : "all";
  const topK = payload.topK === undefined || payload.topK === null
    ? DEFAULT_REQUIREMENT_TOP_K
    : Number(payload.topK);

  if (!Number.isInteger(topK) || topK < 1 || topK > MAX_REQUIREMENT_TOP_K) {
    throw new RequirementDebugRequestError(
      `Choose a top_k value from 1 to ${MAX_REQUIREMENT_TOP_K}.`,
      "invalid_top_k",
    );
  }

  if (requirementId === "all") {
    return { requirementId, topK, requirements: REG_SP_REQUIREMENTS };
  }

  const requirement = getRegSpRequirement(requirementId);
  if (!requirement) {
    throw new RequirementDebugRequestError(
      "Choose a valid Reg S-P debug requirement.",
      "invalid_requirement",
    );
  }

  return { requirementId, topK, requirements: [requirement] };
}

function requirementDebugErrorResponse(error: unknown) {
  if (error instanceof RequirementDebugRequestError) {
    return {
      status: error.status,
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

function sanitizeRequirementDebugResults(
  results: Awaited<ReturnType<typeof buildRequirementMatchResultWithClassifier>>[],
) {
  return results.map((result) => ({
    ...result,
    direct: result.direct.map(omitEmbeddingInput),
    partial: result.partial.map(omitEmbeddingInput),
    background: result.background.map(omitEmbeddingInput),
    irrelevant: result.irrelevant.map(omitEmbeddingInput),
  }));
}

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);

  try {
    if (!areInternalDebugRoutesEnabled()) {
      console.warn("[RegSpan requirements] Debug route blocked", {
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
    const parsed = parseRequirementDebugRequest(await request.json());
    const classifier = createRequirementEvidenceClassifier();

    const results = [];
    for (const requirement of parsed.requirements) {
      const chunks = await retrieveRequirementHybridChunks({
        workspaceId,
        requirement,
        topK: parsed.topK,
        supabase,
      });
      results.push(await buildRequirementMatchResultWithClassifier(
        requirement,
        chunks,
        classifier,
      ));
    }

    console.info("[RegSpan requirements] Debug matching completed", {
      correlationId,
      workspaceId,
      requirementId: parsed.requirementId,
      topK: parsed.topK,
      requirementCount: results.length,
      classifierProvider: classifier.provider,
    });

    return NextResponse.json({
      ok: true,
      topK: parsed.topK,
      requirementId: parsed.requirementId,
      classifierProvider: classifier.provider,
      results: sanitizeRequirementDebugResults(results),
    });
  } catch (error) {
    console.error("[RegSpan requirements] Debug matching failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    const response = requirementDebugErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
