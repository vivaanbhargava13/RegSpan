import { createHash } from "node:crypto";

import type {
  ClassifierCapabilityCaseFixture,
  ClassifierCapabilityFixtureSuite,
} from "./classifierCapabilityEval";

export const CLASSIFIER_FACTS_PROTOTYPE_SCHEMA = "classifier-facts-prototype-results/v1";
export const CLASSIFIER_FACTS_DRY_SCHEMA = "classifier-facts-prototype-dry-run/v1";
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
  "assess", "identify", "contain", "disable", "block", "preserve", "capture", "store", "retain",
  "restore", "remediate", "track", "assign", "validate", "verify", "test", "monitor", "record",
  "inventory", "coordinate", "other",
] as const;
export type FactAction = typeof FACT_ACTIONS[number];

export const FACT_OBJECTS = [
  "incident_nature_and_scope", "customer_information_system", "customer_information", "compromised_asset",
  "incident_materials", "logs", "volatile_information", "evidence", "investigation_records", "service",
  "system", "unauthorized_access_path", "root_cause", "remediation_item", "security_control",
  "restored_environment", "provider_performance", "contract_issue", "record_contents", "other",
] as const;
export type FactObject = typeof FACT_OBJECTS[number];

export const FACT_MODALITIES = ["mandatory", "performed", "descriptive", "optional", "unknown"] as const;
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
  action: FactAction;
  object: FactObject | null;
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

export type FactLedgerEntry = ValidatedFact & {
  mapped_elements: string[];
  deterministic_rejections: string[];
};

export type CaseDerivation = {
  case_id: string;
  requirement_id: string;
  candidate_ids: string[];
  fact_ledger: FactLedgerEntry[];
  supported_elements: string[];
  status: "covered" | "partial" | "missing";
  deterministic_rejection_reasons: string[];
};

export type ExtractionOutcome = {
  requirement_id: string;
  outcome: "model_success" | "provider_error" | "transport_error" | "validation_error";
  raw_provider_exchange: unknown;
  raw_model_content: string | null;
  facts: ValidatedFact[];
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
  "fact_id", "source_candidate_id", "source_unit_ids", "actor", "action", "object", "workflow_scope",
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
            action: { type: "string", enum: FACT_ACTIONS },
            object: nullableEnum(FACT_OBJECTS),
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
    "Do not infer an action from a list of records expected in a file. Classify such lists as records_inventory.",
    "Classify provider oversight and procurement/contract corrective action in their own workflow scopes, never incident_response.",
    "Use optional modality for may, can, optional, or discretionary language. Do not strengthen modality.",
    "Use descriptive for a noun/list/reference that does not state a required or performed operation.",
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
    action: enumValue(value.action, FACT_ACTIONS, `${label}.action`),
    object: value.object === null ? null : enumValue(value.object, FACT_OBJECTS, `${label}.object`),
    workflow_scope: enumValue(value.workflow_scope, WORKFLOW_SCOPES, `${label}.workflow_scope`),
    condition_or_trigger: value.condition_or_trigger as string | null,
    modality: enumValue(value.modality, FACT_MODALITIES, `${label}.modality`),
    tracking_details: value.tracking_details as TrackingDetails | null,
    validation_activity: value.validation_activity === null ? null : enumValue(value.validation_activity, VALIDATION_ACTIVITIES, `${label}.validation_activity`),
    record_or_material: value.record_or_material === null ? null : enumValue(value.record_or_material, RECORD_OR_MATERIALS, `${label}.record_or_material`),
    preservation_method: value.preservation_method === null ? null : enumValue(value.preservation_method, PRESERVATION_METHODS, `${label}.preservation_method`),
  };
}

