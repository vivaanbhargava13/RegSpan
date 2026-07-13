import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  CorpusEvaluationTimeoutError,
  CorpusEvaluationRateLimitWaitExceededError,
  CorpusEvaluationSafetyError,
  assertCorpusEvaluationSafety,
  assertCorpusEvaluationExternalAiOptIn,
  evaluationAnalysisRateLimitCategory,
  evaluationDocumentUploadRateLimitCategory,
  assertFreshEvaluationWorkspace,
  CorpusManifestError,
  createOneShotEvaluationState,
  corpusChunkClassificationViolations,
  newEvaluationWorkspaceValues,
  evidenceIntegrityViolations,
  pollForTerminal,
  retryRateLimitedOperation,
  recordEvaluationFailure,
  normalizeCorpusManifest,
  processingResultForReport,
  scoreCaseFindings,
  selectCorpusCases,
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
const execFile = promisify(execFileCallback);

function manifestCase(id = "case-one") {
  return {
    id,
    filename: `${id}.pdf`,
    tier: "partial",
    sourceType: "client_procedure",
    include: { isolated: true, combined: true },
    expectedStatuses: { safeguards_customer_information: "partial" },
    acceptableAlternateStatuses: { safeguards_customer_information: ["covered"] },
    forbiddenMatches: { safeguards_customer_information: ["current page focus:"] },
    expectedEvidenceConcepts: { safeguards_customer_information: ["encryption"] },
    expectedEvidenceElements: {},
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
  assert.deepEqual(new Set(validated.cases.map((entry) => entry.sourceType)), new Set([
    "client_policy",
    "client_procedure",
    "client_standard",
  ]));
  const notification = validated.cases.find((entry) => entry.id === "weak-notification-gap");
  assert.deepEqual(notification.expectedStatuses, {
    customer_notification_unauthorized_access: ["missing"],
  });
  const score = scoreCaseFindings({
    caseDefinition: notification,
    findings: [{
      id: "notification-finding",
      requirement_id: "customer_notification_unauthorized_access",
      status: "missing",
    }],
    evidenceRows: [],
  });
  assert.equal(score.statusResults[0].matched, true);
});

test("V2 realistic-company manifest normalizes to the canonical evaluator schema", async () => {
  const raw = JSON.parse(await readFile("eval/corpora/regspan-v2-realistic-corpus/manifest.json", "utf8"));
  const normalized = normalizeCorpusManifest(raw);
  const validated = validateCorpusManifest(raw);

  assert.equal(validated.id, "regspan-v2-realistic-company-policies");
  assert.equal(validated.version, 2);
  assert.equal(validated.cases.length, 12);
  const harborview = validated.cases.find((entry) => entry.id === "harborview-asset-advisors");
  assert.equal(harborview.sourceType, "client_policy");
  assert.equal(harborview.documentPath, "documents/harborview_customer_information_safeguards_program.pdf");
  assert.deepEqual(harborview.expectedStatuses.safeguards_customer_information, ["covered"]);
  assert.equal(normalized.id, validated.id);
  assert.equal(harborview.include.isolated, true);
  assert.equal(harborview.include.combined, false);
});

