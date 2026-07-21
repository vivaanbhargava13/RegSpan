/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";

import { CLASSIFIER_FACTS_MODEL, segmentCandidate } from "./classifierFactsPrototype";
import { buildV4ExtractionRequests, v4ExtractionSystemPrompt } from "./classifierFactsPrototypeV4";
import { inspectV41Schema } from "./classifierFactsPrototypeV41";
import { buildOpenAiClassifierRequestBody, buildRequirementEvaluationGuidance, classifierInputForChunk } from "./requirementEvidenceClassifier";
import type { ClassifierCapabilityFixtureSuite } from "./classifierCapabilityEval";

export const GENERALIZATION_SCHEMA = "classifier-generalization-holdout/v1";
export const GENERALIZATION_MODEL = CLASSIFIER_FACTS_MODEL;
export const DEVELOPMENT_CANARY_SUITE_HASH = "2d867460a314063bef3aeec81d95952922476b4d8bbfa1b9bbe7a4ff8bffc73a";

export type GeneralizationReview = {
  reviewer_id: string | null;
  reviewed_at: string | null;
  expected_elements: string[] | null;
  expected_status: "covered" | "partial" | "missing" | null;
  support_kind: "direct" | "partial" | "negative" | null;
  hard_negative_category: string | null;
  supporting_unit_ids: string[] | null;
  unit_element_support: Array<{ unit_id: string; elements: string[] }> | null;
  rationale: string | null;
};

export type GeneralizationCandidate = {
  candidate_id: string;
  position: number;
  text: string;
  content_sha256: string;
  units: Array<{ unit_id: string; text: string; text_sha256: string }>;
  provenance: {
    corpus_id: string;
    document_sha256: string;
    source_path: string;
    filename: string;
    chunk_index: number;
    page_start: number;
    page_end: number;
    section_heading: string;
    section_path: string;
    source_type: string;
    extraction_version: string;
    chunking_version: string;
    retrieval_included: true;
  };
};

export type GeneralizationCase = {
  case_id: string;
  requirement_id: string;
  document_case_id: string;
  candidate_set_id: string;
  candidate_set_sha256: string;
  candidate_count: number;
  unit_count: number;
  set_size: "short" | "noisy";
  evidence_shape: "single_candidate" | "multi_candidate";
  development_canary: false;
  answer_key_provenance: {
    path: string;
    locator: string;
    expected_status_review_aid: string;
    rationale_review_aid: string;
    scoring_authority: false;
  };
  reviewer_1: GeneralizationReview;
  reviewer_2: GeneralizationReview;
  adjudication: GeneralizationReview & { adjudicator_id: string | null; adjudicated_at: string | null; approved: boolean };
};

export type GeneralizationFixture = {
  schema_version: typeof GENERALIZATION_SCHEMA;
  fixture_hash: string;
  development_canary_suite_hash: string;
  source_corpus: { id: string; manifest_path: string; answer_key_path: string; inventory_path: string };
  requirements: Array<{ id: string; title: string; required_elements: string[]; element_definitions: Array<{ id: string; label: string }> }>;
  candidate_sets: Array<{ candidate_set_id: string; document_case_id: string; document_sha256: string; candidates: GeneralizationCandidate[] }>;
  cases: GeneralizationCase[];
};

export type ArmCaseResult = {
  case_id: string;
  outcome: "model_success" | "provider_failure" | "parser_failure" | "schema_failure" | "post_processing_failure";
  predicted_elements: string[];
  predicted_status: "covered" | "partial" | "missing" | null;
  exact_source_unit_valid: boolean;
  facts_returned?: number;
  facts_accepted?: number;
  facts_rejected?: number;
  latency_ms?: number | null;
  token_usage?: { prompt: number | null; completion: number | null; total: number | null } | null;
  validation_outcome?: "accepted" | "rejected";
  accepted_facts?: unknown[];
  rejected_facts?: unknown[];
  atomic_ledger?: Array<{ fact_id: string; mapped_elements: string[]; deterministic_rejections: string[] }>;
};

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function generalizationFixtureHash(fixture: Omit<GeneralizationFixture, "fixture_hash"> | GeneralizationFixture) {
  const rest = { ...(fixture as GeneralizationFixture) };
  delete (rest as Partial<GeneralizationFixture>).fixture_hash;
  return sha256(canonical(rest));
}

