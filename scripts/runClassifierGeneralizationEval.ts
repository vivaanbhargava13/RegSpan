/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildGeneralizationRequestPlan, caseIsAdjudicated, GENERALIZATION_MODEL, isolatedCaseForV41Request, scorePairedGeneralization, validateGeneralizationFixture, verifyIdenticalEvidence, type ArmCaseResult, type GeneralizationFixture } from "../lib/classifierGeneralizationEval";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";
import { mapV3Fact } from "../lib/classifierFactsPrototypeV3";
import { validateV41ExtractionResponse } from "../lib/classifierFactsPrototypeV41";
import { openAiClassifierUsage, parseOpenAiClassification, postProcessOpenAiClassification } from "../lib/requirementEvidenceClassifier";

const FIXTURE = "eval-fixtures/classifier-generalization/holdout.v1.json";
const CANARIES = "eval-fixtures/classifier-capability/fixtures.v2.json";
const ROOT = "eval-results/classifier-generalization/v1-case-isolated";
const CONFIRMATION = "CLASSIFIER_GENERALIZATION_V1";
type Mode = "dry" | "readiness" | "run" | "replay" | "report";

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function writeJson(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function args(argv: string[]) { const mode = (["dry","readiness","run","replay","report"].includes(argv[0]) ? argv[0] : "dry") as Mode; const map = new Map<string,string>(); for (let i = mode === argv[0] ? 1 : 0; i < argv.length; i += 2) { if (!argv[i]?.startsWith("--") || argv[i+1] === undefined) throw new Error("Invalid generalization arguments."); map.set(argv[i], argv[i+1]); } return { mode, fixture: resolve(map.get("--fixtures") ?? FIXTURE), input: resolve(map.get("--input") ?? `${ROOT}/paid-results.json`), output: resolve(map.get("--output") ?? (mode === "dry" ? `${ROOT}/dry-run.json` : mode === "replay" ? `${ROOT}/replay-results.json` : `${ROOT}/paid-results.json`)), report: resolve(map.get("--report-output") ?? `${ROOT}/${mode === "replay" ? "replay-report.md" : "report.md"}`), confirmation: map.get("--confirm-paid") ?? "" }; }

async function load(path: string) { return validateGeneralizationFixture(JSON.parse(await readFile(path, "utf8"))); }
async function baselineHashes() {
  const paths = [
    "eval-fixtures/classifier-generalization/holdout.v1.json",
    "eval-fixtures/classifier-generalization/reviewer-worksheet.json",
    "eval-fixtures/classifier-generalization/reviewer-worksheet.md",
    "eval-fixtures/classifier-facts-prototype/artifact-baselines.v4-1-enumfix.json",
    "eval-results/classifier-facts-prototype/v4-1-enumfix/results.json",
    "eval-results/classifier-facts-prototype/v4-1-enumfix/results.md",
    "eval-fixtures/classifier-capability/fixtures.v2.json",
    "lib/classifierFactsPrototypeV41.ts",
    "lib/classifierFactsPrototypeV4.ts",
    "lib/classifierFactsPrototypeV3.ts",
    "lib/requirementEvidenceClassifier.ts",
  ];
  return Promise.all(paths.map(async (path) => ({ path, sha256: sha256(await readFile(resolve(path))) })));
}

function composition(fixture: GeneralizationFixture) {
  const count = (selector: (item: GeneralizationFixture["cases"][number]) => string) => Object.fromEntries([...new Set(fixture.cases.map(selector))].sort().map((key) => [key, fixture.cases.filter((item) => selector(item) === key).length]));
  return { total_cases: fixture.cases.length, adjudicated_cases: fixture.cases.filter((item) => item.adjudication.approved).length, by_requirement: count((item) => item.requirement_id), by_candidate_set_size: count((item) => item.set_size), by_evidence_shape: count((item) => item.evidence_shape), answer_key_review_aids: count((item) => item.answer_key_provenance.expected_status_review_aid) };
}

async function context(fixturePath: string) {
  const fixture = await load(fixturePath); const canaries = validateClassifierCapabilityFixtures(JSON.parse(await readFile(resolve(CANARIES), "utf8"))); const plan = buildGeneralizationRequestPlan(fixture, canaries); verifyIdenticalEvidence(fixture, plan); return { fixture, canaries, plan };
}

async function dry(fixturePath: string, output: string) {
  const { fixture, plan } = await context(fixturePath); const requests = [...plan.current_requests, ...plan.v4_1_requests].map((request: any) => ({ arm: request.arm, case_id: request.case_id ?? null, requirement_id: request.requirement_id, candidate_id: request.candidate_id ?? null, document_case_id: request.document_case_id ?? null, candidate_set_sha256: request.candidate_set_sha256 ?? null, candidate_ids: request.candidate_ids ?? null, unit_ids: request.unit_ids ?? null, schema_sha256: request.schema_sha256 ?? null, preflight: request.preflight ?? null, body_sha256: sha256(JSON.stringify(request.body)), body: request.body }));
  const preflights = plan.v4_1_requests.map((request: any) => ({ case_id: request.case_id, requirement_id: request.requirement_id, document_case_id: request.document_case_id, candidate_set_sha256: request.candidate_set_sha256, candidate_ids: request.candidate_ids, unit_ids: request.unit_ids, ...request.preflight }));
  const maximum = (key: string) => Math.max(...preflights.map((item: any) => item[key]));
  const artifact = { schema_version: "classifier-generalization-dry-run/v1", generated_at: new Date().toISOString(), network_calls: 0, fixture_hash: fixture.fixture_hash, development_canary_suite_hash: fixture.development_canary_suite_hash, model: GENERALIZATION_MODEL, composition: composition(fixture), model_calls: plan.model_calls, request_count: plan.request_count, request_plan_sha256: sha256(JSON.stringify(requests.map((item) => item.body))), arm_b_provider_preflight: preflights, arm_b_maximum_observed: { candidate_count: maximum("candidate_count"), unit_count: maximum("unit_count"), literal_enum_value_count: maximum("literal_enum_value_count"), schema_byte_size: maximum("schema_byte_size"), prompt_byte_size: maximum("prompt_byte_size"), complete_request_byte_size: maximum("complete_request_byte_size"), schema_name_length: maximum("schema_name_length") }, requests, immutable_baselines: await baselineHashes(), readiness: readinessResult(fixture) };
  await writeJson(output, artifact); const report = output.replace(/\.json$/u, ".md"); await writeFile(report, [`# Classifier generalization dry run`, ``, `Fixture hash: \`${fixture.fixture_hash}\``, ``, `Requests: ${requests.length} (${plan.model_calls.current} current; ${plan.model_calls.v4_1} V4.1)`, ``, `Network calls: 0`, ``, `Readiness: ${artifact.readiness.ready ? "READY" : "BLOCKED"}`, ``, ...artifact.readiness.blockers.map((item) => `- ${item}`), ``].join("\n"), "utf8"); console.log(`Generalization dry run: ${requests.length} requests, zero network calls.`); console.log(`Dry artifacts: ${output}, ${report}`); console.log(`Request plan SHA-256: ${artifact.request_plan_sha256}`);
}

function readinessResult(fixture: GeneralizationFixture) { const approved = fixture.cases.filter(caseIsAdjudicated).length; const blockers = approved === fixture.cases.length ? [] : [`${fixture.cases.length - approved} cases lack approved dual-review adjudication`]; return { ready: blockers.length === 0, blockers, provider_conditions_not_checked: true }; }

function paidKey(fixture: GeneralizationFixture, confirmation: string) { const blockers = [...readinessResult(fixture).blockers]; if (confirmation !== CONFIRMATION) blockers.push(`--confirm-paid ${CONFIRMATION} is required`); if (process.env.CLASSIFIER_GENERALIZATION_ENABLED !== "true") blockers.push("CLASSIFIER_GENERALIZATION_ENABLED=true is required"); if (process.env.ENABLE_EXTERNAL_AI_PROCESSING !== "true" || process.env.ENABLE_EXTERNAL_AI_CLASSIFIER !== "true") blockers.push("external-AI flags are required"); const key = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(); if (!key) blockers.push("API key is required"); if (blockers.length) throw new Error(`Paid generalization run blocked:\n- ${blockers.join("\n- ")}`); return key!; }

async function execute(body: unknown, key: string) { const started = performance.now(); let response: Response; try { response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }); } catch (error) { return { outcome: "provider_failure", latency_ms: performance.now() - started, http_status: null, raw_body: null, response_sha256: null, parsed: null, provider_request_id: null, finish_reason: null, error: String(error) }; } const raw = await response.text(); let parsed: unknown = null; try { parsed = JSON.parse(raw); } catch {} const transport = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; const choices = Array.isArray(transport.choices) ? transport.choices : []; const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {}; return { outcome: response.ok ? "model_success" : "provider_failure", latency_ms: performance.now() - started, http_status: response.status, raw_body: raw, response_sha256: sha256(raw), parsed, provider_request_id: typeof transport.id === "string" ? transport.id : null, finish_reason: typeof first.finish_reason === "string" ? first.finish_reason : null, error: response.ok ? null : `HTTP ${response.status}` }; }

