import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkspaceExternalAiProcessingPolicy } from "./aiProcessingPolicy";
import {
  CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA,
  type ClassifierCapabilityFixtureSuite,
} from "./classifierCapabilityEval";
import { CLASSIFIER_FACTS_MODEL, segmentCandidate } from "./classifierFactsPrototype";
import { mapV3Fact } from "./classifierFactsPrototypeV3";
import {
  CLASSIFIER_FACTS_V41_SCHEMA,
  buildV41ExtractionRequests,
  v41RequestHash,
  validateV41ExtractionResponse,
  type V41Request,
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
export const CLASSIFIER_FACTS_SHADOW_ENQUEUE_TIMEOUT_MS = 2_000;
export const CLASSIFIER_FACTS_SHADOW_CANDIDATE_HASH_VERSION = "canonical-v2" as const;

type SupportedRequirementId = typeof CLASSIFIER_FACTS_SHADOW_SUPPORTED_REQUIREMENTS[number];
type ShadowStatus = "covered" | "partial" | "missing";
type ShadowOutcome = "model_success" | "provider_failure" | "transport_failure" | "validation_failure";

export type ClassifierFactsShadowCandidateSnapshot = RetrievedChunk & {
  position: number;
  units: ReturnType<typeof segmentCandidate>;
};

export type ClassifierFactsShadowJobSnapshot = {
  workspace_id: string;
  document_id: string;
  analysis_run_id: string;
  requirement_id: SupportedRequirementId;
  requirement: RegSpRequirement;
  current_status: FindingStatus;
  current_elements: string[];
  current_evidence: unknown[];
  candidates: ClassifierFactsShadowCandidateSnapshot[];
  candidate_ids: string[];
  candidate_set_sha256: string;
  candidate_set_hash_version?: typeof CLASSIFIER_FACTS_SHADOW_CANDIDATE_HASH_VERSION;
  model: typeof CLASSIFIER_FACTS_MODEL;
  version_identity: typeof CLASSIFIER_FACTS_V41_SCHEMA;
  created_at: string;
};

export type ClassifierFactsShadowJob = {
  id: string;
  workspace_id: string;
  document_id: string;
  analysis_run_id: string;
  requirement_id: SupportedRequirementId;
  status: "pending" | "running" | "completed" | "failed";
  attempts: number;
  snapshot: ClassifierFactsShadowJobSnapshot;
  claimed_at: string | null;
  completed_at: string | null;
  last_error: string | null;
};

export type ClassifierFactsShadowResult = {
  shadow_job_id?: string;
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

type CandidateHashVersion = "legacy-v1" | typeof CLASSIFIER_FACTS_SHADOW_CANDIDATE_HASH_VERSION;

function classifierFactsShadowCandidateProjection(
  candidates: Array<RetrievedChunk | ClassifierFactsShadowCandidateSnapshot>,
  version: CandidateHashVersion,
) {
  const stable = <T>(value: T) => version === "legacy-v1" ? value : value ?? null;
  return candidates.map((candidate, position) => ({
    candidate_id: candidate.chunk_id,
    document_id: candidate.document_id,
    position,
    filename: stable(candidate.filename),
    page_start: stable(candidate.page_start),
    page_end: stable(candidate.page_end),
    chunk_index: stable(candidate.chunk_index),
    section_path: stable(candidate.section_path),
    content_preview: candidate.content_preview,
    source_type: stable(candidate.source_type),
    evidence_role: stable(candidate.evidence_role),
    ...(version === "legacy-v1" ? {
      units: ("units" in candidate ? candidate.units : segmentCandidate(candidate.chunk_id, candidate.content_preview))
        .map((unit) => ({
          unit_id: unit.unit_id,
          candidate_id: unit.candidate_id,
          ordinal: unit.ordinal,
          start_offset: unit.start_offset,
          end_offset: unit.end_offset,
          text: unit.text,
          text_sha256: unit.text_sha256,
        })),
    } : {}),
  }));
}

export function computeClassifierFactsShadowCandidateSetHash(
  candidates: Array<RetrievedChunk | ClassifierFactsShadowCandidateSnapshot>,
  version: CandidateHashVersion = CLASSIFIER_FACTS_SHADOW_CANDIDATE_HASH_VERSION,
) {
  return sha256(JSON.stringify(classifierFactsShadowCandidateProjection(candidates, version)));
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

function shadowRequestUserMessage(
  requirement: RegSpRequirement,
  candidates: ClassifierFactsShadowCandidateSnapshot[],
) {
  const source = candidates.map((candidate, index) => ({
    case_id: `shadow-${index + 1}`,
    source_candidate_id: candidate.chunk_id,
    units: candidate.units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text })),
  }));
  return [
    `Factual extraction focus: ${requirement.title}.`,
    "Account for every unit with facts or no_fact. Extract all relevant atomic operations without assessing sufficiency.",
    JSON.stringify({ candidates: source }, null, 2),
  ].join("\n\n");
}