export function emptyGeneralizationReview(): GeneralizationReview {
  return { reviewer_id: null, reviewed_at: null, expected_elements: null, expected_status: null, support_kind: null, hard_negative_category: null, supporting_unit_ids: null, unit_element_support: null, rationale: null };
}

export function caseIsAdjudicated(item: GeneralizationCase) {
  const a = item.adjudication;
  const complete = (review: GeneralizationReview) => Boolean(review.reviewer_id && review.reviewed_at && review.expected_elements && review.expected_status && review.support_kind && review.supporting_unit_ids && review.unit_element_support && review.rationale);
  return complete(item.reviewer_1) && complete(item.reviewer_2)
    && item.reviewer_1.reviewer_id !== item.reviewer_2.reviewer_id
    && a.approved && complete(a) && Boolean(a.adjudicator_id && a.adjudicated_at);
}

export function validateGeneralizationFixture(value: unknown): GeneralizationFixture {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Generalization fixture must be an object.");
  const fixture = value as GeneralizationFixture;
  if (fixture.schema_version !== GENERALIZATION_SCHEMA) throw new Error("Unsupported generalization fixture schema.");
  if (fixture.development_canary_suite_hash !== DEVELOPMENT_CANARY_SUITE_HASH) throw new Error("Development canary identity changed.");
  if (fixture.fixture_hash !== generalizationFixtureHash(fixture)) throw new Error("Generalization fixture hash mismatch.");
  if (fixture.cases.length < 30 || fixture.cases.length > 50) throw new Error("Holdout must contain 30 to 50 cases.");
  const caseIds = new Set<string>();
  const sets = new Map(fixture.candidate_sets.map((item) => [item.candidate_set_id, item]));
  for (const item of fixture.cases) {
    if (item.development_canary || caseIds.has(item.case_id)) throw new Error(`Canary or duplicate holdout case: ${item.case_id}.`);
    caseIds.add(item.case_id);
    const set = sets.get(item.candidate_set_id);
    if (!set) throw new Error(`Missing candidate set ${item.candidate_set_id}.`);
    if (item.candidate_count !== set.candidates.length || item.unit_count !== set.candidates.reduce((sum, candidate) => sum + candidate.units.length, 0)) throw new Error(`Candidate counts changed for ${item.case_id}.`);
    const setHash = sha256(canonical(set.candidates.map(({ candidate_id, position, text, content_sha256, units, provenance }) => ({ candidate_id, position, text, content_sha256, units, provenance }))));
    if (item.candidate_set_sha256 !== setHash) throw new Error(`Candidate-set hash mismatch for ${item.case_id}.`);
    const candidateIds = new Set<string>();
    const unitIds = new Set<string>();
    set.candidates.forEach((candidate, index) => {
      if (candidate.position !== index + 1 || candidateIds.has(candidate.candidate_id) || sha256(candidate.text) !== candidate.content_sha256) throw new Error(`Candidate integrity failure in ${item.case_id}.`);
      candidateIds.add(candidate.candidate_id);
      for (const unit of candidate.units) {
        if (unitIds.has(unit.unit_id) || sha256(unit.text) !== unit.text_sha256) throw new Error(`Unit integrity failure in ${item.case_id}.`);
        unitIds.add(unit.unit_id);
      }
    });
    for (const review of [item.reviewer_1, item.reviewer_2, item.adjudication]) {
      for (const id of review.supporting_unit_ids ?? []) if (!unitIds.has(id)) throw new Error(`Unknown reviewed unit ${id}.`);
      for (const support of review.unit_element_support ?? []) {
        if (!unitIds.has(support.unit_id)) throw new Error(`Unknown unit-element support ${support.unit_id}.`);
        if (support.elements.some((id) => !fixture.requirements.find((requirement) => requirement.id === item.requirement_id)?.element_definitions.some((element) => element.id === id))) throw new Error(`Unknown reviewed element in ${item.case_id}.`);
      }
    }
  }
  return fixture;
}

