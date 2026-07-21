import type {
  ClassifierCapabilityCaseFixture,
  ClassifierCapabilityFixtureSuite,
} from "./classifierCapabilityEval";
import {
  CLASSIFIER_FACTS_MODEL,
  FACT_ACTIONS,
  FACT_MODALITIES,
  FACT_OBJECTS,
  PRESERVATION_METHODS,
  RECORD_OR_MATERIALS,
  VALIDATION_ACTIVITIES,
  WORKFLOW_SCOPES,
  segmentCandidate,
  type CandidateUnit,
  type FactAction,
  type FactModality,
  type FactObject,
  type FactWorkflowScope,
  type PreservationMethod,
  type RecordOrMaterial,
  type TrackingDetails,
  type ValidationActivity,
} from "./classifierFactsPrototype";

export const CLASSIFIER_FACTS_V3_SCHEMA = "classifier-facts-prototype-results/v3";
export const CLASSIFIER_FACTS_V3_DRY_SCHEMA = "classifier-facts-prototype-dry-run/v3";

export type V3ExtractedFact = {
  fact_id: string;
  source_candidate_id: string;
  source_unit_ids: string[];
  actor: string | null;
  action: FactAction | null;
  object: FactObject | null;
  workflow_scope: FactWorkflowScope;
  condition_or_trigger: string | null;
  modality: FactModality;
  tracking_details: TrackingDetails | null;
  validation_activity: ValidationActivity | null;
  record_or_material: RecordOrMaterial | null;
  preservation_method: PreservationMethod | null;
  action_text?: string | null;
  object_text?: string | null;
};

export type V3Candidate = {
  case_id: string;
  candidate_id: string;
  text: string;
  units: CandidateUnit[];
};

export type V3Request = {
  requirement_id: string;
  model: string;
  body: {
    model: string;
    temperature: 0;
    response_format: {
      type: "json_schema";
      json_schema: { name: string; strict: true; schema: Record<string, unknown> };
    };
    messages: Array<{ role: "system" | "user"; content: string }>;
  };
  candidates: V3Candidate[];
};

export type V3ValidatedFact = V3ExtractedFact & {
  reconstructed_quote: string;
  source_unit_sha256: string[];
};

export type V3RejectedFact = {
  fact_index: number;
  fact_id: string | null;
  original_model_fact: unknown;
  source_candidate_id: string | null;
  source_unit_ids: string[];
  resolved_source_units: Array<{ unit_id: string; text: string; text_sha256: string }>;
  reconstructed_quote: string | null;
  rejection_stage: "fact_schema" | "source_grounding" | "semantic_grounding" | "mapping_eligibility";
  rejection_codes: string[];
  excluded_before_mapping: true;
  raw_provider_response_linkage: {
    requirement_id: string;
    fact_index: number;
    provider_exchange_id: string | null;
    raw_model_content_sha256: string | null;
  };
};

export type V3ExtractionOutcome = {
  requirement_id: string;
  outcome: "model_success" | "provider_error" | "transport_error" | "malformed_model_json"
    | "top_level_schema_error" | "source_isolation_error" | "replay_corruption";
  raw_provider_exchange: unknown;
  raw_model_content: string | null;
  facts: V3ValidatedFact[];
  rejected_facts: V3RejectedFact[];
  facts_returned: number;
  validation_errors: string[];
  selected_unit_reference_count: number;
  invalid_unit_reference_count: number;
};

export type V3OmissionDiagnostic = {
  requirement_id: string;
  case_id: string;
  candidate_id: string;
  unit_id: string;
  unit_text: string;
  unit_text_sha256: string;
  matched_lexeme_families: string[];
  accepted_fact_ids: string[];
  creates_evidence: false;
};

export type V3LedgerFact = V3ValidatedFact & {
  mapped_elements: string[];
  deterministic_rejections: string[];
};

export type V3CaseDerivation = {
  case_id: string;
  requirement_id: string;
  candidate_ids: string[];
  fact_ledger: V3LedgerFact[];
  rejected_fact_ledger: V3RejectedFact[];
  omission_diagnostics: V3OmissionDiagnostic[];
  supported_elements: string[];
  status: "covered" | "partial" | "missing";
  deterministic_rejection_reasons: string[];
};

export type V3Metrics = {
  element_precision: { numerator: number; denominator: number; rate: number | null };
  element_recall: { numerator: number; denominator: number; rate: number | null };
  element_f1: number | null;
  requirement_status_accuracy: { numerator: number; denominator: number; rate: number | null };
  false_assurance: { count: number; denominator: number; rate: number | null };
  hard_negative_rejection: { numerator: number; denominator: number; rate: number | null };
  exact_source_unit_validity: { numerator: number; denominator: number; rate: number | null };
  extraction_failures: number;
  facts_returned: number;
  facts_accepted: number;
  facts_rejected: number;
  fact_acceptance_rate: number | null;
  fact_rejections_by_reason: Record<string, number>;
  requirements_with_rejected_facts: number;
  accepted_facts_per_requirement: Record<string, number>;
  omission_diagnostic_count: number;
};

