import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceExternalAiProcessingPolicy } from "./aiProcessingPolicy";
import {
  CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA,
  type ClassifierCapabilityFixtureSuite,
} from "./classifierCapabilityEval";
import { CLASSIFIER_FACTS_MODEL } from "./classifierFactsPrototype";
import { mapV3Fact } from "./classifierFactsPrototypeV3";
import {
  buildV41ExtractionRequests,
  v41RequestHash,
  validateV41ExtractionResponse,
} from "./classifierFactsPrototypeV41";
import { aggregateFindingForRequirement, type FindingStatus } from "./findingsAggregation";
import type { GradedEvidenceChunk } from "./requirementMatching";
import { openAiClassifierUsage } from "./requirementEvidenceClassifier";
import type { RegSpRequirement } from "./regSpRequirements";
import type { RetrievedChunk } from "./retrieval";

export const CLASSIFIER_FACTS_SHADOW_MODEL = CLASSIFIER_FACTS_MODEL;
export const CLASSIFIER_FACTS_SHADOW_SUPPORTED_REQUIREMENTS = [
  "incident_assessment_containment_control",
  "incident_evidence_log_preservation",
  "response_recovery_remediation_validation",
] as const;
export const CLASSIFIER_FACTS_SHADOW_TIMEOUT_MS = 60_000;

type SupportedRequirementId = typeof CLASSIFIER_FACTS_SHADOW_SUPPORTED_REQUIREMENTS[number];
type ShadowStatus = "covered" | "partial" | "missing";
type ShadowOutcome = "model_success" | "provider_failure" | "transport_failure" | "validation_failure";

export type ClassifierFactsShadowResult = {
  workspace_id: string;
  document_id: string;
  analysis_run_id: string;
  requirement_id: SupportedRequirementId;
  outcome: ShadowOutcome;
  valid: boolean;
  current_status: FindingStatus;
  shadow_status: ShadowStatus | null;
  current_elements: string[];
  shadow_elements: string[];
  candidate_ids: string[];
  candidate_set_sha256: string;
  accepted_facts: unknown[];
  rejected_facts: unknown[];
  atomic_element_ledger: unknown[];
  source_unit_citations: unknown[];
  current_evidence: unknown[];
  request_body: unknown;
  provider_response: unknown;
  request_sha256: string;
  response_sha256: string | null;
  provider_request_id: string | null;
  model: string;
  latency_ms: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  validation_errors: string[];
};

export type ClassifierFactsShadowDisagreementCategory =
  | "exact agreement"
  | "current covered, shadow partial"
  | "current covered, shadow missing"
  | "current partial, shadow covered"
  | "current partial, shadow missing"
  | "current missing, shadow covered"
  | "current missing, shadow partial"
  | "same status, different evidence"
  | "shadow invalid";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const enabled = (value: string | undefined) => value?.trim().toLowerCase() === "true";
const sorted = (values: readonly string[]) => [...new Set(values)].sort();

