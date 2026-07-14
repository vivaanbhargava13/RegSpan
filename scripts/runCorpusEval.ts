#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertExternalAiProcessingServerAvailable } from "@/lib/aiProcessingPolicy";
import { canonicalElementIdsForFinalPositiveQuote } from "@/lib/findingsAggregation";
import { RateLimitError } from "@/lib/rateLimit";
import { canonicalControlKeyForRequirement } from "@/lib/regulatoryControlFramework";
import { loadRegSpRequirementsForFindings } from "@/lib/regulatoryControls";
import type { RegSpRequirement } from "@/lib/regSpRequirements";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  CorpusEvaluationError,
  assertCorpusDocumentClassification,
  createFreshEvaluationWorkspace,
  loadEvaluationRunData,
  recoverWorkspaceAnalysis,
  runWorkspaceAnalysis,
  uploadCorpusDocument,
  waitForProcessingJob,
  type EvaluationRunContext,
  type EvaluationWorkspaceContext,
} from "@/lib/corpusEvaluation";
import {
  CorpusEvaluationTimeoutError,
  CorpusEvaluationRateLimitWaitExceededError,
  CorpusManifestError,
  assertCorpusEvaluationExternalAiOptIn,
  assertCorpusEvaluationSafety,
  createOneShotEvaluationState,
  evidenceIntegrityViolations,
  formatEvaluationStatusAccuracy,
  scoreCaseFindings,
  recordEvaluationFailure,
  runIsolatedCaseSequence,
  processingResultForReport,
  retryRateLimitedOperation,
  selectCorpusCases,
  snapshotSetViolations,
  summarizeEvaluationState,
  validateCorpusManifest,
} from "@/scripts/corpusEvalCore.mjs";
import { writeJsonAtomically } from "@/scripts/corpusEvalState.mjs";

const CORPUS_ROOT = "eval/corpora";
const DEFAULT_CORPUS = "regspan-v1";
const DEFAULT_POLL_TIMEOUT_MS = 300_000;
const DEFAULT_MIN_SCORE = 0.8;
const DEFAULT_MAX_RATE_LIMIT_WAIT_MS = 3_600_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RunnerArgs = {
  corpus: string;
  mode: "isolated" | "combined";
  pollTimeoutMs: number;
  minScore: number;
  actorUserId: string | null;
  workspacePrefix: string | null;
  allowExternalAi: boolean;
  caseIds: string[];
  waitOnRateLimit: boolean;
  maxRateLimitWaitMs: number;
  help: boolean;
};

type CorpusCase = {
  id: string;
  filename: string;
  tier: string;
  sourceType: "client_policy" | "client_procedure" | "client_standard";
  enabled: boolean;
  include: { isolated: boolean; combined: boolean };
  documentPath?: string;
  documentType?: string;
  notes?: string;
  companyName?: string;
  entityType?: string;
  expectedStatuses: Record<string, string[]>;
  acceptableAlternateStatuses: Record<string, string[]>;
  forbiddenMatches: Record<string, string[]>;
  expectedEvidenceConcepts: Record<string, string[]>;
  expectedEvidenceElements: Record<string, string[]>;
};

type CaseScore = {
  statusResults: Array<{
    requirementId: string;
    expected: string[];
    primaryExpected?: string | null;
    alternates: string[];
    actual: string | null;
    primaryMatched?: boolean;
    alternateMatched?: boolean;
    acceptedMatched?: boolean;
    matched: boolean;
  }>;
  conceptResults: Array<{ matched: boolean }>;
  elementResults: Array<{
    elements: string[];
    matchedElements: string[];
    missingElements: string[];
    matched: boolean;
  }>;
  forbiddenResults: Array<{ matched: boolean }>;
  unexpectedCovered: string[];
  primaryMatchedStatuses?: number;
  acceptedMatchedStatuses?: number;
  alternateMatchedStatuses?: number;
  primaryMismatches?: number;
  matchedStatuses: number;
  expectedStatuses: number;
};

type RunSummary = {
  // Legacy accepted-status aliases retained for results.json consumers.
  expected: number;
  matched: number;
  score: number;
  evaluatedStatusExpected: number;
  evaluatedStatusMatched: number;
  selectedStatuses: number;
  evaluatedStatuses: number;
  primaryStatusMatched: number;
  primaryStatusExpected: number;
  primaryStatusScore: number;
  acceptedStatusMatched: number;
  acceptedStatusExpected: number;
  acceptedStatusScore: number;
  alternateStatusMatches: number;
  primaryStatusMismatches: number;
  totalExpectedStatuses: number;
  completedCases: number;
  failedCases: number;
  operationallyFailedCases: number;
  notStartedCases: number;
  allSelectedCasesCompleted: boolean;
  executionStatus: "running" | "completed" | "incomplete";
  evaluationStatus: "pending" | "passed" | "failed";
  conceptsExpected: number;
  conceptsMatched: number;
  elementsExpected: number;
  elementsMatched: number;
  forbiddenEvidenceAssertionFailures: Array<{
    caseId: string;
    requirementId: string | null;
    assertion: "forbidden_evidence";
  }>;
  forbiddenEvidenceAssertionFailureCount: number;
  unexpectedCovered: number;
  expectedStatusTotals: Record<string, number>;
  evaluatedExpectedStatusTotals: Record<string, number>;
  actualStatusTotals: Record<string, number>;
};