function factSchemaFromFrozenV41(canaries: ClassifierCapabilityFixtureSuite) {
  const request = buildV4ExtractionRequests(canaries)[0];
  return (request.body.response_format.json_schema.schema as any).properties.units.items.properties.facts.items as Record<string, unknown>;
}

function schemaName(caseId: string, requirementId: string) {
  const prefix = requirementId.split("_").slice(0, 2).join("_").slice(0, 24).replace(/[^A-Za-z0-9_-]/gu, "_");
  return `facts_gen_${prefix}_${sha256(`${caseId}:${requirementId}`).slice(0, 12)}`;
}

export function buildGeneralizationRequestPlan(fixture: GeneralizationFixture, canaries: ClassifierCapabilityFixtureSuite) {
  validateGeneralizationFixture(fixture);
  const fact = factSchemaFromFrozenV41(canaries);
  const sets = new Map(fixture.candidate_sets.map((item) => [item.candidate_set_id, item]));
  const currentRequests: unknown[] = [];
  const factsRequests: unknown[] = [];
  for (const requirement of fixture.requirements) {
    const cases = fixture.cases.filter((item) => item.requirement_id === requirement.id);
    for (const fixtureCase of cases) {
      const candidateSet = sets.get(fixtureCase.candidate_set_id)!;
      const candidates = candidateSet.candidates.map((candidate) => ({ ...candidate, case_id: fixtureCase.case_id }));
      for (const candidate of candidates) {
        const req = (canaries.requirements as any[]).find((item) => item.id === requirement.id);
        const input = classifierInputForChunk(req, {
          chunk_id: candidate.candidate_id, content_preview: candidate.text, filename: candidate.provenance.filename,
          page_start: candidate.provenance.page_start, page_end: candidate.provenance.page_end,
          chunk_index: candidate.provenance.chunk_index, section_path: candidate.provenance.section_path,
          source_type: candidate.provenance.source_type, evidence_role: "organization_evidence", evidence_reason: "frozen_holdout_candidate",
        } as any, { caseId: candidate.case_id });
        const classifierInput = { ...input, evaluationGuidance: buildRequirementEvaluationGuidance(req) };
        currentRequests.push({ arm: "current", case_id: candidate.case_id, requirement_id: requirement.id, candidate_id: candidate.candidate_id, classifier_input: classifierInput, body: buildOpenAiClassifierRequestBody(classifierInput, GENERALIZATION_MODEL) });
      }
      const unitProperties: Record<string, unknown> = {};
      const unitIds: string[] = [];
      const factRef = { $ref: "#/$defs/fact" };
      const branches = [
        { type: "object", additionalProperties: false, required: ["disposition", "facts", "no_fact_reason"], properties: { disposition: { type: "string", enum: ["facts"] }, facts: { type: "array", minItems: 1, items: factRef }, no_fact_reason: { type: "null" } } },
        { type: "object", additionalProperties: false, required: ["disposition", "facts", "no_fact_reason"], properties: { disposition: { type: "string", enum: ["no_fact"] }, facts: { type: "array", maxItems: 0, items: factRef }, no_fact_reason: { type: "string", minLength: 1 } } },
      ];
      for (const candidate of candidates) for (const unit of candidate.units) { unitIds.push(unit.unit_id); unitProperties[unit.unit_id] = { anyOf: branches }; }
      const name = schemaName(fixtureCase.case_id, requirement.id);
      if (name.length > 64 || !/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error(`Invalid generalization V4.1 schema name: ${name}.`);
      const body = { model: GENERALIZATION_MODEL, temperature: 0 as const, response_format: { type: "json_schema" as const, json_schema: { name, strict: true, schema: { type: "object", additionalProperties: false, required: ["units"], $defs: { fact }, properties: { units: { type: "object", additionalProperties: false, required: unitIds, properties: unitProperties } } } } }, messages: [
        { role: "system" as const, content: v4ExtractionSystemPrompt() },
        { role: "user" as const, content: [`Factual extraction focus: ${requirement.title}.`, "Account for every unit with facts or no_fact. Extract all relevant atomic operations without assessing sufficiency.", JSON.stringify({ candidates: candidates.map((candidate) => ({ case_id: candidate.case_id, source_candidate_id: candidate.candidate_id, units: candidate.units.map(({ unit_id, text }) => ({ unit_id, text })) })) }, null, 2)].join("\n\n") },
      ] };
      const schema = body.response_format.json_schema.schema;
      const schemaMetrics = inspectV41Schema(schema);
      if (schemaMetrics.total_literal_enum_values >= 1000) throw new Error(`V4.1 enum budget exceeded for ${fixtureCase.case_id}.`);
      const schemaSha256 = sha256(JSON.stringify(schema));
      const requestSha256 = sha256(JSON.stringify(body));
      factsRequests.push({
        arm: "v4.1", case_id: fixtureCase.case_id, requirement_id: requirement.id,
        document_case_id: fixtureCase.document_case_id, candidate_set_id: fixtureCase.candidate_set_id,
        candidate_set_sha256: fixtureCase.candidate_set_sha256, candidate_ids: candidates.map((candidate) => candidate.candidate_id),
        unit_ids: unitIds, candidates, schema_sha256: schemaSha256, request_sha256: requestSha256,
        preflight: {
          candidate_count: candidates.length, unit_count: unitIds.length, schema_name: name, schema_name_length: name.length,
          literal_enum_value_count: schemaMetrics.total_literal_enum_values, required_unit_property_count: unitIds.length,
          schema_byte_size: Buffer.byteLength(JSON.stringify(schema), "utf8"),
          prompt_byte_size: Buffer.byteLength(JSON.stringify(body.messages), "utf8"),
          complete_request_byte_size: Buffer.byteLength(JSON.stringify(body), "utf8"), request_sha256: requestSha256, schema_sha256: schemaSha256,
        },
        body,
      });
    }
  }
  const plan = { model: GENERALIZATION_MODEL, current_requests: currentRequests, v4_1_requests: factsRequests, request_count: currentRequests.length + factsRequests.length, model_calls: { current: currentRequests.length, v4_1: factsRequests.length } };
  validateGeneralizationRequestPlan(fixture, plan);
  return plan;
}

export function validateGeneralizationRequestPlan(fixture: GeneralizationFixture, plan: any) {
  const expectedPairs = new Set(fixture.cases.map((item) => `${item.case_id}\u0000${item.requirement_id}`));
  const seen = new Set<string>();
  const schemaNames = new Set<string>();
  const sets = new Map(fixture.candidate_sets.map((item) => [item.candidate_set_id, item]));
  for (const request of plan.v4_1_requests) {
    const key = `${request.case_id}\u0000${request.requirement_id}`;
    if (!expectedPairs.has(key)) throw new Error(`Unknown V4.1 case-requirement request: ${request.case_id}/${request.requirement_id}.`);
    if (seen.has(key)) throw new Error(`Duplicate V4.1 case-requirement request: ${request.case_id}/${request.requirement_id}.`);
    seen.add(key);
    const fixtureCase = fixture.cases.find((item) => item.case_id === request.case_id && item.requirement_id === request.requirement_id)!;
    const set = sets.get(fixtureCase.candidate_set_id)!;
    const expectedCandidateIds = set.candidates.map((candidate) => candidate.candidate_id);
    const expectedUnitIds = set.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id));
    if (request.document_case_id !== fixtureCase.document_case_id || request.candidate_set_id !== fixtureCase.candidate_set_id || request.candidate_set_sha256 !== fixtureCase.candidate_set_sha256) throw new Error(`V4.1 case provenance drift: ${request.case_id}.`);
    if (JSON.stringify(request.candidate_ids) !== JSON.stringify(expectedCandidateIds) || JSON.stringify(request.unit_ids) !== JSON.stringify(expectedUnitIds)) throw new Error(`V4.1 frozen evidence drift: ${request.case_id}.`);
    if (request.candidates.some((candidate: any) => candidate.case_id !== request.case_id) || JSON.stringify(request.candidates.map((candidate: any) => candidate.candidate_id)) !== JSON.stringify(expectedCandidateIds)) throw new Error(`Cross-case V4.1 candidate reference: ${request.case_id}.`);
    const frozenCandidates = request.candidates.map((candidate: any) => { const copy = { ...candidate }; delete copy.case_id; return copy; });
    if (JSON.stringify(frozenCandidates) !== JSON.stringify(set.candidates)) throw new Error(`V4.1 candidate text, order, provenance, or unit drift: ${request.case_id}.`);
    const schema = request.body.response_format.json_schema.schema;
    const name = request.body.response_format.json_schema.name;
    if (name.length > 64 || !/^[A-Za-z0-9_-]+$/u.test(name) || schemaNames.has(name)) throw new Error(`Invalid or duplicate V4.1 schema name: ${name}.`);
    schemaNames.add(name);
    const required = schema.properties.units.required;
    const properties = Object.keys(schema.properties.units.properties);
    if (JSON.stringify(required) !== JSON.stringify(expectedUnitIds) || JSON.stringify(properties) !== JSON.stringify(expectedUnitIds)) throw new Error(`Cross-case or missing V4.1 unit reference: ${request.case_id}.`);
    const requirement = fixture.requirements.find((item) => item.id === request.requirement_id)!;
    const expectedUserPrompt = [`Factual extraction focus: ${requirement.title}.`, "Account for every unit with facts or no_fact. Extract all relevant atomic operations without assessing sufficiency.", JSON.stringify({ candidates: request.candidates.map((candidate: any) => ({ case_id: candidate.case_id, source_candidate_id: candidate.candidate_id, units: candidate.units.map(({ unit_id, text }: any) => ({ unit_id, text })) })) }, null, 2)].join("\n\n");
    if (request.body.model !== GENERALIZATION_MODEL || request.body.temperature !== 0 || request.body.messages[0]?.content !== v4ExtractionSystemPrompt() || request.body.messages[1]?.content !== expectedUserPrompt) throw new Error(`V4.1 frozen model or prompt drift: ${request.case_id}.`);
    const metrics = inspectV41Schema(schema);
    if (metrics.total_literal_enum_values >= 1000 || metrics.definition_count !== 1 || metrics.ref_count !== expectedUnitIds.length * 2) throw new Error(`V4.1 schema safeguards failed: ${request.case_id}.`);
    if (request.request_sha256 !== sha256(JSON.stringify(request.body)) || request.schema_sha256 !== sha256(JSON.stringify(schema))) throw new Error(`V4.1 request or schema hash drift: ${request.case_id}.`);
  }
  const missing = [...expectedPairs].filter((key) => !seen.has(key));
  if (missing.length) throw new Error(`Missing V4.1 case-requirement requests: ${missing.length}.`);
  if (seen.size !== fixture.cases.length) throw new Error(`Expected ${fixture.cases.length} V4.1 requests, received ${seen.size}.`);
  return true;
}