export function configuredClassifierFactsShadowRequirements(environment: Record<string, string | undefined> = process.env) {
  const requested = new Set((environment.CLASSIFIER_FACTS_SHADOW_REQUIREMENTS ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  return CLASSIFIER_FACTS_SHADOW_SUPPORTED_REQUIREMENTS.filter((id) => requested.has(id));
}

export function isClassifierFactsShadowEnabled({
  requirementId,
  workspacePolicy,
  environment = process.env,
}: {
  requirementId: string;
  workspacePolicy: WorkspaceExternalAiProcessingPolicy;
  environment?: Record<string, string | undefined>;
}) {
  return enabled(environment.CLASSIFIER_FACTS_SHADOW_ENABLED)
    && enabled(environment.ENABLE_EXTERNAL_AI_PROCESSING)
    && enabled(environment.ENABLE_EXTERNAL_AI_CLASSIFIER)
    && workspacePolicy.externalAiProcessingEnabled
    && workspacePolicy.externalAiClassifierEnabled
    && configuredClassifierFactsShadowRequirements(environment).includes(requirementId as SupportedRequirementId);
}

export function classifierFactsCandidateSetHash(candidates: RetrievedChunk[]) {
  return sha256(JSON.stringify(candidates.map((candidate, position) => ({
    candidate_id: candidate.chunk_id,
    document_id: candidate.document_id,
    position,
    content: candidate.content_preview,
  }))));
}

function placeholderField<T>(value: T) {
  return { value, provenance: { confirmed: false, source_type: "implementation_inference" as const, reviewer_id: null, reviewed_at: null, source_path: "production-shadow", source_locator: "not-a-label", source_hash: "", normalization_recipe: null } };
}

function category(requirementId: SupportedRequirementId) {
  if (requirementId === "incident_assessment_containment_control") return "incident_assessment_containment" as const;
  if (requirementId === "incident_evidence_log_preservation") return "incident_evidence_log_preservation" as const;
  return "recovery_remediation_validation" as const;
}

export function buildClassifierFactsShadowRequest(requirement: RegSpRequirement, candidates: RetrievedChunk[]) {
  if (!CLASSIFIER_FACTS_SHADOW_SUPPORTED_REQUIREMENTS.includes(requirement.id as SupportedRequirementId)) {
    throw new Error(`Unsupported facts-only shadow requirement: ${requirement.id}.`);
  }
  if (!candidates.length) throw new Error("Facts-only shadow requires at least one candidate.");
  const documentIds = new Set(candidates.map((candidate) => candidate.document_id));
  if (documentIds.size !== 1) throw new Error("Facts-only shadow candidates must belong to one document.");
  const requirementId = requirement.id as SupportedRequirementId;
  const fixture = {
    schema_version: CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA,
    fixture_version: "production-shadow-v1",
    frozen_baseline_commit: "frozen-v4.1",
    source_diagnostic_artifact: "production-shadow",
    suite_hash: "production-shadow",
    requirements: [requirement],
    requirement_sha256: { [requirement.id]: sha256(JSON.stringify(requirement)) },
    multi_candidate_review: { status: "diagnostic_only", case_id: null, blocker: null },
    cases: candidates.map((candidate, index) => ({
      id: `shadow-${index + 1}`,
      requirement_id: requirement.id,
      category: category(requirementId),
      evaluation_role: "scored",
      expected_status: placeholderField(null),
      expected_supported_elements: placeholderField(null),
      notes: "Request construction only; contains no reviewer label.",
      candidates: [{
        ...candidate,
        expected_relationship: placeholderField(null),
        expected_covered_elements: placeholderField(null),
        direct_support_recovery: placeholderField(null),
        hard_negative: placeholderField(null),
        source: { kind: "frozen_evaluation_pack", path: "production-shadow", locator: candidate.chunk_id, content_sha256: sha256(candidate.content_preview), normalization_recipe: null },
      }],
    })),
  } as unknown as ClassifierCapabilityFixtureSuite;
  const requests = buildV41ExtractionRequests(fixture);
  if (requests.length !== 1) throw new Error(`Expected one V4.1 shadow request, received ${requests.length}.`);
  const request = requests[0];
  if (request.model !== CLASSIFIER_FACTS_SHADOW_MODEL) throw new Error("Frozen V4.1 shadow model drift.");
  if (JSON.stringify(request.candidates.map((item) => item.candidate_id)) !== JSON.stringify(candidates.map((item) => item.chunk_id))) {
    throw new Error("Facts-only shadow candidate identity or order drift.");
  }
  return request;
}

function deriveShadowStatus(requirement: RegSpRequirement, elements: string[]): ShadowStatus {
  if (requirement.requiredElementsForCovered.every((id) => elements.includes(id))) return "covered";
  return elements.length ? "partial" : "missing";
}

function currentSnapshot(requirement: RegSpRequirement, candidates: RetrievedChunk[], graded: GradedEvidenceChunk[]) {
  const byId = new Map(graded.map((item) => [item.chunk_id, item]));
  const ordered = candidates.map((candidate) => byId.get(candidate.chunk_id)).filter((item): item is GradedEvidenceChunk => Boolean(item));
  const currentElements = sorted(ordered.flatMap((item) => item.covered_elements));
  const currentEvidence = ordered.filter((item) => item.evidence_relationship === "supports" || item.evidence_relationship === "partially_supports")
    .map((item) => ({ candidate_id: item.chunk_id, covered_elements: item.covered_elements, relationship: item.evidence_relationship, quote: item.supporting_quote }));
  const status = aggregateFindingForRequirement(requirement, ordered).status;
  return { status, currentElements, currentEvidence };
}

function providerMetadata(parsed: unknown) {
  const value = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const choices = Array.isArray(value.choices) ? value.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" && !Array.isArray(first.message) ? first.message as Record<string, unknown> : {};
  return { providerRequestId: typeof value.id === "string" ? value.id : null, content: typeof message.content === "string" ? message.content : null };
}

export async function executeClassifierFactsShadow({
  workspaceId,
  documentId,
  analysisRunId,
  requirement,
  candidates,
  gradedCandidates,
  currentStatus,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = CLASSIFIER_FACTS_SHADOW_TIMEOUT_MS,
}: {
  workspaceId: string;
  documentId: string;
  analysisRunId: string;
  requirement: RegSpRequirement;
  candidates: RetrievedChunk[];
  gradedCandidates: GradedEvidenceChunk[];
  currentStatus?: FindingStatus;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ClassifierFactsShadowResult> {
  const request = buildClassifierFactsShadowRequest(requirement, candidates);
  const snapshot = currentSnapshot(requirement, candidates, gradedCandidates);
  const base = {
    workspace_id: workspaceId, document_id: documentId, analysis_run_id: analysisRunId,
    requirement_id: requirement.id as SupportedRequirementId, current_status: currentStatus ?? snapshot.status,
    current_elements: snapshot.currentElements, candidate_ids: candidates.map((item) => item.chunk_id),
    candidate_set_sha256: classifierFactsCandidateSetHash(candidates), current_evidence: snapshot.currentEvidence,
    request_body: request.body, request_sha256: v41RequestHash(request), model: CLASSIFIER_FACTS_SHADOW_MODEL,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(request.body), signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    return { ...base, outcome: "transport_failure", valid: false, shadow_status: null, shadow_elements: [], accepted_facts: [], rejected_facts: [], atomic_element_ledger: [], source_unit_citations: [], provider_response: null, response_sha256: null, provider_request_id: null, latency_ms: performance.now() - started, prompt_tokens: null, completion_tokens: null, total_tokens: null, validation_errors: [String(error)] };
  }
  clearTimeout(timeout);
  const raw = await response.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { /* recorded as a validation failure below */ }
  const metadata = providerMetadata(parsed);
  const usage = openAiClassifierUsage(parsed);
  const responseBase = { ...base, provider_response: parsed, response_sha256: sha256(raw), provider_request_id: metadata.providerRequestId, latency_ms: performance.now() - started, prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens };
  if (!response.ok) {
    return { ...responseBase, outcome: "provider_failure", valid: false, shadow_status: null, shadow_elements: [], accepted_facts: [], rejected_facts: [], atomic_element_ledger: [], source_unit_citations: [], validation_errors: [`HTTP ${response.status}`] };
  }
  try {
    if (!metadata.content) throw new Error("V4.1 shadow response has no assistant content.");
    const structured = JSON.parse(metadata.content);
    const validated = validateV41ExtractionResponse(request, structured);
    const ledger = validated.facts.map((fact) => {
      const mapping = mapV3Fact(requirement.id, fact);
      return { ...fact, mapped_elements: mapping.mapped, deterministic_rejections: mapping.rejected };
    });
    const shadowElements = sorted(ledger.flatMap((item) => item.mapped_elements));
    const citations = validated.facts.map((fact) => ({ fact_id: fact.fact_id, candidate_id: fact.source_candidate_id, unit_ids: fact.source_unit_ids, exact_quote: fact.reconstructed_quote, unit_sha256: fact.source_unit_sha256 }));
    return { ...responseBase, outcome: "model_success", valid: true, shadow_status: deriveShadowStatus(requirement, shadowElements), shadow_elements: shadowElements, accepted_facts: validated.facts, rejected_facts: validated.rejectedFacts, atomic_element_ledger: ledger, source_unit_citations: citations, validation_errors: [] };
  } catch (error) {
    return { ...responseBase, outcome: "validation_failure", valid: false, shadow_status: null, shadow_elements: [], accepted_facts: [], rejected_facts: [], atomic_element_ledger: [], source_unit_citations: [], validation_errors: [String(error)] };
  }
}

export async function persistClassifierFactsShadowResult(supabase: SupabaseClient, result: ClassifierFactsShadowResult) {
  const { error } = await supabase.from("classifier_facts_shadow_results").insert(result);
  if (error) throw new Error(`classifier_facts_shadow_persist_failed:${error.code ?? "unknown"}`);
}

export async function runClassifierFactsShadowFailOpen({
  supabase, workspaceId, analysisRunId, requirement, candidates, gradedCandidates, workspacePolicy,
  environment = process.env, fetchImpl = fetch,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  analysisRunId: string;
  requirement: RegSpRequirement;
  candidates: RetrievedChunk[];
  gradedCandidates: GradedEvidenceChunk[];
  workspacePolicy: WorkspaceExternalAiProcessingPolicy;
  environment?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  if (!isClassifierFactsShadowEnabled({ requirementId: requirement.id, workspacePolicy, environment })) return [];
  const apiKey = environment.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || environment.OPENAI_API_KEY?.trim();
  if (!apiKey) { console.warn("[RegSpan shadow] Facts-only shadow skipped: API key unavailable."); return []; }
  const gradedById = new Map(gradedCandidates.map((item) => [item.chunk_id, item]));
  const byDocument = new Map<string, RetrievedChunk[]>();
  for (const candidate of candidates) byDocument.set(candidate.document_id, [...(byDocument.get(candidate.document_id) ?? []), candidate]);
  const results: ClassifierFactsShadowResult[] = [];
  for (const [documentId, documentCandidates] of byDocument) {
    try {
      const documentGraded = documentCandidates.map((candidate) => gradedById.get(candidate.chunk_id)).filter((item): item is GradedEvidenceChunk => Boolean(item));
      const result = await executeClassifierFactsShadow({ workspaceId, documentId, analysisRunId, requirement, candidates: documentCandidates, gradedCandidates: documentGraded, apiKey, fetchImpl });
      results.push(result);
      await persistClassifierFactsShadowResult(supabase, result);
    } catch (error) {
      console.warn("[RegSpan shadow] Facts-only shadow failed without affecting production analysis.", { documentId, requirementId: requirement.id, error: String(error) });
    }
  }
  return results;
}

export function categorizeClassifierFactsShadowDisagreement(row: Pick<ClassifierFactsShadowResult, "valid" | "current_status" | "shadow_status" | "current_elements" | "shadow_elements">): ClassifierFactsShadowDisagreementCategory {
  if (!row.valid || row.shadow_status === null) return "shadow invalid";
  const sameEvidence = JSON.stringify(sorted(row.current_elements)) === JSON.stringify(sorted(row.shadow_elements));
  if (row.current_status === row.shadow_status) return sameEvidence ? "exact agreement" : "same status, different evidence";
  if (row.current_status === "covered" && row.shadow_status === "partial") return "current covered, shadow partial";
  if (row.current_status === "covered" && row.shadow_status === "missing") return "current covered, shadow missing";
  if (row.current_status === "partial" && row.shadow_status === "covered") return "current partial, shadow covered";
  if (row.current_status === "partial" && row.shadow_status === "missing") return "current partial, shadow missing";
  if (row.current_status === "missing" && row.shadow_status === "covered") return "current missing, shadow covered";
  if (row.current_status === "missing" && row.shadow_status === "partial") return "current missing, shadow partial";
  return "shadow invalid";
}

export function classifierFactsShadowReportRow(row: ClassifierFactsShadowResult) {
  const categoryValue = categorizeClassifierFactsShadowDisagreement(row);
  const shadowCandidateIds = new Set((row.source_unit_citations as Array<{ candidate_id?: string }>).map((item) => item.candidate_id).filter((id): id is string => Boolean(id)));
  const currentEvidenceCandidates = (row.current_evidence as Array<{ candidate_id?: string }>).map((item) => item.candidate_id).filter((id): id is string => Boolean(id));
  return {
    workspace_id: row.workspace_id, document_id: row.document_id, analysis_run_id: row.analysis_run_id, requirement_id: row.requirement_id,
    valid: row.valid, current_status: row.current_status, shadow_status: row.shadow_status,
    disagreement_category: categoryValue,
    current_only_elements: sorted(row.current_elements.filter((id) => !row.shadow_elements.includes(id))),
    shadow_only_elements: sorted(row.shadow_elements.filter((id) => !row.current_elements.includes(id))),
    current_evidence_rejected_by_v4_1: currentEvidenceCandidates.filter((id) => !shadowCandidateIds.has(id)),
    shadow_evidence_absent_from_current_output: [...shadowCandidateIds].filter((id) => !currentEvidenceCandidates.includes(id)),
    likely_current_false_negative: row.valid && ((row.current_status === "missing" && row.shadow_status !== "missing") || (row.current_status === "partial" && row.shadow_status === "covered")),
    potential_false_assurance: row.valid && ((row.current_status === "covered" && row.shadow_status !== "covered") || (row.current_status === "partial" && row.shadow_status === "missing")),
    candidate_ids: row.candidate_ids, source_unit_citations: row.source_unit_citations, validation_errors: row.validation_errors,
    latency_ms: row.latency_ms, calls: 1, prompt_tokens: row.prompt_tokens, completion_tokens: row.completion_tokens, total_tokens: row.total_tokens,
  };
}
