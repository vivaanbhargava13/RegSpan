import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  BlindHoldoutSchemaError,
  bootstrapHoldoutMetrics,
  quoteDigest,
  repeatabilityMetrics,
  scoreBlindHoldout,
  toBlindExecutionArtifact,
  validateBlindAnswerKey,
  validateBlindCorpusManifest,
  validateBlindExecutionArtifact,
} from "../scripts/blindHoldoutCore.mjs";

const execFile = promisify(execFileCallback);

function answerKey(expectations) {
  return {
    schemaVersion: 1,
    corpusId: "blind-holdout-fixture",
    corpusVersion: 1,
    expectations,
  };
}

function expectation({ caseId, requirementId, status = "covered", supportedElements = [], missingElements = [], spans } = {}) {
  return {
    caseId,
    requirementId,
    primaryExpectedStatus: status,
    supportedElements,
    missingElements,
    validEvidenceSpans: spans ?? (status === "missing" ? [] : [{ spanId: `${caseId}-${requirementId}-span` }]),
    rationale: "Reviewer-approved holdout rationale.",
    reviewerLabels: [{ reviewerId: "reviewer-a", label: status }],
    adjudicatedLabel: status,
    ambiguityNotes: "",
  };
}

function artifact({ runId = "run-one", cases } = {}) {
  return {
    artifactKind: "regspan_blind_holdout_execution",
    schemaVersion: 1,
    blindExecution: true,
    runId,
    corpusId: "blind-holdout-fixture",
    corpusVersion: 1,
    mode: "isolated",
    selectedCaseIds: Object.keys(cases),
    selectedCaseCount: Object.keys(cases).length,
    executionStatus: "completed",
    cases: Object.fromEntries(Object.entries(cases).map(([caseId, entries]) => [caseId, {
      caseId,
      tier: "holdout",
      filename: `${caseId}.pdf`,
      completed: true,
      engineOutput: {
        findings: entries.map((entry) => ({
          findingId: `${caseId}-${entry.requirementId}-finding`,
          requirementId: entry.requirementId,
          status: entry.status,
        })),
        evidence: entries.flatMap((entry) => (entry.evidence ?? []).map((evidence, index) => ({
          evidenceId: `${caseId}-${entry.requirementId}-evidence-${index + 1}`,
          findingId: `${caseId}-${entry.requirementId}-finding`,
          documentId: `${caseId}-document`,
          chunkId: `${caseId}-chunk-${index + 1}`,
          relationship: evidence.relationship ?? "supports",
          quoteHash: quoteDigest(evidence.quote ?? `${caseId}-${entry.requirementId}-${index}`),
          quoteLength: (evidence.quote ?? "").length,
          finalElementIds: evidence.finalElementIds ?? [],
        }))),
      },
    }])),
  };
}

const PERFECT_EXPECTATIONS = [
  expectation({ caseId: "policy-a", requirementId: "safeguards_customer_information", supportedElements: ["administrative_safeguards"] }),
  expectation({ caseId: "policy-b", requirementId: "written_compliance_records", status: "missing", missingElements: ["compliance_record_scope"] }),
];

function perfectArtifact(runId = "run-one") {
  return artifact({
    runId,
    cases: {
      "policy-a": [{
        requirementId: "safeguards_customer_information",
        status: "covered",
        evidence: [{ quote: "Administrative safeguards are maintained.", finalElementIds: ["administrative_safeguards"] }],
      }],
      "policy-b": [{ requirementId: "written_compliance_records", status: "missing" }],
    },
  });
}

test("blind manifests exclude answer-key fields while retaining execution metadata", () => {
  const manifest = validateBlindCorpusManifest({
    version: 1,
    id: "blind-holdout-fixture",
    blindExecution: true,
    cases: [{
      id: "policy-a",
      filename: "policy-a.pdf",
      tier: "holdout",
      sourceType: "client_policy",
      include: { isolated: true },
    }],
  });
  assert.equal(manifest.cases[0].sourceType, "client_policy");
  assert.throws(() => validateBlindCorpusManifest({
    ...manifest,
    cases: [{ ...manifest.cases[0], expectedStatuses: { safeguards_customer_information: "covered" }}],
  }), BlindHoldoutSchemaError);
});

