#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { assertExternalAiProcessingServerAvailable } from "@/lib/aiProcessingPolicy";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";
import {
  CorpusEvaluationError,
  createFreshEvaluationWorkspace,
  loadEvaluationRunData,
  runWorkspaceAnalysis,
  uploadCorpusDocument,
  waitForProcessingJob,
  type EvaluationRunContext,
  type EvaluationWorkspaceContext,
} from "@/lib/corpusEvaluation";
import {
  CorpusEvaluationTimeoutError,
  CorpusManifestError,
  assertCorpusEvaluationExternalAiOptIn,
  assertCorpusEvaluationSafety,
  createOneShotEvaluationState,
  evidenceIntegrityViolations,
  scoreCaseFindings,
  recordEvaluationFailure,
  processingResultForReport,
  snapshotSetViolations,
  validateCorpusManifest,
} from "@/scripts/corpusEvalCore.mjs";
import { writeJsonAtomically } from "@/scripts/corpusEvalState.mjs";

const DEFAULT_CORPUS = "eval/corpora/regspan-v1";
const DEFAULT_POLL_TIMEOUT_MS = 300_000;
const DEFAULT_MIN_SCORE = 0.8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RunnerArgs = {
  corpus: string;
  mode: "isolated" | "combined";
  pollTimeoutMs: number;
  minScore: number;
  actorUserId: string | null;
  workspacePrefix: string | null;
  allowExternalAi: boolean;
  help: boolean;
};

type CorpusCase = {
  id: string;
  filename: string;
  tier: string;
  include: { isolated: boolean; combined: boolean };
  expectedStatuses: Record<string, string[]>;
  acceptableAlternateStatuses: Record<string, string[]>;
  forbiddenMatches: Record<string, string[]>;
  expectedEvidenceConcepts: Record<string, string[]>;
};

type CaseScore = {
  statusResults: Array<{ actual: string | null; matched: boolean }>;
  conceptResults: Array<{ matched: boolean }>;
  forbiddenResults: Array<{ matched: boolean }>;
  unexpectedCovered: string[];
  matchedStatuses: number;
  expectedStatuses: number;
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
  mode: "isolated" | "combined";
  status: "incomplete" | "completed";
  startedAt: string;
  completedAt?: string;
  actorUserId: string;
  workspacePrefix: string;
  workspaces: Record<string, { key: string; name: string; id?: string }>;
  cases: Record<string, CaseState>;
  failures: Array<{ caseId: string | null; message: string; diagnosticCode?: string }>;
};

