import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { CLASSIFIER_FACTS_MODEL } from "../lib/classifierFactsPrototype";
import {
  buildV3ExtractionRequests,
  CLASSIFIER_FACTS_V3_DRY_SCHEMA,
  CLASSIFIER_FACTS_V3_SCHEMA,
  formatV3Markdown,
  scoreV3Prototype,
  validateV3ExtractionResponse,
  type V3ExtractionOutcome,
  type V3Request,
  type V3Result,
} from "../lib/classifierFactsPrototypeV3";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";

const DEFAULT_FIXTURES = "eval-fixtures/classifier-capability/fixtures.v2.json";
const DEFAULT_DRY_OUTPUT = "eval-results/classifier-facts-prototype/v3/dry-run.json";
const DEFAULT_RESULT_OUTPUT = "eval-results/classifier-facts-prototype/v3/results.json";
const DEFAULT_REPORT_OUTPUT = "eval-results/classifier-facts-prototype/v3/results.md";
const DEFAULT_REPLAY_INPUT = "eval-results/classifier-facts-prototype/v3/results.json";
const DEFAULT_REPLAY_OUTPUT = "eval-results/classifier-facts-prototype/v3-replay/results.json";
const DEFAULT_REPLAY_REPORT = "eval-results/classifier-facts-prototype/v3-replay/results.md";
const PAID_CONFIRMATION = "CLASSIFIER_FACTS_PROTOTYPE_V3";

type Mode = "dry" | "run" | "report" | "replay";