test("blind execution artifacts contain engine outputs and no answer labels", () => {
  const result = toBlindExecutionArtifact({
    runId: "run-one",
    corpusId: "blind-holdout-fixture",
    corpusVersion: 1,
    mode: "isolated",
    selectedCaseIds: ["policy-a"],
    selectedCaseCount: 1,
    filtered: false,
    executionStatus: "completed",
    status: "completed",
    startedAt: "2026-07-14T00:00:00.000Z",
    completedAt: "2026-07-14T00:01:00.000Z",
    workspaces: { "policy-a": { id: "workspace-a" } },
    cases: {
      "policy-a": {
        caseId: "policy-a",
        tier: "holdout",
        filename: "policy-a.pdf",
        workspaceKey: "policy-a",
        expectedStatuses: { safeguards_customer_information: ["covered"] },
        completed: true,
        engineOutput: {
          findings: [{ findingId: "finding-a", requirementId: "safeguards_customer_information", status: "partial" }],
          evidence: [{
            quote: "raw client source must not be serialized",
            rationale: "answer key text",
            evidenceId: "evidence-a",
            findingId: "finding-a",
            documentId: "document-a",
            chunkId: "chunk-a",
            relationship: "partially_supports",
            quoteHash: quoteDigest("raw client source must not be serialized"),
            quoteLength: 40,
            finalElementIds: [],
          }],
        },
      },
    },
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /expectedStatuses|acceptableAlternateStatuses|rationale|validEvidenceSpans|raw client source/);
  assert.equal(validateBlindExecutionArtifact(result).runId, "run-one");
});

test("perfect blind scoring reports status, element, and document metrics", () => {
  const metrics = scoreBlindHoldout({
    runArtifacts: [perfectArtifact()],
    answerKey: answerKey(PERFECT_EXPECTATIONS),
    bootstrap: { samples: 100, seed: "perfect" },
  });
  assert.equal(metrics.status.accuracy, 1);
  assert.equal(metrics.status.macroF1, 1);
  assert.equal(metrics.status.falseAssuranceCount, 0);
  assert.deepEqual(metrics.elements.overall, {
    truePositive: 1,
    falsePositive: 0,
    falseNegative: 0,
    precision: 1,
    recall: 1,
    f1: 1,
  });
  assert.equal(metrics.perDocument.every((entry) => entry.exactMatch), true);
});

test("class imbalance, false assurance, and element false positives and negatives are explicit", () => {
  const key = answerKey([
    expectation({ caseId: "policy-a", requirementId: "safeguards_customer_information", status: "partial", supportedElements: ["administrative_safeguards"], missingElements: ["physical_safeguards"] }),
    expectation({ caseId: "policy-b", requirementId: "written_compliance_records", status: "covered" }),
    expectation({ caseId: "policy-c", requirementId: "written_compliance_records", status: "covered" }),
    expectation({ caseId: "policy-d", requirementId: "written_compliance_records", status: "missing" }),
  ]);
  const run = artifact({
    cases: {
      "policy-a": [{ requirementId: "safeguards_customer_information", status: "covered", evidence: [{ finalElementIds: ["physical_safeguards"] }] }],
      "policy-b": [{ requirementId: "written_compliance_records", status: "covered", evidence: [{ finalElementIds: [] }] }],
      "policy-c": [{ requirementId: "written_compliance_records", status: "covered", evidence: [{ finalElementIds: [] }] }],
      "policy-d": [{ requirementId: "written_compliance_records", status: "covered", evidence: [{ finalElementIds: [] }] }],
    },
  });
  const metrics = scoreBlindHoldout({ runArtifacts: [run], answerKey: key, bootstrap: { samples: 100, seed: "imbalance" } });
  assert.equal(metrics.status.accuracy, 0.5);
  assert.equal(metrics.status.falseAssuranceCount, 2);
  assert.equal(metrics.status.falseAssuranceDenominator, 2);
  assert.equal(metrics.elements.overall.falsePositive, 1);
  assert.equal(metrics.elements.overall.falseNegative, 1);
});

test("document-level exact match distinguishes a partial document result", () => {
  const key = answerKey([
    expectation({ caseId: "policy-a", requirementId: "safeguards_customer_information", status: "covered" }),
    expectation({ caseId: "policy-a", requirementId: "written_compliance_records", status: "partial" }),
  ]);
  const run = artifact({ cases: {
    "policy-a": [
      { requirementId: "safeguards_customer_information", status: "covered" },
      { requirementId: "written_compliance_records", status: "missing" },
    ],
  } });
  const metrics = scoreBlindHoldout({ runArtifacts: [run], answerKey: key, bootstrap: { samples: 100, seed: "document" } });
  assert.equal(metrics.perDocument[0].accuracy, 0.5);
  assert.equal(metrics.perDocument[0].exactMatch, false);
});

test("repeatability reports status, ledger, and evidence-selection disagreement across three runs", () => {
  const key = answerKey(PERFECT_EXPECTATIONS);
  const first = perfectArtifact("run-one");
  const second = perfectArtifact("run-two");
  const third = perfectArtifact("run-three");
  third.cases["policy-a"].engineOutput.findings[0].status = "partial";
  third.cases["policy-a"].engineOutput.evidence[0].finalElementIds = [];
  third.cases["policy-a"].engineOutput.evidence[0].quoteHash = quoteDigest("different final evidence");
  const metrics = scoreBlindHoldout({ runArtifacts: [first, second, third], answerKey: key, bootstrap: { samples: 100, seed: "repeatability" } });
  assert.equal(metrics.repeatability.available, true);
  assert.ok(metrics.repeatability.overall.statusAgreement < 1);
  assert.ok(metrics.repeatability.overall.elementLedgerAgreement < 1);
  assert.ok(metrics.repeatability.overall.evidenceSelectionAgreement < 1);
  assert.equal(repeatabilityMetrics(metrics.records, metrics.runIds).available, true);
});

test("bootstrap confidence intervals are deterministic when resampling complete documents", () => {
  const metrics = scoreBlindHoldout({ runArtifacts: [perfectArtifact()], answerKey: answerKey(PERFECT_EXPECTATIONS), bootstrap: { samples: 100, seed: "bootstrap" } });
  const first = bootstrapHoldoutMetrics({ records: metrics.records, samples: 100, seed: "stable" });
  const second = bootstrapHoldoutMetrics({ records: metrics.records, samples: 100, seed: "stable" });
  assert.deepEqual(first, second);
  assert.equal(first.method, "percentile bootstrap resampling complete documents");
});

test("review metadata must target a real evidence row and does not rely on lexical span overlap", () => {
  const run = perfectArtifact();
  const metrics = scoreBlindHoldout({
    runArtifacts: [run],
    answerKey: answerKey(PERFECT_EXPECTATIONS),
    reviewerAdjudication: {
      schemaVersion: 1,
      corpusId: "blind-holdout-fixture",
      reviews: [{
        runId: "run-one",
        caseId: "policy-a",
        requirementId: "safeguards_customer_information",
        evidenceId: "policy-a-safeguards_customer_information-evidence-1",
        label: "topic_only",
      }],
    },
    bootstrap: { samples: 100, seed: "review" },
  });
  assert.equal(metrics.evidenceGrounding.unsupportedGroundedClaimCount, 1);
  assert.equal(metrics.evidenceGrounding.unsupportedGroundedClaimRate, 1);
  assert.throws(() => scoreBlindHoldout({
    runArtifacts: [run],
    answerKey: answerKey(PERFECT_EXPECTATIONS),
    reviewerAdjudication: { schemaVersion: 1, reviews: [{ runId: "run-one", caseId: "policy-a", requirementId: "safeguards_customer_information", evidenceId: "unknown", label: "supported" }] },
    bootstrap: { samples: 100, seed: "review" },
  }), BlindHoldoutSchemaError);
  assert.throws(() => scoreBlindHoldout({
    runArtifacts: [run],
    answerKey: answerKey(PERFECT_EXPECTATIONS),
    reviewerAdjudication: { schemaVersion: 1, reviews: [{ runId: "run-one", caseId: "policy-a", requirementId: "safeguards_customer_information", evidenceId: "policy-a-safeguards_customer_information-evidence-1", label: "not_a_review_label" }] },
    bootstrap: { samples: 100, seed: "review" },
  }), BlindHoldoutSchemaError);
});

test("mismatched corpus, missing cases, and missing requirements fail before scoring", () => {
  const run = perfectArtifact();
  assert.throws(() => scoreBlindHoldout({
    runArtifacts: [run],
    answerKey: { ...answerKey(PERFECT_EXPECTATIONS), corpusId: "other-corpus" },
    bootstrap: { samples: 100 },
  }), BlindHoldoutSchemaError);
  assert.throws(() => scoreBlindHoldout({
    runArtifacts: [run],
    answerKey: answerKey(PERFECT_EXPECTATIONS.slice(0, 1)),
    bootstrap: { samples: 100 },
  }), BlindHoldoutSchemaError);
  const missingRequirementRun = perfectArtifact();
  missingRequirementRun.cases["policy-a"].engineOutput.findings = [];
  missingRequirementRun.cases["policy-a"].engineOutput.evidence = [];
  assert.throws(() => scoreBlindHoldout({
    runArtifacts: [missingRequirementRun],
    answerKey: answerKey(PERFECT_EXPECTATIONS),
    bootstrap: { samples: 100 },
  }), BlindHoldoutSchemaError);
  assert.throws(() => validateBlindAnswerKey(answerKey([
    expectation({ caseId: "policy-a", requirementId: "safeguards_customer_information" }),
    expectation({ caseId: "policy-a", requirementId: "safeguards_customer_information" }),
  ])), BlindHoldoutSchemaError);
});

test("the scoring CLI accepts an answer key outside the repository and writes all artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "regspan-blind-holdout-"));
  try {
    const runDirectory = join(root, "run");
    const outputDirectory = join(root, "score-output");
    const externalAnswerKey = join(root, "external-answer-key.json");
    await writeFile(externalAnswerKey, `${JSON.stringify(answerKey(PERFECT_EXPECTATIONS))}\n`, "utf8");
    await (await import("node:fs/promises")).mkdir(runDirectory);
    await writeFile(join(runDirectory, "results.json"), `${JSON.stringify(perfectArtifact())}\n`, "utf8");
    await execFile(process.execPath, [
      "scripts/scoreBlindHoldout.mjs",
      "--run", runDirectory,
      "--answer-key", externalAnswerKey,
      "--output-dir", outputDirectory,
      "--bootstrap-samples", "100",
      "--seed", "external-key",
    ]);
    assert.deepEqual((await readdir(outputDirectory)).sort(), [
      "element-metrics.csv",
      "evidence-review.csv",
      "metrics.json",
      "per-document.csv",
      "per-requirement.csv",
      "repeatability.csv",
      "status-confusion.csv",
      "summary.md",
    ]);
    const summary = await readFile(join(outputDirectory, "summary.md"), "utf8");
    assert.match(summary, /Overall status accuracy: 100\.0% \(2\/2\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