export function buildClassifierFactsShadowRequestFromSnapshot(snapshot: ClassifierFactsShadowJobSnapshot): V41Request {
  const templateCandidate: RetrievedChunk = {
    ...snapshot.candidates[0],
    chunk_id: "shadow-schema-template",
    content_preview: "Schema template unit.",
  };
  const template = buildClassifierFactsShadowRequest(snapshot.requirement, [templateCandidate]);
  const schema = structuredClone(template.body.response_format.json_schema.schema) as {
    properties: { units: { properties: Record<string, unknown>; required: string[] } };
  };
  const unitTemplate = Object.values(schema.properties.units.properties)[0];
  if (!unitTemplate) throw new Error("classifier_facts_shadow_unit_schema_template_missing");
  const unitIds = snapshot.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id));
  schema.properties.units.properties = Object.fromEntries(
    unitIds.map((unitId) => [unitId, structuredClone(unitTemplate)]),
  );
  schema.properties.units.required = unitIds;
  const candidates = snapshot.candidates.map((candidate, index) => ({
    case_id: `shadow-${index + 1}`,
    candidate_id: candidate.chunk_id,
    text: candidate.content_preview,
    units: structuredClone(candidate.units),
  }));
  return {
    ...template,
    candidates,
    body: {
      ...template.body,
      response_format: {
        ...template.body.response_format,
        json_schema: { ...template.body.response_format.json_schema, schema },
      },
      messages: [
        template.body.messages[0],
        { role: "user", content: shadowRequestUserMessage(snapshot.requirement, snapshot.candidates) },
      ],
    },
  };
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

