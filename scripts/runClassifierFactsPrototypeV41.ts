import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CLASSIFIER_FACTS_MODEL } from "../lib/classifierFactsPrototype";
import {
  buildV41ExtractionRequests,
  CLASSIFIER_FACTS_V41_DRY_SCHEMA,
  CLASSIFIER_FACTS_V41_SCHEMA,
  formatV41Markdown,
  scoreV41Prototype,
  v41RequestHash,
  v41SchemaHash,
  validateV41ExtractionResponse,
  type V41ExtractionOutcome,
  type V41ReplayExchange,
  type V41Request,
  type V41Result,
} from "../lib/classifierFactsPrototypeV41";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";

const FIXTURES = "eval-fixtures/classifier-capability/fixtures.v2.json";
const DRY = "eval-results/classifier-facts-prototype/v4-1-namefix/dry-run.json";
const RESULT = "eval-results/classifier-facts-prototype/v4-1-namefix/results.json";
const REPORT = "eval-results/classifier-facts-prototype/v4-1-namefix/results.md";
const REPLAY_RESULT = "eval-results/classifier-facts-prototype/v4-1-namefix-replay/results.json";
const REPLAY_REPORT = "eval-results/classifier-facts-prototype/v4-1-namefix-replay/results.md";
const CONFIRMATION = "CLASSIFIER_FACTS_PROTOTYPE_V4_1";

type Mode = "dry" | "run" | "report" | "replay";

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseArgs(argv: string[]) {
  const first = argv[0];
  const mode: Mode = first === "dry" || first === "run" || first === "report" || first === "replay" ? first : "dry";
  const values = new Map<string, string>();
  for (let index = mode === first ? 1 : 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("Invalid V4.1 arguments.");
    values.set(argv[index], argv[index + 1]);
  }
  return {
    mode,
    fixtures: resolve(values.get("--fixtures") ?? FIXTURES),
    input: resolve(values.get("--input") ?? RESULT),
    output: resolve(values.get("--output") ?? (mode === "dry" ? DRY : mode === "report" ? REPORT : mode === "replay" ? REPLAY_RESULT : RESULT)),
    report: resolve(values.get("--report-output") ?? (mode === "replay" ? REPLAY_REPORT : REPORT)),
    confirmation: values.get("--confirm-paid") ?? "",
  };
}

async function loadFixtures(path: string) {
  return validateClassifierCapabilityFixtures(JSON.parse(await readFile(path, "utf8")));
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function transportFields(parsed: unknown) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { content: null, finishReason: null, requestId: null };
  const requestId = typeof (parsed as { id?: unknown }).id === "string" ? (parsed as { id: string }).id : null;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return { content: null, finishReason: null, requestId };
  const finishReason = typeof (choices[0] as { finish_reason?: unknown }).finish_reason === "string"
    ? (choices[0] as { finish_reason: string }).finish_reason : null;
  const message = (choices[0] as { message?: unknown }).message;
  const content = message && typeof message === "object" && !Array.isArray(message)
    && typeof (message as { content?: unknown }).content === "string" ? (message as { content: string }).content : null;
  return { content, finishReason, requestId };
}

function replayExchange(
  request: V41Request,
  rawHttp: string | null,
  parsedTransport: unknown | null,
  content: string | null,
  parsedOutput: unknown | null,
): V41ReplayExchange {
  const fields = transportFields(parsedTransport);
  return {
    raw_http_response_body: rawHttp,
    parsed_transport_json: parsedTransport,
    raw_assistant_content: content,
    parsed_structured_output: parsedOutput,
    finish_reason: fields.finishReason,
    provider_request_id: fields.requestId,
    request_hash: v41RequestHash(request),
    response_hash: rawHttp === null ? null : sha256(rawHttp),
  };
}

function failedOutcome(
  request: V41Request,
  outcome: V41ExtractionOutcome["outcome"],
  error: string,
  exchange: V41ReplayExchange,
): V41ExtractionOutcome {
  return {
    requirement_id: request.requirement_id, outcome,
    raw_provider_exchange: exchange.parsed_transport_json ?? exchange.raw_http_response_body,
    raw_model_content: exchange.raw_assistant_content,
    facts: [], rejected_facts: [], facts_returned: 0,
    validation_errors: [error], selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    unit_results: [], units_supplied: request.candidates.reduce((sum, candidate) => sum + candidate.units.length, 0),
    units_returned: 0, units_missing: request.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id)),
    units_duplicated: [], request_sha256: exchange.request_hash, response_sha256: exchange.response_hash,
    raw_provider_exchange_id: exchange.provider_request_id,
    replay_exchange: exchange,
  };
}

