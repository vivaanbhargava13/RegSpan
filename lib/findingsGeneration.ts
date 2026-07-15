import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateFindingForRequirement,
  type GeneratedRequirementFinding,
} from "@/lib/findingsAggregation";
import { retrieveRequirementHybridChunks } from "@/lib/hybridRetrieval";
import {
  buildRequirementMatchResultWithClassifier,
  type GradedEvidenceChunk,
} from "@/lib/requirementMatching";
import {
  createRequirementEvidenceClassifier,
  type RequirementEvidenceClassifierTelemetry,
} from "@/lib/requirementEvidenceClassifier";
import {
  loadWorkspaceExternalAiProcessingPolicy,
} from "@/lib/aiProcessingPolicy";
import { createEmbeddingProvider } from "@/lib/embeddings";
import { workspaceQuotaConfiguration } from "@/lib/rateLimit";
import { loadRegSpRequirementsForFindings } from "@/lib/regulatoryControls";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

export const FINDINGS_GENERATION_TOP_K = 25;

export class FindingsGenerationError extends Error {
  constructor(
    public readonly code: string,
    public readonly publicMessage: string,
    public readonly status = 500,
  ) {
    super(publicMessage);
    this.name = "FindingsGenerationError";
  }
}

type GenerateFindingsInput = {
  workspaceId: string;
  actorUserId: string;
  supabase?: SupabaseClient;
  topK?: number;
  classifierTelemetry?: RequirementEvidenceClassifierTelemetry;
};

type AnalysisRunRow = {
  id: string;
  workspace_id: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  generated_by: string | null;
  requirement_count: number;
  finding_count: number;
  error_message: string | null;
  created_at: string;
};

type AnalysisRunStartResult =
  | { state: "started_new_run"; analysisRun: AnalysisRunRow; reviewedDocumentCount: number }
  | { state: "reused_active_run"; analysisRun: AnalysisRunRow };

export type FindingsGenerationResult =
  | {
    state: "completed";
    startedState: "started_new_run";
    analysisRunId: string;
    requirementCount: number;
    findingCount: number;
    reviewedDocumentCount: number;
    findings: GeneratedRequirementFinding[];
  }
  | {
    state: "reused_active_run";
    analysisRunId: string;
    requirementCount: number;
    findingCount: number;
  };

type FindingEvidenceInsertRow = {
  finding_id: string;
  workspace_id: string;
  document_id: string | null;
  chunk_id: string | null;
  relationship: GeneratedRequirementFinding["evidence"][number]["relationship"];
  quote: string;
  evidence_quote: string;
  reason: string;
  confidence: GeneratedRequirementFinding["evidence"][number]["confidence"];
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
  chunk_index: number | null;
};

type StoredFindingResult = {
  findingId: string;
  requirementId: string;
  status: GeneratedRequirementFinding["status"];
  persistedEvidenceRows: number;
};

function allGradedChunks(match: Awaited<ReturnType<typeof buildRequirementMatchResultWithClassifier>>) {
  return [
    ...match.direct,
    ...match.partial,
    ...match.background,
    ...match.irrelevant,
  ];
}

function sourceQuoteForEvidence(evidence: GeneratedRequirementFinding["evidence"][number]) {
  return [
    evidence.quote,
    evidence.evidence_quote,
    evidence.source_quote,
  ].find((quote) => quote?.trim())?.trim() ?? null;
}

function shouldPersistPrimaryEvidence(relationship: GeneratedRequirementFinding["evidence"][number]["relationship"]) {
  return relationship === "supports"
    || relationship === "partially_supports"
    || relationship === "negative_evidence";
}

function requiresPrimaryEvidence(status: GeneratedRequirementFinding["status"]) {
  return status === "covered" || status === "partial";
}

export function evidenceRowsForInsert({
  findingId,
  workspaceId,
  finding,
}: {
  findingId: string;
  workspaceId: string;
  finding: GeneratedRequirementFinding;
}): FindingEvidenceInsertRow[] {
  const rows: FindingEvidenceInsertRow[] = [];
  for (const evidence of finding.evidence) {
    const quote = sourceQuoteForEvidence(evidence);
    if (!quote || !shouldPersistPrimaryEvidence(evidence.relationship)) continue;
    rows.push({
      finding_id: findingId,
      workspace_id: workspaceId,
      document_id: evidence.document_id ?? null,
      chunk_id: evidence.chunk_id ?? null,
      relationship: evidence.relationship,
      quote,
      evidence_quote: quote,
      reason: evidence.reason,
      confidence: evidence.confidence,
      filename: evidence.filename ?? null,
      page_start: evidence.page_start ?? null,
      page_end: evidence.page_end ?? null,
      section_path: evidence.section_path ?? null,
      chunk_index: evidence.chunk_index ?? null,
    });
  }
  return rows;
}