export function buildClassifierFactsShadowJobSnapshots({
  workspaceId,
  analysisRunId,
  requirement,
  candidates,
  gradedCandidates,
  createdAt = new Date().toISOString(),
}: {
  workspaceId: string;
  analysisRunId: string;
  requirement: RegSpRequirement;
  candidates: RetrievedChunk[];
  gradedCandidates: GradedEvidenceChunk[];
  createdAt?: string;
}) {
  if (!CLASSIFIER_FACTS_SHADOW_SUPPORTED_REQUIREMENTS.includes(requirement.id as SupportedRequirementId)) return [];
  const gradedById = new Map(gradedCandidates.map((item) => [item.chunk_id, item]));
  const byDocument = new Map<string, RetrievedChunk[]>();
  for (const candidate of candidates) byDocument.set(candidate.document_id, [...(byDocument.get(candidate.document_id) ?? []), candidate]);
  return [...byDocument.entries()].map(([documentId, documentCandidates]): ClassifierFactsShadowJobSnapshot => {
    const documentGraded = documentCandidates.map((candidate) => gradedById.get(candidate.chunk_id)).filter((item): item is GradedEvidenceChunk => Boolean(item));
    const current = currentSnapshot(requirement, documentCandidates, documentGraded);
    const frozenCandidates = documentCandidates.map((candidate, position) => ({
      ...candidate,
      position,
      units: segmentCandidate(candidate.chunk_id, candidate.content_preview),
    }));
    return {
      workspace_id: workspaceId,
      document_id: documentId,
      analysis_run_id: analysisRunId,
      requirement_id: requirement.id as SupportedRequirementId,
      requirement: structuredClone(requirement),
      current_status: current.status,
      current_elements: current.currentElements,
      current_evidence: current.currentEvidence,
      candidates: frozenCandidates,
      candidate_ids: frozenCandidates.map((item) => item.chunk_id),
      candidate_set_sha256: computeClassifierFactsShadowCandidateSetHash(frozenCandidates),
      candidate_set_hash_version: CLASSIFIER_FACTS_SHADOW_CANDIDATE_HASH_VERSION,
      model: CLASSIFIER_FACTS_SHADOW_MODEL,
      version_identity: CLASSIFIER_FACTS_V41_SCHEMA,
      created_at: createdAt,
    };
  });
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
  gradedCandidates = [],
  currentStatus,
  currentElements,
  currentEvidence,
  shadowJobId,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = CLASSIFIER_FACTS_SHADOW_TIMEOUT_MS,
  frozenRequest,
  frozenCandidateSetSha256,
}: {
  workspaceId: string;
  documentId: string;
  analysisRunId: string;
  requirement: RegSpRequirement;
  candidates: RetrievedChunk[];
  gradedCandidates?: GradedEvidenceChunk[];
  currentStatus?: FindingStatus;
  currentElements?: string[];
  currentEvidence?: unknown[];
  shadowJobId?: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  frozenRequest?: V41Request;
  frozenCandidateSetSha256?: string;
}): Promise<ClassifierFactsShadowResult> {
  const request = frozenRequest ?? buildClassifierFactsShadowRequest(requirement, candidates);
  const snapshot = currentElements && currentEvidence
    ? { status: currentStatus ?? "missing", currentElements, currentEvidence }
    : currentSnapshot(requirement, candidates, gradedCandidates);
  const base = {
    ...(shadowJobId ? { shadow_job_id: shadowJobId } : {}),
    workspace_id: workspaceId, document_id: documentId, analysis_run_id: analysisRunId,
    requirement_id: requirement.id as SupportedRequirementId, current_status: currentStatus ?? snapshot.status,
    current_elements: snapshot.currentElements, candidate_ids: candidates.map((item) => item.chunk_id),
    candidate_set_sha256: frozenCandidateSetSha256 ?? computeClassifierFactsShadowCandidateSetHash(candidates), current_evidence: snapshot.currentEvidence,
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
  const { error } = await supabase.from("classifier_facts_shadow_results").upsert(result, {
    onConflict: "analysis_run_id,document_id,requirement_id",
  });
  if (error) throw new Error(`classifier_facts_shadow_persist_failed:${error.code ?? "unknown"}`);
}

export async function enqueueClassifierFactsShadowJobsFailOpen({
  supabase, workspaceId, analysisRunId, requirement, candidates, gradedCandidates, workspacePolicy,
  environment = process.env,
}: {
  supabase: SupabaseClient;
  workspaceId: string;
  analysisRunId: string;
  requirement: RegSpRequirement;
  candidates: RetrievedChunk[];
  gradedCandidates: GradedEvidenceChunk[];
  workspacePolicy: WorkspaceExternalAiProcessingPolicy;
  environment?: Record<string, string | undefined>;
}) {
  if (!isClassifierFactsShadowEnabled({ requirementId: requirement.id, workspacePolicy, environment })) return [];
  const snapshots = buildClassifierFactsShadowJobSnapshots({ workspaceId, analysisRunId, requirement, candidates, gradedCandidates });
  return enqueueClassifierFactsShadowSnapshotsFailOpen({ supabase, snapshots });
}

export async function enqueueClassifierFactsShadowSnapshotsFailOpen({
  supabase,
  snapshots,
  timeoutMs = CLASSIFIER_FACTS_SHADOW_ENQUEUE_TIMEOUT_MS,
}: {
  supabase: SupabaseClient;
  snapshots: ClassifierFactsShadowJobSnapshot[];
  timeoutMs?: number;
}) {
  if (!snapshots.length) return [];
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const rows = snapshots.map((snapshot) => ({
      workspace_id: snapshot.workspace_id,
      document_id: snapshot.document_id,
      analysis_run_id: snapshot.analysis_run_id,
      requirement_id: snapshot.requirement_id,
      status: "pending",
      snapshot,
    }));
    const operation = Promise.resolve(supabase.from("classifier_facts_shadow_jobs").upsert(rows, {
      onConflict: "analysis_run_id,document_id,requirement_id", ignoreDuplicates: true,
    }));
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("classifier_facts_shadow_enqueue_timeout")), timeoutMs);
    });
    const { error } = await Promise.race([operation, deadline]);
    if (error) throw new Error(`classifier_facts_shadow_enqueue_failed:${error.code ?? "unknown"}`);
  } catch (error) {
    console.warn("[RegSpan shadow] Enqueue failed without affecting production analysis.", {
      analysisRunIds: [...new Set(snapshots.map((snapshot) => snapshot.analysis_run_id))],
      requirementIds: [...new Set(snapshots.map((snapshot) => snapshot.requirement_id))],
      error: String(error),
    });
    return [];
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return snapshots;
}

