import { createHash } from "node:crypto";

import { CLASSIFIER_FACTS_MODEL } from "./classifierFactsPrototype";
import {
  CLASSIFIER_FACTS_V3_SCHEMA,
  mapV3Fact,
  scoreV3Prototype,
  v3ScoredCandidates,
  validateV3ExtractionResponse,
  type V3ExtractionOutcome,
  type V3RejectedFact,
  type V3Request,
  type V3Result,
  type V3ValidatedFact,
} from "./classifierFactsPrototypeV3";
import type { ClassifierCapabilityFixtureSuite } from "./classifierCapabilityEval";

export { mapV3Fact } from "./classifierFactsPrototypeV3";

export const CLASSIFIER_FACTS_V4_SCHEMA = "classifier-facts-prototype-results/v4";
export const CLASSIFIER_FACTS_V4_DRY_SCHEMA = "classifier-facts-prototype-dry-run/v4";

export type V4Request = V3Request;

export type V4UnitEntry = {
  unit_id: string;
  disposition: "facts" | "no_fact";
  facts: unknown[];
  no_fact_reason: string | null;
};

export type V4UnitResult = {
  unit_id: string;
  candidate_id: string;
  case_id: string;
  disposition: "facts" | "no_fact";
  no_fact_reason: string | null;
  facts_returned: number;
  accepted_fact_ids: string[];
  rejected_fact_ids: Array<string | null>;
};

export type V4ValidationResult = {
  facts: V3ValidatedFact[];
  rejectedFacts: V3RejectedFact[];
  factsReturned: number;
  selectedUnitReferenceCount: number;
  invalidUnitReferenceCount: number;
  unitResults: V4UnitResult[];
  unitsSupplied: number;
  unitsReturned: number;
  unitsMissing: string[];
  unitsDuplicated: string[];
};

export type V4ExtractionOutcome = V3ExtractionOutcome & {
  unit_results: V4UnitResult[];
  units_supplied: number;
  units_returned: number;
  units_missing: string[];
  units_duplicated: string[];
  request_sha256: string;
  response_sha256: string | null;
  raw_provider_exchange_id: string | null;
};

export type V4RequirementDiagnostics = {
  requirement_id: string;
  units_supplied: number;
  units_returned: number;
  units_with_facts: number;
  units_marked_no_fact: number;
  units_missing: string[];
  units_duplicated: string[];
  facts_returned: number;
  facts_accepted: number;
  facts_rejected: number;
  rejection_reasons: Record<string, number>;
  high_signal_units_marked_no_fact: Array<{
    unit_id: string;
    matched_lexeme_families: string[];
    no_fact_reason: string;
    creates_evidence: false;
  }>;
  units_with_accepted_facts_but_no_mapped_element: string[];
  units_producing_multiple_atomic_facts: string[];
  request_sha256: string;
  response_sha256: string | null;
  raw_provider_exchange_id: string | null;
};

export type V4Result = Omit<V3Result, "schema_version" | "extraction_outcomes"> & {
  schema_version: typeof CLASSIFIER_FACTS_V4_SCHEMA;
  extraction_outcomes: V4ExtractionOutcome[];
  requirement_diagnostics: V4RequirementDiagnostics[];
  unit_accountability_complete: boolean;
};

const FACT_KEYS = [
  "fact_id", "source_candidate_id", "source_unit_ids", "actor", "action", "object", "workflow_scope",
  "condition_or_trigger", "modality", "tracking_details", "validation_activity", "record_or_material",
  "preservation_method",
] as const;

