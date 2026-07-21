import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildFactsExtractionRequests,
  CLASSIFIER_FACTS_DRY_SCHEMA,
  CLASSIFIER_FACTS_MODEL,
  CLASSIFIER_FACTS_PROTOTYPE_SCHEMA,
  formatFactsPrototypeMarkdown,
  scoreFactsPrototype,
  validateFactsExtractionResponse,
  type ExtractionOutcome,
  type FactsExtractionRequest,
  type PrototypeResult,
} from "../lib/classifierFactsPrototype";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";

const DEFAULT_FIXTURES = "eval-fixtures/classifier-capability/fixtures.v2.json";
const DEFAULT_DRY_OUTPUT = "eval-results/classifier-facts-prototype/v2/dry-run.json";
const DEFAULT_RESULT_OUTPUT = "eval-results/classifier-facts-prototype/v2/results.json";
const DEFAULT_REPORT_OUTPUT = "eval-results/classifier-facts-prototype/v2/results.md";
const DEFAULT_REPLAY_INPUT = "eval-results/classifier-facts-prototype/v2/results.json";
const DEFAULT_REPLAY_OUTPUT = "eval-results/classifier-facts-prototype/v2-replay/results.json";
const DEFAULT_REPLAY_REPORT_OUTPUT = "eval-results/classifier-facts-prototype/v2-replay/results.md";
const V2_PAID_BASELINE = "eval-fixtures/classifier-facts-prototype/v2-paid-baseline.json";
const PAID_CONFIRMATION = "CLASSIFIER_FACTS_PROTOTYPE_V2";

type Mode = "dry" | "run" | "report" | "replay";

function usage() {
  return [
    "Usage:",
    "  npm run eval:classifier-facts:dry -- [--fixtures <path>] [--output <path>]",
    `  npm run eval:classifier-facts -- --confirm-paid ${PAID_CONFIRMATION} [--output <path>] [--report-output <path>]`,
    "  npm run eval:classifier-facts:report -- [--input <path>] [--output <path>]",
    "  npm run eval:classifier-facts:v2:replay -- [--input <paid-results.json>] [--output <replay-results.json>] [--report-output <replay.md>]",
  ].join("\n");
}

