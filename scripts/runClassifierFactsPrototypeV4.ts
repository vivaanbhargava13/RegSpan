import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CLASSIFIER_FACTS_MODEL } from "../lib/classifierFactsPrototype";
import {
  buildV4ExtractionRequests,
  CLASSIFIER_FACTS_V4_DRY_SCHEMA,
  CLASSIFIER_FACTS_V4_SCHEMA,
  formatV4Markdown,
  scoreV4Prototype,
  v4RequestHash,
  validateV4ExtractionResponse,
  type V4ExtractionOutcome,
  type V4Request,
  type V4Result,
} from "../lib/classifierFactsPrototypeV4";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";

const DEFAULT_FIXTURES = "eval-fixtures/classifier-capability/fixtures.v2.json";
const DEFAULT_DRY = "eval-results/classifier-facts-prototype/v4/dry-run.json";
const DEFAULT_RESULT = "eval-results/classifier-facts-prototype/v4/results.json";
const DEFAULT_REPORT = "eval-results/classifier-facts-prototype/v4/results.md";
const DEFAULT_REPLAY_RESULT = "eval-results/classifier-facts-prototype/v4-replay/results.json";
const DEFAULT_REPLAY_REPORT = "eval-results/classifier-facts-prototype/v4-replay/results.md";
const PAID_CONFIRMATION = "CLASSIFIER_FACTS_PROTOTYPE_V4";

type Mode = "dry" | "run" | "report" | "replay";

