import { createHash } from "node:crypto";

import type {
  ClassifierCapabilityCaseFixture,
  ClassifierCapabilityFixtureSuite,
} from "./classifierCapabilityEval";

export const CLASSIFIER_FACTS_PROTOTYPE_SCHEMA = "classifier-facts-prototype-results/v2";
export const CLASSIFIER_FACTS_DRY_SCHEMA = "classifier-facts-prototype-dry-run/v2";
export const CLASSIFIER_FACTS_MODEL = "gpt-4o-mini-2024-07-18";

export const WORKFLOW_SCOPES = [
  "incident_response",
  "service_provider_oversight",
  "contract_management",
  "general_governance",
  "records_inventory",
  "unrelated",
] as const;
export type FactWorkflowScope = typeof WORKFLOW_SCOPES[number];

export const FACT_ACTIONS = [
  "assess", "identify", "contain", "isolate", "disable", "block", "shutdown", "preserve", "capture",
  "collect", "store", "retain", "maintain", "restore", "rebuild", "reset", "patch", "remove",
  "remediate", "track", "assign", "validate", "verify", "test", "monitor", "record", "inventory",
  "coordinate", "review", "approve", "other",
] as const;
export type FactAction = typeof FACT_ACTIONS[number];

export const FACT_OBJECTS = [
  "incident_nature_and_scope", "customer_information_system", "customer_information", "compromised_asset",
  "incident_materials", "logs", "volatile_information", "evidence", "investigation_records", "service",
  "system", "unauthorized_access_path", "root_cause", "remediation_item", "security_control",
  "restored_environment", "credentials", "patch", "configuration", "backup", "provider_performance",
  "contract_issue", "record_contents", "other",
] as const;
export type FactObject = typeof FACT_OBJECTS[number];

export const FACT_MODALITIES = ["required", "operative", "conditional_operative", "optional", "descriptive", "unknown"] as const;
export type FactModality = typeof FACT_MODALITIES[number];

export const VALIDATION_ACTIVITIES = [
  "access_path_removed", "security_logging_check", "access_permission_check", "data_integrity_check",
  "transaction_test", "business_function_test", "recurrence_monitoring", "evidence_integrity_check",
  "generic_validation",
] as const;
export type ValidationActivity = typeof VALIDATION_ACTIVITIES[number];

export const RECORD_OR_MATERIALS = [
  "incident_file", "logs", "volatile_information", "exports", "screenshots", "investigation_notes",
  "communications", "notification_records", "recovery_test_records", "other_incident_material",
] as const;
export type RecordOrMaterial = typeof RECORD_OR_MATERIALS[number];

export const PRESERVATION_METHODS = [
  "access_controlled_storage", "retention_hold", "fixed_retention_period", "source_export",
  "custody_metadata", "other_controlled_method",
] as const;
export type PreservationMethod = typeof PRESERVATION_METHODS[number];

export type TrackingDetails = {
  owner_assigned: boolean | null;
  due_date_assigned: boolean | null;
  status_monitored: boolean | null;
  open_until_evidence_review: boolean | null;
};

export type ExtractedOperationalFact = {
  fact_id: string;
  source_candidate_id: string;
  source_unit_ids: string[];
  actor: string | null;
  action: FactAction | null;
  action_text: string | null;
  object: FactObject | null;
  object_text: string | null;
  workflow_scope: FactWorkflowScope;
  condition_or_trigger: string | null;
  modality: FactModality;
  tracking_details: TrackingDetails | null;
  validation_activity: ValidationActivity | null;
  record_or_material: RecordOrMaterial | null;
  preservation_method: PreservationMethod | null;
};

export type CandidateUnit = {
  unit_id: string;
  candidate_id: string;
  ordinal: number;
  start_offset: number;
  end_offset: number;
  text: string;
  text_sha256: string;
};

export type PrototypeCandidate = {
  case_id: string;
  candidate_id: string;
  text: string;
  units: CandidateUnit[];
};

export type FactsExtractionRequest = {
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
  candidates: PrototypeCandidate[];
};

export type ValidatedFact = ExtractedOperationalFact & {
  reconstructed_quote: string;
  source_unit_sha256: string[];
};