function parseArgs(argv: string[]) {
  const first = argv[0];
  const mode: Mode = first === "dry" || first === "run" || first === "report" || first === "replay" ? first : "dry";
  const values = new Map<string, string>();
  for (let index = mode === first ? 1 : 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(usage());
    values.set(key, value);
  }
  return {
    mode,
    fixturePath: resolve(values.get("--fixtures") ?? DEFAULT_FIXTURES),
    outputPath: resolve(values.get("--output") ?? (mode === "dry" ? DEFAULT_DRY_OUTPUT : mode === "report" ? DEFAULT_REPORT_OUTPUT : mode === "replay" ? DEFAULT_REPLAY_OUTPUT : DEFAULT_RESULT_OUTPUT)),
    inputPath: resolve(values.get("--input") ?? (mode === "replay" ? DEFAULT_REPLAY_INPUT : DEFAULT_RESULT_OUTPUT)),
    reportOutputPath: resolve(values.get("--report-output") ?? (mode === "replay" ? DEFAULT_REPLAY_REPORT_OUTPUT : DEFAULT_REPORT_OUTPUT)),
    confirmPaid: values.get("--confirm-paid") ?? "",
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

async function loadFixtures(path: string) {
  return validateClassifierCapabilityFixtures(JSON.parse(await readFile(path, "utf8")));
}

function requestSummary(request: FactsExtractionRequest) {
  return {
    requirement_id: request.requirement_id,
    request_sha256: createHash("sha256").update(JSON.stringify(request.body), "utf8").digest("hex"),
    candidate_count: request.candidates.length,
    unit_count: request.candidates.reduce((sum, candidate) => sum + candidate.units.length, 0),
    candidates: request.candidates,
    request_body: request.body,
  };
}

async function runDry(fixturePath: string, outputPath: string) {
  const fixtures = await loadFixtures(fixturePath);
  const requests = buildFactsExtractionRequests(fixtures);
  await writeJson(outputPath, {
    schema_version: CLASSIFIER_FACTS_DRY_SCHEMA,
    generated_at: new Date().toISOString(),
    fixture_suite_hash: fixtures.suite_hash,
    model: CLASSIFIER_FACTS_MODEL,
    network_calls: 0,
    request_count: requests.length,
    scored_case_count: fixtures.cases.filter((item) => item.evaluation_role === "scored").length,
    request_plan_sha256: createHash("sha256").update(JSON.stringify(requests.map((request) => request.body)), "utf8").digest("hex"),
    requests: requests.map(requestSummary),
  });
  console.log(`Serialized ${requests.length} requirement-level requests covering 9 scored cases without network calls.`);
  console.log(`Dry-run artifact: ${outputPath}`);
}

function assertPaidConfiguration(confirmPaid: string) {
  const blockers: string[] = [];
  if (confirmPaid !== PAID_CONFIRMATION) blockers.push(`--confirm-paid ${PAID_CONFIRMATION} is required`);
  if (process.env.CLASSIFIER_FACTS_PROTOTYPE_V2_ENABLED?.trim().toLowerCase() !== "true") {
    blockers.push("CLASSIFIER_FACTS_PROTOTYPE_V2_ENABLED=true is required");
  }
  if (process.env.ENABLE_EXTERNAL_AI_PROCESSING?.trim().toLowerCase() !== "true"
    || process.env.ENABLE_EXTERNAL_AI_CLASSIFIER?.trim().toLowerCase() !== "true") {
    blockers.push("both external-AI policy flags must be true");
  }
  const apiKey = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) blockers.push("a classifier API key is required");
  if (blockers.length) throw new Error(`Paid facts prototype is blocked:\n- ${blockers.join("\n- ")}`);
  return apiKey!;
}

function contentFromProviderExchange(exchange: unknown) {
  if (!exchange || typeof exchange !== "object" || Array.isArray(exchange)) return null;
  const choices = (exchange as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function providerExchangeId(exchange: unknown) {
  if (!exchange || typeof exchange !== "object" || Array.isArray(exchange)) return null;
  const id = (exchange as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

function processStoredModelContent(
  request: FactsExtractionRequest,
  exchange: unknown,
  content: string,
): ExtractionOutcome {
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
    const validated = validateFactsExtractionResponse(request, parsed);
    const rawContentSha256 = createHash("sha256").update(content, "utf8").digest("hex");
    const rejectedFacts = validated.rejectedFacts.map((fact) => ({
      ...fact,
      raw_provider_response_linkage: {
        ...fact.raw_provider_response_linkage,
        provider_exchange_id: providerExchangeId(exchange),
        raw_model_content_sha256: rawContentSha256,
      },
    }));
    return {
      requirement_id: request.requirement_id, outcome: "model_success", raw_provider_exchange: exchange,
      raw_model_content: content, facts: validated.facts, rejected_facts: rejectedFacts,
      facts_returned: validated.factsReturned, validation_errors: [],
      selected_unit_reference_count: validated.selectedUnitReferenceCount,
      invalid_unit_reference_count: validated.invalidUnitReferenceCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const outcome = message.startsWith("Request source isolation failure:")
      ? "source_isolation_error"
      : message.startsWith("Request replay corruption:") ? "replay_corruption" : "top_level_schema_error";
    return {
      requirement_id: request.requirement_id, outcome, raw_provider_exchange: exchange,
      raw_model_content: content, facts: [], rejected_facts: [], facts_returned: 0,
      validation_errors: [message], selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    };
  }
}

async function executeRequest(request: FactsExtractionRequest, apiKey: string): Promise<ExtractionOutcome> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    return {
      requirement_id: request.requirement_id,
      outcome: "transport_error",
      raw_provider_exchange: { error: error instanceof Error ? error.message : String(error) },
      raw_model_content: null,
      facts: [], rejected_facts: [], facts_returned: 0,
      validation_errors: [error instanceof Error ? error.message : String(error)],
      selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    };
  }
  const rawText = await response.text();
  let exchange: unknown = rawText;
  try { exchange = JSON.parse(rawText); } catch { /* Preserve raw transport text. */ }
  if (!response.ok) {
    return {
      requirement_id: request.requirement_id, outcome: "provider_error", raw_provider_exchange: exchange,
      raw_model_content: null, facts: [], rejected_facts: [], facts_returned: 0, validation_errors: [`HTTP ${response.status}`],
      selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    };
  }
  const content = contentFromProviderExchange(exchange);
  if (!content) {
    return {
      requirement_id: request.requirement_id, outcome: "transport_error", raw_provider_exchange: exchange,
      raw_model_content: null, facts: [], rejected_facts: [], facts_returned: 0, validation_errors: ["Provider response did not contain message content."],
      selected_unit_reference_count: 0, invalid_unit_reference_count: 0,
    };
  }
  return processStoredModelContent(request, exchange, content);
}

async function runPaid(fixturePath: string, outputPath: string, reportOutputPath: string, confirmPaid: string) {
  const fixtures = await loadFixtures(fixturePath);
  const requests = buildFactsExtractionRequests(fixtures);
  const apiKey = assertPaidConfiguration(confirmPaid);
  const outcomes: ExtractionOutcome[] = [];
  for (const request of requests) outcomes.push(await executeRequest(request, apiKey));
  const result = scoreFactsPrototype(fixtures, outcomes);
  await writeJson(outputPath, result);
  await mkdir(dirname(reportOutputPath), { recursive: true });
  await writeFile(reportOutputPath, formatFactsPrototypeMarkdown(result), "utf8");
  console.log(`Wrote facts-only prototype result: ${outputPath}`);
  console.log(`Wrote facts-only prototype report: ${reportOutputPath}`);
  if (!result.valid) process.exitCode = 1;
}

function validateStoredResult(value: unknown): asserts value is PrototypeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Stored result must be an object.");
  const result = value as Partial<PrototypeResult>;
  if (result.schema_version !== CLASSIFIER_FACTS_PROTOTYPE_SCHEMA) throw new Error("Stored result schema is invalid.");
  if (result.model !== CLASSIFIER_FACTS_MODEL) throw new Error("Stored result model does not match the frozen prototype model.");
  if (!Array.isArray(result.extraction_outcomes)) throw new Error("Stored result extraction outcomes are missing.");
}

async function regenerateReport(fixturePath: string, inputPath: string, outputPath: string) {
  const fixtures = await loadFixtures(fixturePath);
  const stored: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  validateStoredResult(stored);
  if (stored.fixture_suite_hash !== fixtures.suite_hash) throw new Error("Stored result fixture suite hash mismatch.");
  const requestByRequirement = new Map(buildFactsExtractionRequests(fixtures).map((request) => [request.requirement_id, request]));
  const outcomes = stored.extraction_outcomes.map((outcome): ExtractionOutcome => {
    const request = requestByRequirement.get(outcome.requirement_id);
    if (!request) throw new Error(`Stored result has unknown requirement ${outcome.requirement_id}.`);
    if (outcome.outcome !== "model_success") return { ...outcome, facts: [], rejected_facts: outcome.rejected_facts ?? [], facts_returned: outcome.facts_returned ?? 0 };
    if (!outcome.raw_model_content) throw new Error(`Stored successful outcome ${outcome.requirement_id} lacks raw model content.`);
    const validated = validateFactsExtractionResponse(request, JSON.parse(outcome.raw_model_content));
    return {
      ...outcome,
      facts: validated.facts,
      rejected_facts: validated.rejectedFacts,
      facts_returned: validated.factsReturned,
      validation_errors: [],
      selected_unit_reference_count: validated.selectedUnitReferenceCount,
      invalid_unit_reference_count: validated.invalidUnitReferenceCount,
    };
  });
  const recomputed = scoreFactsPrototype(fixtures, outcomes, stored.generated_at);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatFactsPrototypeMarkdown(recomputed), "utf8");
  console.log(`Recomputed facts-only report without provider calls: ${outputPath}`);
  if (!recomputed.valid) process.exitCode = 1;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function replayPaidV2(fixturePath: string, inputPath: string, outputPath: string, reportOutputPath: string) {
  if (inputPath === outputPath) throw new Error("Replay output must not overwrite the paid input artifact.");
  const fixtures = await loadFixtures(fixturePath);
  const baseline = JSON.parse(await readFile(resolve(V2_PAID_BASELINE), "utf8")) as {
    model: string;
    fixture_suite_hash: string;
    source_result_sha256: string;
    source_dry_run_path: string;
    source_dry_run_sha256: string;
    request_plan_sha256: string;
    requests: Array<{
      requirement_id: string;
      request_sha256: string;
      raw_provider_exchange_sha256: string;
      raw_model_content_sha256: string;
    }>;
  };
  const originalBytes = await readFile(inputPath, "utf8");
  const originalSha256 = sha256(originalBytes);
  if (originalSha256 !== baseline.source_result_sha256) throw new Error("Paid v2 source artifact SHA-256 mismatch.");
  const stored: unknown = JSON.parse(originalBytes);
  validateStoredResult(stored);
  if (stored.model !== baseline.model || stored.fixture_suite_hash !== baseline.fixture_suite_hash
    || stored.fixture_suite_hash !== fixtures.suite_hash) {
    throw new Error("Paid v2 model or fixture identity mismatch.");
  }
  const paidDryBytes = await readFile(resolve(baseline.source_dry_run_path), "utf8");
  if (sha256(paidDryBytes) !== baseline.source_dry_run_sha256) throw new Error("Paid v2 dry request artifact SHA-256 mismatch.");
  const paidDry = JSON.parse(paidDryBytes) as {
    request_plan_sha256: string;
    requests: Array<{
      requirement_id: string;
      request_sha256: string;
      candidates: FactsExtractionRequest["candidates"];
      request_body: FactsExtractionRequest["body"];
    }>;
  };
  if (paidDry.request_plan_sha256 !== baseline.request_plan_sha256
    || sha256(JSON.stringify(paidDry.requests.map((request) => request.request_body))) !== baseline.request_plan_sha256) {
    throw new Error("Paid v2 frozen request plan integrity mismatch.");
  }
  const requests = buildFactsExtractionRequests(fixtures);
  const requestPlanHash = baseline.request_plan_sha256;
  const requestByRequirement = new Map(requests.map((request) => [request.requirement_id, request]));
  const storedByRequirement = new Map(stored.extraction_outcomes.map((outcome) => [outcome.requirement_id, outcome]));
  if (storedByRequirement.size !== requests.length) throw new Error("Paid v2 requirement outcome identity mismatch.");

  const outcomes: ExtractionOutcome[] = [];
  for (const requestIdentity of baseline.requests) {
    const request = requestByRequirement.get(requestIdentity.requirement_id);
    const storedOutcome = storedByRequirement.get(requestIdentity.requirement_id);
    if (!request || !storedOutcome) throw new Error(`Paid v2 requirement ${requestIdentity.requirement_id} is missing.`);
    const paidRequest = paidDry.requests.find((item) => item.requirement_id === requestIdentity.requirement_id);
    if (!paidRequest || paidRequest.request_sha256 !== requestIdentity.request_sha256
      || sha256(JSON.stringify(paidRequest.request_body)) !== requestIdentity.request_sha256) {
      throw new Error(`Paid v2 request identity mismatch for ${requestIdentity.requirement_id}.`);
    }
    if (JSON.stringify(paidRequest.candidates) !== JSON.stringify(request.candidates)) {
      throw new Error(`Paid v2 candidate or source-unit identity mismatch for ${requestIdentity.requirement_id}.`);
    }
    if (sha256(JSON.stringify(storedOutcome.raw_provider_exchange)) !== requestIdentity.raw_provider_exchange_sha256) {
      throw new Error(`Paid v2 raw provider exchange integrity mismatch for ${requestIdentity.requirement_id}.`);
    }
    if (typeof storedOutcome.raw_model_content !== "string"
      || sha256(storedOutcome.raw_model_content) !== requestIdentity.raw_model_content_sha256) {
      throw new Error(`Paid v2 raw model content integrity mismatch for ${requestIdentity.requirement_id}.`);
    }
    const exchangeContent = contentFromProviderExchange(storedOutcome.raw_provider_exchange);
    if (exchangeContent !== storedOutcome.raw_model_content) {
      throw new Error(`Paid v2 raw exchange linkage mismatch for ${requestIdentity.requirement_id}.`);
    }
    outcomes.push(processStoredModelContent(request, storedOutcome.raw_provider_exchange, storedOutcome.raw_model_content));
  }
  const result = scoreFactsPrototype(fixtures, outcomes, stored.generated_at);
  const replayResult = {
    ...result,
    replay: {
      source_path: inputPath,
      source_sha256: originalSha256,
      request_plan_sha256: requestPlanHash,
      network_calls: 0,
      original_artifact_unchanged: sha256(await readFile(inputPath, "utf8")) === originalSha256,
    },
  };
  await writeJson(outputPath, replayResult);
  await mkdir(dirname(reportOutputPath), { recursive: true });
  await writeFile(reportOutputPath, formatFactsPrototypeMarkdown(result), "utf8");
  if (sha256(await readFile(inputPath, "utf8")) !== originalSha256) throw new Error("Paid v2 source artifact changed during replay.");
  console.log(`Replayed ${outcomes.length} stored requirement responses with zero network calls.`);
  console.log(`Replay result: ${outputPath}`);
  console.log(`Replay report: ${reportOutputPath}`);
  if (!result.valid) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
if (args.mode === "dry") await runDry(args.fixturePath, args.outputPath);
else if (args.mode === "run") await runPaid(args.fixturePath, args.outputPath, args.reportOutputPath, args.confirmPaid);
else if (args.mode === "report") await regenerateReport(args.fixturePath, args.inputPath, args.outputPath);
else await replayPaidV2(args.fixturePath, args.inputPath, args.outputPath, args.reportOutputPath);