async function run(fixturePath: string, output: string, report: string, confirmation: string) {
  const { fixture, plan } = await context(fixturePath); const key = paidKey(fixture, confirmation); console.log(`Generalization paid run starting: ${plan.request_count} requests`); console.log(`Result path: ${output}`); console.log(`Report path: ${report}`); const exchanges: unknown[] = [];
  for (const request of [...plan.current_requests, ...plan.v4_1_requests] as any[]) { const exchange = await execute(request.body, key); exchanges.push({ arm: request.arm, case_id: request.case_id ?? null, requirement_id: request.requirement_id, candidate_id: request.candidate_id ?? null, request_body: request.body, request_sha256: sha256(JSON.stringify(request.body)), ...exchange }); console.log(`${request.arm} ${request.case_id ?? request.requirement_id}: ${exchange.outcome}`); }
  const artifact = { schema_version: "classifier-generalization-paid-exchanges/v1", generated_at: new Date().toISOString(), fixture_hash: fixture.fixture_hash, model: GENERALIZATION_MODEL, exchanges, immutable_baselines: await baselineHashes() }; await writeJson(output, artifact); await replay(fixturePath, output, output.replace(/\.json$/u, "-replay.json"), report); }

function deriveStatus(required: string[], elements: string[]): "covered" | "partial" | "missing" { return required.every((id) => elements.includes(id)) ? "covered" : elements.length ? "partial" : "missing"; }