function parseArgs(argv: string[]) {
  const first = argv[0];
  const mode: Mode = first === "dry" || first === "run" || first === "report" || first === "replay" ? first : "dry";
  const values = new Map<string, string>();
  for (let index = mode === first ? 1 : 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Invalid V3 command arguments.");
    values.set(key, value);
  }
  return {
    mode,
    fixturePath: resolve(values.get("--fixtures") ?? DEFAULT_FIXTURES),
    inputPath: resolve(values.get("--input") ?? DEFAULT_REPLAY_INPUT),
    outputPath: resolve(values.get("--output") ?? (mode === "dry" ? DEFAULT_DRY_OUTPUT : mode === "report" ? DEFAULT_REPORT_OUTPUT : mode === "replay" ? DEFAULT_REPLAY_OUTPUT : DEFAULT_RESULT_OUTPUT)),
    reportOutputPath: resolve(values.get("--report-output") ?? (mode === "replay" ? DEFAULT_REPLAY_REPORT : DEFAULT_REPORT_OUTPUT)),
    confirmPaid: values.get("--confirm-paid") ?? "",
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

function requestSummary(request: V3Request) {
  return {
    requirement_id: request.requirement_id,
    request_sha256: sha256(JSON.stringify(request.body)),
    candidate_count: request.candidates.length,
    unit_count: request.candidates.reduce((sum, candidate) => sum + candidate.units.length, 0),
    candidates: request.candidates,
    request_body: request.body,
  };
}

async function runDry(fixturePath: string, outputPath: string) {
  const fixtures = await loadFixtures(fixturePath);
  const requests = buildV3ExtractionRequests(fixtures);
  const requestHashes = requests.map((request) => sha256(JSON.stringify(request.body)));
  await writeJson(outputPath, {
    schema_version: CLASSIFIER_FACTS_V3_DRY_SCHEMA,
    generated_at: new Date().toISOString(),
    fixture_suite_hash: fixtures.suite_hash,
    model: CLASSIFIER_FACTS_MODEL,
    network_calls: 0,
    request_count: requests.length,
    scored_case_count: fixtures.cases.filter((item) => item.evaluation_role === "scored").length,
    request_plan_sha256: sha256(JSON.stringify(requests.map((request) => request.body))),
    request_hashes: requestHashes,
    requests: requests.map(requestSummary),
  });
  console.log(`Serialized ${requests.length} V3 requirement requests with zero network calls.`);
  console.log(`Request hashes: ${requestHashes.join(", ")}`);
  console.log(`Dry-run artifact: ${outputPath}`);
}

function assertPaidConfiguration(confirmPaid: string) {
  const blockers: string[] = [];
  if (confirmPaid !== PAID_CONFIRMATION) blockers.push(`--confirm-paid ${PAID_CONFIRMATION} is required`);
  if (process.env.CLASSIFIER_FACTS_PROTOTYPE_V3_ENABLED?.trim().toLowerCase() !== "true") {
    blockers.push("CLASSIFIER_FACTS_PROTOTYPE_V3_ENABLED=true is required");
  }
  if (process.env.ENABLE_EXTERNAL_AI_PROCESSING?.trim().toLowerCase() !== "true"
    || process.env.ENABLE_EXTERNAL_AI_CLASSIFIER?.trim().toLowerCase() !== "true") {
    blockers.push("both external-AI policy flags must be true");
  }
  const apiKey = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) blockers.push("a classifier API key is required");
  if (blockers.length) throw new Error(`Paid V3 prototype is blocked:\n- ${blockers.join("\n- ")}`);
  return apiKey!;
}

function contentFromExchange(exchange: unknown) {
  if (!exchange || typeof exchange !== "object" || Array.isArray(exchange)) return null;
  const choices = (exchange as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function exchangeId(exchange: unknown) {
  if (!exchange || typeof exchange !== "object" || Array.isArray(exchange)) return null;
  return typeof (exchange as { id?: unknown }).id === "string" ? (exchange as { id: string }).id : null;
}

export function processV3StoredContent(request: V3Request, exchange: unknown, content: string): V3ExtractionOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return {
      requirement_id: request.requirement_id, outcome: "malformed_model_json", raw_provider_exchange: exchange,
      raw_model_content: content, facts: [], rejected_facts: [], facts_returned: 0,
      validation_errors: [error instanceof Error ? error.message : String(error)],
      selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    };
  }
  try {
    const validated = validateV3ExtractionResponse(request, parsed);
    const contentHash = sha256(content);
    return {
      requirement_id: request.requirement_id, outcome: "model_success", raw_provider_exchange: exchange,
      raw_model_content: content, facts: validated.facts,
      rejected_facts: validated.rejectedFacts.map((fact) => ({
        ...fact,
        raw_provider_response_linkage: {
          ...fact.raw_provider_response_linkage,
          provider_exchange_id: exchangeId(exchange),
          raw_model_content_sha256: contentHash,
        },
      })),
      facts_returned: validated.factsReturned, validation_errors: [],
      selected_unit_reference_count: validated.selectedUnitReferenceCount,
      invalid_unit_reference_count: validated.invalidUnitReferenceCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      requirement_id: request.requirement_id,
      outcome: message.startsWith("Request source isolation failure:") ? "source_isolation_error"
        : message.startsWith("Request replay corruption:") ? "replay_corruption" : "top_level_schema_error",
      raw_provider_exchange: exchange, raw_model_content: content, facts: [], rejected_facts: [], facts_returned: 0,
      validation_errors: [message], selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    };
  }
}

async function executeRequest(request: V3Request, apiKey: string): Promise<V3ExtractionOutcome> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    return {
      requirement_id: request.requirement_id, outcome: "transport_error",
      raw_provider_exchange: { error: error instanceof Error ? error.message : String(error) }, raw_model_content: null,
      facts: [], rejected_facts: [], facts_returned: 0,
      validation_errors: [error instanceof Error ? error.message : String(error)], selected_unit_reference_count: 0,
      invalid_unit_reference_count: 0,
    };
  }
  const transport = await response.text();
  let exchange: unknown = transport;
  try { exchange = JSON.parse(transport); } catch { /* Preserve malformed transport. */ }
  if (!response.ok) return {
    requirement_id: request.requirement_id, outcome: "provider_error", raw_provider_exchange: exchange,
    raw_model_content: null, facts: [], rejected_facts: [], facts_returned: 0,
    validation_errors: [`HTTP ${response.status}`], selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
  };
  const content = contentFromExchange(exchange);
  if (!content) return {
    requirement_id: request.requirement_id, outcome: "transport_error", raw_provider_exchange: exchange,
    raw_model_content: null, facts: [], rejected_facts: [], facts_returned: 0,
    validation_errors: ["Provider response lacks message content."], selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
  };
  return processV3StoredContent(request, exchange, content);
}