export function isClassifierFactsShadowWorkerEnabled(environment: Record<string, string | undefined> = process.env) {
  return enabled(environment.CLASSIFIER_FACTS_SHADOW_ENABLED)
    && enabled(environment.CLASSIFIER_FACTS_SHADOW_WORKER_ENABLED)
    && enabled(environment.ENABLE_EXTERNAL_AI_PROCESSING)
    && enabled(environment.ENABLE_EXTERNAL_AI_CLASSIFIER);
}

export function validateClassifierFactsShadowJobSnapshot(job: ClassifierFactsShadowJob) {
  const snapshot = job.snapshot;
  if (snapshot.workspace_id !== job.workspace_id || snapshot.document_id !== job.document_id
    || snapshot.analysis_run_id !== job.analysis_run_id || snapshot.requirement_id !== job.requirement_id) {
    throw new Error("classifier_facts_shadow_job_identity_mismatch");
  }
  if (snapshot.model !== CLASSIFIER_FACTS_SHADOW_MODEL || snapshot.version_identity !== CLASSIFIER_FACTS_V41_SCHEMA) {
    throw new Error("classifier_facts_shadow_frozen_identity_mismatch");
  }
  if (snapshot.requirement.id !== snapshot.requirement_id) throw new Error("classifier_facts_shadow_requirement_mismatch");
  if (snapshot.candidates.some((candidate, index) => candidate.position !== index || candidate.document_id !== snapshot.document_id)) {
    throw new Error("classifier_facts_shadow_candidate_order_or_document_mismatch");
  }
  if (JSON.stringify(snapshot.candidate_ids) !== JSON.stringify(snapshot.candidates.map((item) => item.chunk_id))) {
    throw new Error("classifier_facts_shadow_candidate_identity_mismatch");
  }
  if (new Set(snapshot.candidate_ids).size !== snapshot.candidate_ids.length) {
    throw new Error("classifier_facts_shadow_duplicate_candidate_id");
  }
  const unitIds = new Set<string>();
  for (const candidate of snapshot.candidates) {
    if (!candidate.chunk_id?.trim() || typeof candidate.content_preview !== "string" || !candidate.units.length) {
      throw new Error(`classifier_facts_shadow_candidate_content_mismatch:${candidate.chunk_id}`);
    }
    let priorEnd = 0;
    for (const [index, unit] of candidate.units.entries()) {
      if (unit.candidate_id !== candidate.chunk_id) {
        throw new Error(`classifier_facts_shadow_unit_candidate_mismatch:${candidate.chunk_id}`);
      }
      if (unitIds.has(unit.unit_id)) throw new Error(`classifier_facts_shadow_duplicate_unit_id:${unit.unit_id}`);
      unitIds.add(unit.unit_id);
      if (unit.ordinal !== index + 1) {
        throw new Error(`classifier_facts_shadow_unit_ordinal_mismatch:${candidate.chunk_id}`);
      }
      if (!Number.isInteger(unit.start_offset) || !Number.isInteger(unit.end_offset)
        || unit.start_offset < priorEnd || unit.start_offset < 0
        || unit.end_offset <= unit.start_offset || unit.end_offset > candidate.content_preview.length) {
        throw new Error(`classifier_facts_shadow_unit_offset_mismatch:${unit.unit_id}`);
      }
      if (candidate.content_preview.slice(unit.start_offset, unit.end_offset) !== unit.text) {
        throw new Error(`classifier_facts_shadow_unit_text_mismatch:${unit.unit_id}`);
      }
      const textSha256 = sha256(unit.text);
      if (textSha256 !== unit.text_sha256) {
        throw new Error(`classifier_facts_shadow_unit_hash_mismatch:${unit.unit_id}`);
      }
      const expectedUnitId = `${candidate.chunk_id}:u${String(unit.ordinal).padStart(3, "0")}:${textSha256.slice(0, 12)}`;
      if (unit.unit_id !== expectedUnitId) {
        throw new Error(`classifier_facts_shadow_unit_id_mismatch:${unit.unit_id}`);
      }
      priorEnd = unit.end_offset;
    }
  }
  if (snapshot.candidate_set_hash_version !== undefined
    && snapshot.candidate_set_hash_version !== CLASSIFIER_FACTS_SHADOW_CANDIDATE_HASH_VERSION) {
    throw new Error("classifier_facts_shadow_candidate_set_hash_version_mismatch");
  }
  const hashVersion = snapshot.candidate_set_hash_version ?? "legacy-v1";
  if (snapshot.candidate_set_sha256 !== computeClassifierFactsShadowCandidateSetHash(snapshot.candidates, hashVersion)) {
    throw new Error("classifier_facts_shadow_candidate_set_hash_mismatch");
  }
  return snapshot;
}