export function isolatedCaseForV41Request(fixture: GeneralizationFixture, request: { case_id: string; requirement_id: string }) {
  const matches = fixture.cases.filter((item) => item.case_id === request.case_id && item.requirement_id === request.requirement_id);
  if (matches.length !== 1) throw new Error(`V4.1 request does not resolve to exactly one holdout case: ${request.case_id}/${request.requirement_id}.`);
  return matches[0];
}

const STATUS_STRENGTH = { missing: 0, partial: 1, covered: 2 } as const;

export function scoreGeneralizationArm(fixture: GeneralizationFixture, results: ArmCaseResult[]) {
  const byId = new Map(results.map((item) => [item.case_id, item]));
  const scored = fixture.cases.filter(caseIsAdjudicated);
  let tp = 0, fp = 0, fn = 0, correct = 0, falseAssurance = 0, hardNegatives = 0, rejectedHardNegatives = 0, partials = 0, partialCorrect = 0, directs = 0, directRecovered = 0;
  const invalid: string[] = [];
  for (const item of scored) {
    const result = byId.get(item.case_id);
    if (!result || result.outcome !== "model_success" || result.predicted_status === null) { invalid.push(item.case_id); continue; }
    const expected = new Set(item.adjudication.expected_elements!); const actual = new Set(result.predicted_elements);
    for (const id of actual) {
      if (expected.has(id)) tp++;
      else fp++;
    }
    for (const id of expected) if (!actual.has(id)) fn++;
    if (result.predicted_status === item.adjudication.expected_status) correct++;
    if (STATUS_STRENGTH[result.predicted_status] > STATUS_STRENGTH[item.adjudication.expected_status!]) falseAssurance++;
    if (item.adjudication.support_kind === "negative") { hardNegatives++; if (result.predicted_status === "missing") rejectedHardNegatives++; }
    if (item.adjudication.support_kind === "partial") { partials++; if (result.predicted_status === "partial") partialCorrect++; }
    if (item.adjudication.support_kind === "direct") { directs++; if (result.predicted_status === "covered") directRecovered++; }
  }
  const valid = scored.length - invalid.length; const precision = tp + fp ? tp / (tp + fp) : null; const recall = tp + fn ? tp / (tp + fn) : null;
  const validResults = scored.map((item) => byId.get(item.case_id)).filter((item): item is ArmCaseResult => Boolean(item?.outcome === "model_success"));
  const tokens = validResults.reduce((sum, item) => ({ prompt: sum.prompt + (item.token_usage?.prompt ?? 0), completion: sum.completion + (item.token_usage?.completion ?? 0), total: sum.total + (item.token_usage?.total ?? 0) }), { prompt: 0, completion: 0, total: 0 });
  return { run_valid: scored.length > 0 && invalid.length === 0, labeled_cases: scored.length, valid_cases: valid, invalid_cases: invalid, metrics_suppressed: invalid.length > 0, element_precision: invalid.length ? null : precision, element_recall: invalid.length ? null : recall, element_f1: invalid.length || precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall), requirement_status_accuracy: invalid.length || !valid ? null : correct / valid, false_assurance: invalid.length ? null : falseAssurance, hard_negative_rejection: invalid.length || !hardNegatives ? null : rejectedHardNegatives / hardNegatives, partial_support_accuracy: invalid.length || !partials ? null : partialCorrect / partials, direct_support_recovery: invalid.length || !directs ? null : directRecovered / directs, exact_source_unit_validity: invalid.length || !validResults.length ? null : validResults.filter((item) => item.exact_source_unit_valid).length / validResults.length, invalid_request_rate: scored.length ? invalid.length / scored.length : 0, facts_returned: validResults.reduce((sum, item) => sum + (item.facts_returned ?? 0), 0), facts_accepted: validResults.reduce((sum, item) => sum + (item.facts_accepted ?? 0), 0), facts_rejected: validResults.reduce((sum, item) => sum + (item.facts_rejected ?? 0), 0), latency_ms: validResults.reduce((sum, item) => sum + (item.latency_ms ?? 0), 0), token_usage: tokens, estimated_cost_usd: null as number | null };
}

