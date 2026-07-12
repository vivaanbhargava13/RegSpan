import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CorpusEvaluationTimeoutError,
  CorpusEvaluationSafetyError,
  assertCorpusEvaluationSafety,
  assertCorpusEvaluationExternalAiOptIn,
  assertFreshEvaluationWorkspace,
  CorpusManifestError,
  createOneShotEvaluationState,
  newEvaluationWorkspaceValues,
  evidenceIntegrityViolations,
  pollForTerminal,
  recordEvaluationFailure,
  processingResultForReport,
  scoreCaseFindings,
  evaluationWorkspaceName,
  snapshotSetViolations,
  validateCorpusManifest,
} from "../scripts/corpusEvalCore.mjs";
import {
  writeJsonAtomically,
} from "../scripts/corpusEvalState.mjs";

const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const RUN_ID = "20000000-0000-4000-8000-000000000002";
const DOCUMENT_ID = "40000000-0000-4000-8000-000000000004";

function manifestCase(id = "case-one") {
  return {
    id,
    filename: `${id}.pdf`,
    tier: "partial",
    include: { isolated: true, combined: true },
    expectedStatuses: { safeguards_customer_information: "partial" },
    acceptableAlternateStatuses: { safeguards_customer_information: ["covered"] },
    forbiddenMatches: { safeguards_customer_information: ["current page focus:"] },
    expectedEvidenceConcepts: { safeguards_customer_information: ["encryption"] },
  };
}

test("corpus manifest validates the committed 12-case tiered structure", async () => {
  const manifest = JSON.parse(await readFile("eval/corpora/regspan-v1/manifest.json", "utf8"));
  const validated = validateCorpusManifest(manifest);
  assert.equal(validated.id, "regspan-v1");
  assert.equal(validated.cases.length, 12);
  assert.deepEqual(new Set(validated.cases.map((entry) => entry.tier)), new Set([
    "weak",
    "partial",
    "strong",
    "adversarial",
  ]));
});

test("corpus manifest rejects unsafe filenames and malformed status definitions", () => {
  const valid = {
    version: 1,
    id: "corpus-test",
    cases: Array.from({ length: 10 }, (_, index) => manifestCase(`case-${index}`)),
  };
  assert.throws(
    () => validateCorpusManifest({
      ...valid,
      cases: [{ ...valid.cases[0], filename: "../outside.pdf" }, ...valid.cases.slice(1)],
    }),
    CorpusManifestError,
  );
  assert.throws(
    () => validateCorpusManifest({
      ...valid,
      cases: [{ ...valid.cases[0], expectedStatuses: { safeguards_customer_information: "unknown" } }, ...valid.cases.slice(1)],
    }),
    CorpusManifestError,
  );
});

test("terminal polling completes and times out safely", async () => {
  let attempts = 0;
  const completed = await pollForTerminal({
    load: async () => ({ status: attempts++ < 2 ? "Processing" : "Processed" }),
    terminalStatuses: new Set(["Processed", "Failed"]),
    timeoutMs: 1_000,
    intervalMs: 1,
  });
  assert.equal(completed.status, "Processed");
  assert.equal(attempts, 3);

  let now = 0;
  await assert.rejects(
    () => pollForTerminal({
      load: async () => ({ status: "Processing" }),
      terminalStatuses: new Set(["Processed", "Failed"]),
      timeoutMs: 10,
      intervalMs: 5,
      now: () => now,
      wait: async () => { now += 5; },
    }),
    CorpusEvaluationTimeoutError,
  );
});

test("production safety fails closed", () => {
  assert.throws(
    () => assertCorpusEvaluationSafety({
      environment: { NODE_ENV: "production" },
      actorUserId: "actor-id",
      workspacePrefix: "regspan-eval-",
    }),
    CorpusEvaluationSafetyError,
  );
  assert.deepEqual(assertCorpusEvaluationSafety({
    environment: { NODE_ENV: "development" },
    actorUserId: "actor-id",
    workspacePrefix: "regspan-eval-local-",
  }), { actorUserId: "actor-id", workspacePrefix: "regspan-eval-local-" });
});