export function processV41Exchange(request: V41Request, rawHttp: string, parsedTransport: unknown): V41ExtractionOutcome {
  const fields = transportFields(parsedTransport);
  if (!fields.content) {
    const exchange = replayExchange(request, rawHttp, parsedTransport, null, null);
    return failedOutcome(request, "transport_error", "Provider response lacks assistant content.", exchange);
  }
  let parsedOutput: unknown;
  try {
    parsedOutput = JSON.parse(fields.content);
  } catch (error) {
    const exchange = replayExchange(request, rawHttp, parsedTransport, fields.content, null);
    return failedOutcome(request, "malformed_model_json", error instanceof Error ? error.message : String(error), exchange);
  }
  const exchange = replayExchange(request, rawHttp, parsedTransport, fields.content, parsedOutput);
  try {
    const validated = validateV41ExtractionResponse(request, parsedOutput);
    return {
      requirement_id: request.requirement_id, outcome: "model_success",
      raw_provider_exchange: parsedTransport, raw_model_content: fields.content,
      facts: validated.facts,
      rejected_facts: validated.rejectedFacts.map((fact) => ({
        ...fact,
        raw_provider_response_linkage: {
          ...fact.raw_provider_response_linkage,
          provider_exchange_id: exchange.provider_request_id,
          raw_model_content_sha256: sha256(fields.content!),
        },
      })),
      facts_returned: validated.factsReturned, validation_errors: [],
      selected_unit_reference_count: validated.selectedUnitReferenceCount,
      invalid_unit_reference_count: validated.invalidUnitReferenceCount,
      unit_results: validated.unitResults, units_supplied: validated.unitsSupplied, units_returned: validated.unitsReturned,
      units_missing: validated.unitsMissing, units_duplicated: validated.unitsDuplicated,
      request_sha256: exchange.request_hash, response_sha256: exchange.response_hash,
      raw_provider_exchange_id: exchange.provider_request_id, replay_exchange: exchange,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failedOutcome(request, message.startsWith("Request source isolation failure:") ? "source_isolation_error" : "top_level_schema_error", message, exchange);
  }
}

async function runDry(fixturesPath: string, output: string) {
  const fixtures = await loadFixtures(fixturesPath);
  const requests = buildV41ExtractionRequests(fixtures);
  const summaries = requests.map((request) => {
    const schema = request.body.response_format.json_schema.schema as { properties: { units: { required: string[] } } };
    const oldSchemaName = `unit_accountable_operational_facts_v4_1_${request.requirement_id}`;
    const newSchemaName = request.body.response_format.json_schema.name;
    return {
      requirement_id: request.requirement_id,
      old_schema_name: oldSchemaName,
      old_schema_name_length: oldSchemaName.length,
      new_schema_name: newSchemaName,
      new_schema_name_length: newSchemaName.length,
      required_unit_property_count: schema.properties.units.required.length,
      required_unit_ids: [...schema.properties.units.required].sort(),
      response_schema_sha256: v41SchemaHash(request),
      prompt_sha256: sha256(JSON.stringify(request.body.messages)),
      request_sha256: v41RequestHash(request),
      model: request.model,
      network_calls: 0,
      request_body: request.body,
      candidates: request.candidates,
    };
  });
  await writeJson(output, {
    schema_version: CLASSIFIER_FACTS_V41_DRY_SCHEMA,
    generated_at: new Date().toISOString(), fixture_suite_hash: fixtures.suite_hash,
    model: CLASSIFIER_FACTS_MODEL, network_calls: 0, request_count: requests.length,
    total_required_unit_properties: summaries.reduce((sum, item) => sum + item.required_unit_property_count, 0),
    request_plan_sha256: sha256(JSON.stringify(requests.map((request) => request.body))), requests: summaries,
  });
  console.log(`Serialized ${requests.length} V4.1 exact-unit requests with zero network calls.`);
  for (const item of summaries) console.log(`${item.requirement_id}: ${item.old_schema_name} (${item.old_schema_name_length}) -> ${item.new_schema_name} (${item.new_schema_name_length}), request ${item.request_sha256}`);
  console.log(`Dry artifact: ${output}`);
}

function paidKey(confirmation: string) {
  const blockers: string[] = [];
  if (confirmation !== CONFIRMATION) blockers.push(`--confirm-paid ${CONFIRMATION} is required`);
  if (process.env.CLASSIFIER_FACTS_PROTOTYPE_V4_1_ENABLED?.toLowerCase() !== "true") blockers.push("CLASSIFIER_FACTS_PROTOTYPE_V4_1_ENABLED=true is required");
  if (process.env.ENABLE_EXTERNAL_AI_PROCESSING?.toLowerCase() !== "true" || process.env.ENABLE_EXTERNAL_AI_CLASSIFIER?.toLowerCase() !== "true") blockers.push("external-AI flags are required");
  const key = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) blockers.push("an API key is required");
  if (blockers.length) throw new Error(`Paid V4.1 is blocked:\n- ${blockers.join("\n- ")}`);
  return key!;
}