function parseArgs(argv: string[]) {
  const first = argv[0];
  const mode: Mode = first === "dry" || first === "run" || first === "report" || first === "replay" ? first : "dry";
  const values = new Map<string, string>();
  for (let index = mode === first ? 1 : 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Invalid V4 command arguments.");
    values.set(key, value);
  }
  return {
    mode,
    fixturePath: resolve(values.get("--fixtures") ?? DEFAULT_FIXTURES),
    inputPath: resolve(values.get("--input") ?? DEFAULT_RESULT),
    outputPath: resolve(values.get("--output") ?? (mode === "dry" ? DEFAULT_DRY : mode === "report" ? DEFAULT_REPORT : mode === "replay" ? DEFAULT_REPLAY_RESULT : DEFAULT_RESULT)),
    reportPath: resolve(values.get("--report-output") ?? (mode === "replay" ? DEFAULT_REPLAY_REPORT : DEFAULT_REPORT)),
    confirmation: values.get("--confirm-paid") ?? "",
  };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadFixtures(path: string) {
  return validateClassifierCapabilityFixtures(JSON.parse(await readFile(path, "utf8")));
}

function exchangeId(exchange: unknown) {
  if (!exchange || typeof exchange !== "object" || Array.isArray(exchange)) return null;
  return typeof (exchange as { id?: unknown }).id === "string" ? (exchange as { id: string }).id : null;
}

function contentFromExchange(exchange: unknown) {
  if (!exchange || typeof exchange !== "object" || Array.isArray(exchange)) return null;
  const choices = (exchange as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  return typeof (message as { content?: unknown }).content === "string" ? (message as { content: string }).content : null;
}

function emptyOutcome(request: V4Request, outcome: V4ExtractionOutcome["outcome"], exchange: unknown, content: string | null, error: string): V4ExtractionOutcome {
  return {
    requirement_id: request.requirement_id,
    outcome,
    raw_provider_exchange: exchange,
    raw_model_content: content,
    facts: [], rejected_facts: [], facts_returned: 0,
    validation_errors: [error], selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    unit_results: [],
    units_supplied: request.candidates.reduce((sum, candidate) => sum + candidate.units.length, 0),
    units_returned: 0,
    units_missing: request.candidates.flatMap((candidate) => candidate.units.map((unit) => unit.unit_id)),
    units_duplicated: [],
    request_sha256: v4RequestHash(request),
    response_sha256: content === null ? null : sha256(content),
    raw_provider_exchange_id: exchangeId(exchange),
  };
}

export function processV4StoredContent(request: V4Request, exchange: unknown, content: string): V4ExtractionOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return emptyOutcome(request, "malformed_model_json", exchange, content, error instanceof Error ? error.message : String(error));
  }
  try {
    const validated = validateV4ExtractionResponse(request, parsed);
    const responseHash = sha256(content);
    return {
      requirement_id: request.requirement_id,
      outcome: "model_success",
      raw_provider_exchange: exchange,
      raw_model_content: content,
      facts: validated.facts,
      rejected_facts: validated.rejectedFacts.map((fact) => ({
        ...fact,
        raw_provider_response_linkage: {
          ...fact.raw_provider_response_linkage,
          provider_exchange_id: exchangeId(exchange),
          raw_model_content_sha256: responseHash,
        },
      })),
      facts_returned: validated.factsReturned,
      validation_errors: [],
      selected_unit_reference_count: validated.selectedUnitReferenceCount,
      invalid_unit_reference_count: validated.invalidUnitReferenceCount,
      unit_results: validated.unitResults,
      units_supplied: validated.unitsSupplied,
      units_returned: validated.unitsReturned,
      units_missing: validated.unitsMissing,
      units_duplicated: validated.unitsDuplicated,
      request_sha256: v4RequestHash(request),
      response_sha256: responseHash,
      raw_provider_exchange_id: exchangeId(exchange),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = message.startsWith("Request source isolation failure:")
      ? "source_isolation_error"
      : message.startsWith("Request replay corruption:") ? "replay_corruption" : "top_level_schema_error";
    return emptyOutcome(request, outcome, exchange, content, message);
  }
}

async function runDry(fixturePath: string, outputPath: string) {
  const fixtures = await loadFixtures(fixturePath);
  const requests = buildV4ExtractionRequests(fixtures);
  const hashes = requests.map(v4RequestHash);
  await writeJson(outputPath, {
    schema_version: CLASSIFIER_FACTS_V4_DRY_SCHEMA,
    generated_at: new Date().toISOString(),
    fixture_suite_hash: fixtures.suite_hash,
    model: CLASSIFIER_FACTS_MODEL,
    network_calls: 0,
    request_count: requests.length,
    scored_case_count: fixtures.cases.filter((item) => item.evaluation_role === "scored").length,
    unit_count: requests.reduce((sum, request) => sum + request.candidates.reduce((subtotal, candidate) => subtotal + candidate.units.length, 0), 0),
    request_plan_sha256: sha256(JSON.stringify(requests.map((request) => request.body))),
    request_hashes: hashes,
    requests: requests.map((request) => ({
      requirement_id: request.requirement_id,
      request_sha256: v4RequestHash(request),
      candidates: request.candidates,
      request_body: request.body,
    })),
  });
  console.log(`Serialized ${requests.length} V4 unit-accountable requests with zero network calls.`);
  console.log(`Request hashes: ${hashes.join(", ")}`);
  console.log(`Dry-run artifact: ${outputPath}`);
}

function assertPaidConfiguration(confirmation: string) {
  const blockers: string[] = [];
  if (confirmation !== PAID_CONFIRMATION) blockers.push(`--confirm-paid ${PAID_CONFIRMATION} is required`);
  if (process.env.CLASSIFIER_FACTS_PROTOTYPE_V4_ENABLED?.trim().toLowerCase() !== "true") blockers.push("CLASSIFIER_FACTS_PROTOTYPE_V4_ENABLED=true is required");
  if (process.env.ENABLE_EXTERNAL_AI_PROCESSING?.trim().toLowerCase() !== "true"
    || process.env.ENABLE_EXTERNAL_AI_CLASSIFIER?.trim().toLowerCase() !== "true") blockers.push("both external-AI policy flags must be true");
  const key = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) blockers.push("a classifier API key is required");
  if (blockers.length) throw new Error(`Paid V4 prototype is blocked:\n- ${blockers.join("\n- ")}`);
  return key!;
}

