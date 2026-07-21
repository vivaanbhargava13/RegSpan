import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const fixturePath = resolve("eval-fixtures/classifier-capability/fixtures.v2.json");
const loaderArgs = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];
const nodeArgs = [...loaderArgs, "scripts/runClassifierCapabilityEval.ts"];

async function runHarness(args, overrides = {}) {
  return execFileAsync(process.execPath, [...nodeArgs, ...args], {
    cwd: root,
    env: {
      ...process.env,
      OPENAI_API_KEY: "",
      REQUIREMENT_CLASSIFIER_API_KEY: "",
      ENABLE_EXTERNAL_AI_PROCESSING: "false",
      ENABLE_EXTERNAL_AI_CLASSIFIER: "false",
      ...overrides,
    },
  });
}

async function runTsEval(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loaderArgs, "--input-type=module", "--eval", source], { cwd: root });
  return JSON.parse(stdout);
}

function resultFromDry(fixtures, dry, candidateMutator = (value) => value) {
  const arm = (name, model, requestKey) => ({
    name, model, valid: true, invalid_reasons: [],
    input_cost_per_million_tokens: null, output_cost_per_million_tokens: null,
    cases: fixtures.cases.map((fixtureCase, caseIndex) => ({
      case_id: fixtureCase.id,
      normalized_fixture_input: dry.cases[caseIndex].normalized_fixture_input,
      final_requirement_status: fixtureCase.expected_status.value,
      candidates: fixtureCase.candidates.map((candidate, candidateIndex) => candidateMutator({
        candidate_chunk_id: candidate.chunk_id,
        request_hash: dry.cases[caseIndex].requests[candidateIndex][requestKey].request_hash,
        invariant_request_hash: dry.cases[caseIndex].requests[candidateIndex].invariant_request_hash,
        model, outcome: "model_success", http_status: 200, retry_count: 0,
        error_category: null, error_message: null, raw_response_text: "{}", parsed_transport_json: {},
        parsed_classification: null,
        post_processed_classification: {
          relationship: candidate.expected_relationship.value, confidence: "high",
          requirement_supported: candidate.expected_relationship.value === "supports",
          control_absent_or_out_of_scope: false,
          covered_elements: candidate.expected_covered_elements.value,
          missing_elements: [], vague_elements: [], reason: "Stored output.", supporting_quote: null,
          classifier_provider: "openai",
        },
        accepted_elements: [], rejected_elements: [], validated_quote: null, exact_quote_valid: false,
        latency_ms: 10, token_usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        estimated_cost_usd: null,
      })),
    })),
  });
  return {
    schema_version: "classifier-capability-results/v2",
    fixture_version: fixtures.fixture_version,
    frozen_baseline_commit: fixtures.frozen_baseline_commit,
    fixture_suite_hash: fixtures.suite_hash,
    generated_at: "2026-07-20T00:00:00.000Z",
    fixture_path: fixturePath,
    comparative_conclusions_suppressed: false,
    arms: [arm("baseline", "baseline-test", "baseline"), arm("challenger", "challenger-test", "challenger")],
    metrics: { baseline: { tampered: true }, challenger: { tampered: true } },
  };
}