const ACTIONS = [
  "assess", "identify", "contain", "isolate", "disable", "block", "shutdown", "preserve", "capture",
  "collect", "store", "retain", "maintain", "restore", "rebuild", "reset", "patch", "remove", "remediate",
  "track", "assign", "validate", "verify", "test", "monitor", "record", "inventory", "coordinate", "review",
  "approve", "other",
];
const OBJECTS = [
  "incident_nature_and_scope", "customer_information_system", "customer_information", "compromised_asset",
  "incident_materials", "logs", "volatile_information", "evidence", "investigation_records", "service", "system",
  "unauthorized_access_path", "root_cause", "remediation_item", "security_control", "restored_environment",
  "credentials", "patch", "configuration", "backup", "provider_performance", "contract_issue", "record_contents", "other",
];
const SCOPES = ["incident_response", "service_provider_oversight", "contract_management", "general_governance", "records_inventory", "unrelated"];
const MODALITIES = ["required", "operative", "conditional_operative", "optional", "descriptive", "unknown"];
const VALIDATIONS = ["access_path_removed", "security_logging_check", "access_permission_check", "data_integrity_check", "transaction_test", "business_function_test", "recurrence_monitoring", "evidence_integrity_check", "generic_validation"];
const MATERIALS = ["incident_file", "logs", "volatile_information", "exports", "screenshots", "investigation_notes", "communications", "notification_records", "recovery_test_records", "other_incident_material"];
const METHODS = ["access_controlled_storage", "retention_hold", "fixed_retention_period", "source_export", "custody_metadata", "other_controlled_method"];
const TRACKING_KEYS = ["owner_assigned", "due_date_assigned", "status_monitored", "open_until_evidence_review"];

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function nullableEnum(values: string[]) {
  return { anyOf: [{ type: "string", enum: values }, { type: "null" }] };
}

function factSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: FACT_KEYS,
    properties: {
      fact_id: { type: "string", pattern: "^fact-[0-9]{3,}$" },
      source_candidate_id: { type: "string" },
      source_unit_ids: { type: "array", minItems: 1, items: { type: "string" } },
      actor: { anyOf: [{ type: "string" }, { type: "null" }] },
      action: nullableEnum(ACTIONS),
      object: nullableEnum(OBJECTS),
      workflow_scope: { type: "string", enum: SCOPES },
      condition_or_trigger: { anyOf: [{ type: "string" }, { type: "null" }] },
      modality: { type: "string", enum: MODALITIES },
      tracking_details: {
        anyOf: [{
          type: "object", additionalProperties: false, required: TRACKING_KEYS,
          properties: Object.fromEntries(TRACKING_KEYS.map((key) => [key, { anyOf: [{ type: "boolean" }, { type: "null" }] }])),
        }, { type: "null" }],
      },
      validation_activity: nullableEnum(VALIDATIONS),
      record_or_material: nullableEnum(MATERIALS),
      preservation_method: nullableEnum(METHODS),
    },
  };
}

function responseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["units"],
    properties: {
      units: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["unit_id", "disposition", "facts", "no_fact_reason"],
          properties: {
            unit_id: { type: "string" },
            disposition: { type: "string", enum: ["facts", "no_fact"] },
            facts: { type: "array", items: factSchema() },
            no_fact_reason: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      },
    },
  };
}

export function v4ExtractionSystemPrompt() {
  return [
    "Inspect every supplied source unit and return exactly one unit entry for every unit_id. Do not omit, duplicate, or invent units.",
    "For each unit, use disposition facts when it establishes at least one relevant source-grounded operative fact; otherwise use no_fact with a concise reason.",
    "Return every distinct actor-action-object operation and split compound sentences into separate atomic facts, even when several facts cite the same unit.",
    "Present-tense policy procedures are operative. Procedures triggered when, after, before, or upon an event are conditional_operative.",
    "Extract fixed incident-record retention requirements. Distinguish operative storage and custody handling from descriptive records inventories.",
    "Separately extract restoration, return to service, credential reset, patching, configuration repair, unauthorized-access-path removal, remediation tracking, and validation.",
    "When a unit both returns systems or services to operation and monitors them, extract restoration separately from monitoring.",
    "A fact may cite multiple contiguous units from one candidate when context is required, but it must cite the unit whose entry contains it.",
    "Use no_fact for headings, purpose or capability statements, inventories without an operative action, optional language, provider oversight, procurement, or adjacent workflows that establish no relevant incident-response operation.",
    "Do not weaken no_fact discipline merely to populate facts. Source grounding and the controlled ontology remain authoritative.",
    "Do not return final status, evidence relationships, supported or missing elements, direct-support designations, or compliance conclusions.",
    "Use null for semantic detail not explicitly grounded. Do not add keys.",
  ].join("\n");
}

