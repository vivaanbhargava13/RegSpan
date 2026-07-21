#!/usr/bin/env node

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CLASSIFIER_CAPABILITY_RESULT_SCHEMA,
  CLASSIFIER_CAPABILITY_EXPERIMENT_LIMITATION,
  assertRequestsDifferOnlyByModel,
  formatClassifierCapabilityMarkdown,
  classifierCapabilityMetrics,
  caseHasConfirmedScoringFields,
  invariantOpenAiRequestBody,
  jsonHash,
  paidRunReadinessBlockers,
  validateClassifierCapabilityResultAlignment,
  validateClassifierCapabilityFixtures,
  type ClassifierCapabilityArmOutput,
  type ClassifierCapabilityCandidateOutput,
  type ClassifierCapabilityFixtureSuite,
  type ClassifierCapabilityResult,
} from "../lib/classifierCapabilityEval";
import { aggregateFindingForRequirement } from "../lib/findingsAggregation";
import {
  buildOpenAiClassifierRequestBody,
  classifierInputForChunk,
  createRequirementEvidenceClassifier,
  type OpenAiClassifierUsage,
  type RequirementEvidenceClassifierEvaluationExchange,
} from "../lib/requirementEvidenceClassifier";
import {
  buildRequirementMatchResultWithClassifier,
  type GradedEvidenceChunk,
} from "../lib/requirementMatching";

const DEFAULT_FIXTURE_PATH = "eval-fixtures/classifier-capability/fixtures.v2.json";
const DEFAULT_OUTPUT_PATH = "eval-results/classifier-capability/results.json";
const PAID_CONFIRMATION = "CLASSIFIER_CAPABILITY_AB";

type Mode = "dry" | "readiness" | "run" | "report";
type Args = {
  mode: Mode;
  fixturePath: string;
  outputPath: string;
  inputPath: string;
  baselineModel: string;
  challengerModel: string;
  confirmPaid: string | null;
  baselineInputRate: number | null;
  baselineOutputRate: number | null;
  challengerInputRate: number | null;
  challengerOutputRate: number | null;
};

function usage() {
  console.log(`Classifier capability A/B evaluation

Usage:
  npm run eval:classifier-capability:dry -- [--baseline-model <id>] [--challenger-model <id>]
  npm run eval:classifier-capability:readiness -- --baseline-model <id> --challenger-model <id> --confirm-paid ${PAID_CONFIRMATION}
  npm run eval:classifier-capability -- --baseline-model <id> --challenger-model <id> --confirm-paid ${PAID_CONFIRMATION}
  npm run eval:classifier-capability:report -- [--input <results.json>]

Options:
  --fixtures <path>                         Frozen fixture JSON.
  --output <path>                           Results JSON (run) or Markdown (report).
  --input <path>                            Stored results JSON for offline reporting.
  --baseline-input-cost-per-million <usd>   Optional cost rate.
  --baseline-output-cost-per-million <usd>  Optional cost rate.
  --challenger-input-cost-per-million <usd> Optional cost rate.
  --challenger-output-cost-per-million <usd> Optional cost rate.

The run command is the only mode that can call a provider. It requires explicit
paid confirmation plus ENABLE_EXTERNAL_AI_PROCESSING=true,
ENABLE_EXTERNAL_AI_CLASSIFIER=true, and an API key.
`);
}

function optionalRate(value: string | undefined, label: string) {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}