test("v2 fixtures validate imported adjudications, keep worksheets blank, and dry requests differ only by model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "classifier-capability-dry-"));
  const output = join(directory, "dry.json");
  const { stdout } = await runHarness([
    "dry", "--fixtures", fixturePath, "--output", output,
    "--baseline-model", "baseline-test", "--challenger-model", "challenger-test",
  ]);
  const [dry, fixtures, worksheet] = await Promise.all([
    readFile(output, "utf8").then(JSON.parse),
    readFile(fixturePath, "utf8").then(JSON.parse),
    readFile("eval-fixtures/classifier-capability/reviewer-worksheet.json", "utf8").then(JSON.parse),
  ]);
  assert.match(stdout, /No network calls were made/);
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.fixture_suite_hash, fixtures.suite_hash);
  assert.equal(fixtures.schema_version, "classifier-capability-fixtures/v2");
  assert.deepEqual(
    fixtures.cases.filter((item) => item.evaluation_role === "scored").map((item) => item.id),
    [
      "assessment-full-operative-procedure",
      "assessment-incident-history-negative",
      "preservation-full-operative-procedure",
      "preservation-records-inventory-partial",
      "preservation-optional-language-negative",
      "recovery-full-operative-procedure",
      "recovery-corrective-ownership-negative",
      "recovery-appendix-inventory-negative",
      "recovery-restoration-monitoring-partial",
    ],
  );
  assert.deepEqual(
    fixtures.cases.filter((item) => item.evaluation_role === "diagnostic_only").map((item) => item.id),
    [
      "assessment-monitoring-escalation-partial",
      "preservation-log-procedure",
      "recovery-remediation-validation-multi-candidate-review",
      "recovery-remediation-validation-cross-candidate-aggregation-review",
    ],
  );
  assert.equal(worksheet.cases.every((item) => item.reviewer_decisions.reviewer_id === null), true);
  assert.equal(worksheet.multi_candidate_review_case, null);
  assert.equal(worksheet.paid_readiness_blocker, null);
  assert.match(worksheet.experiment_limitation, /does not evaluate cross-candidate element aggregation/);
  const approved = fixtures.cases.filter((item) => item.evaluation_role === "scored");
  for (const fixtureCase of approved) {
    const provenances = [
      fixtureCase.expected_status.provenance,
      fixtureCase.expected_supported_elements.provenance,
      ...fixtureCase.candidates.flatMap((candidate) => [
        candidate.expected_relationship.provenance,
        candidate.expected_covered_elements.provenance,
        candidate.direct_support_recovery.provenance,
        candidate.hard_negative.provenance,
      ]),
    ];
    assert.equal(provenances.every((item) => item.confirmed && item.source_type === "manual_adjudication"), true);
    assert.equal(provenances.every((item) => item.reviewer_id === "vivaan-bhargava" && item.reviewed_at), true);
  }
  const preservationInventory = fixtures.cases.find((item) => item.id === "preservation-records-inventory-partial");
  assert.equal(preservationInventory.expected_status.value, "partial");
  assert.deepEqual(preservationInventory.expected_supported_elements.value, ["incident_materials"]);
  assert.equal(preservationInventory.candidates[0].hard_negative.value, false);
  for (const diagnostic of fixtures.cases.filter((item) =>
    item.evaluation_role === "diagnostic_only"
    && !item.id.startsWith("recovery-remediation-validation-"))) {
    assert.equal(diagnostic.candidates.every((item) => item.expected_relationship.provenance.source_type === "diagnostic_artifact"), true);
  }
  const adjudicatedDiagnostic = fixtures.cases.find((item) => item.id === "recovery-remediation-validation-multi-candidate-review");
  assert.equal(adjudicatedDiagnostic.evaluation_role, "diagnostic_only");
  assert.equal(adjudicatedDiagnostic.expected_status.value, "covered");
  assert.deepEqual(adjudicatedDiagnostic.expected_supported_elements.value, ["recovery_steps", "remediation_tracking", "validation_testing"]);
  assert.deepEqual(adjudicatedDiagnostic.candidates.map((item) => ({
    relationship: item.expected_relationship.value,
    elements: item.expected_covered_elements.value,
    direct: item.direct_support_recovery.value,
    hardNegative: item.hard_negative.value,
  })), [
    { relationship: "supports", elements: ["recovery_steps", "remediation_tracking", "validation_testing"], direct: true, hardNegative: false },
    { relationship: "background_context", elements: [], direct: false, hardNegative: true },
    { relationship: "partially_supports", elements: ["recovery_steps", "validation_testing"], direct: false, hardNegative: false },
    { relationship: "background_context", elements: [], direct: false, hardNegative: true },
    { relationship: "background_context", elements: [], direct: false, hardNegative: true },
  ]);
  const diagnosticProvenance = [
    adjudicatedDiagnostic.expected_status.provenance,
    adjudicatedDiagnostic.expected_supported_elements.provenance,
    ...adjudicatedDiagnostic.candidates.flatMap((candidate) => [
      candidate.expected_relationship.provenance,
      candidate.expected_covered_elements.provenance,
      candidate.direct_support_recovery.provenance,
      candidate.hard_negative.provenance,
    ]),
  ];
  assert.equal(diagnosticProvenance.every((item) =>
    item.confirmed && item.source_type === "manual_adjudication"
    && item.reviewer_id === "vivaan-bhargava"
    && item.reviewed_at === "2026-07-21T03:31:43.000Z"), true);
  const latestDiagnostic = fixtures.cases.find((item) => item.id === "recovery-remediation-validation-cross-candidate-aggregation-review");
  assert.equal(latestDiagnostic.evaluation_role, "diagnostic_only");
  assert.equal(latestDiagnostic.expected_status.value, "partial");
  assert.deepEqual(latestDiagnostic.expected_supported_elements.value, ["recovery_steps", "validation_testing"]);
  assert.deepEqual(latestDiagnostic.candidates.map((item) => ({
    relationship: item.expected_relationship.value,
    elements: item.expected_covered_elements.value,
    direct: item.direct_support_recovery.value,
    hardNegative: item.hard_negative.value,
  })), [
    { relationship: "partially_supports", elements: ["recovery_steps", "validation_testing"], direct: false, hardNegative: false },
    { relationship: "background_context", elements: [], direct: false, hardNegative: true },
    { relationship: "background_context", elements: [], direct: false, hardNegative: true },
  ]);
  assert.equal(latestDiagnostic.candidates.every((item) =>
    item.expected_relationship.provenance.source_type === "manual_adjudication"
    && item.expected_relationship.provenance.reviewer_id === "vivaan-bhargava"
    && item.expected_relationship.provenance.reviewed_at === "2026-07-21T03:48:51.000Z"), true);
  for (const fixtureCase of dry.cases) for (const request of fixtureCase.requests) {
    const baseline = structuredClone(request.baseline.request_body);
    const challenger = structuredClone(request.challenger.request_body);
    baseline.model = "__MODEL_IDENTIFIER__";
    challenger.model = "__MODEL_IDENTIFIER__";
    assert.deepEqual(baseline, challenger);
    assert.notEqual(request.baseline.request_hash, request.challenger.request_hash);
  }
});

