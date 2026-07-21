/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  buildClassifierFactsShadowJobSnapshots,
  claimClassifierFactsShadowJobs,
  isClassifierFactsShadowWorkerEnabled,
  processClassifierFactsShadowJob,
  summarizeClassifierFactsShadowRows,
  type ClassifierFactsShadowJob,
  type ClassifierFactsShadowResult,
} from "../lib/classifierFactsShadow";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";
import { validateGeneralizationFixture } from "../lib/classifierGeneralizationEval";
import { isUuid } from "../lib/documentSecurity";
import type { RetrievedChunk } from "../lib/retrieval";
import { getServerSupabaseAdminClient } from "../lib/supabase/server";

type Mode = "worker" | "report";
function options(argv: string[]) {
  const mode = (argv[0] === "report" ? "report" : "worker") as Mode;
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("Invalid facts shadow arguments.");
    values.set(argv[index], argv[index + 1]);
  }
  const limit = Number(values.get("--limit") ?? "3");
  const concurrency = Number(values.get("--concurrency") ?? "1");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("--limit must be an integer from 1 through 100.");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 5) throw new Error("--concurrency must be an integer from 1 through 5.");
  return {
    mode, limit, concurrency,
    retryFailed: values.get("--retry-failed") === "true",
    mock: values.get("--mock") === "true",
    workspaceId: values.get("--workspace-id") ?? "",
    analysisRunId: values.get("--analysis-run-id") ?? "",
    output: resolve(values.get("--output") ?? `eval-results/classifier-facts-shadow/${mode}-run.json`),
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>) {
  const output = new Array<R>(values.length); let next = 0;
  const run = async () => { while (next < values.length) { const index = next++; output[index] = await worker(values[index]); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return output;
}

function candidateForMock(item: any, documentCaseId: string): RetrievedChunk {
  return {
    chunk_id: item.candidate_id, document_id: documentCaseId, filename: item.provenance.filename,
    page_start: item.provenance.page_start, page_end: item.provenance.page_end, chunk_index: item.provenance.chunk_index,
    section_path: item.provenance.section_path, content_preview: item.text, similarity: 0, evidence_reason: null,
    embedding_input: null, source_type: "client_policy", evidence_role: "organization_evidence", rerank_score: null, rerank_reason: null,
  };
}

function mockFetch(): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    const unitProperties = body.response_format.json_schema.schema.properties.units.properties;
    const units = Object.fromEntries(Object.keys(unitProperties).map((unitId) => [unitId, {
      disposition: "no_fact", facts: [], no_fact_reason: "Synthetic local worker response.",
    }]));
    return new Response(JSON.stringify({
      id: "mock-shadow-request", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ units }) } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function mockJobs(limit: number) {
  const fixturePath = resolve("eval-fixtures/classifier-generalization/holdout.v1.json");
  const fixtureBytes = await readFile(fixturePath);
  const fixture = validateGeneralizationFixture(JSON.parse(fixtureBytes.toString("utf8")));
  const capability = validateClassifierCapabilityFixtures(JSON.parse(await readFile("eval-fixtures/classifier-capability/fixtures.v2.json", "utf8")));
  const sets = new Map(fixture.candidate_sets.map((item) => [item.candidate_set_id, item]));
  return fixture.cases.slice(0, limit).map((item, index): ClassifierFactsShadowJob => {
    const requirement = capability.requirements.find((entry) => entry.id === item.requirement_id);
    const set = sets.get(item.candidate_set_id);
    if (!requirement || !set) throw new Error(`Mock shadow fixture resolution failed for ${item.case_id}.`);
    const candidates = set.candidates.map((candidate) => candidateForMock(candidate, item.document_case_id));
    const graded = candidates.map((candidate) => ({ ...candidate, evidence_relationship: "irrelevant", covered_elements: [], supporting_quote: null })) as any[];
    const snapshot = buildClassifierFactsShadowJobSnapshots({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      analysisRunId: "00000000-0000-4000-8000-000000000002",
      requirement, candidates, gradedCandidates: graded, createdAt: "2026-01-01T00:00:00.000Z",
    })[0];
    return { id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, workspace_id: snapshot.workspace_id, document_id: snapshot.document_id, analysis_run_id: snapshot.analysis_run_id, requirement_id: snapshot.requirement_id, status: "running", attempts: 1, snapshot, claimed_at: "2026-01-01T00:00:01.000Z", completed_at: null, last_error: null };
  });
}

function mockSupabase() {
  const results: ClassifierFactsShadowResult[] = []; const transitions: unknown[] = [];
  const client = {
    from(table: string) {
      if (table === "classifier_facts_shadow_results") return { upsert: async (row: ClassifierFactsShadowResult) => { results.push(row); return { error: null }; } };
      if (table === "classifier_facts_shadow_jobs") return { update: (value: unknown) => ({ eq: () => ({ eq: async () => { transitions.push(value); return { error: null }; } }) }) };
      throw new Error(`Unexpected mock table ${table}.`);
    },
  };
  return { client: client as any, results, transitions };
}

async function workerRun(limit: number, concurrency: number, retryFailed: boolean, mock: boolean, output: string) {
  let jobs: ClassifierFactsShadowJob[]; let supabase: any; let fetchImpl: typeof fetch; let apiKey: string;
  let networkCalls = 0;
  if (mock) {
    jobs = await mockJobs(limit); const memory = mockSupabase(); supabase = memory.client; fetchImpl = mockFetch(); apiKey = "local-mock-only";
  } else {
    if (!isClassifierFactsShadowWorkerEnabled(process.env)) throw new Error("CLASSIFIER_FACTS_SHADOW_ENABLED=true, CLASSIFIER_FACTS_SHADOW_WORKER_ENABLED=true, and external-AI flags are required.");
    apiKey = process.env.REQUIREMENT_CLASSIFIER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
    if (!apiKey) throw new Error("A server-side classifier API key is required.");
    supabase = getServerSupabaseAdminClient(); jobs = await claimClassifierFactsShadowJobs(supabase, limit, retryFailed); fetchImpl = fetch; networkCalls = jobs.length;
  }
  const outcomes = await mapConcurrent(jobs, concurrency, async (job) => {
    try {
      const result = await processClassifierFactsShadowJob({ supabase, job, apiKey, fetchImpl });
      console.log(`${job.id} ${job.requirement_id}: ${result.outcome}; latency_ms=${Math.round(result.latency_ms)}`);
      return { job_id: job.id, requirement_id: job.requirement_id, outcome: result.outcome, valid: result.valid, latency_ms: result.latency_ms };
    } catch (error) {
      console.log(`${job.id} ${job.requirement_id}: worker_failure; latency_ms=0`);
      return { job_id: job.id, requirement_id: job.requirement_id, outcome: "worker_failure", valid: false, latency_ms: 0, error: String(error) };
    }
  });
  const artifact = { schema_version: "classifier-facts-shadow-worker-run/v1", generated_at: new Date().toISOString(), mock, limit, concurrency, retry_failed: retryFailed, claimed_jobs: jobs.length, network_calls: mock ? 0 : networkCalls, outcomes };
  await writeJson(output, artifact);
  console.log(`Worker artifact: ${output}`);
  console.log(`Claimed: ${jobs.length}; network calls: ${artifact.network_calls}; retry failed: ${retryFailed}.`);
}

async function report(workspaceId: string, analysisRunId: string, output: string) {
  if (!isUuid(workspaceId) || !isUuid(analysisRunId)) throw new Error("A valid --workspace-id and --analysis-run-id are required.");
  const supabase = getServerSupabaseAdminClient();
  const { data, error } = await supabase.from("classifier_facts_shadow_results").select("*")
    .eq("workspace_id", workspaceId).eq("analysis_run_id", analysisRunId).order("created_at", { ascending: true });
  if (error) throw new Error(`classifier_facts_shadow_report_failed:${error.code ?? "unknown"}`);
  const summary = summarizeClassifierFactsShadowRows((data ?? []) as ClassifierFactsShadowResult[]);
  const artifact = { schema_version: "classifier-facts-shadow-report/v2", generated_at: new Date().toISOString(), workspace_id: workspaceId, analysis_run_id: analysisRunId, ...summary };
  await writeJson(output, artifact);
  const markdown = output.replace(/\.json$/u, ".md");
  await writeFile(markdown, [`# Facts-only shadow disagreements`, ``, `Attempted: ${artifact.attempted}`, `Valid: ${artifact.valid}`, `Invalid outcomes: ${artifact.invalid_outcomes}`, `Status agreement: ${artifact.status_agreement}`, `Exact agreement: ${artifact.exact_agreement}`, `Same-status evidence disagreement: ${artifact.same_status_evidence_disagreement}`, `Latency total/average/maximum: ${artifact.latency_ms.total} / ${artifact.latency_ms.average} / ${artifact.latency_ms.maximum} ms`, `Tokens prompt/completion/total: ${artifact.token_usage.prompt} / ${artifact.token_usage.completion} / ${artifact.token_usage.total}`, ``, ...artifact.details.map((item) => `- ${item.document_id} / ${item.requirement_id}: ${item.disagreement_category}`), ``].join("\n"), "utf8");
  console.log(`Shadow report: ${output}`);
  console.log(`Shadow report Markdown: ${markdown}`);
}

const value = options(process.argv.slice(2));
if (value.mode === "worker") await workerRun(value.limit, value.concurrency, value.retryFailed, value.mock, value.output);
else await report(value.workspaceId, value.analysisRunId, value.output);