async function processArtifact(fixture: GeneralizationFixture, plan: any, artifact: any) {
  if (artifact.fixture_hash !== fixture.fixture_hash) throw new Error("Replay fixture hash mismatch."); const exchanges = artifact.exchanges as any[]; const requirements = new Map(fixture.requirements.map((item) => [item.id, item])); const current: ArmCaseResult[] = []; const v41: ArmCaseResult[] = [];
  for (const item of fixture.cases) {
    const req = requirements.get(item.requirement_id)!; const requestItems = plan.current_requests.filter((request: any) => request.case_id === item.case_id); const elementSet = new Set<string>(); let valid = true; let exact = true; let latency = 0; let prompt = 0, completion = 0, total = 0;
    for (const request of requestItems) { const exchange = exchanges.find((entry) => entry.arm === "current" && entry.case_id === item.case_id && entry.candidate_id === request.candidate_id); if (!exchange || exchange.outcome !== "model_success") { valid = false; continue; } try { const parsed = parseOpenAiClassification(exchange.parsed, request.classifier_input.requirement); const processed = postProcessOpenAiClassification(parsed, request.classifier_input); processed.covered_elements.forEach((id) => elementSet.add(id)); if (processed.supporting_quote && !request.classifier_input.chunkContent.includes(processed.supporting_quote)) exact = false; const usage = openAiClassifierUsage(exchange.parsed); prompt += usage.prompt_tokens ?? 0; completion += usage.completion_tokens ?? 0; total += usage.total_tokens ?? 0; latency += exchange.latency_ms ?? 0; } catch { valid = false; } }
    const elements = [...elementSet]; current.push({ case_id: item.case_id, outcome: valid ? "model_success" : "post_processing_failure", predicted_elements: elements, predicted_status: valid ? deriveStatus(req.required_elements, elements) : null, exact_source_unit_valid: exact, latency_ms: latency, token_usage: { prompt, completion, total } });
  }
  for (const request of plan.v4_1_requests) {
    const exchange = exchanges.find((entry) => entry.arm === "v4.1" && entry.case_id === request.case_id && entry.requirement_id === request.requirement_id);
    const item = isolatedCaseForV41Request(fixture, request);
    if (!exchange || exchange.outcome !== "model_success") { v41.push({ case_id: item.case_id, outcome: "provider_failure", predicted_elements: [], predicted_status: null, exact_source_unit_valid: false, validation_outcome: "rejected" }); continue; }
    try {
      const content = exchange.parsed?.choices?.[0]?.message?.content;
      const output = JSON.parse(content);
      const validated = validateV41ExtractionResponse(request, output);
      const ledger = validated.facts.map((fact) => { const mapping = mapV3Fact(item.requirement_id, fact); return { fact_id: fact.fact_id, mapped_elements: mapping.mapped, deterministic_rejections: mapping.rejected }; });
      const mapped = [...new Set(ledger.flatMap((fact) => fact.mapped_elements))];
      const req = requirements.get(item.requirement_id)!;
      const usage = openAiClassifierUsage(exchange.parsed);
      v41.push({ case_id: item.case_id, outcome: "model_success", predicted_elements: mapped, predicted_status: deriveStatus(req.required_elements, mapped), exact_source_unit_valid: true, facts_returned: validated.factsReturned, facts_accepted: validated.facts.length, facts_rejected: validated.rejectedFacts.length, validation_outcome: "accepted", accepted_facts: validated.facts, rejected_facts: validated.rejectedFacts, atomic_ledger: ledger, latency_ms: exchange.latency_ms ?? null, token_usage: { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens } });
    } catch { v41.push({ case_id: item.case_id, outcome: "schema_failure", predicted_elements: [], predicted_status: null, exact_source_unit_valid: false, validation_outcome: "rejected" }); }
  }
  return { current, v4_1: v41, paired: scorePairedGeneralization(fixture, current, v41) };
}