type CaseState = {
  caseId: string;
  tier: string;
  filename: string;
  workspaceKey: string;
  documentId?: string;
  processingJobId?: string;
  processingStatus?: string;
  processingStep?: string;
  processingError?: string;
  analysisRunId?: string;
  analysisStatus?: string;
  processingDurationMs?: number;
  analysisDurationMs?: number;
  rateLimitWaitCount?: number;
  rateLimitWaitMs?: number;
  expectedStatuses: Record<string, string[]>;
  score?: CaseScore;
  integrityViolations?: string[];
  error?: string;
  diagnosticCode?: string;
  completed?: boolean;
};

type RunState = {
  schemaVersion: 1;
  runId: string;
  corpusId: string;
  corpusVersion: number;
  corpusPath: string;
  mode: "isolated" | "combined";
  status: "incomplete" | "completed";
  executionStatus: "running" | "completed" | "incomplete";
  evaluationStatus: "pending" | "passed" | "failed";
  startedAt: string;
  completedAt?: string;
  actorUserId: string;
  workspacePrefix: string;
  selectedCaseIds: string[];
  selectedCaseCount: number;
  filtered: boolean;
  workspaces: Record<string, { key: string; name: string; id?: string }>;
  cases: Record<string, CaseState>;
  failures: Array<{ caseId: string | null; message: string; diagnosticCode?: string }>;
  assertionFailures: Array<{
    caseId: string;
    requirementId: string | null;
    assertion: "forbidden_evidence";
  }>;
  summary?: RunSummary;
};

function usage() {
  console.log(`RegSpan corpus evaluation

Usage:
  npm run eval:corpus -- [options]

Options:
  --corpus <corpus-id-or-directory>  Corpus directory or ID. Defaults to ${DEFAULT_CORPUS}.
  --mode isolated|combined     Evaluation mode. Defaults to isolated.
  --timeout-ms <number>        Polling deadline for jobs/runs. Defaults to ${DEFAULT_POLL_TIMEOUT_MS}.
  --min-score <0..1>           Minimum accepted-status score, including allowed alternates. Defaults to ${DEFAULT_MIN_SCORE}.
  --actor-user-id <uuid>       Evaluation workspace owner; overrides REGSPAN_EVAL_ACTOR_USER_ID.
  --workspace-prefix <prefix>  Explicit prefix beginning regspan-eval-; overrides REGSPAN_EVAL_WORKSPACE_PREFIX.
  --case <case-id>             Run one manifest case; repeat to select multiple cases.
  --allow-external-ai          Allow external AI for newly created evaluation workspaces.
  --wait-on-rate-limit         Wait and retry Analysis rate limits (default).
  --no-wait-on-rate-limit      Fail immediately when Analysis is rate limited.
  --max-rate-limit-wait-ms <n> Maximum total wait for Analysis rate limits. Defaults to ${DEFAULT_MAX_RATE_LIMIT_WAIT_MS}.
  --help                       Show this help.

Every invocation creates new workspaces. Interrupted or failed resources are
left untouched for later manual cleanup; this command never resumes or deletes.
`);
}

function parseArgs(argv: string[]): RunnerArgs {
  const args: RunnerArgs = {
    corpus: DEFAULT_CORPUS,
    mode: "isolated",
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    minScore: DEFAULT_MIN_SCORE,
    actorUserId: null,
    workspacePrefix: null,
    allowExternalAi: false,
    caseIds: [],
    waitOnRateLimit: true,
    maxRateLimitWaitMs: DEFAULT_MAX_RATE_LIMIT_WAIT_MS,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--corpus") { args.corpus = next ?? ""; index += 1; }
    else if (arg === "--mode") { args.mode = next as RunnerArgs["mode"]; index += 1; }
    else if (arg === "--timeout-ms") { args.pollTimeoutMs = Number(next); index += 1; }
    else if (arg === "--min-score") { args.minScore = Number(next); index += 1; }
    else if (arg === "--actor-user-id") { args.actorUserId = next ?? null; index += 1; }
    else if (arg === "--workspace-prefix") { args.workspacePrefix = next ?? null; index += 1; }
    else if (arg === "--case") {
      if (!next || next.startsWith("--")) throw new Error("--case requires a case ID.");
      args.caseIds.push(next);
      index += 1;
    }
    else if (arg === "--allow-external-ai") args.allowExternalAi = true;
    else if (arg === "--wait-on-rate-limit") args.waitOnRateLimit = true;
    else if (arg === "--no-wait-on-rate-limit") args.waitOnRateLimit = false;
    else if (arg === "--max-rate-limit-wait-ms") { args.maxRateLimitWaitMs = Number(next); index += 1; }
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.mode !== "isolated" && args.mode !== "combined") throw new Error("--mode must be isolated or combined.");
  if (!Number.isSafeInteger(args.pollTimeoutMs) || args.pollTimeoutMs < 1_000 || args.pollTimeoutMs > 900_000) {
    throw new Error("--timeout-ms must be an integer from 1000 through 900000.");
  }
  if (!Number.isFinite(args.minScore) || args.minScore < 0 || args.minScore > 1) {
    throw new Error("--min-score must be from 0 through 1.");
  }
  if (!Number.isSafeInteger(args.maxRateLimitWaitMs)
    || args.maxRateLimitWaitMs < 1_000
    || args.maxRateLimitWaitMs > 3_600_000) {
    throw new Error("--max-rate-limit-wait-ms must be an integer from 1000 through 3600000.");
  }
  return args;
}

