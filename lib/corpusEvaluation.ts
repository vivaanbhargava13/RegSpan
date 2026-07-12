import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadDocumentForWorkspace } from "@/lib/documentUpload";
import { generateFindingsForWorkspace } from "@/lib/findingsGeneration";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  CorpusEvaluationTimeoutError,
  assertFreshEvaluationWorkspace,
  evaluationWorkspaceName,
  newEvaluationWorkspaceValues,
  pollForTerminal,
  snapshotSetViolations,
} from "@/scripts/corpusEvalCore.mjs";

const PROCESSING_TERMINAL_STATUSES = new Set(["Processed", "Failed"]);
const ANALYSIS_TERMINAL_STATUSES = new Set(["completed", "failed"]);

export class CorpusEvaluationError extends Error {
  constructor(
    message: string,
    public readonly diagnosticCode = "corpus_evaluation_error",
  ) {
    super(message);
  }
}

export type EvaluationRunContext = {
  runId: string;
  actorUserId: string;
  corpusId: string;
  mode: "isolated" | "combined";
  workspacePrefix: string;
  externalAiProcessingEnabled: true;
};

export type EvaluationWorkspaceContext = EvaluationRunContext & {
  workspaceKey: string;
  workspaceName: string;
  workspaceId: string;
};

type ProcessingJobRow = {
  id: string;
  status: string;
  step: string | null;
  error_message: string | null;
  completed_at: string | null;
};
type DocumentChunkProvenanceRow = {
  id: string;
  document_id: string;
  workspace_id: string;
  metadata: Record<string, unknown> | null;
};
type RegulatorySourceChunkProvenanceRow = { id: string };
type AnalysisRunRow = {
  id: string;
  workspace_id: string;
  generated_by: string | null;
  status: string;
  error_message: string | null;
  completed_at: string | null;
  started_at: string;
};

export function assertEvaluationWorkspacePrefix(prefix: string) {
  if (!/^regspan-eval-[a-z0-9-]*$/.test(prefix)) {
    throw new CorpusEvaluationError(
      "Evaluation workspace prefix must explicitly begin with regspan-eval-.",
    );
  }
  return prefix;
}

function expectedWorkspaceName(context: EvaluationRunContext, workspaceKey: string) {
  assertEvaluationWorkspacePrefix(context.workspacePrefix);
  return evaluationWorkspaceName({
    workspacePrefix: context.workspacePrefix,
    corpusId: context.corpusId,
    mode: context.mode,
    runId: context.runId,
    workspaceKey,
  });
}

export async function createFreshEvaluationWorkspace({
  supabase,
  context,
  workspaceKey,
}: {
  supabase: SupabaseClient;
  context: EvaluationRunContext;
  workspaceKey: string;
}): Promise<EvaluationWorkspaceContext> {
  const workspaceName = expectedWorkspaceName(context, workspaceKey);
  const { data: user, error: userError } = await supabase.auth.admin.getUserById(context.actorUserId);
  if (userError || !user.user) throw new CorpusEvaluationError("Evaluation actor user could not be verified.");

  const { data: existing, error: lookupError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("name", workspaceName)
    .limit(1);
  if (lookupError) throw new CorpusEvaluationError("Evaluation workspace lookup failed.");
  try {
    assertFreshEvaluationWorkspace((existing ?? []).length);
  } catch {
    throw new CorpusEvaluationError("Evaluation workspace already exists; start a new invocation.");
  }

  const { data: workspace, error: createError } = await supabase
    .from("workspaces")
    .insert(newEvaluationWorkspaceValues({
      workspaceName,
      actorUserId: context.actorUserId,
      externalAiProcessingEnabled: context.externalAiProcessingEnabled,
    }))
    .select("id, name, owner_user_id")
    .single();
  if (createError || !workspace) throw new CorpusEvaluationError("Evaluation workspace could not be created.");

  const { error: membershipError } = await supabase.from("workspace_members").insert({
    workspace_id: workspace.id,
    user_id: context.actorUserId,
    role: "owner",
  });
  if (membershipError) {
    await supabase.from("workspaces").delete()
      .eq("id", workspace.id)
      .eq("owner_user_id", context.actorUserId)
      .eq("name", workspaceName);
    throw new CorpusEvaluationError("Evaluation workspace membership could not be created.");
  }

  return { ...context, workspaceKey, workspaceName, workspaceId: workspace.id };
}

async function verifyEvaluationWorkspace(supabase: SupabaseClient, context: EvaluationWorkspaceContext) {
  if (context.workspaceName !== expectedWorkspaceName(context, context.workspaceKey)) {
    throw new CorpusEvaluationError("Evaluation workspace identity is invalid.");
  }
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, name, owner_user_id")
    .eq("id", context.workspaceId)
    .eq("name", context.workspaceName)
    .eq("owner_user_id", context.actorUserId)
    .maybeSingle();
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.actorUserId)
    .maybeSingle();
  if (workspaceError || membershipError || !workspace || !membership) {
    throw new CorpusEvaluationError("Evaluation workspace authorization could not be verified.");
  }
}