test("V2 Westbridge partial expectations remain synchronized with the answer key and summary", async () => {
  const root = "eval/corpora/regspan-v2-realistic-corpus";
  const manifest = validateCorpusManifest(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
  const westbridge = manifest.cases.find((entry) => entry.id === "westbridge-securities");
  assert.ok(westbridge);
  assert.deepEqual(westbridge.expectedStatuses.incident_assessment_containment_control, ["partial"]);
  assert.deepEqual(westbridge.expectedStatuses.response_recovery_remediation_validation, ["partial"]);

  const answerKey = await readFile(join(root, "answer_key.csv"), "utf8");
  for (const requirementId of [
    "incident_assessment_containment_control",
    "response_recovery_remediation_validation",
  ]) {
    const row = answerKey.split(/\r?\n/).find((line) => line.startsWith("westbridge-securities,") && line.includes(`,${requirementId},`));
    assert.ok(row, `missing Westbridge answer-key row for ${requirementId}`);
    assert.match(row, new RegExp(`,${requirementId},(?:"[^"]*"|[^,]*),partial,`));
  }

  const summary = await readFile(join(root, "company_summary.csv"), "utf8");
  const summaryRow = summary.split(/\r?\n/).find((line) => line.startsWith("westbridge-securities,"));
  assert.equal(summaryRow, "westbridge-securities,Westbridge Securities Corporation,Broker-Dealer,westbridge_information_technology_security_policy.pdf,weak,0,5,6");

  const selectedTotals = ["harborview-asset-advisors", "meridian-transfer-trust", "westbridge-securities"]
    .map((caseId) => manifest.cases.find((entry) => entry.id === caseId))
    .flatMap((entry) => Object.values(entry.expectedStatuses).flat());
  assert.deepEqual(selectedTotals.reduce((totals, status) => ({
    ...totals,
    [status]: totals[status] + 1,
  }), { covered: 0, partial: 0, missing: 0 }), { covered: 22, partial: 5, missing: 6 });
});

test("V2 case selection remains isolated, ordered, and corpus-scoped", async () => {
  const raw = JSON.parse(await readFile("eval/corpora/regspan-v2-realistic-corpus/manifest.json", "utf8"));
  const { cases } = validateCorpusManifest(raw);
  const selected = selectCorpusCases({
    cases,
    requestedCaseIds: ["meridian-transfer-trust", "harborview-asset-advisors", "meridian-transfer-trust"],
    mode: "isolated",
  });
  assert.deepEqual(selected.selectedCaseIds, ["harborview-asset-advisors", "meridian-transfer-trust"]);
  assert.equal(selected.filtered, true);
  assert.throws(
    () => selectCorpusCases({ cases, requestedCaseIds: ["strong-safeguards"], mode: "isolated" }),
    /Unknown corpus case ID: strong-safeguards/,
  );
  assert.throws(
    () => selectCorpusCases({ cases, requestedCaseIds: ["harborview-asset-advisors"], mode: "combined" }),
    /not enabled for combined/,
  );
});

test("V2 manifest rejects invalid requirement IDs before evaluation workspaces can be created", async () => {
  const raw = JSON.parse(await readFile("eval/corpora/regspan-v2-realistic-corpus/manifest.json", "utf8"));
  raw.cases[0].expectedStatuses[0].requirementId = "not_a_current_requirement";
  assert.throws(() => validateCorpusManifest(raw), /not a canonical requirement id/);
});

test("V2 inventory hashes and byte counts match its selected PDF fixtures", async () => {
  const root = "eval/corpora/regspan-v2-realistic-corpus";
  const manifest = validateCorpusManifest(JSON.parse(await readFile(join(root, "manifest.json"), "utf8")));
  const inventory = await readFile(join(root, "inventory.csv"), "utf8");
  const expected = new Map(inventory.trim().split(/\r?\n/).slice(1).map((line) => {
    const [filename] = line.split(",", 1);
    const match = line.match(/,(\d+),([a-f0-9]{64})$/i);
    return [filename, { bytes: Number(match?.[1]), sha256: match?.[2].toLowerCase() }];
  }));
  for (const definition of manifest.cases) {
    const bytes = await readFile(join(root, definition.documentPath));
    const entry = expected.get(definition.filename);
    assert.ok(entry, `missing inventory entry for ${definition.filename}`);
    assert.equal(bytes.byteLength, entry.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  }
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
  assert.throws(
    () => validateCorpusManifest({
      ...valid,
      cases: [{ ...valid.cases[0], sourceType: "unknown" }, ...valid.cases.slice(1)],
    }),
    CorpusManifestError,
  );
  assert.throws(
    () => validateCorpusManifest({
      ...valid,
      cases: [{
        ...valid.cases[0],
        expectedStatuses: { customer_notification_trigger_timing: "missing" },
      }, ...valid.cases.slice(1)],
    }),
    CorpusManifestError,
  );
  assert.throws(
    () => validateCorpusManifest({
      ...valid,
      cases: [{
        ...valid.cases[0],
        expectedEvidenceElements: { safeguards_customer_information: ["not_a_real_element"] },
      }, ...valid.cases.slice(1)],
    }, {
      canonicalRequirementElements: {
        safeguards_customer_information: ["access_controls", "encryption"],
      },
    }),
    /unknown canonical element id/,
  );
});

test("corpus case selection is validated, deduplicated, and ordered by the manifest", () => {
  const cases = [
    manifestCase("case-a"),
    manifestCase("case-b"),
    manifestCase("case-c"),
  ];
  const one = selectCorpusCases({
    cases,
    requestedCaseIds: ["case-b"],
    mode: "isolated",
  });
  assert.deepEqual(one.selectedCaseIds, ["case-b"]);
  assert.equal(one.filtered, true);

  const multiple = selectCorpusCases({
    cases,
    requestedCaseIds: ["case-c", "case-a", "case-c"],
    mode: "isolated",
  });
  assert.deepEqual(multiple.selectedCaseIds, ["case-a", "case-c"]);
  assert.equal(multiple.selectedCases.length, 2);

  const full = selectCorpusCases({ cases, requestedCaseIds: [], mode: "isolated" });
  assert.deepEqual(full.selectedCaseIds, ["case-a", "case-b", "case-c"]);
  assert.equal(full.filtered, false);

  assert.throws(
    () => selectCorpusCases({ cases, requestedCaseIds: ["unknown-case"], mode: "isolated" }),
    /Unknown corpus case ID: unknown-case\. Valid case IDs: case-a, case-b, case-c\./,
  );
});

test("corpus pre-Analysis classification requires declared organization evidence", () => {
  assert.deepEqual(corpusChunkClassificationViolations({
    sourceType: "client_standard",
    requireOrganizationEvidence: true,
    chunks: [{ metadata: { source_type: "client_standard", evidence_role: "organization_evidence" } }],
  }), []);
  assert.deepEqual(corpusChunkClassificationViolations({
    sourceType: "client_policy",
    requireOrganizationEvidence: true,
    chunks: [{ metadata: { source_type: "unknown", evidence_role: "supporting_context" } }],
  }), ["source_type_mismatch", "evidence_role_not_organization_evidence"]);
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

test("rate-limited Analysis waits, rechecks, and retries without repeating prior work", async () => {
  const rateLimitError = Object.assign(new Error("Too many requests."), {
    retryAfterSeconds: 2,
    category: "findings_generate",
    code: "rate_limited",
  });
  let analysisAttempts = 0;
  let recoveryChecks = 0;
  const waits = [];
  const result = await retryRateLimitedOperation({
    operation: async () => {
      analysisAttempts += 1;
      if (analysisAttempts === 1) throw rateLimitError;
      return { analysisRunId: "analysis-a" };
    },
    beforeRetry: async () => {
      recoveryChecks += 1;
      return null;
    },
    isRateLimitError: (error) => error === rateLimitError,
    maxRateLimitWaitMs: 10_000,
    sleep: async (milliseconds) => { waits.push(milliseconds); },
  });
  assert.equal(analysisAttempts, 2);
  assert.equal(recoveryChecks, 1);
  assert.deepEqual(waits, [2_000]);
  assert.deepEqual(result, {
    value: { analysisRunId: "analysis-a" },
    rateLimitWaitCount: 1,
    rateLimitWaitMs: 2_000,
  });
});

test("rate-limit retry recovers an existing Analysis before retrying generation", async () => {
  const rateLimitError = Object.assign(new Error("Too many requests."), { retryAfterSeconds: 1 });
  let analysisAttempts = 0;
  const result = await retryRateLimitedOperation({
    operation: async () => {
      analysisAttempts += 1;
      throw rateLimitError;
    },
    beforeRetry: async () => ({ analysisRunId: "completed-analysis" }),
    isRateLimitError: (error) => error === rateLimitError,
    maxRateLimitWaitMs: 10_000,
    sleep: async () => {},
  });
  assert.equal(analysisAttempts, 1);
  assert.equal(result.value.analysisRunId, "completed-analysis");
  assert.equal(result.rateLimitWaitCount, 1);
});

test("rate-limit retry fails fast when disabled, bounded, or unrelated", async () => {
  const rateLimitError = Object.assign(new Error("Too many requests."), { retryAfterSeconds: 2 });
  await assert.rejects(
    () => retryRateLimitedOperation({
      operation: async () => { throw rateLimitError; },
      isRateLimitError: (error) => error === rateLimitError,
      waitOnRateLimit: false,
      maxRateLimitWaitMs: 10_000,
    }),
    (error) => error === rateLimitError,
  );
  await assert.rejects(
    () => retryRateLimitedOperation({
      operation: async () => { throw rateLimitError; },
      isRateLimitError: (error) => error === rateLimitError,
      maxRateLimitWaitMs: 1_000,
      sleep: async () => {},
    }),
    CorpusEvaluationRateLimitWaitExceededError,
  );
  const otherError = new Error("Analysis failed.");
  await assert.rejects(
    () => retryRateLimitedOperation({
      operation: async () => { throw otherError; },
      isRateLimitError: () => false,
      maxRateLimitWaitMs: 10_000,
    }),
    (error) => error === otherError,
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

test("evaluator-only Analysis quota requires an authorized evaluation workspace", () => {
  const input = {
    evaluationAuthorized: true,
    workspaceName: "regspan-eval-regspan-v1-isolated-run-case",
    workspacePrefix: "regspan-eval-",
    actorOwnsWorkspace: true,
    environment: { NODE_ENV: "development" },
  };
  assert.equal(evaluationAnalysisRateLimitCategory(input), "findings_generate_eval");
  assert.equal(evaluationDocumentUploadRateLimitCategory(input), "document_upload_eval");
  assert.throws(
    () => evaluationAnalysisRateLimitCategory({ ...input, workspaceName: "normal-workspace" }),
    CorpusEvaluationSafetyError,
  );
  assert.throws(
    () => evaluationDocumentUploadRateLimitCategory({ ...input, workspaceName: "normal-workspace" }),
    CorpusEvaluationSafetyError,
  );
  assert.throws(
    () => evaluationAnalysisRateLimitCategory({ ...input, actorOwnsWorkspace: false }),
    CorpusEvaluationSafetyError,
  );
  assert.throws(
    () => evaluationAnalysisRateLimitCategory({
      ...input,
      environment: { NODE_ENV: "production" },
    }),
    CorpusEvaluationSafetyError,
  );
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
      corpusVersion: 1,
      corpusPath: "eval/corpora/regspan-v1",
      mode: "isolated",
      actorUserId: ACTOR_ID,
      workspacePrefix: "regspan-eval-",
      selectedCases: [{ id: "case-one", tier: "partial", filename: "case-one.pdf" }],
      filtered: true,
      startedAt: "2026-07-12T00:00:00.000Z",
    });
    recordEvaluationFailure(state, "case-one", "processing_timeout");
    await writeJsonAtomically(path, state);
    const persisted = JSON.parse(await readFile(path, "utf8"));
    assert.equal(persisted.status, "incomplete");
    assert.equal(persisted.corpusVersion, 1);
    assert.equal(persisted.corpusPath, "eval/corpora/regspan-v1");
    assert.deepEqual(persisted.selectedCaseIds, ["case-one"]);
    assert.equal(persisted.selectedCaseCount, 1);
    assert.equal(persisted.filtered, true);
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
    evidenceRows: [{
      finding_id: "finding-1",
      relationship: "supports",
      quote: "Encryption is required. Current page focus: safeguards.",
    }],
  });
  assert.equal(score.statusResults[0].matched, true);
  assert.equal(score.conceptResults[0].matched, true);
  assert.equal(score.forbiddenResults[0].matched, false);
});

test("case scoring uses only positive evidence for concepts and forbidden phrases", () => {
  const definition = validateCorpusManifest({
    version: 1,
    id: "corpus-test",
    cases: Array.from({ length: 10 }, (_, index) => manifestCase(`case-${index}`)),
  }).cases[0];
  const finding = { id: "finding-1", requirement_id: "safeguards_customer_information", status: "partial" };

  const negativeOnly = scoreCaseFindings({
    caseDefinition: definition,
    findings: [finding],
    evidenceRows: [{
      finding_id: "finding-1",
      relationship: "negative_evidence",
      quote: "Encryption is not required. Current page focus: safeguards.",
    }],
  });
  assert.equal(negativeOnly.conceptResults[0].matched, false);
  assert.equal(negativeOnly.forbiddenResults[0].matched, true);

  const positive = scoreCaseFindings({
    caseDefinition: definition,
    findings: [finding],
    evidenceRows: [{
      finding_id: "finding-1",
      relationship: "supports",
      quote: "Encryption is required. Current page focus: safeguards.",
    }],
  });
  assert.equal(positive.conceptResults[0].matched, true);
  assert.equal(positive.forbiddenResults[0].matched, false);
});

test("case scoring evaluates canonical elements from final positive evidence quotes only", () => {
  const definition = {
    expectedStatuses: {},
    acceptableAlternateStatuses: {},
    expectedEvidenceConcepts: {},
    expectedEvidenceElements: { incident_assessment_containment_control: ["containment_control"] },
    forbiddenMatches: {},
  };
  const finding = {
    id: "finding-containment",
    requirement_id: "incident_assessment_containment_control",
    status: "partial",
  };
  const resolverCalls = [];
  const resolver = ({ quote }) => {
    resolverCalls.push(quote);
    return /selects containment actions/i.test(quote) ? ["containment_control"] : [];
  };

  const positive = scoreCaseFindings({
    caseDefinition: definition,
    findings: [finding],
    evidenceRows: [{
      finding_id: finding.id,
      relationship: "supports",
      quote: "The technical lead selects containment actions intended to limit ongoing harm.",
      reason: "The broader chunk also discusses containment.",
      content_preview: "The broader chunk says containment even when the quote does not.",
    }],
    resolveFinalQuoteElementIds: resolver,
  });
  assert.deepEqual(positive.elementResults[0], {
    requirementId: "incident_assessment_containment_control",
    elements: ["containment_control"],
    matchedElements: ["containment_control"],
    missingElements: [],
    matched: true,
  });
  assert.deepEqual(resolverCalls, ["The technical lead selects containment actions intended to limit ongoing harm."]);

  const negative = scoreCaseFindings({
    caseDefinition: definition,
    findings: [finding],
    evidenceRows: [{
      finding_id: finding.id,
      relationship: "negative_evidence",
      quote: "The technical lead selects containment actions intended to limit ongoing harm.",
    }],
    resolveFinalQuoteElementIds: resolver,
  });
  assert.equal(negative.elementResults[0].matched, false);
  assert.deepEqual(negative.elementResults[0].missingElements, ["containment_control"]);

  const reasonOnly = scoreCaseFindings({
    caseDefinition: definition,
    findings: [finding],
    evidenceRows: [{
      finding_id: finding.id,
      relationship: "supports",
      quote: "The review was completed.",
      reason: "The broader chunk proves containment.",
      content_preview: "Containment actions are described elsewhere in the chunk.",
    }],
    resolveFinalQuoteElementIds: resolver,
  });
  assert.equal(reasonOnly.elementResults[0].matched, false);
  assert.deepEqual(reasonOnly.elementResults[0].missingElements, ["containment_control"]);
});

test("case scoring excludes expected and alternate positive statuses from unexpectedCovered", () => {
  const definition = {
    expectedStatuses: { written_incident_response_program: ["missing"] },
    acceptableAlternateStatuses: { written_incident_response_program: ["partial"] },
    expectedEvidenceConcepts: {},
    expectedEvidenceElements: {},
    forbiddenMatches: {},
  };

  for (const status of ["partial", "missing"]) {
    const score = scoreCaseFindings({
      caseDefinition: definition,
      findings: [{ id: `finding-${status}`, requirement_id: "written_incident_response_program", status }],
      evidenceRows: [],
    });
    assert.deepEqual(score.unexpectedCovered, []);
  }
});

test("audited manifest cases encode their corrected status and concept expectations", async () => {
  const manifest = validateCorpusManifest(JSON.parse(await readFile("eval/corpora/regspan-v1/manifest.json", "utf8")));
  const byId = new Map(manifest.cases.map((entry) => [entry.id, entry]));

  const adversarial = byId.get("adversarial-scaffolding");
  assert.deepEqual(adversarial.acceptableAlternateStatuses.written_incident_response_program, undefined);
  assert.deepEqual(adversarial.forbiddenMatches.written_incident_response_program, [
    "Current page focus:",
    "Updated ownership, terminology, and responsibilities.",
  ]);

  const vendorNotice = byId.get("partial-vendor-notice");
  assert.deepEqual(vendorNotice.acceptableAlternateStatuses.service_provider_incident_oversight_notice, ["missing", "conflicting"]);

  const safeguards = byId.get("strong-safeguards");
  assert.deepEqual(safeguards.expectedEvidenceConcepts.safeguards_customer_information, ["encryption"]);

  const assessment = byId.get("partial-incident-assessment");
  assert.deepEqual(assessment.expectedEvidenceConcepts, {});
  assert.deepEqual(assessment.expectedEvidenceElements.incident_assessment_containment_control, ["containment_control"]);

  const recovery = byId.get("partial-recovery-validation");
  assert.deepEqual(recovery.expectedEvidenceConcepts, {});
  assert.deepEqual(recovery.expectedEvidenceElements.response_recovery_remediation_validation, ["recovery_steps"]);
});

test("evaluator evidence compatibility accepts quote and evidence_quote without source_quote", async () => {
  const evaluator = await readFile("lib/corpusEvaluation.ts", "utf8");
  assert.match(
    evaluator,
    /select\("id, finding_id, workspace_id, document_id, chunk_id, relationship, quote, evidence_quote"\)/,
  );
  assert.doesNotMatch(evaluator, /relationship, quote, evidence_quote, source_quote/);

  const definition = validateCorpusManifest({
    version: 1,
    id: "corpus-test",
    cases: Array.from({ length: 10 }, (_, index) => manifestCase(`case-${index}`)),
  }).cases[0];
  const score = scoreCaseFindings({
    caseDefinition: definition,
    findings: [{ id: "finding-1", requirement_id: "safeguards_customer_information", status: "partial" }],
    evidenceRows: [{ finding_id: "finding-1", relationship: "partially_supports", evidence_quote: "Encryption is required." }],
  });
  assert.equal(score.conceptResults[0].matched, true);

  const program = `
    import { loadEvaluationRunData } from "./lib/corpusEvaluation.ts";
    const selected = {};
    const rows = {
      workspaces: [{ id: "workspace-a", name: "regspan-eval-corpus-a-isolated-run-a-case-a", owner_user_id: "actor-a" }],
      workspace_members: [{ workspace_id: "workspace-a" }],
      analysis_run_documents: [{ document_id: "document-a", filename: "fixture.pdf", document_status: "Processed" }],
      findings: [{ id: "finding-a", requirement_id: "safeguards_customer_information", status: "partial" }],
      finding_evidence: [
        { id: "evidence-a", finding_id: "finding-a", workspace_id: "workspace-a", document_id: "document-a", chunk_id: "chunk-a", relationship: "supports", quote: null, evidence_quote: "Encryption is required." },
        { id: "evidence-regulatory", finding_id: "finding-a", workspace_id: "workspace-a", document_id: "document-a", chunk_id: "regulatory-a", relationship: "background_context", quote: null, evidence_quote: "Reference text." },
      ],
      document_chunks: [{ id: "chunk-a", document_id: "document-a", workspace_id: "workspace-a", metadata: { source_type: "client_policy" } }],
      regulatory_source_chunks: [{ id: "regulatory-a" }],
    };
    function query(table) {
      const chain = {
        select(value) { selected[table] = value; return chain; },
        eq() { return chain; },
        in() { return chain; },
        maybeSingle() { return Promise.resolve({ data: rows[table][0] ?? null, error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve, reject); },
      };
      return chain;
    }
    const result = await loadEvaluationRunData({
      supabase: { from: query },
      context: { runId: "run-a", actorUserId: "actor-a", corpusId: "corpus-a", mode: "isolated", workspacePrefix: "regspan-eval-", workspaceKey: "case-a", workspaceName: "regspan-eval-corpus-a-isolated-run-a-case-a", workspaceId: "workspace-a", externalAiProcessingEnabled: true },
      analysisRunId: "analysis-a",
      expectedDocumentIds: ["document-a"],
    });
    console.log(JSON.stringify({ selected: selected.finding_evidence, evidence: result.evidence }));
  `;
  const { stdout } = await execFile(process.execPath, [
    "--conditions=react-server",
    "--import", "./scripts/registerServerTsLoader.mjs",
    "--input-type=module",
    "--eval", program,
  ], { cwd: process.cwd() });
  const loaded = JSON.parse(stdout);
  assert.equal(
    loaded.selected,
    "id, finding_id, workspace_id, document_id, chunk_id, relationship, quote, evidence_quote",
  );
  assert.equal(loaded.evidence[0].evidence_quote, "Encryption is required.");
  assert.equal(loaded.evidence[0].source_resolution, "client_document_chunk");
  assert.equal(loaded.evidence[0].chunk_document_id, "document-a");
  assert.equal(loaded.evidence[0].chunk_workspace_id, "workspace-a");
  assert.equal(loaded.evidence[0].source_type, "client_policy");
  assert.equal(loaded.evidence[1].source_resolution, "regulatory_source_chunk");
  assert.equal(loaded.evidence[1].chunk_document_id, null);
});

test("evaluator diagnostics retain only a fixed evidence-query category", () => {
  const state = createOneShotEvaluationState({
    runId: RUN_ID,
    corpusId: "regspan-v1",
    mode: "isolated",
    actorUserId: ACTOR_ID,
    workspacePrefix: "regspan-eval-",
    selectedCases: [{ id: "case-one", tier: "partial", filename: "case-one.pdf" }],
    startedAt: "2026-07-12T00:00:00.000Z",
  });
  recordEvaluationFailure(
    state,
    "case-one",
    "Finding evidence could not be loaded.",
    "finding_evidence_query_failed",
  );
  assert.equal(state.cases["case-one"].diagnosticCode, "finding_evidence_query_failed");
  assert.equal(state.failures[0].diagnosticCode, "finding_evidence_query_failed");
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
        source_resolution: "regulatory_source_chunk",
        chunk_document_id: null,
        chunk_workspace_id: null,
        source_type: "agency_guidance",
      },
    ],
  });
  assert.deepEqual(violations, [
    "evidence_workspace_mismatch",
    "evidence_outside_run_snapshot",
    "cross_case_evidence",
    "evidence_source_not_client_document_chunk",
    "evidence_chunk_document_mismatch",
    "evidence_chunk_workspace_mismatch",
    "regulatory_or_non_client_evidence",
    "missing_primary_evidence:safeguards_customer_information",
    "missing_primary_evidence:written_compliance_records",
  ]);
});