export function validateFactsExtractionResponse(request: FactsExtractionRequest, response: unknown) {
  assertPlainObject(response, "Extraction response");
  exactKeys(response, ["facts"], "Extraction response");
  if (!Array.isArray(response.facts)) throw new Error("Extraction response facts must be an array.");
  const seenFacts = new Set<string>();
  const candidateById = new Map(request.candidates.map((candidate) => [candidate.candidate_id, candidate]));
  let selectedUnitReferenceCount = 0;
  const facts = response.facts.map((rawFact, index): ValidatedFact => {
    const fact = validateFactShape(rawFact, index);
    if (seenFacts.has(fact.fact_id)) throw new Error(`Duplicate fact ID ${fact.fact_id}.`);
    seenFacts.add(fact.fact_id);
    const candidate = candidateById.get(fact.source_candidate_id);
    if (!candidate) throw new Error(`Fact ${fact.fact_id} references unknown candidate ${fact.source_candidate_id}.`);
    const positions = fact.source_unit_ids.map((unitId) => candidate.units.findIndex((unit) => unit.unit_id === unitId));
    selectedUnitReferenceCount += positions.length;
    if (positions.some((position) => position < 0)) throw new Error(`Fact ${fact.fact_id} references an unknown source unit.`);
    if (new Set(fact.source_unit_ids).size !== fact.source_unit_ids.length) throw new Error(`Fact ${fact.fact_id} repeats a source unit.`);
    for (let position = 1; position < positions.length; position += 1) {
      if (positions[position] !== positions[position - 1] + 1) {
        throw new Error(`Fact ${fact.fact_id} source units must be contiguous and ordered.`);
      }
    }
    const first = candidate.units[positions[0]];
    const last = candidate.units[positions[positions.length - 1]];
    const reconstructedQuote = candidate.text.slice(first.start_offset, last.end_offset);
    if (!reconstructedQuote || !candidate.text.includes(reconstructedQuote)) throw new Error(`Fact ${fact.fact_id} quote reconstruction failed.`);
    return {
      ...fact,
      reconstructed_quote: reconstructedQuote,
      source_unit_sha256: positions.map((position) => candidate.units[position].text_sha256),
    };
  });
  return { facts, selectedUnitReferenceCount, invalidUnitReferenceCount: 0 };
}

function mapFact(requirementId: string, fact: ValidatedFact) {
  const mapped: string[] = [];
  const rejected: string[] = [];
  if (fact.workflow_scope !== "incident_response") {
    rejected.push(`workflow_scope_mismatch:${fact.workflow_scope}`);
    return { mapped, rejected };
  }
  if (fact.modality === "optional") {
    rejected.push("optional_modality");
    return { mapped, rejected };
  }
  if (fact.modality === "descriptive" || fact.modality === "unknown") {
    rejected.push(`non_operational_modality:${fact.modality}`);
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
    if (["contain", "disable", "block"].includes(fact.action)
      && ["compromised_asset", "system", "unauthorized_access_path"].includes(fact.object ?? "")) {
      mapped.push("containment_control");
    }
  } else if (requirementId === "incident_evidence_log_preservation") {
    const preservationAction = ["preserve", "capture", "retain", "store"].includes(fact.action);
    if (preservationAction && fact.record_or_material !== null) mapped.push("incident_materials");
    if (preservationAction && fact.preservation_method !== null
      && fact.preservation_method !== "fixed_retention_period") mapped.push("preservation_process");
    if (preservationAction && fact.preservation_method === "custody_metadata") mapped.push("integrity_or_chain_of_custody");
    if (fact.validation_activity === "evidence_integrity_check") mapped.push("integrity_or_chain_of_custody");
  } else if (requirementId === "response_recovery_remediation_validation") {
    if (["restore", "remediate"].includes(fact.action)
      && ["service", "system", "unauthorized_access_path", "root_cause", "restored_environment"].includes(fact.object ?? "")) {
      mapped.push("recovery_steps");
    }
    const tracking = fact.tracking_details;
    if (["track", "assign"].includes(fact.action) && fact.object === "remediation_item" && tracking
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
  return {
    case_id: fixtureCase.id,
    requirement_id: fixtureCase.requirement_id,
    candidate_ids: candidateIds,
    fact_ledger: ledger,
    supported_elements: orderedSupported,
    status: covered ? "covered" : orderedSupported.length > 0 ? "partial" : "missing",
    deterministic_rejection_reasons: [...new Set(ledger.flatMap((fact) => fact.deterministic_rejections))],
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
  const scoredCases = fixtures.cases.filter((item) => item.evaluation_role === "scored");
  const cases = scoredCases.map((fixtureCase) => deriveCase(fixtures, fixtureCase, facts));
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
  const metrics: PrototypeMetrics | null = failures.length > 0 ? null : {
    element_precision: { numerator: truePositive, denominator: predictedPositive, rate: precision },
    element_recall: { numerator: truePositive, denominator: expectedPositive, rate: recall },
    element_f1: precision === null || recall === null || precision + recall === 0 ? null : 2 * precision * recall / (precision + recall),
    requirement_status_accuracy: { numerator: statusCorrect, denominator: cases.length, rate: ratio(statusCorrect, cases.length) },
    false_assurance: { count: falseAssurance, denominator: cases.length, rate: ratio(falseAssurance, cases.length) },
    hard_negative_rejection: { numerator: hardNegativeCorrect, denominator: hardNegativeTotal, rate: ratio(hardNegativeCorrect, hardNegativeTotal) },
    exact_source_unit_validity: { numerator: unitDenominator - invalidUnits, denominator: unitDenominator, rate: ratio(unitDenominator - invalidUnits, unitDenominator) },
    extraction_failures: 0,
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
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