async function runPaid(fixturePath: string, outputPath: string, reportPath: string, confirmation: string) {
  const fixtures = await loadFixtures(fixturePath);
  const requests = buildV3ExtractionRequests(fixtures);
  const apiKey = assertPaidConfiguration(confirmation);
  const outcomes: V3ExtractionOutcome[] = [];
  for (const request of requests) outcomes.push(await executeRequest(request, apiKey));
  const result = scoreV3Prototype(fixtures, requests, outcomes);
  await writeJson(outputPath, result);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, formatV3Markdown(result), "utf8");
  console.log(`V3 result: ${outputPath}`);
  console.log(`V3 report: ${reportPath}`);
  if (!result.valid) process.exitCode = 1;
}

function assertStoredResult(value: unknown): asserts value is V3Result {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored V3 result must be an object.");
  const result = value as Partial<V3Result>;
  if (result.schema_version !== CLASSIFIER_FACTS_V3_SCHEMA) throw new Error("Stored result is not V3.");
  if (result.model !== CLASSIFIER_FACTS_MODEL || !Array.isArray(result.extraction_outcomes)) throw new Error("Stored V3 identity is invalid.");
}

async function replay(fixturePath: string, inputPath: string, outputPath: string, reportPath: string) {
  if (inputPath === outputPath) throw new Error("V3 replay may not overwrite its input.");
  const original = await readFile(inputPath, "utf8");
  const originalHash = sha256(original);
  const stored: unknown = JSON.parse(original);
  assertStoredResult(stored);
  const fixtures = await loadFixtures(fixturePath);
  if (stored.fixture_suite_hash !== fixtures.suite_hash) throw new Error("Stored V3 fixture hash mismatch.");
  const requests = buildV3ExtractionRequests(fixtures);
  const requestByRequirement = new Map(requests.map((request) => [request.requirement_id, request]));
  const outcomes = stored.extraction_outcomes.map((outcome) => {
    const request = requestByRequirement.get(outcome.requirement_id);
    if (!request) throw new Error(`Stored V3 requirement ${outcome.requirement_id} is unknown.`);
    if (outcome.outcome !== "model_success") return { ...outcome, facts: [], rejected_facts: [] };
    if (typeof outcome.raw_model_content !== "string") throw new Error(`Stored V3 response ${outcome.requirement_id} has no replayable content.`);
    if (contentFromExchange(outcome.raw_provider_exchange) !== outcome.raw_model_content) {
      throw new Error(`Stored V3 raw exchange linkage mismatch for ${outcome.requirement_id}.`);
    }
    return processV3StoredContent(request, outcome.raw_provider_exchange, outcome.raw_model_content);
  });
  const result = scoreV3Prototype(fixtures, requests, outcomes, stored.generated_at);
  await writeJson(outputPath, {
    ...result,
    replay: { source_path: inputPath, source_sha256: originalHash, network_calls: 0, original_artifact_unchanged: true },
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, formatV3Markdown(result), "utf8");
  if (sha256(await readFile(inputPath, "utf8")) !== originalHash) throw new Error("V3 replay input changed.");
  console.log(`Replayed ${outcomes.length} V3 responses with zero network calls.`);
}

async function report(fixturePath: string, inputPath: string, outputPath: string) {
  const fixtures = await loadFixtures(fixturePath);
  const stored: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  assertStoredResult(stored);
  if (stored.fixture_suite_hash !== fixtures.suite_hash) throw new Error("Stored V3 fixture hash mismatch.");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatV3Markdown(stored), "utf8");
  console.log(`V3 Markdown report: ${outputPath}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.mode === "dry") await runDry(args.fixturePath, args.outputPath);
else if (args.mode === "run") await runPaid(args.fixturePath, args.outputPath, args.reportOutputPath, args.confirmPaid);
else if (args.mode === "report") await report(args.fixturePath, args.inputPath, args.outputPath);
else await replay(args.fixturePath, args.inputPath, args.outputPath, args.reportOutputPath);
