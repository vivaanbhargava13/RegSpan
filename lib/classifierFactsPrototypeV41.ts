import { createHash } from "node:crypto";

import type { ClassifierCapabilityFixtureSuite } from "./classifierCapabilityEval";
import {
  buildV4ExtractionRequests,
  formatV4Markdown,
  scoreV4Prototype,
  validateV4ExtractionResponse,
  type V4ExtractionOutcome,
  type V4Request,
  type V4Result,
  type V4ValidationResult,
} from "./classifierFactsPrototypeV4";

export const CLASSIFIER_FACTS_V41_SCHEMA = "classifier-facts-prototype-results/v4.1";
export const CLASSIFIER_FACTS_V41_DRY_SCHEMA = "classifier-facts-prototype-dry-run/v4.1";

export type V41Request = V4Request;

export type V41ReplayExchange = {
  raw_http_response_body: string | null;
  parsed_transport_json: unknown | null;
  raw_assistant_content: string | null;
  parsed_structured_output: unknown | null;
  finish_reason: string | null;
  provider_request_id: string | null;
  request_hash: string;
  response_hash: string | null;
};

export type V41ExtractionOutcome = V4ExtractionOutcome & {
  replay_exchange: V41ReplayExchange;
};

export type V41Result = Omit<V4Result, "schema_version" | "extraction_outcomes"> & {
  schema_version: typeof CLASSIFIER_FACTS_V41_SCHEMA;
  extraction_outcomes: V41ExtractionOutcome[];
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function exactKeys(value: Record<string, unknown>, expected: string[], label: string) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has unexpected or missing properties.`);
  }
}

function exactUnitIds(request: V41Request) {
  return request.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id));
}

function dynamicResponseSchema(baseRequest: V4Request) {
  const generic = baseRequest.body.response_format.json_schema.schema as {
    properties: { units: { items: { properties: { facts: { items: Record<string, unknown> } } } } };
  };
  const fact = generic.properties.units.items.properties.facts.items;
  const factsBranch = {
    type: "object",
    additionalProperties: false,
    required: ["disposition", "facts", "no_fact_reason"],
    properties: {
      disposition: { type: "string", enum: ["facts"] },
      facts: { type: "array", minItems: 1, items: fact },
      no_fact_reason: { type: "null" },
    },
  };
  const noFactBranch = {
    type: "object",
    additionalProperties: false,
    required: ["disposition", "facts", "no_fact_reason"],
    properties: {
      disposition: { type: "string", enum: ["no_fact"] },
      facts: { type: "array", maxItems: 0, items: fact },
      no_fact_reason: { type: "string", minLength: 1 },
    },
  };
  const unitIds = exactUnitIds(baseRequest);
  return {
    type: "object",
    additionalProperties: false,
    required: ["units"],
    properties: {
      units: {
        type: "object",
        additionalProperties: false,
        required: unitIds,
        properties: Object.fromEntries(unitIds.map((unitId) => [unitId, { anyOf: [factsBranch, noFactBranch] }])),
      },
    },
  };
}

export function buildV41ExtractionRequests(fixtures: ClassifierCapabilityFixtureSuite): V41Request[] {
  const requests: V41Request[] = buildV4ExtractionRequests(fixtures).map((baseRequest) => ({
    ...baseRequest,
    body: {
      ...baseRequest.body,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: v41SchemaName(baseRequest.requirement_id),
          strict: true,
          schema: dynamicResponseSchema(baseRequest),
        },
      },
    },
  }));
  const names = requests.map((request) => request.body.response_format.json_schema.name);
  for (const [index, name] of names.entries()) {
    if (name.length > 64) throw new Error(`V4.1 schema name exceeds 64 characters: ${name}.`);
    if (!/^[A-Za-z0-9_-]+$/u.test(name)) throw new Error(`V4.1 schema name contains unsupported characters: ${name}.`);
    if (name !== v41SchemaName(requests[index].requirement_id)) throw new Error(`V4.1 schema name is not deterministic for ${requests[index].requirement_id}.`);
  }
  if (new Set(names).size !== names.length) throw new Error("V4.1 schema names must be unique across the request plan.");
  return requests;
}

export function v41SchemaName(requirementId: string) {
  const sanitized = requirementId.replace(/[^A-Za-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "");
  const shortPrefix = sanitized.split("_").slice(0, 2).join("_").slice(0, 20) || "requirement";
  return `facts_v41_${shortPrefix}_${sha256(requirementId).slice(0, 10)}`;
}

export function v41SchemaHash(request: V41Request) {
  return sha256(JSON.stringify(request.body.response_format.json_schema.schema));
}

export function v41RequestHash(request: V41Request) {
  return sha256(JSON.stringify(request.body));
}

export function validateV41ProviderStructure(request: V41Request, response: unknown) {
  assertObject(response, "V4.1 response");
  exactKeys(response, ["units"], "V4.1 response");
  assertObject(response.units, "V4.1 response units");
  const expected = exactUnitIds(request);
  exactKeys(response.units, expected, "V4.1 response units");
  for (const unitId of expected) {
    const value = response.units[unitId];
    assertObject(value, `V4.1 unit ${unitId}`);
    exactKeys(value, ["disposition", "facts", "no_fact_reason"], `V4.1 unit ${unitId}`);
    if (!Array.isArray(value.facts)) throw new Error(`V4.1 unit ${unitId} facts must be an array.`);
    if (value.disposition === "facts") {
      if (value.facts.length < 1 || value.no_fact_reason !== null) {
        throw new Error(`V4.1 unit ${unitId} violates the facts branch.`);
      }
    } else if (value.disposition === "no_fact") {
      if (value.facts.length !== 0 || typeof value.no_fact_reason !== "string" || value.no_fact_reason.length < 1) {
        throw new Error(`V4.1 unit ${unitId} violates the no_fact branch.`);
      }
    } else {
      throw new Error(`V4.1 unit ${unitId} has an invalid disposition.`);
    }
  }
  return true;
}

export function validateV41ExtractionResponse(request: V41Request, response: unknown): V4ValidationResult {
  validateV41ProviderStructure(request, response);
  const units = (response as { units: Record<string, { disposition: "facts" | "no_fact"; facts: unknown[]; no_fact_reason: string | null }> }).units;
  return validateV4ExtractionResponse(request, {
    units: Object.entries(units).map(([unitId, decision]) => ({ unit_id: unitId, ...decision })),
  });
}

export function scoreV41Prototype(
  fixtures: ClassifierCapabilityFixtureSuite,
  requests: V41Request[],
  outcomes: V41ExtractionOutcome[],
  generatedAt = new Date().toISOString(),
): V41Result {
  const v4 = scoreV4Prototype(fixtures, requests, outcomes, generatedAt);
  return { ...v4, schema_version: CLASSIFIER_FACTS_V41_SCHEMA, extraction_outcomes: outcomes };
}

export function formatV41Markdown(result: V41Result) {
  return formatV4Markdown({ ...result, schema_version: "classifier-facts-prototype-results/v4" });
}