async function execute(request: V41Request, key: string) {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    const exchange = replayExchange(request, null, null, null, null);
    return failedOutcome(request, "transport_error", String(error), exchange);
  }
  const rawHttp = await response.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(rawHttp); } catch { /* Persist raw body. */ }
  if (!response.ok) {
    const exchange = replayExchange(request, rawHttp, parsed, null, null);
    return failedOutcome(request, "provider_error", `HTTP ${response.status}`, exchange);
  }
  return processV41Exchange(request, rawHttp, parsed);
}

async function runPaid(fixturesPath: string, output: string, report: string, confirmation: string) {
  const fixtures = await loadFixtures(fixturesPath), requests = buildV41ExtractionRequests(fixtures), key = paidKey(confirmation);
  const outcomes: V41ExtractionOutcome[] = [];
  for (const request of requests) outcomes.push(await execute(request, key));
  const result = scoreV41Prototype(fixtures, requests, outcomes);
  await writeJson(output, result); await mkdir(dirname(report), { recursive: true }); await writeFile(report, formatV41Markdown(result), "utf8");
  if (!result.valid) process.exitCode = 1;
}

function assertResult(value: unknown): asserts value is V41Result {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored V4.1 result must be an object.");
  const result = value as Partial<V41Result>;
  if (result.schema_version !== CLASSIFIER_FACTS_V41_SCHEMA || result.model !== CLASSIFIER_FACTS_MODEL || !Array.isArray(result.extraction_outcomes)) throw new Error("Stored V4.1 identity is invalid.");
}

async function replay(fixturesPath: string, input: string, output: string, report: string) {
  if (input === output) throw new Error("Replay cannot overwrite its source.");
  const source = await readFile(input, "utf8"), sourceHash = sha256(source), stored: unknown = JSON.parse(source); assertResult(stored);
  const fixtures = await loadFixtures(fixturesPath), requests = buildV41ExtractionRequests(fixtures), requestById = new Map(requests.map((request) => [request.requirement_id, request]));
  const outcomes = stored.extraction_outcomes.map((outcome) => {
    const request = requestById.get(outcome.requirement_id); if (!request) throw new Error(`Unknown requirement ${outcome.requirement_id}.`);
    if (outcome.replay_exchange.request_hash !== v41RequestHash(request)) throw new Error(`Request hash mismatch for ${outcome.requirement_id}.`);
    const raw = outcome.replay_exchange.raw_http_response_body;
    if (typeof raw !== "string" || sha256(raw) !== outcome.replay_exchange.response_hash) throw new Error(`Response hash mismatch for ${outcome.requirement_id}.`);
    return processV41Exchange(request, raw, outcome.replay_exchange.parsed_transport_json);
  });
  const result = scoreV41Prototype(fixtures, requests, outcomes, stored.generated_at);
  await writeJson(output, { ...result, replay: { source_path: input, source_sha256: sourceHash, network_calls: 0 } });
  await mkdir(dirname(report), { recursive: true }); await writeFile(report, formatV41Markdown(result), "utf8");
  if (sha256(await readFile(input, "utf8")) !== sourceHash) throw new Error("Replay source changed.");
}

async function report(input: string, output: string) {
  const stored: unknown = JSON.parse(await readFile(input, "utf8")); assertResult(stored);
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, formatV41Markdown(stored), "utf8");
}

const args = parseArgs(process.argv.slice(2));
if (args.mode === "dry") await runDry(args.fixtures, args.output);
else if (args.mode === "run") await runPaid(args.fixtures, args.output, args.report, args.confirmation);
else if (args.mode === "report") await report(args.input, args.output);
else await replay(args.fixtures, args.input, args.output, args.report);