export type V3Result = {
  schema_version: typeof CLASSIFIER_FACTS_V3_SCHEMA;
  generated_at: string;
  fixture_suite_hash: string;
  model: string;
  valid: boolean;
  extraction_failure_count: number;
  extraction_outcomes: V3ExtractionOutcome[];
  omission_diagnostics: V3OmissionDiagnostic[];
  cases: V3CaseDerivation[];
  metrics: V3Metrics | null;
};

const REQUIRED_FACT_KEYS = [
  "fact_id", "source_candidate_id", "source_unit_ids", "actor", "action", "object", "workflow_scope",
  "condition_or_trigger", "modality", "tracking_details", "validation_activity", "record_or_material",
  "preservation_method",
] as const;
const OPTIONAL_DIAGNOSTIC_KEYS = ["action_text", "object_text"] as const;
const TRACKING_KEYS = ["owner_assigned", "due_date_assigned", "status_monitored", "open_until_evidence_review"];

function normalizeSemanticText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function nullableString(value: unknown, label: string) {
  if (value !== null && (typeof value !== "string" || value.trim().length === 0)) {
    throw new Error(`${label} must be a non-empty string or null.`);
  }
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label} is invalid.`);
  return value as T[number];
}

function nullableEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] | null {
  return value === null ? null : enumValue(value, allowed, label);
}

function factJsonSchema(): Record<string, unknown> {
  const enumOrNull = (values: readonly string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
  const properties: Record<string, unknown> = {
    fact_id: { type: "string", pattern: "^fact-[0-9]{3,}$" },
    source_candidate_id: { type: "string" },
    source_unit_ids: { type: "array", minItems: 1, items: { type: "string" } },
    actor: { anyOf: [{ type: "string" }, { type: "null" }] },
    action: enumOrNull(FACT_ACTIONS),
    object: enumOrNull(FACT_OBJECTS),
    workflow_scope: { type: "string", enum: WORKFLOW_SCOPES },
    condition_or_trigger: { anyOf: [{ type: "string" }, { type: "null" }] },
    modality: { type: "string", enum: FACT_MODALITIES },
    tracking_details: {
      anyOf: [{
        type: "object", additionalProperties: false, required: TRACKING_KEYS,
        properties: Object.fromEntries(TRACKING_KEYS.map((key) => [key, { anyOf: [{ type: "boolean" }, { type: "null" }] }])),
      }, { type: "null" }],
    },
    validation_activity: enumOrNull(VALIDATION_ACTIVITIES),
    record_or_material: enumOrNull(RECORD_OR_MATERIALS),
    preservation_method: enumOrNull(PRESERVATION_METHODS),
  };
  return {
    type: "object", additionalProperties: false, required: ["facts"],
    properties: {
      facts: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: REQUIRED_FACT_KEYS, properties },
      },
    },
  };
}

export function v3ExtractionSystemPrompt() {
  return [
    "Extract source-grounded atomic operational facts only. Inspect every candidate and every source unit before responding.",
    "Return every distinct operative actor-action-object fact. Split compound sentences into separate facts even when the facts cite the same unit.",
    "Separately extract recovery, remediation tracking, and validation operations when they occur together.",
    "Extract fixed-retention obligations for incident records even when adjacent language is a descriptive records inventory.",
    "Return no fact for a unit that contains only an inventory, purpose statement, capability statement, background, or adjacent workflow.",
    "Every fact must cite one candidate and one or more contiguous, ordered source_unit_ids from that candidate.",
    "action and object are normalized controlled ontology values. The source_unit_ids, not model-echoed text, are the authoritative quotation.",
    "Classify provider oversight and procurement or contract corrective action in their own workflow scopes, never incident_response.",
    "required means must, shall, required, or equivalent obligation.",
    "operative means present-tense policy or procedure language stating that an actor performs an action.",
    "conditional_operative means an established action performed when, after, before, or upon a trigger.",
    "optional means may, can, at discretion, when appropriate, if feasible, or equivalent discretionary language.",
    "descriptive means purpose, capability, background, inventory, or design language that does not establish an action.",
    "unknown means modality cannot be grounded. Lack of must or shall alone never makes language optional.",
    "Generic examples: a team reviews alerts is operative; after an alert the team opens a case is conditional_operative; a team may review alerts is optional.",
    "Do not return final status, evidence relationship, requirement support, direct support, covered or missing elements, or compliance conclusions.",
    "Use null for optional semantic details not explicitly grounded. Do not add keys.",
  ].join("\n");
}

export function v3ScoredCandidates(fixtures: ClassifierCapabilityFixtureSuite) {
  return fixtures.cases.filter((item) => item.evaluation_role === "scored").map((fixtureCase) => {
    if (fixtureCase.candidates.length !== 1) throw new Error(`V3 scored case ${fixtureCase.id} must contain one candidate.`);
    const candidate = fixtureCase.candidates[0];
    return {
      requirement_id: fixtureCase.requirement_id,
      case_id: fixtureCase.id,
      candidate_id: candidate.chunk_id,
      text: candidate.content_preview,
      units: segmentCandidate(candidate.chunk_id, candidate.content_preview),
    };
  });
}

export function buildV3ExtractionRequests(fixtures: ClassifierCapabilityFixtureSuite, model = CLASSIFIER_FACTS_MODEL): V3Request[] {
  if (model !== CLASSIFIER_FACTS_MODEL) throw new Error(`V3 model is frozen to ${CLASSIFIER_FACTS_MODEL}.`);
  const candidates = v3ScoredCandidates(fixtures);
  return fixtures.requirements.map((requirement) => {
    const grouped = candidates.filter((candidate) => candidate.requirement_id === requirement.id);
    if (grouped.length === 0) throw new Error(`No V3 scored candidates for ${requirement.id}.`);
    const source = grouped.map((candidate) => ({
      case_id: candidate.case_id,
      source_candidate_id: candidate.candidate_id,
      units: candidate.units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text })),
    }));
    return {
      requirement_id: requirement.id,
      model,
      candidates: grouped.map(({ case_id, candidate_id, text, units }) => ({ case_id, candidate_id, text, units })),
      body: {
        model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "operational_facts_v3", strict: true, schema: factJsonSchema() } },
        messages: [
          { role: "system", content: v3ExtractionSystemPrompt() },
          {
            role: "user",
            content: [
              `Factual extraction focus: ${requirement.title}.`,
              "Inspect all units and extract every distinct source-grounded operative fact in this factual domain; do not assess sufficiency.",
              JSON.stringify({ candidates: source }, null, 2),
            ].join("\n\n"),
          },
        ],
      },
    };
  });
}

const ACTION_LEXEMES: Record<FactAction, RegExp | null> = {
  assess: /\b(?:assess\w*|evaluat\w*|determin\w*|investigat\w*)\b/u,
  identify: /\b(?:identif\w*|determin\w*)\b/u,
  contain: /\b(?:contain\w*|control\w*)\b/u,
  isolate: /\bisolat\w*\b/u,
  disable: /\bdisabl\w*\b/u,
  block: /\bblock\w*\b/u,
  shutdown: /\b(?:shutdown|shut\s+down)\b/u,
  preserve: /\bpreserv\w*\b/u,
  capture: /\bcaptur\w*\b/u,
  collect: /\bcollect\w*\b/u,
  store: /\bstor(?:e|es|ed|ing|age)\b/u,
  retain: /\b(?:retain\w*|retention)\b/u,
  maintain: /\bmaintain\w*\b/u,
  restore: /\b(?:restor\w*|recover\w*|return\w*[^.]{0,50}\bto\s+(?:service|operation))\b/u,
  rebuild: /\b(?:rebuild\w*|rebuilt)\b/u,
  reset: /\b(?:reset\w*|reissu\w*|rotat\w*)\b/u,
  patch: /\b(?:patch\w*|configuration\s+(?:change|repair)\w*|repair\w*\s+configuration)\b/u,
  remove: /\bremov\w*\b/u,
  remediate: /\b(?:remediat\w*|corrective\s+action\w*)\b/u,
  track: /\b(?:track\w*|remain\w*\s+open)\b/u,
  assign: /\bassign\w*\b/u,
  validate: /\bvalidat\w*\b/u,
  verify: /\b(?:verif\w*|confirm\w*)\b/u,
  test: /\btest\w*\b/u,
  monitor: /\bmonitor\w*\b/u,
  record: /\b(?:record\w*|document\w*|enter\w*)\b/u,
  inventory: /\b(?:inventory|inventories|contents?|lists?|includes?|contains?)\b/u,
  coordinate: /\bcoordinat\w*\b/u,
  review: /\breview\w*\b/u,
  approve: /\bapprov\w*\b/u,
  other: null,
};

const OBJECT_LEXEMES: Record<FactObject, RegExp | null> = {
  incident_nature_and_scope: /\b(?:nature|scope|method\s+of\s+access|duration|privileges?)\b/u,
  customer_information_system: /\bcustomer\s+information\s+systems?\b/u,
  customer_information: /\b(?:customer\s+information|customer\s+data|information\s+types?)\b/u,
  compromised_asset: /\b(?:compromised|affected)\s+(?:hosts?|accounts?|applications?|systems?|network\s+segments?)\b/u,
  incident_materials: /\b(?:incident\s+(?:file|records?|materials?)|notification\s+investigations?|supporting\s+facts|no-notice\s+decision|records?)\b/u,
  logs: /\b(?:logs?|logging)\b/u,
  volatile_information: /\bvolatile\s+information\b/u,
  evidence: /\bevidence\b/u,
  investigation_records: /\b(?:investigation\s+(?:records?|notes?|timeline)|notification\s+investigations?)\b/u,
  service: /\bservices?\b/u,
  system: /\bsystems?\b/u,
  unauthorized_access_path: /\b(?:unauthorized\s+(?:access\s+paths?|persistence)|access\s+paths?)\b/u,
  root_cause: /\broot\s+cause\b/u,
  remediation_item: /\b(?:remediation\s+items?|corrective\s+actions?)\b/u,
  security_control: /\b(?:security\s+controls?|controls?|logging|access|permissions?|integrity)\b/u,
  restored_environment: /\b(?:restored\s+environment|restored\s+(?:services?|systems?))\b/u,
  credentials: /\b(?:credentials?|keys?|tokens?)\b/u,
  patch: /\bpatch\w*\b/u,
  configuration: /\bconfigurations?\b/u,
  backup: /\bbackups?\b/u,
  provider_performance: /\b(?:vendor|provider)\s+performance\b/u,
  contract_issue: /\b(?:contract\s+issues?|terms\s+of\s+their\s+agreements?)\b/u,
  record_contents: /\b(?:contents?|inventory|include\w*)\b/u,
  other: null,
};

const OMISSION_LEXEMES: Record<string, RegExp> = {
  assess: /\bassess\w*\b/u,
  identify: /\bidentif\w*\b/u,
  isolate: /\bisolat\w*\b/u,
  disable: /\bdisabl\w*\b/u,
  block: /\bblock\w*\b/u,
  contain: /\bcontain\w*\b/u,
  preserve: /\bpreserv\w*\b/u,
  retain: /\b(?:retain\w*|retention)\b/u,
  maintain: /\bmaintain\w*\b/u,
  store: /\bstor(?:e|es|ed|ing|age)\b/u,
  collect: /\bcollect\w*\b/u,
  restore: /\b(?:restor\w*|recover\w*|return\w*[^.]{0,50}\bto\s+service)\b/u,
  reset: /\breset\w*\b/u,
  patch: /\bpatch\w*\b/u,
  assign: /\bassign\w*\b/u,
  track: /\btrack\w*\b/u,
  monitor: /\bmonitor\w*\b/u,
  review: /\breview\w*\b/u,
  validate: /\bvalidat\w*\b/u,
  verify: /\bverif\w*\b/u,
  test: /\btest\w*\b/u,
};

function validateFactShape(raw: unknown, index: number): V3ExtractedFact {
  assertObject(raw, `Fact ${index}`);
  const actualKeys = Object.keys(raw);
  const allowed = new Set<string>([...REQUIRED_FACT_KEYS, ...OPTIONAL_DIAGNOSTIC_KEYS]);
  for (const key of actualKeys) if (!allowed.has(key)) throw new Error(`Fact ${index} contains unsupported key ${key}.`);
  for (const key of REQUIRED_FACT_KEYS) if (!(key in raw)) throw new Error(`Fact ${index} is missing ${key}.`);
  if (typeof raw.fact_id !== "string" || !/^fact-[0-9]{3,}$/u.test(raw.fact_id)) throw new Error(`Fact ${index} fact_id is invalid.`);
  if (typeof raw.source_candidate_id !== "string" || !raw.source_candidate_id) throw new Error(`Fact ${index} source_candidate_id is invalid.`);
  if (!Array.isArray(raw.source_unit_ids) || raw.source_unit_ids.length === 0
    || raw.source_unit_ids.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`Fact ${index} source_unit_ids are invalid.`);
  }
  nullableString(raw.actor, `Fact ${index} actor`);
  nullableString(raw.condition_or_trigger, `Fact ${index} condition_or_trigger`);
  if ("action_text" in raw) nullableString(raw.action_text, `Fact ${index} action_text`);
  if ("object_text" in raw) nullableString(raw.object_text, `Fact ${index} object_text`);
  let tracking: TrackingDetails | null = null;
  if (raw.tracking_details !== null) {
    assertObject(raw.tracking_details, `Fact ${index} tracking_details`);
    const keys = Object.keys(raw.tracking_details).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...TRACKING_KEYS].sort())) throw new Error(`Fact ${index} tracking_details keys are invalid.`);
    for (const key of TRACKING_KEYS) {
      const value = raw.tracking_details[key];
      if (value !== null && typeof value !== "boolean") throw new Error(`Fact ${index} tracking_details.${key} is invalid.`);
    }
    tracking = raw.tracking_details as TrackingDetails;
  }
  return {
    fact_id: raw.fact_id,
    source_candidate_id: raw.source_candidate_id,
    source_unit_ids: raw.source_unit_ids as string[],
    actor: raw.actor as string | null,
    action: nullableEnum(raw.action, FACT_ACTIONS, `Fact ${index} action`),
    object: nullableEnum(raw.object, FACT_OBJECTS, `Fact ${index} object`),
    workflow_scope: enumValue(raw.workflow_scope, WORKFLOW_SCOPES, `Fact ${index} workflow_scope`),
    condition_or_trigger: raw.condition_or_trigger as string | null,
    modality: enumValue(raw.modality, FACT_MODALITIES, `Fact ${index} modality`),
    tracking_details: tracking,
    validation_activity: nullableEnum(raw.validation_activity, VALIDATION_ACTIVITIES, `Fact ${index} validation_activity`),
    record_or_material: nullableEnum(raw.record_or_material, RECORD_OR_MATERIALS, `Fact ${index} record_or_material`),
    preservation_method: nullableEnum(raw.preservation_method, PRESERVATION_METHODS, `Fact ${index} preservation_method`),
    ...(Object.hasOwn(raw, "action_text") ? { action_text: raw.action_text as string | null } : {}),
    ...(Object.hasOwn(raw, "object_text") ? { object_text: raw.object_text as string | null } : {}),
  };
}

function semanticRejections(fact: V3ExtractedFact, quote: string) {
  const normalized = normalizeSemanticText(quote);
  const reasons: string[] = [];
  if (fact.action !== null) {
    const actionPattern = ACTION_LEXEMES[fact.action];
    if (actionPattern && !actionPattern.test(normalized)) reasons.push(`action_not_grounded:${fact.action}`);
  }
  if (fact.object !== null) {
    const objectPattern = OBJECT_LEXEMES[fact.object];
    if (objectPattern && !objectPattern.test(normalized)) reasons.push(`object_not_grounded:${fact.object}`);
  }
  return reasons;
}

function eligibilityRejections(fact: V3ExtractedFact) {
  const reasons: string[] = [];
  if (fact.workflow_scope !== "incident_response") reasons.push(`workflow_scope_mismatch:${fact.workflow_scope}`);
  if (fact.modality === "optional") reasons.push("optional_modality");
  if (fact.modality === "descriptive" || fact.modality === "unknown") reasons.push(`non_operational_modality:${fact.modality}`);
  return reasons;
}

function rejectedFact(input: {
  request: V3Request; raw: unknown; index: number; stage: V3RejectedFact["rejection_stage"]; codes: string[];
  candidate?: V3Candidate; units?: CandidateUnit[]; quote?: string;
}): V3RejectedFact {
  const raw = input.raw && typeof input.raw === "object" && !Array.isArray(input.raw) ? input.raw as Record<string, unknown> : {};
  const sourceCandidateId = typeof raw.source_candidate_id === "string" ? raw.source_candidate_id : null;
  const sourceUnitIds = Array.isArray(raw.source_unit_ids) ? raw.source_unit_ids.filter((item): item is string => typeof item === "string") : [];
  const units = input.units ?? sourceUnitIds.flatMap((unitId) => {
    const unit = input.candidate?.units.find((item) => item.unit_id === unitId);
    return unit ? [unit] : [];
  });
  return {
    fact_index: input.index,
    fact_id: typeof raw.fact_id === "string" ? raw.fact_id : null,
    original_model_fact: input.raw,
    source_candidate_id: sourceCandidateId,
    source_unit_ids: sourceUnitIds,
    resolved_source_units: units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text, text_sha256: unit.text_sha256 })),
    reconstructed_quote: input.quote ?? null,
    rejection_stage: input.stage,
    rejection_codes: [...new Set(input.codes)],
    excluded_before_mapping: true,
    raw_provider_response_linkage: {
      requirement_id: input.request.requirement_id,
      fact_index: input.index,
      provider_exchange_id: null,
      raw_model_content_sha256: null,
    },
  };
}

export function validateV3ExtractionResponse(request: V3Request, response: unknown) {
  assertObject(response, "Extraction response");
  if (Object.keys(response).length !== 1 || !("facts" in response)) throw new Error("Extraction response must contain only facts.");
  if (!Array.isArray(response.facts)) throw new Error("Extraction response facts must be an array.");
  const candidateById = new Map(request.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const allUnitIds = new Set(request.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id)));
  const seenFactIds = new Set<string>();
  const facts: V3ValidatedFact[] = [];
  const rejectedFacts: V3RejectedFact[] = [];
  let selectedUnitReferenceCount = 0;

  for (const [index, raw] of response.facts.entries()) {
    let fact: V3ExtractedFact;
    try {
      fact = validateFactShape(raw, index);
    } catch (error) {
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "fact_schema", codes: [error instanceof Error ? error.message : String(error)] }));
      continue;
    }
    if (seenFactIds.has(fact.fact_id)) {
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "fact_schema", codes: ["duplicate_fact_id"] }));
      continue;
    }
    seenFactIds.add(fact.fact_id);
    const candidate = candidateById.get(fact.source_candidate_id);
    if (!candidate) throw new Error(`Request source isolation failure: unknown or cross-requirement candidate ${fact.source_candidate_id}.`);
    const positions = fact.source_unit_ids.map((unitId) => candidate.units.findIndex((unit) => unit.unit_id === unitId));
    if (positions.some((position) => position < 0)) {
      const crossCandidate = fact.source_unit_ids.some((unitId) => allUnitIds.has(unitId) || !unitId.startsWith(`${candidate.candidate_id}:`));
      if (crossCandidate) throw new Error(`Request source isolation failure: cross-candidate source unit in ${fact.fact_id}.`);
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "source_grounding", codes: ["invalid_source_unit_id"], candidate }));
      continue;
    }
    const units = positions.map((position) => candidate.units[position]);
    if (new Set(fact.source_unit_ids).size !== fact.source_unit_ids.length) {
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "source_grounding", codes: ["duplicate_source_unit_id"], candidate, units }));
      continue;
    }
    if (positions.slice(1).some((position, offset) => position !== positions[offset] + 1)) {
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "source_grounding", codes: ["noncontiguous_or_unordered_source_units"], candidate, units }));
      continue;
    }
    const quote = candidate.text.slice(units[0].start_offset, units[units.length - 1].end_offset);
    if (!quote || !candidate.text.includes(quote)) throw new Error(`Request replay corruption: quote reconstruction failed for ${fact.fact_id}.`);
    const semantic = semanticRejections(fact, quote);
    if (semantic.length) {
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "semantic_grounding", codes: semantic, candidate, units, quote }));
      continue;
    }
    const eligibility = eligibilityRejections(fact);
    if (eligibility.length) {
      rejectedFacts.push(rejectedFact({ request, raw, index, stage: "mapping_eligibility", codes: eligibility, candidate, units, quote }));
      continue;
    }
    facts.push({ ...fact, reconstructed_quote: quote, source_unit_sha256: units.map((unit) => unit.text_sha256) });
    selectedUnitReferenceCount += units.length;
  }
  return {
    facts,
    rejectedFacts,
    factsReturned: response.facts.length,
    selectedUnitReferenceCount,
    invalidUnitReferenceCount: 0,
  };
}

export function mapV3Fact(requirementId: string, fact: V3ValidatedFact) {
  const mapped: string[] = [];
  const rejected: string[] = [];
  const quote = normalizeSemanticText(fact.reconstructed_quote);
  if (fact.action === null) return { mapped, rejected: ["null_action_not_mappable"] };
  if (fact.action === "inventory" || (fact.action === "record" && fact.object === "record_contents")) {
    return { mapped, rejected: ["records_inventory_not_operational_proof"] };
  }

  if (requirementId === "incident_assessment_containment_control") {
    if (fact.action === "assess" && fact.object === "incident_nature_and_scope") mapped.push("assesses_scope");
    if (fact.action === "identify" && ["customer_information_system", "customer_information"].includes(fact.object ?? "")) {
      mapped.push("customer_information_systems");
    }
    const containmentObject = ["compromised_asset", "system", "unauthorized_access_path", "credentials", "other"].includes(fact.object ?? "");
    if (["contain", "isolate", "disable", "block", "shutdown"].includes(fact.action) && containmentObject) {
      mapped.push("containment_control");
    }
    if (fact.action === "coordinate" && /\bcontrolled\s+shutdowns?\b/u.test(quote)) mapped.push("containment_control");
  } else if (requirementId === "incident_evidence_log_preservation") {
    const materialObject = ["incident_materials", "logs", "volatile_information", "evidence", "investigation_records"].includes(fact.object ?? "")
      || fact.record_or_material !== null;
    const fixedRetention = ["preserve", "retain", "maintain"].includes(fact.action) && (fact.preservation_method === "fixed_retention_period"
      || /\b(?:for|retain(?:ed)?\s+for)\s+(?:at\s+least\s+)?\d+\s+(?:years?|months?|days?)\b/u.test(quote));
    const maintainsIncidentFile = fact.action === "maintain" && (fact.object === "incident_materials"
      || fact.record_or_material === "incident_file" || /\bincident\s+file\b/u.test(quote));
    const operationalPreservation = ["preserve", "retain", "maintain", "collect", "store", "capture"].includes(fact.action) && materialObject;
    if (operationalPreservation || maintainsIncidentFile) mapped.push("incident_materials");
    if ((operationalPreservation || maintainsIncidentFile) && !fixedRetention) mapped.push("preservation_process");
    const handlingDetail = /\b(?:access[- ]controlled|access\s+control|source|collection\s+time|custodian|integrity|chain\s+of\s+custody|custody\s+metadata)\b/u.test(quote);
    if (handlingDetail && (operationalPreservation || fact.action === "store")) {
      mapped.push("preservation_process", "integrity_or_chain_of_custody");
    }
    if (fact.validation_activity === "evidence_integrity_check" && operationalPreservation) mapped.push("integrity_or_chain_of_custody");
  } else if (requirementId === "response_recovery_remediation_validation") {
    const recoveryObject = ["service", "system", "unauthorized_access_path", "root_cause", "restored_environment", "credentials", "patch", "configuration", "backup", "other"].includes(fact.object ?? "");
    if (["restore", "rebuild", "reset", "patch", "remove", "remediate"].includes(fact.action) && recoveryObject) {
      mapped.push("recovery_steps");
    }
    const trackingText = /\b(?:owners?|assigned|assignment|due\s+dates?|remain\w*\s+open|open\s+(?:item|status)|track\w*|monitor\w*|completion\s+evidence|evidence\s+of\s+completion|completion\s+review|reviewed|closure)\b/u.test(quote);
    const trackingDetail = fact.tracking_details !== null
      && Object.values(fact.tracking_details).some((value) => value === true);
    if (["track", "assign", "monitor", "review"].includes(fact.action) && fact.object === "remediation_item"
      && (trackingText || trackingDetail)) mapped.push("remediation_tracking");
    const validationTarget = /\b(?:logging|access|permissions?|controls?|integrity|transactions?|functions?|data|restored\s+(?:services?|systems?)|services?|systems?)\b/u.test(quote);
    if (["validate", "verify", "test"].includes(fact.action)
      && (validationTarget || fact.validation_activity !== null)
      && ["system", "service", "unauthorized_access_path", "security_control", "restored_environment", "remediation_item", "other"].includes(fact.object ?? "")) {
      mapped.push("validation_testing");
    }
  }
  if (!mapped.length) rejected.push("no_atomic_mapping_rule_matched");
  return { mapped: [...new Set(mapped)], rejected };
}

export function buildV3OmissionDiagnostics(requests: V3Request[], outcomes: V3ExtractionOutcome[]) {
  const outcomeByRequirement = new Map(outcomes.map((outcome) => [outcome.requirement_id, outcome]));
  const diagnostics: V3OmissionDiagnostic[] = [];
  for (const request of requests) {
    const accepted = outcomeByRequirement.get(request.requirement_id)?.facts ?? [];
    for (const candidate of request.candidates) {
      for (const unit of candidate.units) {
        const normalized = normalizeSemanticText(unit.text);
        const matches = Object.entries(OMISSION_LEXEMES).filter(([, pattern]) => pattern.test(normalized)).map(([family]) => family);
        if (!matches.length) continue;
        const acceptedFactIds = accepted.filter((fact) => fact.source_candidate_id === candidate.candidate_id
          && fact.source_unit_ids.includes(unit.unit_id)).map((fact) => fact.fact_id);
        if (acceptedFactIds.length) continue;
        diagnostics.push({
          requirement_id: request.requirement_id,
          case_id: candidate.case_id,
          candidate_id: candidate.candidate_id,
          unit_id: unit.unit_id,
          unit_text: unit.text,
          unit_text_sha256: unit.text_sha256,
          matched_lexeme_families: matches,
          accepted_fact_ids: [],
          creates_evidence: false,
        });
      }
    }
  }
  return diagnostics;
}

export function deriveV3Case(
  fixtures: ClassifierCapabilityFixtureSuite,
  fixtureCase: ClassifierCapabilityCaseFixture,
  facts: V3ValidatedFact[],
  rejectedFacts: V3RejectedFact[],
  diagnostics: V3OmissionDiagnostic[],
): V3CaseDerivation {
  const candidateIds = fixtureCase.candidates.map((candidate) => candidate.chunk_id);
  const ledger = facts.filter((fact) => candidateIds.includes(fact.source_candidate_id)).map((fact): V3LedgerFact => {
    const mapping = mapV3Fact(fixtureCase.requirement_id, fact);
    return { ...fact, mapped_elements: mapping.mapped, deterministic_rejections: mapping.rejected };
  });
  const requirement = fixtures.requirements.find((item) => item.id === fixtureCase.requirement_id);
  if (!requirement) throw new Error(`Unknown requirement ${fixtureCase.requirement_id}.`);
  const supportedSet = new Set(ledger.flatMap((fact) => fact.mapped_elements));
  const supported = requirement.coverageElements.map((item) => item.id).filter((id) => supportedSet.has(id));
  const rejected = rejectedFacts.filter((fact) => fact.source_candidate_id !== null && candidateIds.includes(fact.source_candidate_id));
  const covered = requirement.requiredElementsForCovered.every((id) => supportedSet.has(id));
  return {
    case_id: fixtureCase.id,
    requirement_id: fixtureCase.requirement_id,
    candidate_ids: candidateIds,
    fact_ledger: ledger,
    rejected_fact_ledger: rejected,
    omission_diagnostics: diagnostics.filter((item) => candidateIds.includes(item.candidate_id)),
    supported_elements: supported,
    status: covered ? "covered" : supported.length ? "partial" : "missing",
    deterministic_rejection_reasons: [...new Set([
      ...ledger.flatMap((fact) => fact.deterministic_rejections),
      ...rejected.flatMap((fact) => fact.rejection_codes),
    ])],
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function statusRank(status: string) {
  return status === "missing" ? 0 : status === "partial" ? 1 : 2;
}

export function scoreV3Prototype(
  fixtures: ClassifierCapabilityFixtureSuite,
  requests: V3Request[],
  outcomes: V3ExtractionOutcome[],
  generatedAt = new Date().toISOString(),
): V3Result {
  const failures = outcomes.filter((outcome) => outcome.outcome !== "model_success");
  const facts = outcomes.flatMap((outcome) => outcome.facts);
  const rejectedFacts = outcomes.flatMap((outcome) => outcome.rejected_facts);
  const diagnostics = buildV3OmissionDiagnostics(requests, outcomes);
  const scoredCases = fixtures.cases.filter((item) => item.evaluation_role === "scored");
  const cases = scoredCases.map((fixtureCase) => deriveV3Case(fixtures, fixtureCase, facts, rejectedFacts, diagnostics));
  let truePositive = 0;
  let predictedPositive = 0;
  let expectedPositive = 0;
  let statusCorrect = 0;
  let falseAssurance = 0;
  let hardNegativeCorrect = 0;
  let hardNegativeTotal = 0;
  for (const derived of cases) {
    const fixtureCase = scoredCases.find((item) => item.id === derived.case_id)!;
    const expected = fixtureCase.expected_supported_elements.value ?? [];
    truePositive += derived.supported_elements.filter((element) => expected.includes(element)).length;
    predictedPositive += derived.supported_elements.length;
    expectedPositive += expected.length;
    if (derived.status === fixtureCase.expected_status.value) statusCorrect += 1;
    if (statusRank(derived.status) > statusRank(fixtureCase.expected_status.value!)) falseAssurance += 1;
    if (fixtureCase.candidates.some((candidate) => candidate.hard_negative.value === true)) {
      hardNegativeTotal += 1;
      if (derived.status === "missing" && !derived.supported_elements.length) hardNegativeCorrect += 1;
    }
  }
  const precision = ratio(truePositive, predictedPositive);
  const recall = ratio(truePositive, expectedPositive);
  const unitTotal = outcomes.reduce((sum, outcome) => sum + outcome.selected_unit_reference_count, 0);
  const invalidUnits = outcomes.reduce((sum, outcome) => sum + outcome.invalid_unit_reference_count, 0);
  const factsReturned = outcomes.reduce((sum, outcome) => sum + outcome.facts_returned, 0);
  const factsAccepted = facts.length;
  const factRejectionsByReason: Record<string, number> = {};
  for (const fact of rejectedFacts) for (const reason of fact.rejection_codes) {
    factRejectionsByReason[reason] = (factRejectionsByReason[reason] ?? 0) + 1;
  }
  const metrics: V3Metrics | null = failures.length ? null : {
    element_precision: { numerator: truePositive, denominator: predictedPositive, rate: precision },
    element_recall: { numerator: truePositive, denominator: expectedPositive, rate: recall },
    element_f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
    requirement_status_accuracy: { numerator: statusCorrect, denominator: cases.length, rate: ratio(statusCorrect, cases.length) },
    false_assurance: { count: falseAssurance, denominator: cases.length, rate: ratio(falseAssurance, cases.length) },
    hard_negative_rejection: { numerator: hardNegativeCorrect, denominator: hardNegativeTotal, rate: ratio(hardNegativeCorrect, hardNegativeTotal) },
    exact_source_unit_validity: { numerator: unitTotal - invalidUnits, denominator: unitTotal, rate: ratio(unitTotal - invalidUnits, unitTotal) },
    extraction_failures: 0,
    facts_returned: factsReturned,
    facts_accepted: factsAccepted,
    facts_rejected: rejectedFacts.length,
    fact_acceptance_rate: ratio(factsAccepted, factsReturned),
    fact_rejections_by_reason: factRejectionsByReason,
    requirements_with_rejected_facts: outcomes.filter((outcome) => outcome.rejected_facts.length).length,
    accepted_facts_per_requirement: Object.fromEntries(outcomes.map((outcome) => [outcome.requirement_id, outcome.facts.length])),
    omission_diagnostic_count: diagnostics.length,
  };
  return {
    schema_version: CLASSIFIER_FACTS_V3_SCHEMA,
    generated_at: generatedAt,
    fixture_suite_hash: fixtures.suite_hash,
    model: CLASSIFIER_FACTS_MODEL,
    valid: failures.length === 0,
    extraction_failure_count: failures.length,
    extraction_outcomes: outcomes,
    omission_diagnostics: diagnostics,
    cases,
    metrics,
  };
}

function percent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatV3Markdown(result: V3Result) {
  const lines = [
    "# Facts-only classifier prototype V3",
    "",
    `Model: \`${result.model}\``,
    `Fixture suite hash: \`${result.fixture_suite_hash}\``,
    `Run valid: **${result.valid ? "yes" : "no"}**`,
    "",
    "V3 reconstructs exact quotes from source-unit IDs and validates normalized semantics against those quotes. Omission diagnostics never create evidence.",
    "",
    "## Metrics",
    "",
  ];
  if (!result.metrics) lines.push("Metrics suppressed because at least one requirement request failed.", "");
  else lines.push(
    `- Element precision: ${percent(result.metrics.element_precision.rate)} (${result.metrics.element_precision.numerator}/${result.metrics.element_precision.denominator})`,
    `- Element recall: ${percent(result.metrics.element_recall.rate)} (${result.metrics.element_recall.numerator}/${result.metrics.element_recall.denominator})`,
    `- Element F1: ${percent(result.metrics.element_f1)}`,
    `- Requirement-status accuracy: ${percent(result.metrics.requirement_status_accuracy.rate)} (${result.metrics.requirement_status_accuracy.numerator}/${result.metrics.requirement_status_accuracy.denominator})`,
    `- False assurance: ${result.metrics.false_assurance.count}/${result.metrics.false_assurance.denominator}`,
    `- Hard-negative rejection: ${result.metrics.hard_negative_rejection.numerator}/${result.metrics.hard_negative_rejection.denominator}`,
    `- Exact source-unit validity: ${percent(result.metrics.exact_source_unit_validity.rate)}`,
    `- Facts returned/accepted/rejected: ${result.metrics.facts_returned}/${result.metrics.facts_accepted}/${result.metrics.facts_rejected}`,
    `- Omission diagnostics: ${result.metrics.omission_diagnostic_count}`,
    "",
  );
  lines.push("## Omission diagnostics", "");
  if (!result.omission_diagnostics.length) lines.push("None.", "");
  for (const item of result.omission_diagnostics) lines.push(
    `- \`${item.unit_id}\` (${item.matched_lexeme_families.join(", ")}) — ${JSON.stringify(item.unit_text)}`,
    "  - Creates evidence: no",
  );
  lines.push("", "## Per-case derivation", "");
  for (const item of result.cases) {
    lines.push(`### ${item.case_id}`, "", `Status: \`${item.status}\``, `Elements: ${item.supported_elements.join(", ") || "none"}`, "");
    for (const fact of item.fact_ledger) lines.push(
      `- \`${fact.fact_id}\` ${fact.action}/${fact.object ?? "null"}: ${JSON.stringify(fact.reconstructed_quote)}`,
      `  - Mapped: ${fact.mapped_elements.join(", ") || "none"}`,
    );
    for (const fact of item.rejected_fact_ledger) lines.push(
      `- REJECTED \`${fact.fact_id ?? `fact-index-${fact.fact_index}`}\`: ${fact.rejection_codes.join(", ")}`,
      `  - Quote: ${fact.reconstructed_quote === null ? "unresolved" : JSON.stringify(fact.reconstructed_quote)}`,
    );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
