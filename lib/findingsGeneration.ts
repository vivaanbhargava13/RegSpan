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
import { createRequirementEvidenceClassifier } from "@/lib/requirementEvidenceClassifier";
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

function allGradedChunks(match: Awaited<ReturnType<typeof buildRequirementMatchResultWithClassifier>>) {
  return [
    ...match.direct,
    ...match.partial,
    ...match.background,
    ...match.irrelevant,
  ];
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
  const { data, error } = await supabase
    .from("analysis_runs")
    .insert({
      workspace_id: workspaceId,
      status: "running",
      generated_by: actorUserId,
      requirement_count: requirementCount,
      finding_count: 0,
      started_at: new Date().toISOString(),
    })
    .select("id, workspace_id, status, started_at, completed_at, generated_by, requirement_count, finding_count, error_message, created_at")
    .single<AnalysisRunRow>();

  if (error || !data) {
    throw new FindingsGenerationError(
      "analysis_run_create_failed",
      "Unable to start findings analysis.",
    );
  }

  return data;
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

  if (finding.evidence.length > 0) {
    const { error: evidenceError } = await supabase.from("finding_evidence").insert(
      finding.evidence.map((evidence) => ({
        finding_id: data.id,
        workspace_id: workspaceId,
        document_id: evidence.document_id,
        chunk_id: evidence.chunk_id,
        relationship: evidence.relationship,
        quote: evidence.quote,
        evidence_quote: evidence.quote,
        reason: evidence.reason,
        confidence: evidence.confidence,
        filename: evidence.filename,
        page_start: evidence.page_start,
        page_end: evidence.page_end,
        section_path: evidence.section_path,
        chunk_index: evidence.chunk_index,
      })),
    );

    if (evidenceError) {
      throw new FindingsGenerationError(
        "finding_evidence_insert_failed",
        "Unable to store generated finding evidence.",
      );
    }
  }

  return data.id;
}

async function completeAnalysisRun({
  supabase,
  analysisRunId,
  findingCount,
}: {
  supabase: SupabaseClient;
  analysisRunId: string;
  findingCount: number;
}) {
  const completedAt = new Date().toISOString();
  const { error } = await supabase
    .from("analysis_runs")
    .update({
      status: "completed",
      completed_at: completedAt,
      finding_count: findingCount,
      error_message: null,
    })
    .eq("id", analysisRunId);

  if (error) {
    throw new FindingsGenerationError(
      "analysis_run_complete_failed",
      "Findings were generated but the analysis run could not be finalized.",
    );
  }
}

async function failAnalysisRun({
  supabase,
  analysisRunId,
  errorMessage,
}: {
  supabase: SupabaseClient;
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
    .eq("id", analysisRunId);
}

export async function generateFindingsForWorkspace({
  workspaceId,
  actorUserId,
  supabase = getServerSupabaseAdminClient(),
  topK = FINDINGS_GENERATION_TOP_K,
}: GenerateFindingsInput) {
  await assertProcessedEvidenceExists(supabase, workspaceId);
  const requirements = await loadRegSpRequirementsForFindings({ supabase });
  const analysisRun = await createAnalysisRun({
    supabase,
    workspaceId,
    actorUserId,
    requirementCount: requirements.length,
  });
  const classifier = createRequirementEvidenceClassifier();

  try {
    const generatedFindings: GeneratedRequirementFinding[] = [];
    for (const requirement of requirements) {
      const candidates = await retrieveRequirementHybridChunks({
        workspaceId,
        requirement,
        topK,
        supabase,
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
      await storeFinding({
        supabase,
        workspaceId,
        analysisRunId: analysisRun.id,
        finding,
      });
      generatedFindings.push(finding);
    }

    await completeAnalysisRun({
      supabase,
      analysisRunId: analysisRun.id,
      findingCount: generatedFindings.length,
    });

    return {
      analysisRunId: analysisRun.id,
      requirementCount: requirements.length,
      findingCount: generatedFindings.length,
      findings: generatedFindings,
    };
  } catch (error) {
    await failAnalysisRun({
      supabase,
      analysisRunId: analysisRun.id,
      errorMessage: error instanceof FindingsGenerationError
        ? error.publicMessage
        : "Findings generation failed.",
    });
    throw error;
  }
}