test("paid gate rejects missing API configuration before provider access", async () => {
  await assert.rejects(
    runHarness([
      "run", "--fixtures", fixturePath, "--baseline-model", "a", "--challenger-model", "b",
      "--confirm-paid", "CLASSIFIER_CAPABILITY_AB",
    ], {
      ENABLE_EXTERNAL_AI_PROCESSING: "true", ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
      REQUIREMENT_CLASSIFIER_API_KEY: "", OPENAI_API_KEY: "",
    }),
    /classifier API key is required/i,
  );
});

test("paid-readiness audit returns READY without provider calls", async () => {
  const { stdout } = await runHarness([
    "readiness", "--fixtures", fixturePath,
    "--baseline-model", "baseline-test", "--challenger-model", "challenger-test",
    "--confirm-paid", "CLASSIFIER_CAPABILITY_AB",
  ], {
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
    REQUIREMENT_CLASSIFIER_API_KEY: "readiness-only-placeholder",
  });
  assert.match(stdout, /^READY:/m);
  assert.match(stdout, /No provider calls were made/);
});

test("source-complete diagnostic pack preserves deterministic order, stored ids, hashes, and adjudication", async () => {
  const [fixtures, worksheet, capture] = await Promise.all([
    readFile(fixturePath, "utf8").then(JSON.parse),
    readFile("eval-fixtures/classifier-capability/reviewer-worksheet.json", "utf8").then(JSON.parse),
    readFile("eval-fixtures/classifier-capability/frozen-aggregation-pack.response-recovery-remediation-validation.json", "utf8").then(JSON.parse),
  ]);
  const fixtureCase = fixtures.cases.find((item) => item.id === "recovery-remediation-validation-cross-candidate-aggregation-review");
  const worksheetCase = worksheet.cases.find((item) => item.case_id === fixtureCase.id);
  const normalize = (value) => value.replace(/\r\n?/g, "\n").normalize("NFC");
  const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");

  assert.equal(fixtureCase.evaluation_role, "diagnostic_only");
  assert.equal(capture.order_kind, "deterministic_stored_chunk_index_order");
  assert.match(capture.ordering_method, /ascending chunk_index order; no query vector/);
  assert.equal("query_vector_source" in capture, false);
  assert.equal(hash(await readFile(capture.source_document.path)), capture.source_document.sha256);
  assert.deepEqual(fixtureCase.candidates.map((item) => item.chunk_id), capture.candidates.map((item) => item.chunk_id));
  assert.deepEqual(worksheetCase.candidates.map((item) => item.candidate_id), capture.candidates.map((item) => item.chunk_id));
  assert.deepEqual(capture.candidates.map((item) => item.original_position), [1, 2, 3]);
  assert.deepEqual(capture.candidates.map((item) => item.chunk_index), [3, 7, 16]);
  for (const [index, candidate] of fixtureCase.candidates.entries()) {
    const stored = capture.candidates[index];
    assert.match(candidate.chunk_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(candidate.chunk_id, candidate.stored_provenance.chunk_id);
    assert.equal(candidate.document_id, candidate.stored_provenance.document_id);
    assert.equal(candidate.chunk_index, stored.chunk_index);
    assert.equal(hash(candidate.content_preview), stored.stored_content_sha256);
    assert.equal(stored.stored_content_sha256, stored.independently_recomputed_sha256);
    assert.equal(normalize(candidate.content_preview), normalize(stored.exact_stored_content));
    assert.equal(candidate.stored_provenance.original_position, index + 1);
    assert.equal(candidate.stored_provenance.merged_rank, null);
  }
  assert.equal(fixtureCase.expected_status.value, "partial");
  assert.deepEqual(fixtureCase.expected_supported_elements.value, ["recovery_steps", "validation_testing"]);
  assert.equal(fixtureCase.candidates.every((item) => item.expected_relationship.provenance.confirmed), true);
  assert.equal(worksheetCase.reviewer_decisions.reviewer_id, null);
  assert.equal(worksheetCase.candidates.every((item) =>
    Object.values(item.reviewer_decisions).every((value) => value === null)), true);
});

test("duplicate diagnostic candidates are rejected", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { classifierCapabilityFixtureSuiteHash, validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, "utf8"));
    const multi = fixtures.cases.find((item) => item.id === "recovery-remediation-validation-cross-candidate-aggregation-review");
    const duplicate = structuredClone(fixtures);
    const duplicateMulti = duplicate.cases.find((item) => item.id === multi.id);
    duplicateMulti.candidates.push(structuredClone(duplicateMulti.candidates[0]));
    duplicate.suite_hash = classifierCapabilityFixtureSuiteHash(duplicate);
    let duplicateRejected = false;
    try { validateClassifierCapabilityFixtures(duplicate); } catch (error) { duplicateRejected = /duplicate/i.test(String(error)); }
    console.log(JSON.stringify({ duplicateRejected }));
  `);
  assert.deepEqual(evaluated, { duplicateRejected: true });
});

test("paid readiness requires sufficient independently confirmed per-candidate cases", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { paidRunReadinessBlockers } from "./lib/classifierCapabilityEval.ts";
    const fixtures = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, "utf8"));
    const scored = (suite) => suite.cases.filter((item) => item.evaluation_role === "scored");
    const blocked = (suite) => paidRunReadinessBlockers(suite).length > 0;

    const tooFew = structuredClone(fixtures);
    scored(tooFew).slice(0, 2).forEach((item) => { item.evaluation_role = "diagnostic_only"; });

    const noDirect = structuredClone(fixtures);
    scored(noDirect).forEach((item) => item.candidates.forEach((candidate) => { candidate.direct_support_recovery.value = false; }));

    const noHardNegative = structuredClone(fixtures);
    scored(noHardNegative).forEach((item) => item.candidates.forEach((candidate) => { candidate.hard_negative.value = false; }));

    const noPartial = structuredClone(fixtures);
    scored(noPartial).forEach((item) => { if (item.expected_status.value === "partial") item.expected_status.value = "covered"; });

    const unconfirmed = structuredClone(fixtures);
    scored(unconfirmed)[0].candidates[0].expected_relationship.provenance.confirmed = false;

    const providerDerived = structuredClone(fixtures);
    scored(providerDerived)[0].expected_status.provenance.source_type = "diagnostic_artifact";

    const diagnosticNoise = structuredClone(fixtures);
    diagnosticNoise.cases.filter((item) => item.evaluation_role === "diagnostic_only").forEach((item) => {
      item.expected_status.provenance.confirmed = false;
      item.candidates.forEach((candidate) => { candidate.hard_negative.provenance.confirmed = false; });
    });

    console.log(JSON.stringify({
      valid:paidRunReadinessBlockers(fixtures),
      tooFewBlocked:blocked(tooFew),
      noDirectBlocked:blocked(noDirect),
      noHardNegativeBlocked:blocked(noHardNegative),
      noPartialBlocked:blocked(noPartial),
      unconfirmedBlocked:blocked(unconfirmed),
      providerDerivedBlocked:blocked(providerDerived),
      diagnosticsIgnored:paidRunReadinessBlockers(diagnosticNoise),
    }));
  `);
  assert.deepEqual(evaluated, {
    valid: [],
    tooFewBlocked: true,
    noDirectBlocked: true,
    noHardNegativeBlocked: true,
    noPartialBlocked: true,
    unconfirmedBlocked: true,
    providerDerivedBlocked: true,
    diagnosticsIgnored: [],
  });
});