function evaluationRequest(correlationId: string) {
  return new Request("http://127.0.0.1/internal/corpus-evaluation", {
    headers: { "x-request-id": correlationId },
  });
}

export async function uploadCorpusDocument({
  supabase,
  context,
  filename,
  bytes,
  correlationId,
}: {
  supabase: SupabaseClient;
  context: EvaluationWorkspaceContext;
  filename: string;
  bytes: Uint8Array;
  correlationId: string;
}) {
  await verifyEvaluationWorkspace(supabase, context);
  const request = evaluationRequest(correlationId);
  for (const category of [
    "document_upload",
    "workspace_document_upload",
    "workspace_processing_request",
  ] as const) {
    await checkRateLimit({
      request,
      category,
      supabase,
      correlationId,
      userId: context.actorUserId,
      workspaceId: context.workspaceId,
    });
  }
  await checkRateLimit({
    request,
    category: "workspace_upload_bytes",
    supabase,
    correlationId,
    userId: context.actorUserId,
    workspaceId: context.workspaceId,
    cost: bytes.byteLength,
  });

  const fileBytes = new Uint8Array(bytes);
  const file = new File([fileBytes.buffer], filename, { type: "application/pdf" });
  return uploadDocumentForWorkspace({
    supabase,
    correlationId,
    workspaceId: context.workspaceId,
    file,
    documentType: "Information Security",
    notes: `Automated corpus evaluation run ${context.runId}.`,
  });
}

export async function waitForProcessingJob({
  supabase,
  context,
  documentId,
  jobId,
  pollTimeoutMs,
}: {
  supabase: SupabaseClient;
  context: EvaluationWorkspaceContext;
  documentId: string;
  jobId: string;
  pollTimeoutMs: number;
}) {
  await verifyEvaluationWorkspace(supabase, context);
  const job = await pollForTerminal<ProcessingJobRow>({
    label: "Document processing",
    timeoutMs: pollTimeoutMs,
    terminalStatuses: PROCESSING_TERMINAL_STATUSES,
    load: async () => {
      const { data, error } = await supabase
        .from("processing_jobs")
        .select("id, status, step, error_message, completed_at")
        .eq("id", jobId)
        .eq("workspace_id", context.workspaceId)
        .eq("document_id", documentId)
        .maybeSingle<ProcessingJobRow>();
      if (error || !data) throw new CorpusEvaluationError("Processing job could not be loaded.");
      return data;
    },
  });
  return job;
}

async function assertExactEligibleDocuments(
  supabase: SupabaseClient,
  context: EvaluationWorkspaceContext,
  expectedDocumentIds: string[],
) {
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("workspace_id", context.workspaceId)
    .in("status", ["Processed", "Ready"]);
  if (error) throw new CorpusEvaluationError("Evaluation document set could not be verified.");
  const violations = snapshotSetViolations((data ?? []).map((row) => row.id), expectedDocumentIds);
  if (violations.length > 0) {
    throw new CorpusEvaluationError(`Evaluation workspace document set is invalid: ${violations.join(", ")}.`);
  }
}

export async function assertExactAnalysisSnapshot({
  supabase,
  context,
  analysisRunId,
  expectedDocumentIds,
}: {
  supabase: SupabaseClient;
  context: EvaluationWorkspaceContext;
  analysisRunId: string;
  expectedDocumentIds: string[];
}) {
  const { data, error } = await supabase
    .from("analysis_run_documents")
    .select("document_id")
    .eq("workspace_id", context.workspaceId)
    .eq("analysis_run_id", analysisRunId);
  if (error) throw new CorpusEvaluationError("Evaluation Analysis snapshot could not be verified.");
  const violations = snapshotSetViolations((data ?? []).map((row) => row.document_id), expectedDocumentIds);
  if (violations.length > 0) {
    throw new CorpusEvaluationError(`Evaluation Analysis snapshot is invalid: ${violations.join(", ")}.`);
  }
}