function parseArgs(argv: string[]): Args {
  const first = argv[0];
  if (first === "--help" || first === "-h") {
    usage();
    process.exit(0);
  }
  const mode: Mode = first === "dry" || first === "readiness" || first === "run" || first === "report" ? first : "dry";
  const args = new Map<string, string>();
  for (let index = mode === first ? 1 : 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error(`Invalid option near ${name ?? "end of arguments"}.`);
    args.set(name, value);
  }
  const outputDefault = mode === "report"
    ? "eval-results/classifier-capability/report.md"
    : mode === "dry"
      ? "eval-results/classifier-capability/dry-run.json"
      : DEFAULT_OUTPUT_PATH;
  return {
    mode,
    fixturePath: args.get("--fixtures") ?? DEFAULT_FIXTURE_PATH,
    outputPath: args.get("--output") ?? outputDefault,
    inputPath: args.get("--input") ?? DEFAULT_OUTPUT_PATH,
    baselineModel: args.get("--baseline-model") ?? process.env.CLASSIFIER_CAPABILITY_BASELINE_MODEL?.trim() ?? "baseline-model",
    challengerModel: args.get("--challenger-model") ?? process.env.CLASSIFIER_CAPABILITY_CHALLENGER_MODEL?.trim() ?? "challenger-model",
    confirmPaid: args.get("--confirm-paid") ?? null,
    baselineInputRate: optionalRate(args.get("--baseline-input-cost-per-million"), "Baseline input rate"),
    baselineOutputRate: optionalRate(args.get("--baseline-output-cost-per-million"), "Baseline output rate"),
    challengerInputRate: optionalRate(args.get("--challenger-input-cost-per-million"), "Challenger input rate"),
    challengerOutputRate: optionalRate(args.get("--challenger-output-cost-per-million"), "Challenger output rate"),
  };
}

async function loadFixtures(path: string) {
  return validateClassifierCapabilityFixtures(JSON.parse(await readFile(resolve(path), "utf8")));
}

function requirementForCase(fixtures: ClassifierCapabilityFixtureSuite, requirementId: string) {
  const requirement = fixtures.requirements.find((item) => item.id === requirementId);
  if (!requirement) throw new Error(`Missing frozen requirement ${requirementId}.`);
  return requirement;
}

function normalizedCandidateChunk(candidate: ClassifierCapabilityFixtureSuite["cases"][number]["candidates"][number]) {
  return {
    chunk_id: candidate.chunk_id,
    rank: candidate.rank,
    document_id: candidate.document_id,
    filename: candidate.filename,
    page_start: candidate.page_start,
    page_end: candidate.page_end,
    chunk_index: candidate.chunk_index,
    section_path: candidate.section_path,
    content_preview: candidate.content_preview,
    similarity: candidate.similarity,
    evidence_reason: candidate.evidence_reason,
    embedding_input: candidate.embedding_input,
    source_type: candidate.source_type,
    evidence_role: candidate.evidence_role,
    rerank_score: candidate.rerank_score,
    rerank_reason: candidate.rerank_reason,
  };
}

function requestPlan(fixtures: ClassifierCapabilityFixtureSuite, baselineModel: string, challengerModel: string) {
  if (!baselineModel.trim() || !challengerModel.trim()) {
    throw new Error("Baseline and challenger model identifiers must be non-empty.");
  }
  return fixtures.cases.map((fixtureCase) => {
    const requirement = requirementForCase(fixtures, fixtureCase.requirement_id);
    return {
      case_id: fixtureCase.id,
      normalized_fixture_input: {
        requirement,
        candidates: fixtureCase.candidates.map(normalizedCandidateChunk),
      },
      requests: fixtureCase.candidates.map((candidate) => {
        const input = classifierInputForChunk(requirement, candidate, { caseId: fixtureCase.id });
        const baseline = buildOpenAiClassifierRequestBody(input, baselineModel);
        const challenger = buildOpenAiClassifierRequestBody(input, challengerModel);
        const invariantHash = assertRequestsDifferOnlyByModel(baseline, challenger);
        return {
          candidate_chunk_id: candidate.chunk_id,
          invariant_request_hash: invariantHash,
          baseline: { model: baselineModel, request_hash: jsonHash(baseline), request_body: baseline },
          challenger: { model: challengerModel, request_hash: jsonHash(challenger), request_body: challenger },
        };
      }),
    };
  });
}