async function assertProcessedEvidenceExists(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from("document_chunks")
    .select("id")
    .eq("workspace_id", workspaceId)
    .limit(1);

  if (error) {
    throw new FindingsGenerationError(
      "processed_evidence_lookup_failed",
      "Unable to check processed document evidence.",
    );
  }

  if ((data ?? []).length === 0) {
    throw new FindingsGenerationError(
      "no_processed_documents",
      "Process at least one document before generating findings.",
      400,
    );
  }
}

async function createAnalysisRun({
  supabase,
  workspaceId,
  actorUserId,
  requirementCount,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  actorUserId: string;
  requirementCount: number;
}) {
  const { data, error } = await supabase.rpc("start_analysis_run_with_quota_v1", {
    p_workspace_id: workspaceId,
    p_actor_user_id: actorUserId,
    p_requirement_count: requirementCount,
    p_max_active_runs: workspaceQuotaConfiguration().maxActiveAnalysisRuns,
  });

  if (error || !data) {
    throw new FindingsGenerationError(
      "analysis_run_create_failed",
      "Unable to start findings analysis.",
    );
  }

  const result = data as {
    result?: string;
    analysis_run_id?: string;
    reviewed_document_count?: number;
  } & Partial<AnalysisRunRow>;
  if (!result.analysis_run_id || !result.workspace_id) {
    throw new FindingsGenerationError(
      "analysis_run_create_failed",
      "Unable to start findings analysis.",
    );
  }

  const analysisRun = {
    id: result.analysis_run_id,
    workspace_id: result.workspace_id,
    status: result.status ?? "running",
    started_at: result.started_at ?? new Date().toISOString(),
    completed_at: result.completed_at ?? null,
    generated_by: result.generated_by ?? actorUserId,
    requirement_count: result.requirement_count ?? requirementCount,
    finding_count: result.finding_count ?? 0,
    error_message: result.error_message ?? null,
    created_at: result.created_at ?? new Date().toISOString(),
  } satisfies AnalysisRunRow;

  if (result.result === "reused_active_run") {
    return { state: "reused_active_run", analysisRun } satisfies AnalysisRunStartResult;
  }
  if (result.result !== "started_new_run") {
    throw new FindingsGenerationError(
      "analysis_run_create_failed",
      "Unable to start findings analysis.",
    );
  }
  return {
    state: "started_new_run",
    analysisRun,
    reviewedDocumentCount: result.reviewed_document_count ?? 0,
  } satisfies AnalysisRunStartResult;
}

async function storeFinding({
  supabase,
  workspaceId,
  analysisRunId,
  finding,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  analysisRunId: string;
  finding: GeneratedRequirementFinding;
}) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("findings")
    .insert({
      analysis_run_id: analysisRunId,
      workspace_id: workspaceId,
      requirement_id: finding.requirement_id,
      requirement_name: finding.requirement_name,
      status: finding.status,
      severity: finding.severity,
      confidence: finding.confidence,
      summary: finding.summary,
      finding_text: finding.summary,
      remediation: finding.remediation,
      rationale: finding.rationale,
      evidence_text: finding.evidence
        .map((evidence) => evidence.quote)
        .filter(Boolean)
        .join("\n\n") || null,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new FindingsGenerationError(
      "finding_insert_failed",
      "Unable to store generated findings.",
    );
  }

  const evidenceRows = evidenceRowsForInsert({
    findingId: data.id,
    workspaceId,
    finding,
  });

  let persistedEvidenceRows = 0;
  if (evidenceRows.length > 0) {
    const { data: insertedEvidence, error: evidenceError } = await supabase
      .from("finding_evidence")
      .insert(evidenceRows)
      .select("id");

    if (evidenceError) {
      console.error("[RegSpan findings] Finding evidence insert failed", {
        analysisRunId,
        findingId: data.id,
        requirementId: finding.requirement_id,
        error: evidenceError.message,
      });
      throw new FindingsGenerationError(
        "finding_evidence_insert_failed",
        "Unable to store generated finding evidence.",
      );
    }

    persistedEvidenceRows = insertedEvidence?.length ?? 0;
    if (persistedEvidenceRows !== evidenceRows.length) {
      throw new FindingsGenerationError(
        "finding_evidence_insert_incomplete",
        "Generated findings evidence could not be fully stored.",
      );
    }
  }

  if (requiresPrimaryEvidence(finding.status) && persistedEvidenceRows === 0) {
    console.error("[RegSpan findings] Covered or partial finding has no persisted source evidence", {
      analysisRunId,
      findingId: data.id,
      requirementId: finding.requirement_id,
      status: finding.status,
      generatedEvidenceRows: finding.evidence.length,
      insertableEvidenceRows: evidenceRows.length,
    });
    throw new FindingsGenerationError(
      "finding_primary_evidence_missing",
      `Generated ${finding.status} finding for ${finding.requirement_id} without persisted source evidence.`,
    );
  }

  return {
    findingId: data.id,
    requirementId: finding.requirement_id,
    status: finding.status,
    persistedEvidenceRows,
  };
}