test("fallback and deterministic guardrail candidates are excluded and status false assurance is ordered", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { classifierCapabilityMetrics } from "./lib/classifierCapabilityEval.ts";
    const fixtures = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, "utf8"));
    const c = fixtures.cases[0]; c.evaluation_role = "scored";
    const confirmed = { confirmed:true, source_type:"manual_adjudication", reviewer_id:"test-reviewer", reviewed_at:"2026-07-20T00:00:00Z", source_path:"test", source_locator:"synthetic test", source_hash:"a".repeat(64), normalization_recipe:null };
    c.expected_status = { value:"missing", provenance:confirmed };
    c.expected_supported_elements = { value:[], provenance:confirmed };
    for (const x of c.candidates) {
      x.expected_relationship = { value:"irrelevant", provenance:confirmed };
      x.expected_covered_elements = { value:[], provenance:confirmed };
      x.direct_support_recovery = { value:false, provenance:confirmed };
      x.hard_negative = { value:true, provenance:confirmed };
    }
    const make = (outcome) => ({ name:"baseline", model:"m", valid:outcome==="model_success", invalid_reasons:[], input_cost_per_million_tokens:null, output_cost_per_million_tokens:null,
      cases: fixtures.cases.map((fc) => ({ case_id:fc.id, normalized_fixture_input:{requirement:fixtures.requirements[0],candidates:[]}, final_requirement_status:fc.id===c.id?"covered":"missing", candidates:fc.candidates.map((x) => ({ candidate_chunk_id:x.chunk_id, request_hash:"x", invariant_request_hash:"y", model:"m", outcome, http_status:null, retry_count:0, error_category:null, error_message:null, raw_response_text:null, parsed_transport_json:null, parsed_classification:null, post_processed_classification:{relationship:"supports",confidence:"high",requirement_supported:true,control_absent_or_out_of_scope:false,covered_elements:[],missing_elements:[],vague_elements:[],reason:"",supporting_quote:null,classifier_provider:outcome==="model_success"?"openai":"fallback"}, accepted_elements:[],rejected_elements:[],validated_quote:null,exact_quote_valid:false,latency_ms:1,token_usage:{prompt_tokens:null,completion_tokens:null,total_tokens:null},estimated_cost_usd:null })) })) });
    const fallback = classifierCapabilityMetrics(fixtures, make("fallback"));
    const guardrail = classifierCapabilityMetrics(fixtures, make("deterministic_guardrail"));
    const success = classifierCapabilityMetrics(fixtures, make("model_success"));
    console.log(JSON.stringify({fallback,guardrail,success}));
  `);
  assert.equal(evaluated.fallback.model_success_candidate_count, 0);
  assert.equal(evaluated.fallback.hard_negative_rejection.denominator, 0);
  assert.equal(evaluated.guardrail.model_success_candidate_count, 0);
  assert.equal(evaluated.guardrail.excluded_candidates[0].reason, "deterministic_guardrail");
  assert.equal(evaluated.success.false_assurance.count, 1);
  assert.equal(evaluated.success.false_assurance.denominator, 9);
});

test("invalid arm report suppresses comparative conclusions and shows a warning", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { formatClassifierCapabilityMarkdown } from "./lib/classifierCapabilityEval.ts";
    const fixtures = JSON.parse(await readFile(${JSON.stringify(fixturePath)}, "utf8"));
    const arm = (name,valid) => ({
      name, model:name+"-model", valid,
      invalid_reasons:valid?[]:["case/candidate: fallback"],
      input_cost_per_million_tokens:null, output_cost_per_million_tokens:null,
      cases:fixtures.cases.map((fc)=>({
        case_id:fc.id,
        normalized_fixture_input:{requirement:fixtures.requirements[0],candidates:[]},
        final_requirement_status:"missing",
        candidates:fc.candidates.map((x)=>({
          candidate_chunk_id:x.chunk_id, request_hash:"x", invariant_request_hash:"y",
          model:name+"-model", outcome:valid?"model_success":"fallback",
          http_status:null, retry_count:0, error_category:null, error_message:null,
          raw_response_text:null, parsed_transport_json:null, parsed_classification:null,
          post_processed_classification:{relationship:"irrelevant",confidence:"low",requirement_supported:false,control_absent_or_out_of_scope:false,covered_elements:[],missing_elements:[],vague_elements:[],reason:"",supporting_quote:null,classifier_provider:valid?"openai":"fallback"},
          accepted_elements:[], rejected_elements:[], validated_quote:null, exact_quote_valid:false,
          latency_ms:1, token_usage:{prompt_tokens:null,completion_tokens:null,total_tokens:null}, estimated_cost_usd:null,
        })),
      })),
    });
    const result={schema_version:"classifier-capability-results/v2",fixture_version:fixtures.fixture_version,frozen_baseline_commit:fixtures.frozen_baseline_commit,fixture_suite_hash:fixtures.suite_hash,generated_at:"now",fixture_path:"fixture",comparative_conclusions_suppressed:true,arms:[arm("baseline",false),arm("challenger",true)],metrics:{baseline:{},challenger:{}}};
    const report=formatClassifierCapabilityMarkdown(fixtures,result);
    console.log(JSON.stringify({warning:report.includes("INVALID RUN"),quality:report.includes("## Quality metrics"),scope:report.includes("does not evaluate cross-candidate element aggregation")}));
  `);
  assert.equal(evaluated.warning, true);
  assert.equal(evaluated.quality, false);
  assert.equal(evaluated.scope, true);
});