function usage() {
  console.log(`RegSpan corpus evaluation

Usage:
  npm run eval:corpus -- [options]

Options:
  --corpus <path>              Corpus directory. Defaults to ${DEFAULT_CORPUS}.
  --mode isolated|combined     Evaluation mode. Defaults to isolated.
  --timeout-ms <number>        Polling deadline for jobs/runs. Defaults to ${DEFAULT_POLL_TIMEOUT_MS}.
  --min-score <0..1>           Minimum expected-status score. Defaults to ${DEFAULT_MIN_SCORE}.
  --actor-user-id <uuid>       Evaluation workspace owner; overrides REGSPAN_EVAL_ACTOR_USER_ID.
  --workspace-prefix <prefix>  Explicit prefix beginning regspan-eval-; overrides REGSPAN_EVAL_WORKSPACE_PREFIX.
  --allow-external-ai          Allow external AI for newly created evaluation workspaces.
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
    else if (arg === "--allow-external-ai") args.allowExternalAi = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.mode !== "isolated" && args.mode !== "combined") throw new Error("--mode must be isolated or combined.");
  if (!Number.isSafeInteger(args.pollTimeoutMs) || args.pollTimeoutMs < 1_000 || args.pollTimeoutMs > 900_000) {
    throw new Error("--timeout-ms must be an integer from 1000 through 900000.");
  }
  if (!Number.isFinite(args.minScore) || args.minScore < 0 || args.minScore > 1) {
    throw new Error("--min-score must be from 0 through 1.");
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

async function loadManifest(corpusDir: string) {
  return validateCorpusManifest(JSON.parse(await readFile(join(corpusDir, "manifest.json"), "utf8"))) as unknown as {
    id: string; version: 1; cases: CorpusCase[];
  };
}

async function loadPdfBytes(corpusDir: string, filename: string) {
  for (const directory of ["sources", "generated"]) {
    try { return await readFile(join(corpusDir, directory, filename)); } catch { /* Try the next directory. */ }
  }
  throw new Error(`Corpus PDF is missing for case filename ${basename(filename)}.`);
}

function runContext(state: RunState): EvaluationRunContext {
  return {
    runId: state.runId,
    actorUserId: state.actorUserId,
    corpusId: state.corpusId,
    mode: state.mode,
    workspacePrefix: state.workspacePrefix,
    externalAiProcessingEnabled: true,
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
  const scored = Object.values(state.cases).filter((entry) => entry.score);
  const expected = scored.reduce((total, entry) => total + (entry.score?.expectedStatuses ?? 0), 0);
  const matched = scored.reduce((total, entry) => total + (entry.score?.matchedStatuses ?? 0), 0);
  const concepts = scored.flatMap((entry) => entry.score?.conceptResults ?? []);
  return {
    expected,
    matched,
    score: expected === 0 ? 1 : matched / expected,
    conceptsExpected: concepts.length,
    conceptsMatched: concepts.filter((entry) => entry.matched).length,
    unexpectedCovered: scored.flatMap((entry) => entry.score?.unexpectedCovered ?? []).length,
  };
}

function markdown(state: RunState) {
  const summary = summarize(state);
  const rows = Object.values(state.cases).map((entry) =>
    `| ${entry.caseId} | ${entry.tier} | ${entry.processingStatus ?? "not started"} | ${entry.processingStep ?? ""} | ${entry.processingError ?? ""} | ${entry.analysisStatus ?? "not started"} | ${entry.score ? `${entry.score.matchedStatuses}/${entry.score.expectedStatuses}` : "-"} | ${entry.diagnosticCode ?? ""} | ${entry.error ?? ""} |`,
  );
  return `# RegSpan Corpus Evaluation\n\nStatus: ${state.status}\n\nRun ID: ${state.runId}\n\n`
    + `Expected status score: ${(summary.score * 100).toFixed(1)}% (${summary.matched}/${summary.expected})\n\n`
    + `Evidence concepts: ${summary.conceptsMatched}/${summary.conceptsExpected}; unexpected covered/partial: ${summary.unexpectedCovered}\n\n`
    + `| Case | Tier | Processing | Step | Processing error | Analysis | Status score | Diagnostic code | Error |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

function csv(state: RunState) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = ["case_id,tier,workspace_id,document_id,processing_job_id,analysis_run_id,processing_status,processing_step,processing_error,analysis_status,status_matches,status_expected,diagnostic_code,error"];
  for (const entry of Object.values(state.cases)) {
    rows.push([
      entry.caseId, entry.tier, state.workspaces[entry.workspaceKey]?.id, entry.documentId,
      entry.processingJobId, entry.analysisRunId, entry.processingStatus, entry.processingStep, entry.processingError, entry.analysisStatus,
      entry.score?.matchedStatuses, entry.score?.expectedStatuses, entry.diagnosticCode, entry.error,
    ].map(quote).join(","));
  }
  return `${rows.join("\n")}\n`;
}

async function writeReports(outputDir: string, state: RunState) {
  await persistState(outputDir, state);
  await writeFile(join(outputDir, "summary.md"), markdown(state), "utf8");
  await writeFile(join(outputDir, "results.csv"), csv(state), "utf8");
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
  corpusDir,
  outputDir,
  pollTimeoutMs,
}: {
  definition: CorpusCase;
  state: RunState;
  context: EvaluationWorkspaceContext;
  corpusDir: string;
  outputDir: string;
  pollTimeoutMs: number;
}) {
  const entry = state.cases[definition.id];
  const bytes = await loadPdfBytes(corpusDir, definition.filename);
  const startedAt = Date.now();
  const uploaded = await uploadCorpusDocument({
    supabase: getServerSupabaseAdminClient(),
    context,
    filename: definition.filename,
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
}

async function analyzeAndScore({
  definitions,
  state,
  context,
  outputDir,
  pollTimeoutMs,
}: {
  definitions: CorpusCase[];
  state: RunState;
  context: EvaluationWorkspaceContext;
  outputDir: string;
  pollTimeoutMs: number;
}) {
  const entries = definitions.map((definition) => state.cases[definition.id]);
  const documentIds = entries.map((entry) => entry.documentId).filter((id): id is string => Boolean(id));
  if (documentIds.length !== definitions.length) throw new CorpusEvaluationError("Evaluation document set is incomplete.");
  const startedAt = Date.now();
  const analysis = await runWorkspaceAnalysis({
    supabase: getServerSupabaseAdminClient(),
    context,
    expectedDocumentIds: documentIds,
    pollTimeoutMs,
    correlationId: crypto.randomUUID(),
  });
  for (const entry of entries) {
    entry.analysisRunId = analysis.analysisRunId;
    entry.analysisStatus = analysis.analysisRun.status;
    entry.analysisDurationMs = Date.now() - startedAt;
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
    }) as unknown as CaseScore;
    entry.completed = true;
  }
  await persistState(outputDir, state);
}

function createState({
  manifest,
  selectedCases,
  mode,
  actorUserId,
  workspacePrefix,
}: {
  manifest: { id: string };
  selectedCases: CorpusCase[];
  mode: "isolated" | "combined";
  actorUserId: string;
  workspacePrefix: string;
}): RunState {
  const runId = crypto.randomUUID();
  return createOneShotEvaluationState({
    runId,
    corpusId: manifest.id,
    mode,
    actorUserId,
    workspacePrefix,
    selectedCases,
    startedAt: new Date().toISOString(),
  }) as RunState;
}

async function main() {
  await loadLocalEnvironment();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  const { actorUserId, workspacePrefix } = assertRunnerSafety(args);
  assertExternalAiEvaluationSafety(args);
  const corpusDir = resolve(args.corpus);
  const manifest = await loadManifest(corpusDir);
  const selectedCases = manifest.cases.filter((definition) => definition.include[args.mode]);
  if (selectedCases.length === 0) throw new Error(`No corpus cases are enabled for ${args.mode} mode.`);

  const state = createState({ manifest, selectedCases, mode: args.mode, actorUserId, workspacePrefix });
  const outputDir = resolve("eval-results", `corpus-${manifest.id}-${args.mode}-${state.runId}`);
  await writeReports(outputDir, state);

  let activeCaseId: string | null = null;
  try {
    if (args.mode === "combined") {
      const context = await createWorkspace(state, "combined", outputDir);
      for (const definition of selectedCases) {
        activeCaseId = definition.id;
        await processCase({ definition, state, context, corpusDir, outputDir, pollTimeoutMs: args.pollTimeoutMs });
      }
      await analyzeAndScore({ definitions: selectedCases, state, context, outputDir, pollTimeoutMs: args.pollTimeoutMs });
    } else {
      for (const definition of selectedCases) {
        activeCaseId = definition.id;
        const context = await createWorkspace(state, definition.id, outputDir);
        await processCase({ definition, state, context, corpusDir, outputDir, pollTimeoutMs: args.pollTimeoutMs });
        await analyzeAndScore({ definitions: [definition], state, context, outputDir, pollTimeoutMs: args.pollTimeoutMs });
      }
    }
    const summary = summarize(state);
    for (const entry of Object.values(state.cases)) {
      if (entry.score?.forbiddenResults.some((result) => !result.matched)) {
        state.failures.push({ caseId: entry.caseId, message: "forbidden_evidence_match" });
      }
    }
    if (summary.score < args.minScore) state.failures.push({ caseId: null, message: "status_score_below_threshold" });
    if (state.failures.length === 0) state.status = "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Corpus evaluation failed.";
    recordEvaluationFailure(
      state,
      activeCaseId,
      message,
      error instanceof CorpusEvaluationError ? error.diagnosticCode : "corpus_evaluation_failed",
    );
  }
  state.completedAt = new Date().toISOString();
  await writeReports(outputDir, state);
  console.log(`Evaluation run ${state.runId} ${state.status}. Results: ${outputDir}`);
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