export function evaluateGeneralizationGate(current: ReturnType<typeof scoreGeneralizationArm>, v41: ReturnType<typeof scoreGeneralizationArm>) {
  const blockers: string[] = [];
  if (!v41.labeled_cases) blockers.push("no approved adjudicated holdout labels");
  if (v41.invalid_cases.length) blockers.push("V4.1 contains invalid scored outcomes");
  if (v41.false_assurance !== 0) blockers.push("false assurance is not zero");
  if (v41.exact_source_unit_validity !== 1) blockers.push("exact source-unit validity is not 100%");
  if ((v41.element_precision ?? 0) < .9) blockers.push("element precision below 90%");
  if ((v41.element_recall ?? 0) < .8) blockers.push("element recall below 80%");
  if ((v41.requirement_status_accuracy ?? 0) < .85) blockers.push("status accuracy below 85%");
  if ((v41.hard_negative_rejection ?? 0) < .95) blockers.push("hard-negative rejection below 95%");
  if (current.element_recall !== null && v41.element_recall !== null && v41.element_recall < current.element_recall) blockers.push("recall worse than current classifier");
  if (current.requirement_status_accuracy !== null && v41.requirement_status_accuracy !== null && v41.requirement_status_accuracy < current.requirement_status_accuracy) blockers.push("status accuracy worse than current classifier");
  return { advances: blockers.length === 0, blockers, exact_source_unit_validity_required: 1, material_invalid_request_regression_allowed: false, prohibited_evidence_sources: ["diagnostics", "no_fact reasons", "headings", "inventories", "lexical hints"] };
}