export type RejectedFact = {
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

export type FactLedgerEntry = ValidatedFact & {
  mapped_elements: string[];
  deterministic_rejections: string[];
};

export type CaseDerivation = {
  case_id: string;
  requirement_id: string;
  candidate_ids: string[];
  fact_ledger: FactLedgerEntry[];
  rejected_fact_ledger: RejectedFact[];
  supported_elements: string[];
  status: "covered" | "partial" | "missing";
  deterministic_rejection_reasons: string[];
};

export type ExtractionOutcome = {
  requirement_id: string;
  outcome: "model_success" | "provider_error" | "transport_error" | "malformed_model_json"
    | "top_level_schema_error" | "source_isolation_error" | "replay_corruption";
  raw_provider_exchange: unknown;
  raw_model_content: string | null;
  facts: ValidatedFact[];
  rejected_facts: RejectedFact[];
  facts_returned: number;
  validation_errors: string[];
  selected_unit_reference_count: number;
  invalid_unit_reference_count: number;
};

export type PrototypeMetrics = {
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
};

export type PrototypeResult = {
  schema_version: typeof CLASSIFIER_FACTS_PROTOTYPE_SCHEMA;
  generated_at: string;
  fixture_suite_hash: string;
  model: string;
  valid: boolean;
  extraction_failure_count: number;
  extraction_outcomes: ExtractionOutcome[];
  cases: CaseDerivation[];
  metrics: PrototypeMetrics | null;
};

const PROHIBITED_MODEL_KEYS = new Set([
  "status", "final_status", "requirement_status", "relationship", "evidence_relationship",
  "requirement_supported", "direct_support", "covered_elements", "missing_elements", "compliance_conclusion",
]);

const FACT_KEYS = [
  "fact_id", "source_candidate_id", "source_unit_ids", "actor", "action", "action_text", "object", "object_text", "workflow_scope",
  "condition_or_trigger", "modality", "tracking_details", "validation_activity", "record_or_material",
  "preservation_method",
];
const TRACKING_KEYS = ["owner_assigned", "due_date_assigned", "status_monitored", "open_until_evidence_review"];

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
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

function sentenceRanges(text: string, rangeStart: number, rangeEnd: number) {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = rangeStart;
  for (let index = rangeStart; index < rangeEnd; index += 1) {
    const char = text[index];
    if ((char === "." || char === "?" || char === "!")
      && (index + 1 === rangeEnd || /\s/u.test(text[index + 1] ?? ""))) {
      ranges.push({ start, end: index + 1 });
      start = index + 1;
      while (start < rangeEnd && /[ \t]/u.test(text[start])) start += 1;
    }
  }
  if (start < rangeEnd) ranges.push({ start, end: rangeEnd });
  return ranges;
}

export function segmentCandidate(candidateId: string, text: string): CandidateUnit[] {
  if (!candidateId.trim()) throw new Error("Candidate ID is required for segmentation.");
  if (!text.length) throw new Error(`Candidate ${candidateId} has no text.`);
  const rawRanges: Array<{ start: number; end: number }> = [];
  let lineStart = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") continue;
    let start = lineStart;
    let end = index;
    while (start < end && /[ \t]/u.test(text[start])) start += 1;
    while (end > start && /[ \t]/u.test(text[end - 1])) end -= 1;
    if (start < end) {
      const line = text.slice(start, end);
      if (/^(?:[•*-]|\d+[.)])\s/u.test(line)) rawRanges.push({ start, end });
      else rawRanges.push(...sentenceRanges(text, start, end));
    }
    lineStart = index + 1;
  }
  return rawRanges.map((range, index) => {
    const unitText = text.slice(range.start, range.end);
    const digest = sha256(unitText);
    return {
      unit_id: `${candidateId}:u${String(index + 1).padStart(3, "0")}:${digest.slice(0, 12)}`,
      candidate_id: candidateId,
      ordinal: index + 1,
      start_offset: range.start,
      end_offset: range.end,
      text: unitText,
      text_sha256: digest,
    };
  });
}

function factJsonSchema(): Record<string, unknown> {
  const nullableEnum = (values: readonly string[]) => ({ anyOf: [{ type: "string", enum: values }, { type: "null" }] });
  return {
    type: "object",
    additionalProperties: false,
    required: ["facts"],
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: FACT_KEYS,
          properties: {
            fact_id: { type: "string", pattern: "^fact-[0-9]{3,}$" },
            source_candidate_id: { type: "string" },
            source_unit_ids: { type: "array", minItems: 1, items: { type: "string" } },
            actor: { anyOf: [{ type: "string" }, { type: "null" }] },
            action: nullableEnum(FACT_ACTIONS),
            action_text: { anyOf: [{ type: "string" }, { type: "null" }] },
            object: nullableEnum(FACT_OBJECTS),
            object_text: { anyOf: [{ type: "string" }, { type: "null" }] },
            workflow_scope: { type: "string", enum: WORKFLOW_SCOPES },
            condition_or_trigger: { anyOf: [{ type: "string" }, { type: "null" }] },
            modality: { type: "string", enum: FACT_MODALITIES },
            tracking_details: {
              anyOf: [{
                type: "object", additionalProperties: false, required: TRACKING_KEYS,
                properties: Object.fromEntries(TRACKING_KEYS.map((key) => [key, { anyOf: [{ type: "boolean" }, { type: "null" }] }])),
              }, { type: "null" }],
            },
            validation_activity: nullableEnum(VALIDATION_ACTIVITIES),
            record_or_material: nullableEnum(RECORD_OR_MATERIALS),
            preservation_method: nullableEnum(PRESERVATION_METHODS),
          },
        },
      },
    },
  };
}