test("offline reporting rejects fixture and result tampering, alignment changes, and request hash changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "classifier-capability-integrity-"));
  const dryPath = join(directory, "dry.json");
  await runHarness(["dry", "--fixtures", fixturePath, "--output", dryPath, "--baseline-model", "baseline-test", "--challenger-model", "challenger-test"]);
  const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
  const dry = JSON.parse(await readFile(dryPath, "utf8"));
  const originalResult = resultFromDry(fixtures, dry);

  const fixtureMutations = {
    "changed label": (value) => { value.cases[0].expected_status.value = "missing"; },
    "changed provenance": (value) => { value.cases[0].expected_status.provenance.source_locator += " changed"; },
    "changed text": (value) => { value.cases[0].candidates[0].content_preview += " changed"; },
    "duplicate case": (value) => { value.cases[1].id = value.cases[0].id; },
    "duplicate candidate": (value) => { value.cases[0].candidates.push(structuredClone(value.cases[0].candidates[0])); },
  };
  for (const [name, mutate] of Object.entries(fixtureMutations)) {
    const changed = structuredClone(fixtures); mutate(changed);
    const changedPath = join(directory, `fixture-${name.replaceAll(" ", "-")}.json`);
    await writeFile(changedPath, JSON.stringify(changed));
    await assert.rejects(runHarness(["dry", "--fixtures", changedPath, "--output", join(directory, "ignored.json")]), /hash mismatch|Duplicate|duplicate/i, name);
  }

  const resultMutations = {
    "removed case": (value) => { value.arms[0].cases.pop(); },
    "added case": (value) => { value.arms[0].cases.push(structuredClone(value.arms[0].cases[0])); },
    "reordered cases": (value) => { value.arms[0].cases.reverse(); },
    "duplicate case": (value) => { value.arms[0].cases[1].case_id = value.arms[0].cases[0].case_id; },
    "removed candidate": (value) => { value.arms[0].cases[0].candidates.pop(); },
    "added candidate": (value) => { value.arms[0].cases[0].candidates.push(structuredClone(value.arms[0].cases[0].candidates[0])); },
    "reordered candidates": (value) => {
      value.arms[0].cases[0].candidates.push(structuredClone(value.arms[0].cases[0].candidates[0]));
      value.arms[0].cases[0].candidates[1].candidate_chunk_id = "unexpected";
      value.arms[0].cases[0].candidates.reverse();
    },
    "changed request hash": (value) => { value.arms[0].cases[0].candidates[0].request_hash = "0".repeat(64); },
    "arm misalignment": (value) => { value.arms[1].cases.reverse(); },
  };
  for (const [name, mutate] of Object.entries(resultMutations)) {
    const changed = structuredClone(originalResult); mutate(changed);
    const resultPath = join(directory, `result-${name.replaceAll(" ", "-")}.json`);
    await writeFile(resultPath, JSON.stringify(changed));
    await assert.rejects(runHarness(["report", "--fixtures", fixturePath, "--input", resultPath, "--output", join(directory, "report.md")]), /case IDs|candidate IDs|duplicate|request hash|alignment/i, name);
  }
});

test("offline reporting recomputes metrics instead of trusting stored aggregates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "classifier-capability-recompute-"));
  const dryPath = join(directory, "dry.json");
  const resultPath = join(directory, "result.json");
  const reportPath = join(directory, "report.md");
  await runHarness(["dry", "--fixtures", fixturePath, "--output", dryPath, "--baseline-model", "baseline-test", "--challenger-model", "challenger-test"]);
  const fixtures = JSON.parse(await readFile(fixturePath, "utf8"));
  const dry = JSON.parse(await readFile(dryPath, "utf8"));
  const result = resultFromDry(fixtures, dry);
  result.metrics = { baseline: { injected_untrusted_metric: "SHOULD_NOT_RENDER" }, challenger: { injected_untrusted_metric: "SHOULD_NOT_RENDER" } };
  await writeFile(resultPath, JSON.stringify(result));
  await runHarness(["report", "--fixtures", fixturePath, "--input", resultPath, "--output", reportPath]);
  const report = await readFile(reportPath, "utf8");
  assert.doesNotMatch(report, /SHOULD_NOT_RENDER|injected_untrusted_metric/);
  assert.match(report, /fixture_unresolved|fixture_diagnostic_only/);
});