export function scorePairedGeneralization(fixture: GeneralizationFixture, currentResults: ArmCaseResult[], v41Results: ArmCaseResult[]) {
  const scoreSubset = (cases: GeneralizationCase[], results: ArmCaseResult[]) => scoreGeneralizationArm({ ...fixture, cases }, results);
  const current = scoreGeneralizationArm(fixture, currentResults);
  const v4_1 = scoreGeneralizationArm(fixture, v41Results);
  const groups = {
    requirement_family: Object.fromEntries(fixture.requirements.map((requirement) => [requirement.id, { current: scoreSubset(fixture.cases.filter((item) => item.requirement_id === requirement.id), currentResults), v4_1: scoreSubset(fixture.cases.filter((item) => item.requirement_id === requirement.id), v41Results) }])),
    support_kind: Object.fromEntries(["direct", "partial", "negative"].map((kind) => [kind, { current: scoreSubset(fixture.cases.filter((item) => item.adjudication.support_kind === kind), currentResults), v4_1: scoreSubset(fixture.cases.filter((item) => item.adjudication.support_kind === kind), v41Results) }])),
    evidence_shape: Object.fromEntries(["single_candidate", "multi_candidate"].map((shape) => [shape, { current: scoreSubset(fixture.cases.filter((item) => item.evidence_shape === shape), currentResults), v4_1: scoreSubset(fixture.cases.filter((item) => item.evidence_shape === shape), v41Results) }])),
    candidate_set_size: Object.fromEntries(["short", "noisy"].map((size) => [size, { current: scoreSubset(fixture.cases.filter((item) => item.set_size === size), currentResults), v4_1: scoreSubset(fixture.cases.filter((item) => item.set_size === size), v41Results) }])),
    hard_negative_category: Object.fromEntries([...new Set(fixture.cases.map((item) => item.adjudication.hard_negative_category).filter(Boolean))].map((category) => [category!, { current: scoreSubset(fixture.cases.filter((item) => item.adjudication.hard_negative_category === category), currentResults), v4_1: scoreSubset(fixture.cases.filter((item) => item.adjudication.hard_negative_category === category), v41Results) }])),
  };
  const delta = (key: keyof typeof current) => typeof current[key] === "number" && typeof v4_1[key] === "number" ? (v4_1[key] as number) - (current[key] as number) : null;
  return { current, v4_1, paired_deltas: { element_precision: delta("element_precision"), element_recall: delta("element_recall"), element_f1: delta("element_f1"), requirement_status_accuracy: delta("requirement_status_accuracy"), hard_negative_rejection: delta("hard_negative_rejection"), partial_support_accuracy: delta("partial_support_accuracy"), direct_support_recovery: delta("direct_support_recovery"), invalid_request_rate: delta("invalid_request_rate") }, groups, gate: evaluateGeneralizationGate(current, v4_1) };
}

export function classifyFailureLayer(code: string) {
  if (/absent|no_source/u.test(code)) return "source evidence absent";
  if (/omission|not_extracted/u.test(code)) return "source evidence present but not extracted";
  if (/rejected|ground|semantic/u.test(code)) return "extracted fact rejected incorrectly";
  if (/mapping|mapped/u.test(code)) return "accepted fact mapped incorrectly";
  if (/status/u.test(code)) return "deterministic status incorrect";
  return "schema or provider failure";
}

export function verifyIdenticalEvidence(fixture: GeneralizationFixture, plan: ReturnType<typeof buildGeneralizationRequestPlan>) {
  const expected = fixture.cases.reduce((sum, item) => sum + item.candidate_count, 0);
  const current = plan.current_requests.length;
  const facts = plan.v4_1_requests.reduce((sum: number, request: any) => sum + request.candidate_ids.length, 0);
  if (current !== expected || facts !== expected) throw new Error(`Arm evidence differs: expected ${expected}, current ${current}, V4.1 ${facts}.`);
  return true;
}

export function candidateUnits(candidateId: string, text: string) {
  return segmentCandidate(candidateId, text).map((unit) => ({ ...unit, text_sha256: sha256(unit.text) }));
}