function extractionSystemPrompt() {
  return [
    "You extract atomic operational facts from supplied source units. Return facts only.",
    "Every fact must be fully grounded in the cited source_candidate_id and one or more source_unit_ids.",
    "Use source units from only one candidate per fact. Cite contiguous units in source order.",
    "Return one separate fact for every distinct actor-action-object operation, even when one sentence contains several operations.",
    "Generic example: if a policy says a team opens a case, assigns an owner, and tracks completion, return three facts citing the same unit.",
    "action and object are normalized controlled ontology values; action_text and object_text are different fields that must copy the shortest exact contiguous source phrases grounding them.",
    "Never copy an ontology label into action_text or object_text unless that label literally occurs in the cited source. Use null when action or object is null.",
    "Do not infer an action from a list of records expected in a file. Classify such lists as records_inventory.",
    "An explicit required or operative retention statement for incident records is an operational retention fact even when it follows an inventory; extract the retention operation separately from the descriptive inventory.",
    "Classify provider oversight and procurement/contract corrective action in their own workflow scopes, never incident_response.",
    "Modality required means explicit must, shall, required, or an equivalent obligation.",
    "Modality operative means present-tense policy or procedure language stating that an actor performs an action; lack of must or shall does not make it optional.",
    "Modality conditional_operative means an action required or established when, after, before, or upon a trigger.",
    "Modality optional means may, can, at discretion, when appropriate, if feasible, or equivalent discretionary language.",
    "Modality descriptive means purpose, capability, background, inventory, or design language that does not itself establish an action.",
    "Modality unknown means modality cannot be grounded.",
    "Generic examples: 'The team reviews alerts' is operative; 'After an alert, the team opens a case' is conditional_operative; 'The team may review alerts' is optional.",
    "Do not return final status, evidence relationship, requirement_supported, direct_support, covered/missing elements, or any compliance conclusion.",
    "Use null for every field not explicitly grounded in the cited units. Do not add keys.",
  ].join("\n");
}