async function executeRequest(request: V4Request, apiKey: string) {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    return emptyOutcome(request, "transport_error", { error: String(error) }, null, String(error));
  }
  const text = await response.text();
  let exchange: unknown = text;
  try { exchange = JSON.parse(text); } catch { /* Retain raw transport. */ }
  if (!response.ok) return emptyOutcome(request, "provider_error", exchange, null, `HTTP ${response.status}`);
  const content = contentFromExchange(exchange);
  if (!content) return emptyOutcome(request, "transport_error", exchange, null, "Provider response lacks message content.");
  return processV4StoredContent(request, exchange, content);
}

async function runPaid(fixturePath: string, outputPath: string, reportPath: string, confirmation: string) {
  const fixtures = await loadFixtures(fixturePath);
  const requests = buildV4ExtractionRequests(fixtures);
  const apiKey = assertPaidConfiguration(confirmation);
  const outcomes: V4ExtractionOutcome[] = [];
  for (const request of requests) outcomes.push(await executeRequest(request, apiKey));
  const result = scoreV4Prototype(fixtures, requests, outcomes);
  await writeJson(outputPath, result);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, formatV4Markdown(result), "utf8");
  console.log(`V4 result: ${outputPath}`);
  console.log(`V4 report: ${reportPath}`);
  if (!result.valid) process.exitCode = 1;
}

function assertStoredResult(value: unknown): asserts value is V4Result {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored V4 result must be an object.");
  const result = value as Partial<V4Result>;
  if (result.schema_version !== CLASSIFIER_FACTS_V4_SCHEMA || result.model !== CLASSIFIER_FACTS_MODEL
    || !Array.isArray(result.extraction_outcomes)) throw new Error("Stored V4 result identity is invalid.");
}

async function replay(fixturePath: string, inputPath: string, outputPath: string, reportPath: string) {
  if (inputPath === outputPath) throw new Error("V4 replay cannot overwrite its source.");
  const original = await readFile(inputPath, "utf8");
  const originalHash = sha256(original);
  const stored: unknown = JSON.parse(original);
  assertStoredResult(stored);
  const fixtures = await loadFixtures(fixturePath);
  if (stored.fixture_suite_hash !== fixtures.suite_hash) throw new Error("Stored V4 fixture hash mismatch.");
  const requests = buildV4ExtractionRequests(fixtures);
  const requestById = new Map(requests.map((request) => [request.requirement_id, request]));
  const outcomes = stored.extraction_outcomes.map((outcome) => {
    const request = requestById.get(outcome.requirement_id);
    if (!request) throw new Error(`Unknown stored V4 requirement ${outcome.requirement_id}.`);
    if (outcome.request_sha256 !== v4RequestHash(request)) throw new Error(`V4 request integrity mismatch for ${outcome.requirement_id}.`);
    if (outcome.outcome !== "model_success") return emptyOutcome(request, outcome.outcome, outcome.raw_provider_exchange, outcome.raw_model_content, outcome.validation_errors.join("; "));
    if (typeof outcome.raw_model_content !== "string" || contentFromExchange(outcome.raw_provider_exchange) !== outcome.raw_model_content) {
      throw new Error(`V4 replay integrity failure for ${outcome.requirement_id}.`);
    }
    return processV4StoredContent(request, outcome.raw_provider_exchange, outcome.raw_model_content);
  });
  const result = scoreV4Prototype(fixtures, requests, outcomes, stored.generated_at);
  await writeJson(outputPath, { ...result, replay: { source_path: inputPath, source_sha256: originalHash, network_calls: 0 } });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, formatV4Markdown(result), "utf8");
  if (sha256(await readFile(inputPath, "utf8")) !== originalHash) throw new Error("V4 replay source changed.");
  console.log(`Replayed ${outcomes.length} V4 responses with zero network calls.`);
}

async function report(inputPath: string, outputPath: string) {
  const stored: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  assertStoredResult(stored);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatV4Markdown(stored), "utf8");
  console.log(`V4 report: ${outputPath}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.mode === "dry") await runDry(args.fixturePath, args.outputPath);
else if (args.mode === "run") await runPaid(args.fixturePath, args.outputPath, args.reportPath, args.confirmation);
else if (args.mode === "report") await report(args.inputPath, args.outputPath);
else await replay(args.fixturePath, args.inputPath, args.outputPath, args.reportPath);
