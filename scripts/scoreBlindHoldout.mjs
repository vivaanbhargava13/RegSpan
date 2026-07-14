#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  BlindHoldoutSchemaError,
  evidenceReviewTemplateRows,
  renderBlindHoldoutSummary,
  scoreBlindHoldout,
  toCsv,
} from "./blindHoldoutCore.mjs";

const DEFAULT_BOOTSTRAP_SAMPLES = 2_000;
const DEFAULT_CONFIDENCE_LEVEL = 0.95;

function usage() {
  console.log(`RegSpan blind holdout scoring

Usage:
  npm run eval:score-holdout -- --run <completed-run-dir> [--run <completed-run-dir> ...] --answer-key <path> [options]

Options:
  --run <directory>             Completed blind execution result directory; repeat for repeatability scoring.
  --answer-key <path>           Versioned answer-key JSON. This path may be outside the repository.
  --review <path>               Optional reviewer-adjudication JSON.
  --output-dir <directory>      Output directory. Defaults under ignored eval-results/.
  --bootstrap-samples <number>  Whole-document bootstrap samples. Defaults to ${DEFAULT_BOOTSTRAP_SAMPLES}.
  --confidence-level <0..1>     Bootstrap confidence level. Defaults to ${DEFAULT_CONFIDENCE_LEVEL}.
  --seed <value>                Deterministic bootstrap seed. Defaults to regspan-blind-holdout.
  --help                        Show this help.

This command never uploads documents, starts processing, or calls Analysis.
`);
}