export function scoredPrototypeCandidates(fixtures: ClassifierCapabilityFixtureSuite) {
  return fixtures.cases.filter((item) => item.evaluation_role === "scored").map((fixtureCase) => {
    if (fixtureCase.candidates.length !== 1) throw new Error(`Prototype scored case ${fixtureCase.id} must contain exactly one candidate.`);
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

export function buildFactsExtractionRequests(
  fixtures: ClassifierCapabilityFixtureSuite,
  model = CLASSIFIER_FACTS_MODEL,
): FactsExtractionRequest[] {
  if (model !== CLASSIFIER_FACTS_MODEL) throw new Error(`Prototype model is frozen to ${CLASSIFIER_FACTS_MODEL}.`);
  const candidates = scoredPrototypeCandidates(fixtures);
  return fixtures.requirements.map((requirement) => {
    const grouped = candidates.filter((candidate) => candidate.requirement_id === requirement.id);
    if (grouped.length === 0) throw new Error(`No scored prototype candidates for ${requirement.id}.`);
    const source = grouped.map((candidate) => ({
      case_id: candidate.case_id,
      source_candidate_id: candidate.candidate_id,
      units: candidate.units.map((unit) => ({ unit_id: unit.unit_id, text: unit.text })),
    }));
    const user = [
      `Factual extraction focus: ${requirement.title}.`,
      "Extract all source-grounded operational facts relevant to this factual domain; do not assess sufficiency or compliance.",
      JSON.stringify({ candidates: source }, null, 2),
    ].join("\n\n");
    const prototypeCandidates: PrototypeCandidate[] = grouped.map(({ case_id, candidate_id, text, units }) => ({ case_id, candidate_id, text, units }));
    return {
      requirement_id: requirement.id,
      model,
      candidates: prototypeCandidates,
      body: {
        model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "operational_facts", strict: true, schema: factJsonSchema() } },
        messages: [
          { role: "system", content: extractionSystemPrompt() },
          { role: "user", content: user },
        ],
      },
    };
  });
}

const ACTION_FAMILY_PATTERNS: Record<FactAction, RegExp> = {
  assess: /\b(?:assess(?:es|ed|ing)?|evaluat(?:e|es|ed|ing)|determin(?:e|es|ed|ing)|investigat(?:e|es|ed|ing))\b/iu,
  identify: /\b(?:identif(?:y|ies|ied|ying)|determin(?:e|es|ed|ing))\b/iu,
  contain: /\b(?:contain(?:s|ed|ing|ment)?|control(?:s|led|ling)?)\b/iu,
  isolate: /\bisolat(?:e|es|ed|ing)\b/iu,
  disable: /\bdisabl(?:e|es|ed|ing)\b/iu,
  block: /\bblock(?:s|ed|ing)?\b/iu,
  shutdown: /\b(?:shutdown|shut\s+down)\b/iu,
  preserve: /\bpreserv(?:e|es|ed|ing)\b/iu,
  capture: /\bcaptur(?:e|es|ed|ing)\b/iu,
  collect: /\bcollect(?:s|ed|ing|ion)?\b/iu,
  store: /\bstor(?:e|es|ed|ing|age)\b/iu,
  retain: /\bretain(?:s|ed|ing)?|retention\b/iu,
  maintain: /\bmaintain(?:s|ed|ing)?\b/iu,
  restore: /\b(?:restor(?:e|es|ed|ing|ation)|recover(?:s|ed|ing|y)?|return(?:s|ed|ing)?\s+[^.]{0,40}\s+to\s+(?:service|operation))\b/iu,
  rebuild: /\brebuild(?:s|ing)?|rebuilt\b/iu,
  reset: /\b(?:reset(?:s|ting)?|reissu(?:e|es|ed|ing)|rotat(?:e|es|ed|ing))\b/iu,
  patch: /\b(?:patch(?:es|ed|ing)?|configuration\s+change(?:s)?)\b/iu,
  remove: /\bremov(?:e|es|ed|ing)\b/iu,
  remediate: /\b(?:remediat(?:e|es|ed|ing|ion)|correct(?:s|ed|ing|ive))\b/iu,
  track: /\b(?:track(?:s|ed|ing)?|remain(?:s|ed|ing)?\s+open)\b/iu,
  assign: /\bassign(?:s|ed|ing|ment)?\b/iu,
  validate: /\bvalidat(?:e|es|ed|ing|ion)\b/iu,
  verify: /\b(?:verif(?:y|ies|ied|ying)|confirm(?:s|ed|ing|ation)?)\b/iu,
  test: /\btest(?:s|ed|ing)?\b/iu,
  monitor: /\bmonitor(?:s|ed|ing)?\b/iu,
  record: /\b(?:record(?:s|ed|ing)?|document(?:s|ed|ing|ation)?|enter(?:s|ed|ing)?)\b/iu,
  inventory: /\b(?:inventory|inventories|contents?|list(?:s|ed|ing)?|contain(?:s|ed|ing)?|include(?:s|d|ing)?)\b/iu,
  coordinate: /\bcoordinat(?:e|es|ed|ing|ion)\b/iu,
  review: /\breview(?:s|ed|ing)?\b/iu,
  approve: /\bapprov(?:e|es|ed|ing|al)\b/iu,
  other: /[\s\S]+/u,
};

function semanticGroundingRejections(fact: ExtractedOperationalFact, reconstructedQuote: string) {
  const reasons: string[] = [];
  if (fact.action === null) {
    if (fact.action_text !== null) reasons.push("action_text_without_action");
  } else if (fact.action_text === null) {
    reasons.push(`missing_action_text:${fact.action}`);
  } else {
    if (!reconstructedQuote.includes(fact.action_text)) reasons.push(`action_text_not_exact_source_substring:${fact.action}`);
    else if (!ACTION_FAMILY_PATTERNS[fact.action].test(fact.action_text)) reasons.push(`action_family_mismatch:${fact.action}`);
  }
  if (fact.object === null) {
    if (fact.object_text !== null) reasons.push("object_text_without_object");
  } else if (fact.object_text === null) {
    reasons.push(`missing_object_text:${fact.object}`);
  } else if (!reconstructedQuote.includes(fact.object_text)) {
    reasons.push(`object_text_not_exact_source_substring:${fact.object}`);
  }
  return reasons;
}

function validateFactShape(value: unknown, index: number): ExtractedOperationalFact {
  const label = `facts[${index}]`;
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (PROHIBITED_MODEL_KEYS.has(key)) throw new Error(`${label} contains prohibited conclusion field ${key}.`);
  }
  exactKeys(value, FACT_KEYS, label);
  if (typeof value.fact_id !== "string" || !/^fact-[0-9]{3,}$/u.test(value.fact_id)) throw new Error(`${label}.fact_id is invalid.`);
  if (typeof value.source_candidate_id !== "string" || !value.source_candidate_id) throw new Error(`${label}.source_candidate_id is invalid.`);
  if (!Array.isArray(value.source_unit_ids) || value.source_unit_ids.length === 0
    || value.source_unit_ids.some((item) => typeof item !== "string" || !item)) throw new Error(`${label}.source_unit_ids is invalid.`);
  nullableString(value.actor, `${label}.actor`);
  nullableString(value.action_text, `${label}.action_text`);
  nullableString(value.object_text, `${label}.object_text`);
  nullableString(value.condition_or_trigger, `${label}.condition_or_trigger`);
  if (value.tracking_details !== null) {
    assertPlainObject(value.tracking_details, `${label}.tracking_details`);
    exactKeys(value.tracking_details, TRACKING_KEYS, `${label}.tracking_details`);
    for (const key of TRACKING_KEYS) {
      if (value.tracking_details[key] !== null && typeof value.tracking_details[key] !== "boolean") {
        throw new Error(`${label}.tracking_details.${key} must be boolean or null.`);
      }
    }
  }
  return {
    fact_id: value.fact_id,
    source_candidate_id: value.source_candidate_id,
    source_unit_ids: value.source_unit_ids as string[],
    actor: value.actor as string | null,
    action: value.action === null ? null : enumValue(value.action, FACT_ACTIONS, `${label}.action`),
    action_text: value.action_text as string | null,
    object: value.object === null ? null : enumValue(value.object, FACT_OBJECTS, `${label}.object`),
    object_text: value.object_text as string | null,
    workflow_scope: enumValue(value.workflow_scope, WORKFLOW_SCOPES, `${label}.workflow_scope`),
    condition_or_trigger: value.condition_or_trigger as string | null,
    modality: enumValue(value.modality, FACT_MODALITIES, `${label}.modality`),
    tracking_details: value.tracking_details as TrackingDetails | null,
    validation_activity: value.validation_activity === null ? null : enumValue(value.validation_activity, VALIDATION_ACTIVITIES, `${label}.validation_activity`),
    record_or_material: value.record_or_material === null ? null : enumValue(value.record_or_material, RECORD_OR_MATERIALS, `${label}.record_or_material`),
    preservation_method: value.preservation_method === null ? null : enumValue(value.preservation_method, PRESERVATION_METHODS, `${label}.preservation_method`),
  };
}

function factSchemaRejectionCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(".action is invalid")) return "unsupported_action_family";
  if (message.includes(".object is invalid")) return "unsupported_object_family";
  if (message.includes(".workflow_scope is invalid")) return "invalid_workflow_scope";
  if (message.includes(".modality is invalid")) return "invalid_modality";
  return "invalid_fact_schema";
}

function rawSourceFields(rawFact: unknown) {
  if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) {
    return { factId: null, candidateId: null, unitIds: [] as string[] };
  }
  const value = rawFact as Record<string, unknown>;
  return {
    factId: typeof value.fact_id === "string" ? value.fact_id : null,
    candidateId: typeof value.source_candidate_id === "string" ? value.source_candidate_id : null,
    unitIds: Array.isArray(value.source_unit_ids) ? value.source_unit_ids.filter((item): item is string => typeof item === "string") : [],
  };
}

function rejectedFact(input: {
  request: FactsExtractionRequest;
  rawFact: unknown;
  index: number;
  stage: RejectedFact["rejection_stage"];
  codes: string[];
  candidate?: PrototypeCandidate;
  units?: CandidateUnit[];
  quote?: string | null;
}): RejectedFact {
  const source = rawSourceFields(input.rawFact);
  const units = input.units ?? [];
  return {
    fact_index: input.index,
    fact_id: source.factId,
    original_model_fact: input.rawFact,
    source_candidate_id: source.candidateId,
    source_unit_ids: source.unitIds,
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

function mappingEligibilityRejections(fact: ExtractedOperationalFact) {
  if (fact.workflow_scope !== "incident_response") return [`workflow_scope_mismatch:${fact.workflow_scope}`];
  if (fact.modality === "optional") return ["optional_modality"];
  if (fact.modality === "descriptive" || fact.modality === "unknown") return [`non_operational_modality:${fact.modality}`];
  return [];
}

export function validateFactsExtractionResponse(request: FactsExtractionRequest, response: unknown) {
  assertPlainObject(response, "Extraction response");
  exactKeys(response, ["facts"], "Extraction response");
  if (!Array.isArray(response.facts)) throw new Error("Extraction response facts must be an array.");
  const seenFacts = new Set<string>();
  const candidateById = new Map(request.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const allRequestUnitIds = new Set(request.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id)));
  let selectedUnitReferenceCount = 0;
  const facts: ValidatedFact[] = [];
  const rejectedFacts: RejectedFact[] = [];

  for (const [index, rawFact] of response.facts.entries()) {
    let fact: ExtractedOperationalFact;
    try {
      fact = validateFactShape(rawFact, index);
    } catch (error) {
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "fact_schema", codes: [factSchemaRejectionCode(error)] }));
      continue;
    }
    if (seenFacts.has(fact.fact_id)) {
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "fact_schema", codes: ["duplicate_fact_id"] }));
      continue;
    }
    seenFacts.add(fact.fact_id);
    const candidate = candidateById.get(fact.source_candidate_id);
    if (!candidate) {
      throw new Error(`Request source isolation failure: fact ${fact.fact_id} references unknown or cross-requirement candidate ${fact.source_candidate_id}.`);
    }
    const positions = fact.source_unit_ids.map((unitId) => candidate.units.findIndex((unit) => unit.unit_id === unitId));
    if (positions.some((position) => position < 0)) {
      const crossCandidateUnit = fact.source_unit_ids.find((unitId) => allRequestUnitIds.has(unitId)
        || (!unitId.startsWith(`${candidate.candidate_id}:`) && unitId.includes(":u")));
      if (crossCandidateUnit) {
        throw new Error(`Request source isolation failure: fact ${fact.fact_id} references a cross-candidate source unit ${crossCandidateUnit}.`);
      }
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "source_grounding", codes: ["invalid_source_unit_id"], candidate }));
      continue;
    }
    const units = positions.map((position) => candidate.units[position]);
    if (new Set(fact.source_unit_ids).size !== fact.source_unit_ids.length) {
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "source_grounding", codes: ["duplicate_source_unit_id"], candidate, units }));
      continue;
    }
    if (positions.slice(1).some((position, offset) => position !== positions[offset] + 1)) {
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "source_grounding", codes: ["noncontiguous_or_unordered_source_units"], candidate, units }));
      continue;
    }
    const reconstructedQuote = candidate.text.slice(units[0].start_offset, units[units.length - 1].end_offset);
    if (!reconstructedQuote || !candidate.text.includes(reconstructedQuote)) {
      throw new Error(`Request replay corruption: fact ${fact.fact_id} quote reconstruction failed.`);
    }
    const semanticRejections = semanticGroundingRejections(fact, reconstructedQuote);
    if (semanticRejections.length > 0) {
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "semantic_grounding", codes: semanticRejections, candidate, units, quote: reconstructedQuote }));
      continue;
    }
    const eligibilityRejections = mappingEligibilityRejections(fact);
    if (eligibilityRejections.length > 0) {
      rejectedFacts.push(rejectedFact({ request, rawFact, index, stage: "mapping_eligibility", codes: eligibilityRejections, candidate, units, quote: reconstructedQuote }));
      continue;
    }
    facts.push({
      ...fact,
      reconstructed_quote: reconstructedQuote,
      source_unit_sha256: units.map((unit) => unit.text_sha256),
    });
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