function markdown(result: any) { return [`# Classifier generalization A/B report`, ``, `Fixture hash: \`${result.fixture_hash}\``, ``, `Run valid: ${result.paired.current.invalid_cases.length === 0 && result.paired.v4_1.invalid_cases.length === 0 ? "yes" : "no"}`, ``, `Scored adjudicated cases: ${result.paired.current.labeled_cases}`, ``, `Gate: ${result.paired.gate.advances ? "PASS" : "BLOCKED"}`, ``, ...result.paired.gate.blockers.map((item: string) => `- ${item}`), ``, `This holdout measures the current per-candidate classifier and frozen V4.1 on identical evidence. Development canaries, retrieval, ingestion, and production integration are outside its metrics.`, ``].join("\n"); }

async function replay(fixturePath: string, input: string, output: string, report: string) { const { fixture, plan } = await context(fixturePath); const artifact = JSON.parse(await readFile(input, "utf8")); const processed = await processArtifact(fixture, plan, artifact); const result = { schema_version: "classifier-generalization-replay/v1", generated_at: new Date().toISOString(), network_calls: 0, source_artifact: input, source_artifact_sha256: sha256(await readFile(input)), fixture_hash: fixture.fixture_hash, ...processed }; await writeJson(output, result); await mkdir(dirname(report), { recursive: true }); await writeFile(report, markdown(result), "utf8"); console.log(`Offline replay wrote ${output} and ${report}; network calls: 0.`); }

const options = args(process.argv.slice(2));
if (options.mode === "dry") await dry(options.fixture, options.output);
else if (options.mode === "readiness") { const fixture = await load(options.fixture); const value = readinessResult(fixture); console.log(JSON.stringify(value, null, 2)); if (!value.ready) process.exitCode = 2; }
else if (options.mode === "run") await run(options.fixture, options.output, options.report, options.confirmation);
else if (options.mode === "replay") await replay(options.fixture, options.input, options.output, options.report);
else { const artifact = JSON.parse(await readFile(options.input, "utf8")); await mkdir(dirname(options.report), { recursive: true }); await writeFile(options.report, markdown(artifact), "utf8"); console.log(options.report); }