test("external AI opt-in is required before evaluation workspaces are created", () => {
  assert.throws(() => assertCorpusEvaluationExternalAiOptIn(false), CorpusEvaluationSafetyError);
  assert.doesNotThrow(() => assertCorpusEvaluationExternalAiOptIn(true));
});

test("failed processing is reported with only safe job details", () => {
  assert.deepEqual(processingResultForReport({
    status: "Failed",
    step: "Extracting text",
    errorMessage: "This PDF could not be processed safely.",
  }), {
    processingStatus: "failed",
    processingStep: "Extracting text",
    processingError: "This PDF could not be processed safely.",
  });
  assert.deepEqual(processingResultForReport({ status: "Processed" }), {
    processingStatus: "processed",
    processingStep: undefined,
    processingError: undefined,
  });
  assert.equal(processingResultForReport({ status: "Unexpected" }).processingStatus, "failed");
});

test("invocation run IDs produce unique workspace names", () => {
  const input = { workspacePrefix: "regspan-eval-", corpusId: "regspan-v1", mode: "combined", workspaceKey: "combined" };
  const first = evaluationWorkspaceName({ ...input, runId: RUN_ID });
  const second = evaluationWorkspaceName({ ...input, runId: "50000000-0000-4000-8000-000000000005" });
  assert.notEqual(first, second);
  assert.match(first, new RegExp(RUN_ID));
});

test("fresh evaluator workspaces refuse any existing name", () => {
  assert.doesNotThrow(() => assertFreshEvaluationWorkspace(0));
  assert.throws(() => assertFreshEvaluationWorkspace(1), CorpusEvaluationSafetyError);
});

test("only explicitly enabled fresh evaluation workspaces receive external AI consent", () => {
  const input = {
    workspaceName: "regspan-eval-regspan-v1-isolated-run-case",
    actorUserId: ACTOR_ID,
    externalAiProcessingEnabled: true,
  };
  assert.deepEqual(newEvaluationWorkspaceValues(input), {
    name: "regspan-eval-regspan-v1-isolated-run-case",
    owner_user_id: ACTOR_ID,
    external_ai_processing_enabled: true,
  });
  assert.throws(
    () => newEvaluationWorkspaceValues({ ...input, externalAiProcessingEnabled: false }),
    CorpusEvaluationSafetyError,
  );
});

test("isolated and combined snapshots require exact document sets", () => {
  assert.deepEqual(snapshotSetViolations([DOCUMENT_ID], [DOCUMENT_ID]), []);
  assert.deepEqual(snapshotSetViolations([DOCUMENT_ID, "extra"], [DOCUMENT_ID]), ["unexpected_snapshot_document"]);
  assert.deepEqual(snapshotSetViolations([DOCUMENT_ID], [DOCUMENT_ID, "missing"]), ["missing_snapshot_document"]);
});