function mapFact(requirementId: string, fact: ValidatedFact) {
  const mapped: string[] = [];
  const rejected: string[] = [];
  if (fact.action === null) {
    rejected.push("null_action_not_mappable");
    return { mapped, rejected };
  }
  if (fact.action === "inventory" || (fact.object === "record_contents" && fact.action === "record")) {
    rejected.push("records_inventory_not_operational_proof");
    return { mapped, rejected };
  }

  if (requirementId === "incident_assessment_containment_control") {
    if (fact.action === "assess" && fact.object === "incident_nature_and_scope") mapped.push("assesses_scope");
    if (fact.action === "identify" && (fact.object === "customer_information_system" || fact.object === "customer_information")) {
      mapped.push("customer_information_systems");
    }
    const containmentObject = ["compromised_asset", "system", "unauthorized_access_path", "credentials"].includes(fact.object ?? "");
    const blocksScopedTarget = fact.action === "block" && fact.object !== null;
    const coordinatesControlledShutdown = fact.action === "coordinate"
      && /\bcontrolled\s+shutdowns?\b/iu.test(fact.object_text ?? "");
    if ((["contain", "isolate", "disable", "shutdown"].includes(fact.action) && containmentObject)
      || blocksScopedTarget || coordinatesControlledShutdown) {
      mapped.push("containment_control");
    }
  } else if (requirementId === "incident_evidence_log_preservation") {
    const materials = ["incident_materials", "logs", "volatile_information", "evidence", "investigation_records"].includes(fact.object ?? "")
      || fact.record_or_material !== null;
    const preservationAction = ["preserve", "capture", "collect", "retain", "store"].includes(fact.action);
    const maintainsIncidentFile = fact.action === "maintain"
      && (fact.object === "incident_materials" || fact.record_or_material === "incident_file");
    if ((preservationAction && materials) || maintainsIncidentFile) mapped.push("incident_materials");
    if (preservationAction && materials && fact.preservation_method !== "fixed_retention_period") mapped.push("preservation_process");
    if (fact.action === "store" && fact.preservation_method !== null) mapped.push("preservation_process");
    if (fact.action === "store"
      && (fact.preservation_method === "access_controlled_storage" || fact.preservation_method === "custody_metadata")) {
      mapped.push("integrity_or_chain_of_custody");
    }
    if (preservationAction && fact.preservation_method === "custody_metadata") mapped.push("integrity_or_chain_of_custody");
    if (fact.validation_activity === "evidence_integrity_check") mapped.push("integrity_or_chain_of_custody");
  } else if (requirementId === "response_recovery_remediation_validation") {
    if (["restore", "rebuild", "reset", "patch", "remove", "remediate"].includes(fact.action)
      && ["service", "system", "unauthorized_access_path", "root_cause", "restored_environment", "credentials", "patch", "configuration", "backup"].includes(fact.object ?? "")) {
      mapped.push("recovery_steps");
    }
    const tracking = fact.tracking_details;
    if (["track", "assign", "monitor", "review"].includes(fact.action) && fact.object === "remediation_item" && tracking
      && [tracking.owner_assigned, tracking.due_date_assigned, tracking.status_monitored, tracking.open_until_evidence_review].some((item) => item === true)) {
      mapped.push("remediation_tracking");
    }
    if (["validate", "verify", "test"].includes(fact.action) && fact.validation_activity !== null
      && ["system", "service", "unauthorized_access_path", "security_control", "restored_environment", "remediation_item"].includes(fact.object ?? "")) {
      mapped.push("validation_testing");
    }
  }
  if (mapped.length === 0) rejected.push("no_atomic_mapping_rule_matched");
  return { mapped: [...new Set(mapped)], rejected };
}