export function buildV4ExtractionRequests(fixtures: ClassifierCapabilityFixtureSuite, model = CLASSIFIER_FACTS_MODEL): V4Request[] {
  if (model !== CLASSIFIER_FACTS_MODEL) throw new Error(`V4 model is frozen to ${CLASSIFIER_FACTS_MODEL}.`);
  const candidates = v3ScoredCandidates(fixtures);
  return fixtures.requirements.map((requirement) => {
    const grouped = candidates.filter((candidate) => candidate.requirement_id === requirement.id);
    if (!grouped.length) throw new Error(`No V4 candidates for ${requirement.id}.`);
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
        response_format: {
          type: "json_schema",
          json_schema: { name: "unit_accountable_operational_facts_v4", strict: true, schema: responseSchema() },
        },
        messages: [
          { role: "system", content: v4ExtractionSystemPrompt() },
          {
            role: "user",
            content: [
              `Factual extraction focus: ${requirement.title}.`,
              "Account for every unit with facts or no_fact. Extract all relevant atomic operations without assessing sufficiency.",
              JSON.stringify({ candidates: source }, null, 2),
            ].join("\n\n"),
          },
        ],
      },
    };
  });
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an invalid schema.`);
  }
}

function customRejectedFact(
  request: V4Request,
  raw: unknown,
  index: number,
  code: string,
  quote: string | null,
): V3RejectedFact {
  const object = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return {
    fact_index: index,
    fact_id: typeof object.fact_id === "string" ? object.fact_id : null,
    original_model_fact: raw,
    source_candidate_id: typeof object.source_candidate_id === "string" ? object.source_candidate_id : null,
    source_unit_ids: Array.isArray(object.source_unit_ids)
      ? object.source_unit_ids.filter((item): item is string => typeof item === "string") : [],
    resolved_source_units: [],
    reconstructed_quote: quote,
    rejection_stage: "source_grounding",
    rejection_codes: [code],
    excluded_before_mapping: true,
    raw_provider_response_linkage: {
      requirement_id: request.requirement_id,
      fact_index: index,
      provider_exchange_id: null,
      raw_model_content_sha256: null,
    },
  };
}

export function validateV4ExtractionResponse(request: V4Request, response: unknown): V4ValidationResult {
  assertObject(response, "V4 extraction response");
  exactKeys(response, ["units"], "V4 extraction response");
  if (!Array.isArray(response.units)) throw new Error("V4 extraction response units must be enumerable.");

  const suppliedUnits = request.candidates.flatMap((candidate) => candidate.units.map((unit) => ({
    ...unit,
    candidate_id: candidate.candidate_id,
    case_id: candidate.case_id,
  })));
  const suppliedById = new Map(suppliedUnits.map((unit) => [unit.unit_id, unit]));
  const entryCounts = new Map<string, number>();
  const parsedEntries: V4UnitEntry[] = [];
  for (const [index, rawEntry] of response.units.entries()) {
    assertObject(rawEntry, `Unit entry ${index}`);
    exactKeys(rawEntry, ["unit_id", "disposition", "facts", "no_fact_reason"], `Unit entry ${index}`);
    if (typeof rawEntry.unit_id !== "string" || !rawEntry.unit_id) throw new Error(`Unit entry ${index} has an invalid unit_id.`);
    if (!suppliedById.has(rawEntry.unit_id)) throw new Error(`Request unit accountability failure: unknown or cross-requirement unit ${rawEntry.unit_id}.`);
    entryCounts.set(rawEntry.unit_id, (entryCounts.get(rawEntry.unit_id) ?? 0) + 1);
    if (rawEntry.disposition !== "facts" && rawEntry.disposition !== "no_fact") {
      throw new Error(`Unit entry ${rawEntry.unit_id} has an invalid disposition.`);
    }
    if (!Array.isArray(rawEntry.facts)) throw new Error(`Unit entry ${rawEntry.unit_id} facts must be an array.`);
    if (rawEntry.disposition === "facts") {
      if (!rawEntry.facts.length || rawEntry.no_fact_reason !== null) {
        throw new Error(`Unit entry ${rawEntry.unit_id} violates facts/no_fact exclusivity.`);
      }
    } else if (rawEntry.facts.length
      || typeof rawEntry.no_fact_reason !== "string" || !rawEntry.no_fact_reason.trim()) {
      throw new Error(`Unit entry ${rawEntry.unit_id} violates facts/no_fact exclusivity.`);
    }
    parsedEntries.push(rawEntry as V4UnitEntry);
  }
  const duplicated = [...entryCounts].filter(([, count]) => count > 1).map(([unitId]) => unitId);
  if (duplicated.length) throw new Error(`Request unit accountability failure: duplicated units ${duplicated.join(", ")}.`);
  const missing = suppliedUnits.filter((unit) => !entryCounts.has(unit.unit_id)).map((unit) => unit.unit_id);
  if (missing.length) throw new Error(`Request unit accountability failure: omitted units ${missing.join(", ")}.`);

  const facts: V3ValidatedFact[] = [];
  const rejectedFacts: V3RejectedFact[] = [];
  const unitResults: V4UnitResult[] = [];
  const seenFactIds = new Set<string>();
  let factsReturned = 0;
  let selectedUnitReferenceCount = 0;
  let globalFactIndex = 0;
  for (const entry of parsedEntries) {
    const supplied = suppliedById.get(entry.unit_id)!;
    const acceptedForUnit: string[] = [];
    const rejectedForUnit: Array<string | null> = [];
    for (const rawFact of entry.facts) {
      factsReturned += 1;
      const currentIndex = globalFactIndex;
      globalFactIndex += 1;
      const object = rawFact && typeof rawFact === "object" && !Array.isArray(rawFact) ? rawFact as Record<string, unknown> : {};
      if (typeof object.source_candidate_id === "string" && object.source_candidate_id !== supplied.candidate_id) {
        throw new Error(`Request source isolation failure: fact in ${entry.unit_id} references cross-candidate source ${object.source_candidate_id}.`);
      }
      const validated = validateV3ExtractionResponse(request, { facts: [rawFact] });
      if (validated.rejectedFacts.length) {
        for (const rejected of validated.rejectedFacts) {
          rejectedFacts.push({ ...rejected, fact_index: currentIndex });
          rejectedForUnit.push(rejected.fact_id);
        }
        continue;
      }
      const fact = validated.facts[0];
      if (!fact.source_unit_ids.includes(entry.unit_id)) {
        const rejected = customRejectedFact(request, rawFact, currentIndex, "entry_unit_not_cited", fact.reconstructed_quote);
        rejectedFacts.push(rejected);
        rejectedForUnit.push(rejected.fact_id);
        continue;
      }
      if (seenFactIds.has(fact.fact_id)) {
        const rejected = customRejectedFact(request, rawFact, currentIndex, "duplicate_fact_id", fact.reconstructed_quote);
        rejectedFacts.push(rejected);
        rejectedForUnit.push(rejected.fact_id);
        continue;
      }
      seenFactIds.add(fact.fact_id);
      facts.push(fact);
      acceptedForUnit.push(fact.fact_id);
      selectedUnitReferenceCount += fact.source_unit_ids.length;
    }
    unitResults.push({
      unit_id: entry.unit_id,
      candidate_id: supplied.candidate_id,
      case_id: supplied.case_id,
      disposition: entry.disposition,
      no_fact_reason: entry.no_fact_reason,
      facts_returned: entry.facts.length,
      accepted_fact_ids: acceptedForUnit,
      rejected_fact_ids: rejectedForUnit,
    });
  }
  return {
    facts,
    rejectedFacts,
    factsReturned,
    selectedUnitReferenceCount,
    invalidUnitReferenceCount: 0,
    unitResults,
    unitsSupplied: suppliedUnits.length,
    unitsReturned: parsedEntries.length,
    unitsMissing: [],
    unitsDuplicated: [],
  };
}

const HIGH_SIGNAL_LEXEMES: Record<string, RegExp> = {
  assess: /\bassess\w*\b/iu,
  identify: /\bidentif\w*\b/iu,
  contain: /\b(?:contain\w*|isolat\w*|disabl\w*|block\w*|shutdown|shut\s+down)\b/iu,
  preserve: /\b(?:preserv\w*|retain\w*|retention|maintain\w*|stor(?:e|es|ed|ing|age)|collect\w*)\b/iu,
  recover: /\b(?:restor\w*|recover\w*|return\w*[^.]{0,40}\bto\s+(?:service|operation)|reset\w*|patch\w*)\b/iu,
  track: /\b(?:assign\w*|track\w*|monitor\w*|review\w*|remain\w*\s+open)\b/iu,
  validate: /\b(?:validat\w*|verif\w*|test\w*)\b/iu,
};

export function buildV4RequirementDiagnostics(request: V4Request, outcome: V4ExtractionOutcome): V4RequirementDiagnostics {
  const unitById = new Map(request.candidates.flatMap((candidate) => candidate.units).map((unit) => [unit.unit_id, unit]));
  const factById = new Map(outcome.facts.map((fact) => [fact.fact_id, fact]));
  const rejectionReasons: Record<string, number> = {};
  for (const rejected of outcome.rejected_facts) for (const reason of rejected.rejection_codes) {
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }
  const highSignalNoFact = outcome.unit_results.flatMap((result) => {
    if (result.disposition !== "no_fact" || !result.no_fact_reason) return [];
    const text = unitById.get(result.unit_id)?.text ?? "";
    const matches = Object.entries(HIGH_SIGNAL_LEXEMES).filter(([, pattern]) => pattern.test(text)).map(([family]) => family);
    return matches.length ? [{
      unit_id: result.unit_id,
      matched_lexeme_families: matches,
      no_fact_reason: result.no_fact_reason,
      creates_evidence: false as const,
    }] : [];
  });
  const noMapped = outcome.unit_results.filter((result) => result.accepted_fact_ids.length
    && result.accepted_fact_ids.every((factId) => {
      const fact = factById.get(factId);
      return !fact || mapV3Fact(request.requirement_id, fact).mapped.length === 0;
    })).map((result) => result.unit_id);
  return {
    requirement_id: request.requirement_id,
    units_supplied: outcome.units_supplied,
    units_returned: outcome.units_returned,
    units_with_facts: outcome.unit_results.filter((unit) => unit.disposition === "facts").length,
    units_marked_no_fact: outcome.unit_results.filter((unit) => unit.disposition === "no_fact").length,
    units_missing: outcome.units_missing,
    units_duplicated: outcome.units_duplicated,
    facts_returned: outcome.facts_returned,
    facts_accepted: outcome.facts.length,
    facts_rejected: outcome.rejected_facts.length,
    rejection_reasons: rejectionReasons,
    high_signal_units_marked_no_fact: highSignalNoFact,
    units_with_accepted_facts_but_no_mapped_element: noMapped,
    units_producing_multiple_atomic_facts: outcome.unit_results.filter((unit) => unit.accepted_fact_ids.length > 1).map((unit) => unit.unit_id),
    request_sha256: outcome.request_sha256,
    response_sha256: outcome.response_sha256,
    raw_provider_exchange_id: outcome.raw_provider_exchange_id,
  };
}

export function scoreV4Prototype(
  fixtures: ClassifierCapabilityFixtureSuite,
  requests: V4Request[],
  outcomes: V4ExtractionOutcome[],
  generatedAt = new Date().toISOString(),
): V4Result {
  const v3 = scoreV3Prototype(fixtures, requests, outcomes, generatedAt);
  const diagnostics = requests.map((request) => {
    const outcome = outcomes.find((item) => item.requirement_id === request.requirement_id);
    if (!outcome) throw new Error(`Missing V4 outcome for ${request.requirement_id}.`);
    return buildV4RequirementDiagnostics(request, outcome);
  });
  return {
    ...v3,
    schema_version: CLASSIFIER_FACTS_V4_SCHEMA,
    extraction_outcomes: outcomes,
    requirement_diagnostics: diagnostics,
    unit_accountability_complete: outcomes.every((outcome) => outcome.outcome === "model_success"
      && outcome.units_supplied === outcome.units_returned
      && !outcome.units_missing.length && !outcome.units_duplicated.length),
  };
}

export function formatV4Markdown(result: V4Result) {
  const percent = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  const lines = [
    "# Facts-only classifier prototype V4",
    "",
    `Model: \`${result.model}\``,
    `Fixture suite hash: \`${result.fixture_suite_hash}\``,
    `Run valid: **${result.valid ? "yes" : "no"}**`,
    `Unit accountability complete: **${result.unit_accountability_complete ? "yes" : "no"}**`,
    "",
    "V4 requires exactly one facts/no_fact entry per supplied unit. no_fact reasons and diagnostics never create evidence.",
    "",
    "## Metrics",
    "",
  ];
  if (!result.metrics) lines.push("Metrics suppressed because at least one request failed.", "");
  else lines.push(
    `- Element precision: ${percent(result.metrics.element_precision.rate)}`,
    `- Element recall: ${percent(result.metrics.element_recall.rate)}`,
    `- Requirement-status accuracy: ${result.metrics.requirement_status_accuracy.numerator}/${result.metrics.requirement_status_accuracy.denominator}`,
    `- False assurance: ${result.metrics.false_assurance.count}/${result.metrics.false_assurance.denominator}`,
    `- Hard-negative rejection: ${result.metrics.hard_negative_rejection.numerator}/${result.metrics.hard_negative_rejection.denominator}`,
    `- Exact source-unit validity: ${percent(result.metrics.exact_source_unit_validity.rate)}`,
    "",
  );
  lines.push("## Requirement diagnostics", "");
  for (const item of result.requirement_diagnostics) lines.push(
    `### ${item.requirement_id}`,
    "",
    `- Units supplied/returned: ${item.units_supplied}/${item.units_returned}`,
    `- Units with facts/no_fact: ${item.units_with_facts}/${item.units_marked_no_fact}`,
    `- Facts returned/accepted/rejected: ${item.facts_returned}/${item.facts_accepted}/${item.facts_rejected}`,
    `- High-signal no_fact units: ${item.high_signal_units_marked_no_fact.length}`,
    `- Accepted but unmapped units: ${item.units_with_accepted_facts_but_no_mapped_element.length}`,
    `- Multiple-fact units: ${item.units_producing_multiple_atomic_facts.length}`,
    `- Request SHA-256: \`${item.request_sha256}\``,
    `- Response SHA-256: ${item.response_sha256 ? `\`${item.response_sha256}\`` : "none"}`,
    `- Provider exchange: ${item.raw_provider_exchange_id ?? "none"}`,
    "",
  );
  lines.push("## Case derivations", "");
  for (const item of result.cases) lines.push(
    `- \`${item.case_id}\`: **${item.status}** — ${item.supported_elements.join(", ") || "none"}`,
  );
  return `${lines.join("\n")}\n`;
}

export function v4RequestHash(request: V4Request) {
  return sha256(JSON.stringify(request.body));
}

export function assertV3SchemaUnchanged() {
  return CLASSIFIER_FACTS_V3_SCHEMA === "classifier-facts-prototype-results/v3";
}