export async function runWorkspaceAnalysis({
  supabase,
  context,
  expectedDocumentIds,
  pollTimeoutMs,
  correlationId,
}: {
  supabase: SupabaseClient;
  context: EvaluationWorkspaceContext;
  expectedDocumentIds: string[];
  pollTimeoutMs: number;
  correlationId: string;
}) {
  await verifyEvaluationWorkspace(supabase, context);
  await assertExactEligibleDocuments(supabase, context, expectedDocumentIds);
  await checkRateLimit({
    request: evaluationRequest(correlationId),
    category: "findings_generate",
    supabase,
    correlationId,
    userId: context.actorUserId,
    workspaceId: context.workspaceId,
  });
  const result = await generateFindingsForWorkspace({
    supabase,
    workspaceId: context.workspaceId,
    actorUserId: context.actorUserId,
  });
  if (result.state === "reused_active_run") {
    throw new CorpusEvaluationError("Fresh evaluation workspace unexpectedly had an active Analysis run.");
  }
  const run = await pollForTerminal<AnalysisRunRow>({
    label: "Analysis polling",
    timeoutMs: pollTimeoutMs,
    terminalStatuses: ANALYSIS_TERMINAL_STATUSES,
    load: async () => {
      const { data, error } = await supabase
        .from("analysis_runs")
        .select("id, workspace_id, generated_by, status, error_message, completed_at, started_at")
        .eq("id", result.analysisRunId)
        .eq("workspace_id", context.workspaceId)
        .eq("generated_by", context.actorUserId)
        .maybeSingle<AnalysisRunRow>();
      if (error || !data) throw new CorpusEvaluationError("Analysis run could not be loaded.");
      return data;
    },
  });
  if (run.status !== "completed") throw new CorpusEvaluationError("Analysis failed or did not complete.");
  await assertExactAnalysisSnapshot({
    supabase,
    context,
    analysisRunId: result.analysisRunId,
    expectedDocumentIds,
  });
  return { ...result, analysisRun: run };
}

export async function loadEvaluationRunData({
  supabase,
  context,
  analysisRunId,
  expectedDocumentIds,
}: {
  supabase: SupabaseClient;
  context: EvaluationWorkspaceContext;
  analysisRunId: string;
  expectedDocumentIds: string[];
}) {
  await verifyEvaluationWorkspace(supabase, context);
  await assertExactAnalysisSnapshot({ supabase, context, analysisRunId, expectedDocumentIds });
  const [{ data: snapshots, error: snapshotError }, { data: findings, error: findingsError }] = await Promise.all([
    supabase.from("analysis_run_documents")
      .select("document_id, filename, document_status")
      .eq("analysis_run_id", analysisRunId)
      .eq("workspace_id", context.workspaceId),
    supabase.from("findings")
      .select("id, requirement_id, status")
      .eq("analysis_run_id", analysisRunId)
      .eq("workspace_id", context.workspaceId),
  ]);
  if (snapshotError || findingsError) throw new CorpusEvaluationError("Analysis results could not be loaded.");
  const findingIds = (findings ?? []).map((finding) => finding.id);
  const { data: evidence, error: evidenceError } = findingIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("finding_evidence")
      .select("id, finding_id, workspace_id, document_id, chunk_id, relationship, quote, evidence_quote")
      .eq("workspace_id", context.workspaceId)
      .in("finding_id", findingIds);
  if (evidenceError) {
    throw new CorpusEvaluationError(
      "Finding evidence could not be loaded.",
      "finding_evidence_query_failed",
    );
  }
  const chunkIds = [...new Set((evidence ?? []).map((row) => row.chunk_id).filter(Boolean))];
  const { data: chunks, error: chunksError } = chunkIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("document_chunks")
      .select("id, document_id, workspace_id, metadata")
      .in("id", chunkIds) as unknown as { data: DocumentChunkProvenanceRow[] | null; error: unknown };
  if (chunksError) {
    throw new CorpusEvaluationError(
      "Evidence provenance could not be loaded.",
      "evidence_provenance_query_failed",
    );
  }
  const chunkById = new Map((chunks ?? []).map((chunk) => [chunk.id, chunk]));
  const unresolvedChunkIds = chunkIds.filter((chunkId) => !chunkById.has(chunkId));
  const { data: regulatoryChunks, error: regulatoryChunksError } = unresolvedChunkIds.length === 0
    ? { data: [], error: null }
    : await supabase.from("regulatory_source_chunks")
      .select("id")
      .in("id", unresolvedChunkIds) as unknown as { data: RegulatorySourceChunkProvenanceRow[] | null; error: unknown };
  if (regulatoryChunksError) {
    throw new CorpusEvaluationError(
      "Evidence provenance could not be loaded.",
      "evidence_provenance_query_failed",
    );
  }
  const regulatoryChunkIds = new Set((regulatoryChunks ?? []).map((chunk) => chunk.id));
  return {
    snapshots: snapshots ?? [],
    findings: findings ?? [],
    evidence: (evidence ?? []).map((row) => ({
      ...row,
      source_resolution: chunkById.has(row.chunk_id)
        ? "client_document_chunk"
        : regulatoryChunkIds.has(row.chunk_id)
          ? "regulatory_source_chunk"
          : "unresolved",
      chunk_document_id: chunkById.get(row.chunk_id)?.document_id ?? null,
      chunk_workspace_id: chunkById.get(row.chunk_id)?.workspace_id ?? null,
      source_type: chunkById.get(row.chunk_id)?.metadata?.source_type,
    })),
  };
}

export { CorpusEvaluationTimeoutError };