export async function claimClassifierFactsShadowJobs(supabase: SupabaseClient, limit: number, retryFailed = false) {
  const { data, error } = await supabase.rpc("claim_classifier_facts_shadow_jobs_v1", {
    p_limit: limit,
    p_retry_failed: retryFailed,
  });
  if (error) throw new Error(`classifier_facts_shadow_claim_failed:${error.code ?? "unknown"}`);
  return (data ?? []) as ClassifierFactsShadowJob[];
}

async function markClassifierFactsShadowJob(
  supabase: SupabaseClient,
  jobId: string,
  status: "completed" | "failed",
  lastError: string | null,
) {
  const { error } = await supabase.from("classifier_facts_shadow_jobs").update({
    status,
    completed_at: new Date().toISOString(),
    last_error: lastError,
  }).eq("id", jobId).eq("status", "running");
  if (error) throw new Error(`classifier_facts_shadow_job_update_failed:${error.code ?? "unknown"}`);
}

export async function processClassifierFactsShadowJob({
  supabase,
  job,
  apiKey,
  fetchImpl = fetch,
  timeoutMs = CLASSIFIER_FACTS_SHADOW_TIMEOUT_MS,
}: {
  supabase: SupabaseClient;
  job: ClassifierFactsShadowJob;
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}) {
  try {
    const snapshot = validateClassifierFactsShadowJobSnapshot(job);
    const request = buildClassifierFactsShadowRequestFromSnapshot(snapshot);
    const candidates = snapshot.candidates.map((frozenCandidate) => {
      const candidate = { ...frozenCandidate } as Partial<ClassifierFactsShadowCandidateSnapshot>;
      delete candidate.position;
      delete candidate.units;
      return candidate as RetrievedChunk;
    });
    const result = await executeClassifierFactsShadow({
      shadowJobId: job.id,
      workspaceId: snapshot.workspace_id,
      documentId: snapshot.document_id,
      analysisRunId: snapshot.analysis_run_id,
      requirement: snapshot.requirement,
      candidates,
      currentStatus: snapshot.current_status,
      currentElements: snapshot.current_elements,
      currentEvidence: snapshot.current_evidence,
      apiKey,
      fetchImpl,
      timeoutMs,
      frozenRequest: request,
      frozenCandidateSetSha256: snapshot.candidate_set_sha256,
    });
    await persistClassifierFactsShadowResult(supabase, result);
    if (result.valid) await markClassifierFactsShadowJob(supabase, job.id, "completed", null);
    else await markClassifierFactsShadowJob(supabase, job.id, "failed", result.validation_errors[0] ?? result.outcome);
    return result;
  } catch (error) {
    await markClassifierFactsShadowJob(supabase, job.id, "failed", String(error)).catch(() => undefined);
    throw error;
  }
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

export function summarizeClassifierFactsShadowRows(rows: ClassifierFactsShadowResult[]) {
  const details = rows.map(classifierFactsShadowReportRow);
  const categories: ClassifierFactsShadowDisagreementCategory[] = [
    "exact agreement", "same status, different evidence", "current covered, shadow partial",
    "current covered, shadow missing", "current partial, shadow covered", "current partial, shadow missing",
    "current missing, shadow covered", "current missing, shadow partial", "shadow invalid",
  ];
  const disagreementCounts = Object.fromEntries(categories.map((category) => [
    category,
    details.filter((item) => item.disagreement_category === category).length,
  ]));
  const numeric = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const latencies = rows.map((row) => numeric(row.latency_ms)).filter((value): value is number => value !== null);
  const token = (key: "prompt_tokens" | "completion_tokens" | "total_tokens") => rows.reduce((sum, row) => {
    const value = numeric(row[key]);
    return sum + (value ?? 0);
  }, 0);
  const requirements = [...new Set(rows.map((row) => row.requirement_id))].sort();
  return {
    attempted: rows.length,
    valid: rows.filter((row) => row.valid).length,
    invalid_outcomes: rows.filter((row) => !row.valid).length,
    status_agreement: rows.filter((row) => row.valid && row.current_status === row.shadow_status).length,
    exact_agreement: disagreementCounts["exact agreement"],
    same_status_evidence_disagreement: disagreementCounts["same status, different evidence"],
    disagreement_counts: disagreementCounts,
    latency_ms: {
      total: latencies.reduce((sum, value) => sum + value, 0),
      average: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
      maximum: latencies.length ? Math.max(...latencies) : 0,
    },
    token_usage: { prompt: token("prompt_tokens"), completion: token("completion_tokens"), total: token("total_tokens") },
    by_requirement: Object.fromEntries(requirements.map((requirementId) => {
      const subset = rows.filter((row) => row.requirement_id === requirementId);
      return [requirementId, {
        attempted: subset.length,
        valid: subset.filter((row) => row.valid).length,
        status_agreement: subset.filter((row) => row.valid && row.current_status === row.shadow_status).length,
        same_status_evidence_disagreement: subset.filter((row) => categorizeClassifierFactsShadowDisagreement(row) === "same status, different evidence").length,
        latency_ms: subset.reduce((sum, row) => sum + (numeric(row.latency_ms) ?? 0), 0),
        prompt_tokens: subset.reduce((sum, row) => sum + (numeric(row.prompt_tokens) ?? 0), 0),
        completion_tokens: subset.reduce((sum, row) => sum + (numeric(row.completion_tokens) ?? 0), 0),
        total_tokens: subset.reduce((sum, row) => sum + (numeric(row.total_tokens) ?? 0), 0),
      }];
    })),
    details,
  };
}