async function writeJson(path: string, value: unknown) {
  const outputPath = resolve(path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return outputPath;
}

function estimatedCost(
  usage: OpenAiClassifierUsage,
  inputRate: number | null,
  outputRate: number | null,
) {
  if (inputRate === null || outputRate === null || usage.prompt_tokens === null || usage.completion_tokens === null) {
    return null;
  }
  return (usage.prompt_tokens * inputRate + usage.completion_tokens * outputRate) / 1_000_000;
}

function allGraded(match: Awaited<ReturnType<typeof buildRequirementMatchResultWithClassifier>>) {
  return [...match.direct, ...match.partial, ...match.background, ...match.irrelevant];
}

async function runArm({
  name,
  model,
  inputRate,
  outputRate,
  fixtures,
  plan,
}: {
  name: "baseline" | "challenger";
  model: string;
  inputRate: number | null;
  outputRate: number | null;
  fixtures: ClassifierCapabilityFixtureSuite;
  plan: ReturnType<typeof requestPlan>;
}): Promise<ClassifierCapabilityArmOutput> {
  const apiKey = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Paid run requires REQUIREMENT_CLASSIFIER_API_KEY or OPENAI_API_KEY.");
  const exchanges = new Map<string, RequirementEvidenceClassifierEvaluationExchange>();
  const classifier = createRequirementEvidenceClassifier({
    ...process.env,
    REQUIREMENT_CLASSIFIER_PROVIDER: "openai",
    REQUIREMENT_CLASSIFIER_MODEL: model,
    REQUIREMENT_CLASSIFIER_API_KEY: apiKey,
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
  }, fetch, {
    workspaceId: "classifier-capability-evaluation",
    workspaceConsentEnabled: true,
    externalAiProcessingEnabled: true,
    externalAiClassifierEnabled: true,
    denialReason: null,
  }, {
    candidateConcurrencyOverride: 1,
    recordEvaluationExchange(exchange) {
      if (!exchange.candidateChunkId) throw new Error("Evaluation exchange omitted its candidate chunk id.");
      exchanges.set(`${exchange.caseId}/${exchange.candidateChunkId}`, exchange);
    },
  });
  if (classifier.provider !== "openai") throw new Error(`Classifier arm ${name} did not resolve to OpenAI.`);

  const cases = [];
  for (const [caseIndex, fixtureCase] of fixtures.cases.entries()) {
    const requirement = requirementForCase(fixtures, fixtureCase.requirement_id);
    const casePlan = plan[caseIndex];
    const started = performance.now();
    const match = await buildRequirementMatchResultWithClassifier(
      requirement,
      fixtureCase.candidates,
      classifier,
      new Map(fixtureCase.candidates.map((item) => [item.document_id, fixtureCase.id])),
      { candidateConcurrencyOverride: 1 },
    );
    const elapsed = performance.now() - started;
    const graded = allGraded(match) as GradedEvidenceChunk[];
    const finding = aggregateFindingForRequirement(requirement, graded);
    const gradedById = new Map(graded.map((item) => [item.chunk_id, item]));
    const outputCandidates: ClassifierCapabilityCandidateOutput[] = fixtureCase.candidates.map((fixtureCandidate) => {
      const gradedCandidate = gradedById.get(fixtureCandidate.chunk_id);
      if (!gradedCandidate) throw new Error(`Missing graded candidate ${fixtureCase.id}/${fixtureCandidate.chunk_id}.`);
      const request = casePlan.requests.find((item) => item.candidate_chunk_id === gradedCandidate.chunk_id);
      if (!request) throw new Error(`Missing request plan for ${gradedCandidate.chunk_id}.`);
      const exchange = exchanges.get(`${fixtureCase.id}/${gradedCandidate.chunk_id}`) ?? null;
      const armRequest = name === "baseline" ? request.baseline : request.challenger;
      const postProcessed = {
        relationship: gradedCandidate.evidence_relationship,
        confidence: gradedCandidate.classifier_confidence,
        requirement_supported: gradedCandidate.requirement_supported,
        control_absent_or_out_of_scope: gradedCandidate.control_absent_or_out_of_scope,
        covered_elements: gradedCandidate.covered_elements,
        missing_elements: gradedCandidate.missing_elements,
        vague_elements: gradedCandidate.vague_elements,
        reason: gradedCandidate.grade_reason,
        supporting_quote: gradedCandidate.supporting_quote,
        classifier_provider: gradedCandidate.classifier_provider,
      };
      const parsedCovered = new Set(exchange?.parsedClassification?.covered_elements ?? []);
      const postCovered = new Set(postProcessed.covered_elements);
      const acceptedElements = [...postCovered].map((elementId) => ({
        element_id: elementId,
        reason: parsedCovered.has(elementId)
          ? "Accepted after existing element handling and quote validation."
          : "Recovered by existing deterministic operative-element post-processing.",
      }));
      const rejectedElements = [...parsedCovered]
        .filter((elementId) => !postCovered.has(elementId))
        .map((elementId) => ({
          element_id: elementId,
          reason: postProcessed.reason,
        }));
      const usage = exchange?.usage ?? { prompt_tokens: null, completion_tokens: null, total_tokens: null };
      const quote = postProcessed.supporting_quote;
      return {
        candidate_chunk_id: gradedCandidate.chunk_id,
        request_hash: armRequest.request_hash,
        invariant_request_hash: request.invariant_request_hash,
        model,
        outcome: exchange?.outcome
          ?? (gradedCandidate.classifier_provider === "heuristic" ? "deterministic_guardrail" : "fallback"),
        http_status: exchange?.httpStatus ?? null,
        retry_count: exchange?.retryCount ?? 0,
        error_category: exchange?.errorCategory ?? null,
        error_message: exchange?.errorMessage
          ?? (gradedCandidate.classifier_provider === "openai" ? null : gradedCandidate.grade_reason),
        raw_response_text: exchange?.rawResponseText ?? null,
        parsed_transport_json: exchange?.parsedTransportJson ?? null,
        parsed_classification: exchange?.parsedClassification ?? null,
        post_processed_classification: postProcessed,
        accepted_elements: acceptedElements,
        rejected_elements: rejectedElements,
        validated_quote: quote && gradedCandidate.content_preview.includes(quote) ? quote : null,
        exact_quote_valid: Boolean(quote && gradedCandidate.content_preview.includes(quote)),
        latency_ms: exchange?.elapsedMs ?? elapsed,
        token_usage: usage,
        estimated_cost_usd: estimatedCost(usage, inputRate, outputRate),
      };
    });
    cases.push({
      case_id: fixtureCase.id,
      normalized_fixture_input: casePlan.normalized_fixture_input,
      final_requirement_status: finding.status,
      candidates: outputCandidates,
    });
  }
  const scoredFailures = cases.flatMap((caseOutput, caseIndex) => {
    const fixtureCase = fixtures.cases[caseIndex];
    if (fixtureCase.evaluation_role !== "scored" || !caseHasConfirmedScoringFields(fixtureCase)) return [];
    return caseOutput.candidates
      .filter((candidate) => candidate.outcome !== "model_success")
      .map((candidate) => `${caseOutput.case_id}/${candidate.candidate_chunk_id}: ${candidate.outcome}`);
  });
  return {
    name,
    model,
    valid: scoredFailures.length === 0,
    invalid_reasons: scoredFailures,
    input_cost_per_million_tokens: inputRate,
    output_cost_per_million_tokens: outputRate,
    cases,
  };
}

async function runDry(args: Args, fixtures: ClassifierCapabilityFixtureSuite) {
  const plan = requestPlan(fixtures, args.baselineModel, args.challengerModel);
  const output = await writeJson(args.outputPath, {
    schema_version: "classifier-capability-dry-run/v1",
    fixture_version: fixtures.fixture_version,
    frozen_baseline_commit: fixtures.frozen_baseline_commit,
    fixture_suite_hash: fixtures.suite_hash,
    network_calls: 0,
    experiment_limitation: CLASSIFIER_CAPABILITY_EXPERIMENT_LIMITATION,
    equivalence: "passed: every serialized request is byte-equivalent after replacing only model",
    cases: plan,
  });
  console.log(`Validated ${fixtures.cases.length} cases and ${plan.reduce((sum, item) => sum + item.requests.length, 0)} candidate requests.`);
  console.log(`No network calls were made. Dry-run artifact: ${output}`);
}

function paidEnvironmentBlockers(args: Args) {
  const blockers: string[] = [];
  if (args.confirmPaid !== PAID_CONFIRMATION) {
    blockers.push(`Explicit paid confirmation --confirm-paid ${PAID_CONFIRMATION} is required.`);
  }
  if (process.env.ENABLE_EXTERNAL_AI_PROCESSING?.trim().toLowerCase() !== "true"
    || process.env.ENABLE_EXTERNAL_AI_CLASSIFIER?.trim().toLowerCase() !== "true") {
    blockers.push("Both external-AI policy flags must be explicitly true.");
  }
  if (!(process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim())) {
    blockers.push("A classifier API key is required.");
  }
  return blockers;
}

async function runReadiness(args: Args, fixtures: ClassifierCapabilityFixtureSuite) {
  const plan = requestPlan(fixtures, args.baselineModel, args.challengerModel);
  const blockers = [...paidRunReadinessBlockers(fixtures), ...paidEnvironmentBlockers(args)];
  if (blockers.length > 0) {
    console.log(`BLOCKED:\n- ${blockers.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`READY: ${fixtures.cases.filter((item) => item.evaluation_role === "scored").length} scored cases and ${plan.reduce((sum, item) => sum + item.requests.length, 0)} total candidate requests validated.`);
  console.log("Fixture integrity, suite hash, paid configuration, distinct models, and baseline/challenger request equivalence passed. No provider calls were made.");
}

async function runPaid(args: Args, fixtures: ClassifierCapabilityFixtureSuite) {
  const plan = requestPlan(fixtures, args.baselineModel, args.challengerModel);
  const readinessBlockers = [...paidRunReadinessBlockers(fixtures), ...paidEnvironmentBlockers(args)];
  if (readinessBlockers.length > 0) {
    throw new Error(`Paid run is blocked:\n- ${readinessBlockers.join("\n- ")}`);
  }
  const baseline = await runArm({
    name: "baseline", model: args.baselineModel, inputRate: args.baselineInputRate,
    outputRate: args.baselineOutputRate, fixtures, plan,
  });
  const challenger = await runArm({
    name: "challenger", model: args.challengerModel, inputRate: args.challengerInputRate,
    outputRate: args.challengerOutputRate, fixtures, plan,
  });
  const resultWithoutMetrics = {
    schema_version: CLASSIFIER_CAPABILITY_RESULT_SCHEMA,
    fixture_version: fixtures.fixture_version,
    frozen_baseline_commit: fixtures.frozen_baseline_commit,
    fixture_suite_hash: fixtures.suite_hash,
    generated_at: new Date().toISOString(),
    fixture_path: args.fixturePath,
    comparative_conclusions_suppressed: !baseline.valid || !challenger.valid,
    arms: [baseline, challenger],
  } satisfies Omit<ClassifierCapabilityResult, "metrics">;
  const result: ClassifierCapabilityResult = {
    ...resultWithoutMetrics,
    metrics: {
      baseline: classifierCapabilityMetrics(fixtures, baseline),
      challenger: classifierCapabilityMetrics(fixtures, challenger),
    },
  };
  const output = await writeJson(args.outputPath, result);
  const reportPath = args.outputPath.replace(/\.json$/i, ".md");
  await writeFile(resolve(reportPath), formatClassifierCapabilityMarkdown(fixtures, result), "utf8");
  console.log(`Paid A/B results: ${output}`);
  console.log(`Comparison report: ${resolve(reportPath)}`);
  if (!baseline.valid || !challenger.valid) {
    console.error("Invalid run: comparative quality conclusions were suppressed.");
    process.exitCode = 1;
  }
}

async function regenerateReport(args: Args, fixtures: ClassifierCapabilityFixtureSuite) {
  const stored = JSON.parse(await readFile(resolve(args.inputPath), "utf8")) as ClassifierCapabilityResult;
  validateClassifierCapabilityResultAlignment(fixtures, stored);
  for (const arm of stored.arms) {
    for (const [caseIndex, caseOutput] of arm.cases.entries()) {
      const fixtureCase = fixtures.cases[caseIndex];
      const expectedNormalized = {
        requirement: requirementForCase(fixtures, fixtureCase.requirement_id),
        candidates: fixtureCase.candidates.map(normalizedCandidateChunk),
      };
      if (jsonHash(caseOutput.normalized_fixture_input) !== jsonHash(expectedNormalized)) {
        throw new Error(`Stored normalized fixture input changed for ${arm.name}/${fixtureCase.id}.`);
      }
      for (const [candidateIndex, candidate] of caseOutput.candidates.entries()) {
        const chunk = expectedNormalized.candidates[candidateIndex];
        const requestBody = buildOpenAiClassifierRequestBody(
          classifierInputForChunk(
            expectedNormalized.requirement,
            chunk,
            { caseId: caseOutput.case_id },
          ),
          arm.model,
        );
        if (candidate.request_hash !== jsonHash(requestBody)) {
          throw new Error(`Stored request hash mismatch for ${caseOutput.case_id}/${candidate.candidate_chunk_id}.`);
        }
        const normalized = invariantOpenAiRequestBody(requestBody);
        if (candidate.invariant_request_hash !== jsonHash(normalized)) {
          throw new Error(`Stored request invariant hash mismatch for ${caseOutput.case_id}/${candidate.candidate_chunk_id}.`);
        }
      }
    }
  }
  const recomputedValidity = stored.arms.map((arm) => {
    const failures = arm.cases.flatMap((caseOutput, caseIndex) => {
      const fixtureCase = fixtures.cases[caseIndex];
      if (fixtureCase.evaluation_role !== "scored" || !caseHasConfirmedScoringFields(fixtureCase)) return [];
      return caseOutput.candidates.filter((item) => item.outcome !== "model_success")
        .map((item) => `${caseOutput.case_id}/${item.candidate_chunk_id}: ${item.outcome}`);
    });
    if (arm.valid !== (failures.length === 0)) throw new Error(`Stored ${arm.name} arm validity does not match candidate outcomes.`);
    return failures;
  });
  const result: ClassifierCapabilityResult = {
    ...stored,
    comparative_conclusions_suppressed: recomputedValidity.some((item) => item.length > 0),
    metrics: {
      baseline: classifierCapabilityMetrics(fixtures, stored.arms[0]),
      challenger: classifierCapabilityMetrics(fixtures, stored.arms[1]),
    },
  };
  const outputPath = resolve(args.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, formatClassifierCapabilityMarkdown(fixtures, result), "utf8");
  console.log(`Offline report regenerated without API calls: ${outputPath}`);
  if (result.comparative_conclusions_suppressed) process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
const fixtures = await loadFixtures(args.fixturePath);
if (args.mode === "dry") await runDry(args, fixtures);
else if (args.mode === "readiness") await runReadiness(args, fixtures);
else if (args.mode === "run") await runPaid(args, fixtures);
else await regenerateReport(args, fixtures);