test("partial reports remain incomplete and are written atomically", async () => {
  const directory = await mkdtemp(join(tmpdir(), "regspan-corpus-state-"));
  try {
    const path = join(directory, "results.json");
    const state = createOneShotEvaluationState({
      runId: RUN_ID,
      corpusId: "regspan-v1",
      mode: "isolated",
      actorUserId: ACTOR_ID,
      workspacePrefix: "regspan-eval-",
      selectedCases: [{ id: "case-one", tier: "partial", filename: "case-one.pdf" }],
      startedAt: "2026-07-12T00:00:00.000Z",
    });
    recordEvaluationFailure(state, "case-one", "processing_timeout");
    await writeJsonAtomically(path, state);
    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted.status, "incomplete");
    assert.deepEqual(persisted.failures, [{ caseId: "case-one", message: "processing_timeout" }]);
    assert.deepEqual(await readdir(directory), ["results.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("case scoring recognizes alternate statuses, concepts, and forbidden evidence", () => {
  const definition = validateCorpusManifest({
    version: 1,
    id: "corpus-test",
    cases: Array.from({ length: 10 }, (_, index) => manifestCase(`case-${index}`)),
  }).cases[0];
  const finding = { id: "finding-1", requirement_id: "safeguards_customer_information", status: "covered" };
  const score = scoreCaseFindings({
    caseDefinition: definition,
    findings: [finding],
    evidenceRows: [{ finding_id: "finding-1", quote: "Encryption is required. Current page focus: safeguards." }],
  });
  assert.equal(score.statusResults[0].matched, true);
  assert.equal(score.conceptResults[0].matched, true);
  assert.equal(score.forbiddenResults[0].matched, false);
});

test("evidence integrity catches missing support, snapshot leakage, regulatory evidence, and cross-case rows", () => {
  const violations = evidenceIntegrityViolations({
    workspaceId: "workspace-a",
    snapshotDocumentIds: ["document-a"],
    caseDocumentIds: ["document-a"],
    findings: [
      { id: "finding-covered", requirement_id: "safeguards_customer_information", status: "covered" },
      { id: "finding-partial", requirement_id: "written_compliance_records", status: "partial" },
    ],
    evidenceRows: [
      {
        finding_id: "finding-covered",
        workspace_id: "workspace-b",
        document_id: "document-b",
        relationship: "supports",
        quote: "source text",
        source_type: "agency_guidance",
      },
    ],
  });
  assert.deepEqual(violations, [
    "evidence_workspace_mismatch",
    "evidence_outside_run_snapshot",
    "cross_case_evidence",
    "regulatory_or_non_client_evidence",
    "missing_primary_evidence:written_compliance_records",
  ]);
});

test("corpus runner is one-shot and contains no resume, adoption, or cleanup path", async () => {
  const [runner, evaluator, evaluatorCore, findingsGeneration, uploadService, deletionService, uploadRoute, browserConsentRoute, packageJson, gitignore, docs] = await Promise.all([
    readFile("scripts/runCorpusEval.ts", "utf8"),
    readFile("lib/corpusEvaluation.ts", "utf8"),
    readFile("scripts/corpusEvalCore.mjs", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("lib/documentUpload.ts", "utf8"),
    readFile("lib/documentDeletion.ts", "utf8"),
    readFile("app/api/documents/route.ts", "utf8"),
    readFile("app/api/workspace/external-ai-processing/route.ts", "utf8"),
    readFile("package.json", "utf8"),
    readFile(".gitignore", "utf8"),
    readFile("docs/evaluation/corpus-evaluation.md", "utf8"),
  ]);
  assert.match(runner, /writeJsonAtomically/);
  assert.match(runner, /uploadCorpusDocument/);
  assert.match(runner, /runWorkspaceAnalysis/);
  assert.match(runner, /--allow-external-ai/);
  assert.match(runner, /assertExternalAiProcessingServerAvailable/);
  assert.ok(
    runner.indexOf("assertExternalAiEvaluationSafety(args)")
      < runner.indexOf("const state = createState"),
    "external AI checks must run before evaluation workspaces can be created",
  );
  assert.doesNotMatch(runner, /--resume|--cleanup|cleanupEvaluation|recoverEvaluation|process\.once\("SIG/);
  assert.match(evaluator, /category: "findings_generate"/);
  assert.match(evaluator, /assertExactAnalysisSnapshot/);
  assert.match(evaluator, /createFreshEvaluationWorkspace/);
  assert.match(evaluatorCore, /external_ai_processing_enabled: true/);
  assert.doesNotMatch(evaluator, /\.update\(\{\s*external_ai_processing_enabled/);
  assert.doesNotMatch(evaluator, /deleteDocumentForWorkspace|cleanupEvaluation|recoverEvaluation/);
  assert.doesNotMatch(findingsGeneration, /onAnalysisRunStarted/);
  assert.match(uploadService, /queueDocumentProcessing/);
  assert.doesNotMatch(uploadService, /suppliedDocumentId|suppliedIdempotencyKey/);
  assert.match(deletionService, /delete_document_and_derived/);
  assert.match(uploadRoute, /uploadDocumentForWorkspace/);
  assert.match(browserConsentRoute, /workspace\.owner_user_id !== actor\.user\.id/);
  assert.match(packageJson, /"eval:corpus"/);
  assert.match(gitignore, /^eval-results\/$/m);
  assert.match(gitignore, /^eval\/corpora\/\*\*\/generated\/\*\.pdf$/m);
  assert.match(docs, /npm run eval:corpus/);
});