async function loadLocalEnvironment() {
  let source: string;
  try { source = await readFile(".env.local", "utf8"); } catch { return; }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function assertRunnerSafety(args: RunnerArgs) {
  const actorUserId = args.actorUserId ?? process.env.REGSPAN_EVAL_ACTOR_USER_ID?.trim() ?? null;
  if (!actorUserId || !UUID_PATTERN.test(actorUserId)) {
    throw new Error("Provide --actor-user-id or REGSPAN_EVAL_ACTOR_USER_ID as a valid UUID.");
  }
  const workspacePrefix = args.workspacePrefix ?? process.env.REGSPAN_EVAL_WORKSPACE_PREFIX?.trim() ?? null;
  return assertCorpusEvaluationSafety({ environment: process.env, actorUserId, workspacePrefix });
}

function canonicalRequirementElements(requirements: RegSpRequirement[]) {
  return Object.fromEntries(requirements.map((requirement) => [
    canonicalControlKeyForRequirement(requirement),
    requirement.coverageElements.map((element) => element.id),
  ]));
}

async function loadManifest(corpusDir: string, requirements: RegSpRequirement[]) {
  const manifest = validateCorpusManifest(
    JSON.parse(await readFile(join(corpusDir, "manifest.json"), "utf8")),
    { canonicalRequirementElements: canonicalRequirementElements(requirements) },
  ) as unknown as {
    id: string; version: number; cases: CorpusCase[];
  };
  const requirementIds = new Set<string>(requirements.map((requirement) => canonicalControlKeyForRequirement(requirement)));
  for (const definition of manifest.cases) {
    const unknownRequirementIds = Object.keys(definition.expectedStatuses)
      .filter((requirementId) => !requirementIds.has(requirementId));
    if (unknownRequirementIds.length > 0) {
      throw new CorpusManifestError(
        `Case ${definition.id} references requirement IDs not available to the evaluator: ${unknownRequirementIds.join(", ")}.`,
      );
    }
  }
  return manifest;
}

async function availableCorpusIds() {
  try {
    const entries = await readdir(CORPUS_ROOT, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function resolveCorpusDirectory(corpus: string) {
  const looksLikeDirectory = corpus.includes("/") || corpus.includes("\\") || corpus.startsWith(".");
  const corpusDir = resolve(looksLikeDirectory ? corpus : join(CORPUS_ROOT, corpus));
  try {
    if (!(await stat(corpusDir)).isDirectory()) throw new Error("not_directory");
    await stat(join(corpusDir, "manifest.json"));
    return corpusDir;
  } catch {
    const available = await availableCorpusIds();
    throw new CorpusManifestError(
      `Unknown corpus ${basename(corpus)}. Available corpus IDs: ${available.join(", ") || "none"}.`,
    );
  }
}

function corpusFilePath(corpusDir: string, relativePath: string) {
  const root = resolve(corpusDir);
  const resolvedPath = resolve(root, relativePath);
  const relativePathFromRoot = relative(root, resolvedPath);
  if (!relativePathFromRoot || relativePathFromRoot === ".."
    || relativePathFromRoot.startsWith(`..${sep}`) || isAbsolute(relativePathFromRoot)) {
    throw new CorpusManifestError("Corpus document path must remain within the selected corpus.");
  }
  return resolvedPath;
}

async function loadCorpusPdf({ corpusDir, definition }: { corpusDir: string; definition: CorpusCase }) {
  const candidates = definition.documentPath
    ? [definition.documentPath]
    : [join("sources", definition.filename), join("generated", definition.filename)];
  for (const relativePath of candidates) {
    try {
      const path = corpusFilePath(corpusDir, relativePath);
      return { path, bytes: new Uint8Array(await readFile(path)) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new CorpusManifestError(`Corpus PDF is missing for case filename ${basename(definition.filename)}.`);
}

type InventoryEntry = { bytes: number; sha256: string };

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new CorpusManifestError("Corpus inventory contains an unterminated CSV value.");
  values.push(value);
  return values;
}

async function loadInventory(corpusDir: string) {
  let contents: string;
  try {
    contents = await readFile(join(corpusDir, "inventory.csv"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map<string, InventoryEntry>();
    throw error;
  }
  const lines = contents.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new CorpusManifestError("Corpus inventory must contain a header and at least one PDF entry.");
  const header = parseCsvLine(lines[0]);
  const filenameIndex = header.indexOf("filename");
  const bytesIndex = header.indexOf("bytes");
  const hashIndex = header.indexOf("sha256");
  if (filenameIndex < 0 || bytesIndex < 0 || hashIndex < 0) {
    throw new CorpusManifestError("Corpus inventory must include filename, bytes, and sha256 columns.");
  }
  const entries = new Map<string, InventoryEntry>();
  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const filename = values[filenameIndex]?.trim();
    const bytes = Number(values[bytesIndex]);
    const sha256 = values[hashIndex]?.trim().toLowerCase();
    if (!filename || !Number.isSafeInteger(bytes) || bytes < 0 || !/^[a-f0-9]{64}$/.test(sha256 ?? "")) {
      throw new CorpusManifestError("Corpus inventory contains an invalid PDF entry.");
    }
    if (entries.has(filename)) throw new CorpusManifestError(`Corpus inventory repeats filename ${filename}.`);
    entries.set(filename, { bytes, sha256 });
  }
  return entries;
}

async function preflightCorpusFiles(corpusDir: string, definitions: CorpusCase[]) {
  const inventory = await loadInventory(corpusDir);
  const files = new Map<string, Uint8Array>();
  for (const definition of definitions) {
    const { bytes } = await loadCorpusPdf({ corpusDir, definition });
    const expected = inventory.get(definition.filename);
    if (inventory.size > 0 && !expected) {
      throw new CorpusManifestError(`Corpus inventory is missing ${definition.filename}.`);
    }
    if (expected) {
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (expected.bytes !== bytes.byteLength || expected.sha256 !== actualHash) {
        throw new CorpusManifestError(`Corpus inventory validation failed for ${definition.filename}.`);
      }
    }
    files.set(definition.id, bytes);
  }
  return files;
}

function runContext(state: RunState): EvaluationRunContext {
  return {
    runId: state.runId,
    actorUserId: state.actorUserId,
    corpusId: state.corpusId,
    mode: state.mode,
    workspacePrefix: state.workspacePrefix,
    externalAiProcessingEnabled: true,
    evaluationAnalysisQuotaAuthorized: true,
  };
}

function assertExternalAiEvaluationSafety(args: RunnerArgs) {
  assertCorpusEvaluationExternalAiOptIn(args.allowExternalAi);
  assertExternalAiProcessingServerAvailable(process.env);
}

async function persistState(outputDir: string, state: RunState) {
  await writeJsonAtomically(join(outputDir, "results.json"), state);
}

function summarize(state: RunState) {
  return summarizeEvaluationState(state) as unknown as RunSummary;
}

function formatStatusTotals(totals: Record<string, number>) {
  const entries = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right));
  return entries.length === 0 ? "none" : entries.map(([status, count]) => `${status}: ${count}`).join(", ");
}

function expectedStatusResults(entry: CaseState) {
  if (entry.score?.statusResults) return entry.score.statusResults;
  return Object.entries(entry.expectedStatuses).flatMap(([requirementId, statuses]) =>
    statuses.map((status) => ({
      requirementId,
      expected: [status],
      primaryExpected: status,
      alternates: [],
      actual: null,
      primaryMatched: false,
      alternateMatched: false,
      acceptedMatched: false,
      matched: false,
    }))
  );
}

function statusMatchKind(result: CaseScore["statusResults"][number]) {
  const primaryExpected = result.primaryExpected ?? result.expected[0] ?? null;
  const primaryMatched = result.primaryMatched ?? result.actual === primaryExpected;
  if (primaryMatched) return "primary";
  const alternateMatched = result.alternateMatched ?? (
    result.actual !== primaryExpected && (result.alternates ?? []).includes(result.actual ?? "")
  );
  return alternateMatched ? "accepted alternate" : "mismatch";
}

function caseStatusMetrics(entry: CaseState) {
  const statusResults = expectedStatusResults(entry);
  const kinds = statusResults.map(statusMatchKind);
  return {
    primaryMatched: kinds.filter((kind) => kind === "primary").length,
    acceptedMatched: kinds.filter((kind) => kind !== "mismatch").length,
    alternateMatched: kinds.filter((kind) => kind === "accepted alternate").length,
    primaryMismatches: kinds.filter((kind) => kind !== "primary").length,
    details: statusResults.map((result, index) => {
      const primaryExpected = result.primaryExpected ?? result.expected[0] ?? "absent";
      return `${result.requirementId}:${kinds[index]}:${primaryExpected}->${result.actual ?? "absent"}`;
    }),
  };
}

function alternateMatchDetails(state: RunState) {
  return Object.values(state.cases).flatMap((entry) =>
    expectedStatusResults(entry)
      .filter((result) => statusMatchKind(result) === "accepted alternate")
      .map((result) => {
        const primaryExpected = result.primaryExpected ?? result.expected[0] ?? "absent";
        return `${entry.caseId} / ${result.requirementId}: primary ${primaryExpected}; accepted alternate ${result.actual}; actual ${result.actual}`;
      })
  );
}

function markdown(state: RunState) {
  const summary = summarize(state);
  const rows = Object.values(state.cases).map((entry) => {
    const elementResults = entry.score?.elementResults ?? [];
    const elementPass = elementResults.length === 0 ? "-" : elementResults.every((result) => result.matched) ? "pass" : "fail";
    const statusResults = expectedStatusResults(entry);
    const statusMetrics = caseStatusMetrics(entry);
    const assertionFailures = summary.forbiddenEvidenceAssertionFailures
      .filter((failure) => failure.caseId === entry.caseId)
      .map((failure) => failure.requirementId ?? "unknown requirement")
      .join(", ");
    const expectedStatuses = statusResults.map((result) => `${result.requirementId}: ${result.expected.join(" or ")}`).join("; ");
    const actualStatuses = (entry.score?.statusResults ?? []).map((result) => `${result.requirementId}: ${result.actual ?? "absent"}`).join("; ");
    return `| ${entry.caseId} | ${entry.tier} | ${entry.processingStatus ?? "not started"} | ${entry.analysisStatus ?? "not started"} | ${statusMetrics.primaryMatched}/${statusResults.length} | ${statusMetrics.acceptedMatched}/${statusResults.length} | ${statusMetrics.alternateMatched} | ${statusMetrics.primaryMismatches} | ${statusMetrics.details.join("; ")} | ${expectedStatuses} | ${actualStatuses} | ${elementPass} | ${assertionFailures || "-"} | ${entry.diagnosticCode ?? ""} | ${entry.error ?? ""} |`;
  });
  const accuracyLine = formatEvaluationStatusAccuracy(summary);
  const progressLabel = state.filtered ? "Selected-corpus progress" : "Full-corpus progress";
  const alternateDetails = alternateMatchDetails(state);
  const assertionDetails = summary.forbiddenEvidenceAssertionFailures
    .map((failure) => `${failure.caseId} / ${failure.requirementId ?? "unknown requirement"}`);
  return `# RegSpan Corpus Evaluation\n\nStatus: ${state.status}\n\nRun ID: ${state.runId}\n\nCorpus ID: ${state.corpusId}\n\nCorpus version: ${state.corpusVersion}\n\nCorpus path: ${state.corpusPath}\n\n`
    + `Selected cases: ${state.selectedCaseIds.join(", ")}\n\n`
    + `Selected case count: ${state.selectedCaseCount}; filtered run: ${state.filtered ? "yes" : "no"}\n\n`
    + `Execution status: ${summary.executionStatus}\n\n`
    + `Evaluation status: ${summary.evaluationStatus}\n\n`
    + `Completed/analyzed cases: ${summary.completedCases}; operationally failed cases: ${summary.operationallyFailedCases}; not-started cases: ${summary.notStartedCases}\n\n`
    + `${accuracyLine}\n\n`
    + `Accepted status accuracy: ${(summary.acceptedStatusScore * 100).toFixed(1)}% (${summary.acceptedStatusMatched}/${summary.acceptedStatusExpected})\n\n`
    + `Alternate-status matches: ${summary.alternateStatusMatches}; primary mismatches: ${summary.primaryStatusMismatches}\n\n`
    + `${progressLabel}: ${summary.evaluatedStatuses}/${summary.selectedStatuses} primary statuses evaluated\n\n`
    + `Expected status totals for selected cases: ${formatStatusTotals(summary.expectedStatusTotals)}\n\n`
    + `${summary.allSelectedCasesCompleted ? "" : `Evaluated expected status totals: ${formatStatusTotals(summary.evaluatedExpectedStatusTotals)}\n\n`}`
    + `Actual status totals: ${formatStatusTotals(summary.actualStatusTotals)}\n\n`
    + `Evidence concepts: ${summary.conceptsMatched}/${summary.conceptsExpected}; evidence elements: ${summary.elementsMatched}/${summary.elementsExpected}; unexpected covered/partial: ${summary.unexpectedCovered}\n\n`
    + `Forbidden-evidence assertion failures: ${summary.forbiddenEvidenceAssertionFailureCount}${assertionDetails.length > 0 ? ` (${assertionDetails.join("; ")})` : ""}\n\n`
    + `${alternateDetails.length > 0 ? `Accepted alternate matches:\n${alternateDetails.map((detail) => `- ${detail}`).join("\n")}\n\n` : ""}`
    + `| Case | Tier | Processing | Analysis | Primary | Accepted | Alternate matches | Primary mismatches | Status results | Expected statuses | Actual statuses | Element result | Assertion failures | Diagnostic code | Error |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

function csv(state: RunState) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const summary = summarize(state);
  const rows = ["corpus_id,corpus_version,corpus_path,execution_status,evaluation_status,legacy_status,case_id,tier,selected_case_ids,selected_case_count,filtered_run,completed_case_count,operationally_failed_case_count,not_started_case_count,selected_statuses,evaluated_statuses,primary_status_matches,primary_status_expected,primary_status_accuracy,accepted_status_matches,accepted_status_expected,accepted_status_accuracy,alternate_status_matches,primary_status_mismatches,forbidden_evidence_assertion_failure_count,workspace_id,document_id,processing_job_id,analysis_run_id,processing_status,processing_step,processing_error,analysis_status,rate_limit_wait_count,rate_limit_wait_ms,status_matches,status_expected,primary_case_status_matches,accepted_case_status_matches,alternate_case_status_matches,primary_case_status_mismatches,status_match_details,expected_requirement_statuses,actual_requirement_statuses,expected_evidence_elements,matched_evidence_elements,missing_evidence_elements,evidence_elements_passed,forbidden_evidence_assertion_failures,diagnostic_code,error"];
  for (const entry of Object.values(state.cases)) {
    const elementResults = entry.score?.elementResults ?? [];
    const statusResults = expectedStatusResults(entry);
    const statusMetrics = caseStatusMetrics(entry);
    const assertionFailures = summary.forbiddenEvidenceAssertionFailures
      .filter((failure) => failure.caseId === entry.caseId)
      .map((failure) => `${failure.assertion}:${failure.requirementId ?? "unknown_requirement"}`)
      .join("|");
    rows.push([
      state.corpusId, state.corpusVersion, state.corpusPath, summary.executionStatus, summary.evaluationStatus, state.status, entry.caseId, entry.tier, state.selectedCaseIds.join("|"), state.selectedCaseCount, state.filtered,
      summary.completedCases, summary.operationallyFailedCases, summary.notStartedCases, summary.selectedStatuses, summary.evaluatedStatuses,
      summary.primaryStatusMatched, summary.primaryStatusExpected, summary.primaryStatusScore,
      summary.acceptedStatusMatched, summary.acceptedStatusExpected, summary.acceptedStatusScore, summary.alternateStatusMatches, summary.primaryStatusMismatches, summary.forbiddenEvidenceAssertionFailureCount,
      state.workspaces[entry.workspaceKey]?.id, entry.documentId,
      entry.processingJobId, entry.analysisRunId, entry.processingStatus, entry.processingStep, entry.processingError, entry.analysisStatus, entry.rateLimitWaitCount, entry.rateLimitWaitMs,
      entry.score?.matchedStatuses, entry.score?.expectedStatuses,
      statusMetrics.primaryMatched, statusMetrics.acceptedMatched, statusMetrics.alternateMatched, statusMetrics.primaryMismatches, statusMetrics.details.join("|"),
      statusResults.map((result) => `${result.requirementId}:${result.expected.join("|")}`).join(";"),
      (entry.score?.statusResults ?? []).map((result) => `${result.requirementId}:${result.actual ?? "absent"}`).join(";"),
      elementResults.flatMap((result) => result.elements).join("|"),
      elementResults.flatMap((result) => result.matchedElements).join("|"),
      elementResults.flatMap((result) => result.missingElements).join("|"),
      elementResults.length === 0 ? "" : String(elementResults.every((result) => result.matched)),
      assertionFailures,
      entry.diagnosticCode, entry.error,
    ].map(quote).join(","));
  }
  return `${rows.join("\n")}\n`;
}

async function writeReports(outputDir: string, state: RunState) {
  state.summary = summarize(state);
  await persistState(outputDir, state);
  await writeFile(join(outputDir, "summary.md"), markdown(state), "utf8");
  await writeFile(join(outputDir, "results.csv"), csv(state), "utf8");
}

function appendRunFailureOnce(
  state: RunState,
  failure: { caseId: string | null; message: string; diagnosticCode?: string },
) {
  const exists = state.failures.some((existing) =>
    existing.caseId === failure.caseId
    && existing.message === failure.message
    && existing.diagnosticCode === failure.diagnosticCode
  );
  if (!exists) state.failures.push(failure);
}

function finalizeEvaluationOutcome(state: RunState, minScore: number) {
  const initialSummary = summarize(state);
  state.assertionFailures = initialSummary.forbiddenEvidenceAssertionFailures;
  for (const failure of state.assertionFailures) {
    appendRunFailureOnce(state, {
      caseId: failure.caseId,
      message: "forbidden_evidence_match",
    });
  }
  if (initialSummary.acceptedStatusScore < minScore) {
    appendRunFailureOnce(state, { caseId: null, message: "status_score_below_threshold" });
  }

  const summary = summarize(state);
  const hasOperationalFailure = summary.operationallyFailedCases > 0
    || state.failures.some((failure) =>
      failure.message !== "forbidden_evidence_match"
      && failure.message !== "status_score_below_threshold"
    );
  const statusGateFailed = summary.acceptedStatusScore < minScore;
  state.executionStatus = summary.notStartedCases === 0 ? "completed" : "incomplete";
  state.evaluationStatus = hasOperationalFailure
    || summary.forbiddenEvidenceAssertionFailureCount > 0
    || statusGateFailed
    ? "failed"
    : "passed";
  // Preserve the legacy field: completed historically meant all configured gates passed.
  state.status = state.evaluationStatus === "passed" ? "completed" : "incomplete";
  state.summary = summarize(state);
  return state.summary;
}

async function createWorkspace(state: RunState, workspaceKey: string, outputDir: string) {
  const context = await createFreshEvaluationWorkspace({
    supabase: getServerSupabaseAdminClient(),
    context: runContext(state),
    workspaceKey,
  });
  state.workspaces[workspaceKey].id = context.workspaceId;
  await persistState(outputDir, state);
  return context;
}

async function processCase({
  definition,
  state,
  context,
  bytes,
  outputDir,
  pollTimeoutMs,
}: {
  definition: CorpusCase;
  state: RunState;
  context: EvaluationWorkspaceContext;
  bytes: Uint8Array;
  outputDir: string;
  pollTimeoutMs: number;
}) {
  const entry = state.cases[definition.id];
  const startedAt = Date.now();
  const uploaded = await uploadCorpusDocument({
    supabase: getServerSupabaseAdminClient(),
    context,
    filename: definition.filename,
    sourceType: definition.sourceType,
    documentType: definition.documentType,
    notes: definition.notes,
    bytes,
    correlationId: crypto.randomUUID(),
  });
  entry.documentId = uploaded.documentId;
  entry.processingJobId = uploaded.processing.jobId;
  entry.processingDurationMs = Date.now() - startedAt;
  await persistState(outputDir, state);
  if (!uploaded.processing.ok || !uploaded.processing.jobId) {
    throw new CorpusEvaluationError("Document processing could not be queued.");
  }
  const pollingStartedAt = Date.now();
  const job = await waitForProcessingJob({
    supabase: getServerSupabaseAdminClient(),
    context,
    documentId: uploaded.documentId,
    jobId: uploaded.processing.jobId,
    pollTimeoutMs,
  });
  Object.assign(entry, processingResultForReport({
    status: job.status,
    step: job.step,
    errorMessage: job.error_message,
  }));
  entry.processingDurationMs += Date.now() - pollingStartedAt;
  await persistState(outputDir, state);
  if (job.status !== "Processed") {
    throw new CorpusEvaluationError("Document processing failed.");
  }
  await assertCorpusDocumentClassification({
    supabase: getServerSupabaseAdminClient(),
    context,
    documentId: uploaded.documentId,
    sourceType: definition.sourceType,
    requireOrganizationEvidence: definition.tier !== "adversarial",
  });
}

async function analyzeAndScore({
  definitions,
  state,
  context,
  outputDir,
  pollTimeoutMs,
  waitOnRateLimit,
  maxRateLimitWaitMs,
  requirementsById,
}: {
  definitions: CorpusCase[];
  state: RunState;
  context: EvaluationWorkspaceContext;
  outputDir: string;
  pollTimeoutMs: number;
  waitOnRateLimit: boolean;
  maxRateLimitWaitMs: number;
  requirementsById: Map<string, RegSpRequirement>;
}) {
  const entries = definitions.map((definition) => state.cases[definition.id]);
  const documentIds = entries.map((entry) => entry.documentId).filter((id): id is string => Boolean(id));
  if (documentIds.length !== definitions.length) throw new CorpusEvaluationError("Evaluation document set is incomplete.");
  const startedAt = Date.now();
  const retry = await retryRateLimitedOperation({
    operation: () => runWorkspaceAnalysis({
      supabase: getServerSupabaseAdminClient(),
      context,
      expectedDocumentIds: documentIds,
      pollTimeoutMs,
      correlationId: crypto.randomUUID(),
    }),
    beforeRetry: () => recoverWorkspaceAnalysis({
      supabase: getServerSupabaseAdminClient(),
      context,
      expectedDocumentIds: documentIds,
      pollTimeoutMs,
    }),
    isRateLimitError: (error) => error instanceof RateLimitError
      && error.category === "findings_generate_eval"
      && error.code === "rate_limited",
    waitOnRateLimit,
    maxRateLimitWaitMs,
    onWait: async ({ rateLimitWaitCount, rateLimitWaitMs, waitMs }) => {
      for (const entry of entries) {
        entry.rateLimitWaitCount = rateLimitWaitCount;
        entry.rateLimitWaitMs = rateLimitWaitMs;
      }
      await persistState(outputDir, state);
      console.log(`Analysis rate limited. Waiting ${Math.ceil(waitMs / 1_000)} seconds before retrying.`);
    },
  });
  const analysis = retry.value;
  for (const entry of entries) {
    entry.analysisRunId = analysis.analysisRunId;
    entry.analysisStatus = analysis.analysisRun.status;
    entry.analysisDurationMs = Date.now() - startedAt;
    entry.rateLimitWaitCount = retry.rateLimitWaitCount;
    entry.rateLimitWaitMs = retry.rateLimitWaitMs;
  }
  await persistState(outputDir, state);

  const data = await loadEvaluationRunData({
    supabase: getServerSupabaseAdminClient(),
    context,
    analysisRunId: analysis.analysisRunId,
    expectedDocumentIds: documentIds,
  });
  const violations = [
    ...snapshotSetViolations(data.snapshots.map((snapshot) => snapshot.document_id), documentIds),
    ...evidenceIntegrityViolations({
      workspaceId: context.workspaceId,
      snapshotDocumentIds: data.snapshots.map((snapshot) => snapshot.document_id),
      caseDocumentIds: documentIds,
      findings: data.findings,
      evidenceRows: data.evidence,
    }),
  ];
  if (data.snapshots.some((snapshot) => !["Processed", "Ready"].includes(snapshot.document_status))) {
    violations.push("failed_document_in_analysis_snapshot");
  }
  if (violations.length > 0) {
    throw new CorpusEvaluationError(`Evidence integrity checks failed: ${[...new Set(violations)].join(", ")}.`);
  }
  for (const definition of definitions) {
    const entry = state.cases[definition.id];
    entry.integrityViolations = [];
    entry.score = scoreCaseFindings({
      caseDefinition: definition,
      findings: data.findings,
      evidenceRows: data.evidence,
      resolveFinalQuoteElementIds: ({ requirementId, quote }) => {
        const requirement = requirementsById.get(requirementId);
        return requirement ? canonicalElementIdsForFinalPositiveQuote(requirement, quote) : [];
      },
    }) as unknown as CaseScore;
    entry.completed = true;
  }
  await persistState(outputDir, state);
}

function createState({
  manifest,
  corpusPath,
  selectedCases,
  filtered,
  mode,
  actorUserId,
  workspacePrefix,
}: {
  manifest: { id: string; version: number };
  corpusPath: string;
  selectedCases: CorpusCase[];
  filtered: boolean;
  mode: "isolated" | "combined";
  actorUserId: string;
  workspacePrefix: string;
}): RunState {
  const runId = crypto.randomUUID();
  return createOneShotEvaluationState({
    runId,
    corpusId: manifest.id,
    corpusVersion: manifest.version,
    corpusPath,
    mode,
    actorUserId,
    workspacePrefix,
    selectedCases,
    filtered,
    startedAt: new Date().toISOString(),
  }) as RunState;
}

function diagnosticCodeForError(error: unknown) {
  if (error instanceof CorpusEvaluationError) return error.diagnosticCode;
  if (error instanceof CorpusEvaluationRateLimitWaitExceededError) return "analysis_rate_limit_wait_exceeded";
  return "corpus_evaluation_failed";
}

async function main() {
  await loadLocalEnvironment();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const { actorUserId, workspacePrefix } = assertRunnerSafety(args);
  assertExternalAiEvaluationSafety(args);
  const corpusDir = await resolveCorpusDirectory(args.corpus);
  const requirements = await loadRegSpRequirementsForFindings({ supabase: getServerSupabaseAdminClient() });
  const requirementsById = new Map(requirements.map((requirement) => [
    canonicalControlKeyForRequirement(requirement),
    requirement,
  ]));
  const manifest = await loadManifest(corpusDir, requirements);
  const selection = selectCorpusCases({
    cases: manifest.cases,
    requestedCaseIds: args.caseIds,
    mode: args.mode,
  }) as unknown as { selectedCases: CorpusCase[]; selectedCaseIds: string[]; filtered: boolean };
  const selectedCases = selection.selectedCases;
  if (selectedCases.length === 0) throw new Error(`No corpus cases are enabled for ${args.mode} mode.`);
  const preparedFiles = await preflightCorpusFiles(
    corpusDir,
    manifest.cases.filter((definition) => definition.enabled),
  );

  const state = createState({
    manifest,
    corpusPath: corpusDir,
    selectedCases,
    filtered: selection.filtered,
    mode: args.mode,
    actorUserId,
    workspacePrefix,
  });
  const outputDir = resolve("eval-results", `corpus-${manifest.id}-${args.mode}-${state.runId}`);
  await writeReports(outputDir, state);

  let activeCaseId: string | null = null;
  try {
    if (args.mode === "combined") {
      const context = await createWorkspace(state, "combined", outputDir);
      for (const definition of selectedCases) {
        activeCaseId = definition.id;
        await processCase({ definition, state, context, bytes: preparedFiles.get(definition.id)!, outputDir, pollTimeoutMs: args.pollTimeoutMs });
      }
      await analyzeAndScore({ definitions: selectedCases, state, context, outputDir, pollTimeoutMs: args.pollTimeoutMs, waitOnRateLimit: args.waitOnRateLimit, maxRateLimitWaitMs: args.maxRateLimitWaitMs, requirementsById });
    } else {
      await runIsolatedCaseSequence({
        cases: selectedCases,
        runCase: async (definition) => {
          activeCaseId = definition.id;
          const context = await createWorkspace(state, definition.id, outputDir);
          await processCase({ definition, state, context, bytes: preparedFiles.get(definition.id)!, outputDir, pollTimeoutMs: args.pollTimeoutMs });
          await analyzeAndScore({ definitions: [definition], state, context, outputDir, pollTimeoutMs: args.pollTimeoutMs, waitOnRateLimit: args.waitOnRateLimit, maxRateLimitWaitMs: args.maxRateLimitWaitMs, requirementsById });
        },
        onCaseFailure: async (definition, error) => {
          recordEvaluationFailure(state, definition.id, error instanceof Error ? error.message : "Corpus evaluation failed.", diagnosticCodeForError(error));
          await writeReports(outputDir, state);
          console.error(`Case ${definition.id} failed. Continuing isolated evaluation.`);
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Corpus evaluation failed.";
    recordEvaluationFailure(
      state,
      activeCaseId,
      message,
      diagnosticCodeForError(error),
    );
  }
  const finalSummary = finalizeEvaluationOutcome(state, args.minScore);
  state.completedAt = new Date().toISOString();
  await writeReports(outputDir, state);
  console.log(`Evaluation run ${state.runId}: execution ${state.executionStatus}; evaluation ${state.evaluationStatus}.`);
  console.log(
    `Primary status accuracy: ${(finalSummary.primaryStatusScore * 100).toFixed(1)}% (${finalSummary.primaryStatusMatched}/${finalSummary.primaryStatusExpected}); `
    + `accepted status accuracy: ${(finalSummary.acceptedStatusScore * 100).toFixed(1)}% (${finalSummary.acceptedStatusMatched}/${finalSummary.acceptedStatusExpected}); `
    + `alternate matches: ${finalSummary.alternateStatusMatches}; `
    + `operational failures: ${finalSummary.operationallyFailedCases}; `
    + `forbidden-evidence assertion failures: ${finalSummary.forbiddenEvidenceAssertionFailureCount}.`,
  );
  console.log(`Results: ${outputDir}`);
  if (state.status !== "completed") process.exitCode = 1;
}

main().catch((error) => {
  const safeMessage = error instanceof CorpusManifestError
    || error instanceof CorpusEvaluationTimeoutError
    || error instanceof CorpusEvaluationError
    || error instanceof Error
    ? error.message
    : "Corpus evaluation failed.";
  console.error(`Corpus evaluation failed: ${safeMessage}`);
  process.exitCode = 1;
});