export function deriveCase(
  fixtures: ClassifierCapabilityFixtureSuite,
  fixtureCase: ClassifierCapabilityCaseFixture,
  facts: ValidatedFact[],
  rejectedFacts: RejectedFact[] = [],
): CaseDerivation {
  const candidateIds = fixtureCase.candidates.map((candidate) => candidate.chunk_id);
  const ledger = facts.filter((fact) => candidateIds.includes(fact.source_candidate_id)).map((fact): FactLedgerEntry => {
    const mapping = mapFact(fixtureCase.requirement_id, fact);
    return { ...fact, mapped_elements: mapping.mapped, deterministic_rejections: mapping.rejected };
  });
  const supported = [...new Set(ledger.flatMap((fact) => fact.mapped_elements))];
  const requirement = fixtures.requirements.find((item) => item.id === fixtureCase.requirement_id);
  if (!requirement) throw new Error(`Unknown requirement ${fixtureCase.requirement_id}.`);
  const orderedSupported = requirement.coverageElements.map((item) => item.id).filter((id) => supported.includes(id));
  const covered = requirement.requiredElementsForCovered.every((id) => supported.includes(id));
  const rejectedFactLedger = rejectedFacts.filter((fact) => fact.source_candidate_id !== null
    && candidateIds.includes(fact.source_candidate_id));
  return {
    case_id: fixtureCase.id,
    requirement_id: fixtureCase.requirement_id,
    candidate_ids: candidateIds,
    fact_ledger: ledger,
    rejected_fact_ledger: rejectedFactLedger,
    supported_elements: orderedSupported,
    status: covered ? "covered" : orderedSupported.length > 0 ? "partial" : "missing",
    deterministic_rejection_reasons: [...new Set([
      ...ledger.flatMap((fact) => fact.deterministic_rejections),
      ...rejectedFactLedger.flatMap((fact) => fact.rejection_codes),
    ])],
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function statusRank(status: string) {
  return status === "missing" ? 0 : status === "partial" ? 1 : 2;
}

export function scoreFactsPrototype(
  fixtures: ClassifierCapabilityFixtureSuite,
  outcomes: ExtractionOutcome[],
  generatedAt = new Date().toISOString(),
): PrototypeResult {
  const failures = outcomes.filter((item) => item.outcome !== "model_success");
  const facts = outcomes.flatMap((item) => item.facts);
  const rejectedFacts = outcomes.flatMap((item) => item.rejected_facts ?? []);
  const scoredCases = fixtures.cases.filter((item) => item.evaluation_role === "scored");
  const cases = scoredCases.map((fixtureCase) => deriveCase(fixtures, fixtureCase, facts, rejectedFacts));
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
    truePositive += derived.supported_elements.filter((item) => expected.includes(item)).length;
    predictedPositive += derived.supported_elements.length;
    expectedPositive += expected.length;
    if (derived.status === fixtureCase.expected_status.value) statusCorrect += 1;
    if (statusRank(derived.status) > statusRank(fixtureCase.expected_status.value!)) falseAssurance += 1;
    if (fixtureCase.candidates.some((candidate) => candidate.hard_negative.value === true)) {
      hardNegativeTotal += 1;
      if (derived.status === "missing" && derived.supported_elements.length === 0) hardNegativeCorrect += 1;
    }
  }
  const precision = ratio(truePositive, predictedPositive);
  const recall = ratio(truePositive, expectedPositive);
  const unitDenominator = outcomes.reduce((sum, item) => sum + item.selected_unit_reference_count, 0);
  const invalidUnits = outcomes.reduce((sum, item) => sum + item.invalid_unit_reference_count, 0);
  const factsReturned = outcomes.reduce((sum, item) => sum + (item.facts_returned ?? item.facts.length + (item.rejected_facts?.length ?? 0)), 0);
  const factsAccepted = outcomes.reduce((sum, item) => sum + item.facts.length, 0);
  const factsRejected = outcomes.reduce((sum, item) => sum + (item.rejected_facts?.length ?? 0), 0);
  const factRejectionsByReason: Record<string, number> = {};
  for (const fact of rejectedFacts) {
    for (const reason of fact.rejection_codes) factRejectionsByReason[reason] = (factRejectionsByReason[reason] ?? 0) + 1;
  }
  const acceptedFactsPerRequirement = Object.fromEntries(outcomes.map((item) => [item.requirement_id, item.facts.length]));
  const metrics: PrototypeMetrics | null = failures.length > 0 ? null : {
    element_precision: { numerator: truePositive, denominator: predictedPositive, rate: precision },
    element_recall: { numerator: truePositive, denominator: expectedPositive, rate: recall },
    element_f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
    requirement_status_accuracy: { numerator: statusCorrect, denominator: cases.length, rate: ratio(statusCorrect, cases.length) },
    false_assurance: { count: falseAssurance, denominator: cases.length, rate: ratio(falseAssurance, cases.length) },
    hard_negative_rejection: { numerator: hardNegativeCorrect, denominator: hardNegativeTotal, rate: ratio(hardNegativeCorrect, hardNegativeTotal) },
    exact_source_unit_validity: { numerator: unitDenominator - invalidUnits, denominator: unitDenominator, rate: ratio(unitDenominator - invalidUnits, unitDenominator) },
    extraction_failures: 0,
    facts_returned: factsReturned,
    facts_accepted: factsAccepted,
    facts_rejected: factsRejected,
    fact_acceptance_rate: ratio(factsAccepted, factsReturned),
    fact_rejections_by_reason: factRejectionsByReason,
    requirements_with_rejected_facts: outcomes.filter((item) => (item.rejected_facts?.length ?? 0) > 0).length,
    accepted_facts_per_requirement: acceptedFactsPerRequirement,
  };
  return {
    schema_version: CLASSIFIER_FACTS_PROTOTYPE_SCHEMA,
    generated_at: generatedAt,
    fixture_suite_hash: fixtures.suite_hash,
    model: CLASSIFIER_FACTS_MODEL,
    valid: failures.length === 0,
    extraction_failure_count: failures.length,
    extraction_outcomes: outcomes,
    cases,
    metrics,
  };
}

function percent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export function formatFactsPrototypeMarkdown(result: PrototypeResult) {
  const lines = [
    "# Facts-only classifier prototype evaluation",
    "",
    `Model: \`${result.model}\``,
    `Fixture suite hash: \`${result.fixture_suite_hash}\``,
    `Run valid: **${result.valid ? "yes" : "no"}**`,
    `Extraction failures: **${result.extraction_failure_count}**`,
    "",
    "This evaluation isolates facts-only extraction plus deterministic mapping. It does not evaluate retrieval, ingestion, embeddings, or production behavior.",
    "",
    "## Metrics",
    "",
  ];
  if (!result.metrics) {
    lines.push("Metrics suppressed because at least one requirement extraction did not produce a validated model-success outcome.", "");
  } else {
    lines.push(
      `- Element precision: ${percent(result.metrics.element_precision.rate)} (${result.metrics.element_precision.numerator}/${result.metrics.element_precision.denominator})`,
      `- Element recall: ${percent(result.metrics.element_recall.rate)} (${result.metrics.element_recall.numerator}/${result.metrics.element_recall.denominator})`,
      `- Element F1: ${percent(result.metrics.element_f1)}`,
      `- Requirement-status accuracy: ${percent(result.metrics.requirement_status_accuracy.rate)} (${result.metrics.requirement_status_accuracy.numerator}/${result.metrics.requirement_status_accuracy.denominator})`,
      `- False assurance: ${percent(result.metrics.false_assurance.rate)} (${result.metrics.false_assurance.count}/${result.metrics.false_assurance.denominator})`,
      `- Hard-negative rejection: ${percent(result.metrics.hard_negative_rejection.rate)} (${result.metrics.hard_negative_rejection.numerator}/${result.metrics.hard_negative_rejection.denominator})`,
      `- Exact source-unit validity: ${percent(result.metrics.exact_source_unit_validity.rate)} (${result.metrics.exact_source_unit_validity.numerator}/${result.metrics.exact_source_unit_validity.denominator})`,
      `- Extraction failures: ${result.metrics.extraction_failures}`,
      `- Facts returned: ${result.metrics.facts_returned}`,
      `- Facts accepted: ${result.metrics.facts_accepted}`,
      `- Facts rejected: ${result.metrics.facts_rejected}`,
      `- Fact acceptance rate: ${percent(result.metrics.fact_acceptance_rate)}`,
      `- Requirements containing rejected facts: ${result.metrics.requirements_with_rejected_facts}`,
      `- Accepted facts per requirement: ${JSON.stringify(result.metrics.accepted_facts_per_requirement)}`,
      `- Fact rejections by reason: ${JSON.stringify(result.metrics.fact_rejections_by_reason)}`,
      "",
    );
  }
  lines.push("## Extraction outcomes", "");
  for (const outcome of result.extraction_outcomes) {
    lines.push(`- \`${outcome.requirement_id}\`: **${outcome.outcome}**${outcome.validation_errors.length ? ` — ${outcome.validation_errors.join("; ")}` : ""}`);
  }
  lines.push("", "## Per-case fact ledger and derivation", "");
  for (const item of result.cases) {
    lines.push(
      `### ${item.case_id}`,
      "",
      `Derived status: \`${item.status}\``,
      `Mapped elements: ${item.supported_elements.length ? item.supported_elements.map((element) => `\`${element}\``).join(", ") : "none"}`,
      `Deterministic rejection reasons: ${item.deterministic_rejection_reasons.length ? item.deterministic_rejection_reasons.map((reason) => `\`${reason}\``).join(", ") : "none"}`,
      "",
    );
    if (item.fact_ledger.length === 0) lines.push("No validated facts.", "");
    for (const fact of item.fact_ledger) {
      lines.push(
        `- \`${fact.fact_id}\` — ${fact.action} / ${fact.object ?? "null"} / ${fact.workflow_scope} / ${fact.modality}`,
        `  - Units: ${fact.source_unit_ids.map((id) => `\`${id}\``).join(", ")}`,
        `  - Quote: ${JSON.stringify(fact.reconstructed_quote)}`,
        `  - Mapped: ${fact.mapped_elements.length ? fact.mapped_elements.join(", ") : "none"}`,
        `  - Rejected: ${fact.deterministic_rejections.length ? fact.deterministic_rejections.join(", ") : "none"}`,
      );
    }
    for (const fact of item.rejected_fact_ledger) {
      lines.push(
        `- REJECTED \`${fact.fact_id ?? `fact-index-${fact.fact_index}`}\` — stage ${fact.rejection_stage}`,
        `  - Units: ${fact.source_unit_ids.length ? fact.source_unit_ids.map((id) => `\`${id}\``).join(", ") : "unresolved"}`,
        `  - Quote: ${fact.reconstructed_quote === null ? "unresolved" : JSON.stringify(fact.reconstructed_quote)}`,
        `  - Rejection codes: ${fact.rejection_codes.join(", ")}`,
        "  - Excluded before mapping: yes",
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