function parseArgs(argv) {
  const args = {
    runDirectories: [],
    answerKeyPath: null,
    reviewPath: null,
    outputDirectory: null,
    bootstrapSamples: DEFAULT_BOOTSTRAP_SAMPLES,
    confidenceLevel: DEFAULT_CONFIDENCE_LEVEL,
    seed: "regspan-blind-holdout",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--run") { args.runDirectories.push(next ?? ""); index += 1; }
    else if (arg === "--answer-key") { args.answerKeyPath = next ?? null; index += 1; }
    else if (arg === "--review") { args.reviewPath = next ?? null; index += 1; }
    else if (arg === "--output-dir") { args.outputDirectory = next ?? null; index += 1; }
    else if (arg === "--bootstrap-samples") { args.bootstrapSamples = Number(next); index += 1; }
    else if (arg === "--confidence-level") { args.confidenceLevel = Number(next); index += 1; }
    else if (arg === "--seed") { args.seed = next ?? ""; index += 1; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.help) return args;
  if (args.runDirectories.length === 0 || args.runDirectories.some((directory) => !directory)) {
    throw new Error("Provide at least one --run directory.");
  }
  if (!args.answerKeyPath) throw new Error("--answer-key is required.");
  if (!Number.isSafeInteger(args.bootstrapSamples) || args.bootstrapSamples < 100 || args.bootstrapSamples > 20_000) {
    throw new Error("--bootstrap-samples must be an integer from 100 through 20000.");
  }
  if (!(args.confidenceLevel > 0 && args.confidenceLevel < 1)) {
    throw new Error("--confidence-level must be between zero and one.");
  }
  if (!String(args.seed).trim()) throw new Error("--seed must not be empty.");
  return args;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Unable to read ${label}: ${basename(path)}.`);
  }
}

function statusConfusionRows(metrics) {
  return metrics.status.classes.flatMap((expected) => metrics.status.classes.map((actual) => ({
    expected_status: expected,
    actual_status: actual,
    count: metrics.status.confusion[expected][actual],
  })));
}

function perRequirementRows(metrics) {
  return Object.entries(metrics.perRequirement).map(([requirementId, value]) => ({
    requirement_id: requirementId,
    total: value.total,
    matched: value.matched,
    accuracy: value.accuracy,
    macro_precision: value.macroPrecision,
    macro_recall: value.macroRecall,
    macro_f1: value.macroF1,
    false_assurance_count: value.falseAssuranceCount,
    false_assurance_rate: value.falseAssuranceRate,
  }));
}

function perDocumentRows(metrics) {
  return Object.entries(metrics.perRun).flatMap(([runId, value]) => value.perDocument.map((entry) => ({
    run_id: runId,
    case_id: entry.caseId,
    total: entry.total,
    matched: entry.matched,
    accuracy: entry.accuracy,
    exact_match: entry.exactMatch,
  })));
}

function elementRows(metrics) {
  const rows = [{ requirement_id: "overall", ...metrics.elements.overall }];
  for (const [requirementId, value] of Object.entries(metrics.elements.byRequirement)) {
    rows.push({ requirement_id: requirementId, ...value });
  }
  return rows;
}

function repeatabilityRows(metrics) {
  if (!metrics.repeatability.available) {
    return [{ scope_type: "overall", scope_id: "not_available", run_count: metrics.repeatability.runCount, status_agreement: "", element_ledger_agreement: "", evidence_selection_agreement: "", instability: "" }];
  }
  return [
    { scope_type: "overall", scope_id: "overall", run_count: metrics.repeatability.runCount, status_agreement: metrics.repeatability.overall.statusAgreement, element_ledger_agreement: metrics.repeatability.overall.elementLedgerAgreement, evidence_selection_agreement: metrics.repeatability.overall.evidenceSelectionAgreement, instability: metrics.repeatability.overall.instability },
    ...metrics.repeatability.perCase.map((entry) => ({ scope_type: "case", scope_id: entry.caseId, run_count: metrics.repeatability.runCount, status_agreement: entry.statusAgreement, element_ledger_agreement: entry.elementLedgerAgreement, evidence_selection_agreement: entry.evidenceSelectionAgreement, instability: entry.instability })),
    ...metrics.repeatability.perRequirement.map((entry) => ({ scope_type: "requirement", scope_id: entry.requirementId, run_count: metrics.repeatability.runCount, status_agreement: entry.statusAgreement, element_ledger_agreement: entry.elementLedgerAgreement, evidence_selection_agreement: entry.evidenceSelectionAgreement, instability: entry.instability })),
  ];
}

async function writeOutputs(outputDirectory, metrics) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(outputDirectory, "summary.md"), renderBlindHoldoutSummary(metrics), "utf8"),
    writeFile(join(outputDirectory, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
    writeFile(join(outputDirectory, "status-confusion.csv"), toCsv(statusConfusionRows(metrics), ["expected_status", "actual_status", "count"]), "utf8"),
    writeFile(join(outputDirectory, "per-requirement.csv"), toCsv(perRequirementRows(metrics), ["requirement_id", "total", "matched", "accuracy", "macro_precision", "macro_recall", "macro_f1", "false_assurance_count", "false_assurance_rate"]), "utf8"),
    writeFile(join(outputDirectory, "per-document.csv"), toCsv(perDocumentRows(metrics), ["run_id", "case_id", "total", "matched", "accuracy", "exact_match"]), "utf8"),
    writeFile(join(outputDirectory, "element-metrics.csv"), toCsv(elementRows(metrics), ["requirement_id", "truePositive", "falsePositive", "falseNegative", "precision", "recall", "f1"]), "utf8"),
    writeFile(join(outputDirectory, "repeatability.csv"), toCsv(repeatabilityRows(metrics), ["scope_type", "scope_id", "run_count", "status_agreement", "element_ledger_agreement", "evidence_selection_agreement", "instability"]), "utf8"),
    writeFile(join(outputDirectory, "evidence-review.csv"), toCsv(evidenceReviewTemplateRows(metrics), ["runId", "caseId", "requirementId", "evidenceId", "findingId", "relationship", "quoteHash", "finalElementIds", "validEvidenceSpanIds", "reviewerLabel", "reviewNotes"]), "utf8"),
  ]);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) return usage();
  const answerKeyPath = resolve(args.answerKeyPath);
  const runArtifacts = await Promise.all(args.runDirectories.map((directory) =>
    readJson(join(resolve(directory), "results.json"), "blind execution results")));
  const answerKey = await readJson(answerKeyPath, "answer key");
  const reviewerAdjudication = args.reviewPath
    ? await readJson(resolve(args.reviewPath), "reviewer adjudication")
    : null;
  const metrics = scoreBlindHoldout({
    runArtifacts,
    answerKey,
    reviewerAdjudication,
    bootstrap: {
      samples: args.bootstrapSamples,
      confidenceLevel: args.confidenceLevel,
      seed: args.seed,
    },
  });
  const outputDirectory = args.outputDirectory
    ? resolve(args.outputDirectory)
    : resolve("eval-results", `blind-holdout-score-${metrics.corpusId}-${Date.now()}`);
  await writeOutputs(outputDirectory, metrics);
  console.log(`Blind holdout score: ${(metrics.status.accuracy * 100).toFixed(1)}% (${metrics.status.matched}/${metrics.status.total}).`);
  console.log(`Results: ${outputDirectory}`);
}

main().catch((error) => {
  const message = error instanceof BlindHoldoutSchemaError || error instanceof Error
    ? error.message
    : "Blind holdout scoring failed.";
  console.error(`Blind holdout scoring failed: ${message}`);
  process.exitCode = 1;
});