function assertCompletedRunHasPrimaryEvidence(storedFindings: StoredFindingResult[]) {
  const missingEvidence = storedFindings.filter((finding) =>
    requiresPrimaryEvidence(finding.status) && finding.persistedEvidenceRows === 0
  );

  if (missingEvidence.length > 0) {
    throw new FindingsGenerationError(
      "analysis_primary_evidence_invariant_failed",
      `Analysis generated covered or partial findings without persisted source evidence: ${
        missingEvidence.map((finding) => finding.requirementId).join(", ")
      }.`,
    );
  }
}

async function completeAnalysisRun({
  supabase,
  workspaceId,
  analysisRunId,
  findingCount,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  analysisRunId: string;
  findingCount: number;
}) {
  const { data, error } = await supabase.rpc("complete_analysis_run_with_evidence_guard_v1", {
    p_analysis_run_id: analysisRunId,
    p_workspace_id: workspaceId,
    p_finding_count: findingCount,
  });

  const result = data as { result?: string; code?: string } | null;
  if (error || result?.result !== "completed") {
    throw new FindingsGenerationError(
      result?.code ?? "analysis_run_complete_failed",
      result?.code === "analysis_primary_evidence_invariant_failed"
        ? "Analysis could not be completed because primary client source evidence was not persisted."
        : "Findings were generated but the analysis run could not be finalized.",
    );
  }
}

async function failAnalysisRun({
  supabase,
  workspaceId,
  analysisRunId,
  errorMessage,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  analysisRunId: string;
  errorMessage: string;
}) {
  await supabase
    .from("analysis_runs")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq("id", analysisRunId)
    .eq("workspace_id", workspaceId);
}

export async function generateFindingsForWorkspace({
  workspaceId,
  actorUserId,
  supabase = getServerSupabaseAdminClient(),
  topK = FINDINGS_GENERATION_TOP_K,
  classifierTelemetry,
}: GenerateFindingsInput) {
  await assertProcessedEvidenceExists(supabase, workspaceId);
  const requirements = await loadRegSpRequirementsForFindings({ supabase });
  const runStart = await createAnalysisRun({
    supabase,
    workspaceId,
    actorUserId,
    requirementCount: requirements.length,
  });

  if (runStart.state === "reused_active_run") {
    return {
      state: "reused_active_run",
      analysisRunId: runStart.analysisRun.id,
      requirementCount: runStart.analysisRun.requirement_count,
      findingCount: runStart.analysisRun.finding_count,
    } satisfies FindingsGenerationResult;
  }

  const analysisRun = runStart.analysisRun;

  try {
    const workspaceAiPolicy = await loadWorkspaceExternalAiProcessingPolicy({
      supabase,
      workspaceId,
    });
    const classifier = createRequirementEvidenceClassifier(
      process.env,
      fetch,
      workspaceAiPolicy,
      classifierTelemetry,
    );
    const embeddingProvider = createEmbeddingProvider(
      process.env,
      fetch,
      workspaceAiPolicy,
    );
    const generatedFindings: GeneratedRequirementFinding[] = [];
    const storedFindings: StoredFindingResult[] = [];
    for (const requirement of requirements) {
      const candidates = await retrieveRequirementHybridChunks({
        workspaceId,
        requirement,
        topK,
        supabase,
        provider: embeddingProvider,
        analysisRunId: analysisRun.id,
      });
      const organizationCandidates = candidates.filter(
        (chunk) => chunk.evidence_role === "organization_evidence",
      );
      const match = await buildRequirementMatchResultWithClassifier(
        requirement,
        organizationCandidates,
        classifier,
      );
      const finding = aggregateFindingForRequirement(
        requirement,
        allGradedChunks(match) as GradedEvidenceChunk[],
      );
      const storedFinding = await storeFinding({
        supabase,
        workspaceId,
        analysisRunId: analysisRun.id,
        finding,
      });
      storedFindings.push(storedFinding);
      generatedFindings.push(finding);
    }

    assertCompletedRunHasPrimaryEvidence(storedFindings);

    await completeAnalysisRun({
      supabase,
      workspaceId,
      analysisRunId: analysisRun.id,
      findingCount: generatedFindings.length,
    });

    return {
      state: "completed",
      startedState: "started_new_run",
      analysisRunId: analysisRun.id,
      requirementCount: requirements.length,
      findingCount: generatedFindings.length,
      reviewedDocumentCount: runStart.reviewedDocumentCount,
      findings: generatedFindings,
    } satisfies FindingsGenerationResult;
  } catch (error) {
    await failAnalysisRun({
      supabase,
      workspaceId,
      analysisRunId: analysisRun.id,
      errorMessage: error instanceof FindingsGenerationError
        ? error.publicMessage
        : "Findings generation failed.",
    });
    throw error;
  }
}