test("evidence integrity accepts only resolved client chunks with matching document and workspace provenance", () => {
  const base = {
    finding_id: "finding-a",
    workspace_id: "workspace-a",
    document_id: "document-a",
    chunk_document_id: "document-a",
    chunk_workspace_id: "workspace-a",
    source_resolution: "client_document_chunk",
    relationship: "supports",
    evidence_quote: "Encryption is required.",
  };
  const input = (evidenceRows) => evidenceIntegrityViolations({
    workspaceId: "workspace-a",
    snapshotDocumentIds: ["document-a"],
    caseDocumentIds: ["document-a"],
    findings: [{ id: "finding-a", requirement_id: "safeguards_customer_information", status: "partial" }],
    evidenceRows,
  });

  assert.deepEqual(input([{ ...base, source_type: "unknown" }]), []);
  assert.deepEqual(input([{ ...base, source_type: "client_procedure" }]), []);
  assert.deepEqual(input([{ ...base, source_resolution: "regulatory_source_chunk", source_type: "regulatory_reference" }]), [
    "evidence_source_not_client_document_chunk",
    "regulatory_or_non_client_evidence",
    "missing_primary_evidence:safeguards_customer_information",
  ]);
  assert.deepEqual(input([{ ...base, source_resolution: "unresolved", chunk_document_id: null, chunk_workspace_id: null }]), [
    "evidence_source_not_client_document_chunk",
    "evidence_chunk_document_mismatch",
    "evidence_chunk_workspace_mismatch",
    "missing_primary_evidence:safeguards_customer_information",
  ]);
  assert.deepEqual(input([{ ...base, chunk_document_id: "document-b", chunk_workspace_id: "workspace-b" }]), [
    "evidence_chunk_document_mismatch",
    "evidence_chunk_workspace_mismatch",
    "missing_primary_evidence:safeguards_customer_information",
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
  assert.match(runner, /sourceType: definition\.sourceType/);
  assert.match(runner, /runWorkspaceAnalysis/);
  assert.match(runner, /--allow-external-ai/);
  assert.match(runner, /assertExternalAiProcessingServerAvailable/);
  assert.match(runner, /error instanceof RateLimitError/);
  assert.match(runner, /findings_generate_eval/);
  assert.match(runner, /recoverWorkspaceAnalysis/);
  assert.match(runner, /rateLimitWaitCount/);
  assert.match(runner, /rateLimitWaitMs/);
  assert.match(runner, /--case <case-id>/);
  assert.match(runner, /const DEFAULT_CORPUS = "regspan-v1"/);
  assert.match(runner, /--corpus <corpus-id-or-directory>/);
  assert.match(runner, /resolveCorpusDirectory\(args\.corpus\)/);
  assert.match(runner, /preflightCorpusFiles/);
  assert.match(runner, /Corpus version:/);
  assert.match(runner, /expectedStatusTotals/);
  assert.match(runner, /actualStatusTotals/);
  assert.match(runner, /Selected case count:/);
  assert.match(runner, /selected_case_ids/);
  assert.ok(
    runner.indexOf("assertExternalAiEvaluationSafety(args)")
      < runner.indexOf("const state = createState"),
    "external AI checks must run before evaluation workspaces can be created",
  );
  assert.ok(
    runner.indexOf("selectCorpusCases({")
      < runner.indexOf("const state = createState"),
    "case selection must be validated before evaluation workspaces can be created",
  );
  assert.doesNotMatch(runner, /--resume|--cleanup|cleanupEvaluation|recoverEvaluation|process\.once\("SIG/);
  assert.match(evaluator, /evaluationAnalysisRateLimitForContext/);
  assert.match(evaluator, /evaluationDocumentUploadRateLimitForContext/);
  assert.match(evaluator, /assertExactAnalysisSnapshot/);
  assert.match(evaluator, /createFreshEvaluationWorkspace/);
  assert.match(evaluator, /Source type: \$\{sourceType\.replace/);
  assert.match(evaluator, /assertCorpusDocumentClassification/);
  assert.match(evaluator, /\.in\("status", \["queued", "running", "completed"\]\)/);
  assert.match(evaluatorCore, /external_ai_processing_enabled: true/);
  assert.match(evaluatorCore, /Unknown corpus case ID/);
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
  assert.match(docs, /--case partial-evidence-preservation/);
  assert.match(docs, /--corpus regspan-v2-realistic-corpus/);
});
