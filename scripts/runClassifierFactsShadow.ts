/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  classifierFactsShadowReportRow,
  executeClassifierFactsShadow,
  type ClassifierFactsShadowResult,
} from "../lib/classifierFactsShadow";
import { validateClassifierCapabilityFixtures } from "../lib/classifierCapabilityEval";
import { validateGeneralizationFixture } from "../lib/classifierGeneralizationEval";
import { isUuid } from "../lib/documentSecurity";
import type { RetrievedChunk } from "../lib/retrieval";
import { getServerSupabaseAdminClient } from "../lib/supabase/server";

type Mode = "mock" | "report";
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function options(argv: string[]) {
  const mode = (argv[0] === "report" ? "report" : "mock") as Mode;
  const values = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || argv[index + 1] === undefined) throw new Error("Invalid facts shadow arguments.");
    values.set(argv[index], argv[index + 1]);
  }
  const limit = Number(values.get("--limit") ?? "3");
  if (!Number.isInteger(limit) || limit < 1 || limit > 36) throw new Error("--limit must be an integer from 1 through 36.");
  return {
    mode, limit,
    workspaceId: values.get("--workspace-id") ?? "",
    analysisRunId: values.get("--analysis-run-id") ?? "",
    output: resolve(values.get("--output") ?? `eval-results/classifier-facts-shadow/${mode}.json`),
  };
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
      disposition: "no_fact", facts: [], no_fact_reason: "Synthetic local response for transport-free shadow verification.",
    }]));
    return new Response(JSON.stringify({
      id: "mock-shadow-request", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ units }) } }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function mockRun(limit: number, output: string) {
  const fixturePath = resolve("eval-fixtures/classifier-generalization/holdout.v1.json");
  const fixtureBytes = await readFile(fixturePath);
  const fixture = validateGeneralizationFixture(JSON.parse(fixtureBytes.toString("utf8")));
  const capability = validateClassifierCapabilityFixtures(JSON.parse(await readFile("eval-fixtures/classifier-capability/fixtures.v2.json", "utf8")));
  const sets = new Map(fixture.candidate_sets.map((item) => [item.candidate_set_id, item]));
  const cases = fixture.cases.slice(0, limit);
  const results = [];
  for (const item of cases) {
    const requirement = capability.requirements.find((entry) => entry.id === item.requirement_id);
    const set = sets.get(item.candidate_set_id);
    if (!requirement || !set) throw new Error(`Mock shadow fixture resolution failed for ${item.case_id}.`);
    const candidates = set.candidates.map((candidate) => candidateForMock(candidate, item.document_case_id));
    const graded = candidates.map((candidate) => ({ ...candidate, evidence_relationship: "irrelevant", covered_elements: [], supporting_quote: null })) as any[];
    const result = await executeClassifierFactsShadow({
      workspaceId: "00000000-0000-4000-8000-000000000001", documentId: item.document_case_id,
      analysisRunId: "00000000-0000-4000-8000-000000000002", requirement, candidates, gradedCandidates: graded,
      apiKey: "local-mock-only", fetchImpl: mockFetch(), timeoutMs: 5_000,
    });
    results.push({ case_id: item.case_id, requirement_id: item.requirement_id, candidate_ids: result.candidate_ids, candidate_set_sha256: result.candidate_set_sha256, request_sha256: result.request_sha256, outcome: result.outcome, valid: result.valid, shadow_status: result.shadow_status });
  }
  const artifact = { schema_version: "classifier-facts-shadow-mock/v1", generated_at: new Date().toISOString(), source_fixture: fixturePath, source_fixture_sha256: sha256(fixtureBytes), request_count: results.length, expected_request_count: limit, network_calls: 0, persistence_writes: 0, results };
  await writeJson(output, artifact);
  console.log(`Frozen V4.1 shadow mock: ${results.length} document-requirement requests; network calls: 0; persistence writes: 0.`);
  console.log(`Artifact: ${output}`);
}

async function report(workspaceId: string, analysisRunId: string, output: string) {
  if (!isUuid(workspaceId) || !isUuid(analysisRunId)) throw new Error("A valid --workspace-id and --analysis-run-id are required.");
  const supabase = getServerSupabaseAdminClient();
  const { data, error } = await supabase.from("classifier_facts_shadow_results").select("*")
    .eq("workspace_id", workspaceId).eq("analysis_run_id", analysisRunId).order("created_at", { ascending: true });
  if (error) throw new Error(`classifier_facts_shadow_report_failed:${error.code ?? "unknown"}`);
  const rows = (data ?? []) as ClassifierFactsShadowResult[];
  const details = rows.map(classifierFactsShadowReportRow);
  const categoryCounts = Object.fromEntries([...new Set(details.map((item) => item.disagreement_category))]
    .sort().map((category) => [category, details.filter((item) => item.disagreement_category === category).length]));
  const artifact = {
    schema_version: "classifier-facts-shadow-report/v1", generated_at: new Date().toISOString(), workspace_id: workspaceId,
    analysis_run_id: analysisRunId, attempted: rows.length, valid: rows.filter((item) => item.valid).length,
    invalid: rows.filter((item) => !item.valid).length, model_calls: rows.length,
    status_agreement: rows.filter((item) => item.valid && item.current_status === item.shadow_status).length,
    disagreement_categories: categoryCounts,
    likely_current_false_negatives: details.filter((item) => item.likely_current_false_negative).length,
    potential_false_assurance: details.filter((item) => item.potential_false_assurance).length,
    latency_ms: rows.reduce((sum, item) => sum + item.latency_ms, 0),
    token_usage: rows.reduce((sum, item) => ({ prompt: sum.prompt + (item.prompt_tokens ?? 0), completion: sum.completion + (item.completion_tokens ?? 0), total: sum.total + (item.total_tokens ?? 0) }), { prompt: 0, completion: 0, total: 0 }),
    disagreements: details,
  };
  await writeJson(output, artifact);
  const markdown = output.replace(/\.json$/u, ".md");
  await writeFile(markdown, [`# Facts-only shadow disagreements`, ``, `Attempted: ${artifact.attempted}`, `Valid: ${artifact.valid}`, `Invalid: ${artifact.invalid}`, `Status agreement: ${artifact.status_agreement}`, `Likely current false negatives: ${artifact.likely_current_false_negatives}`, `Potential false assurance: ${artifact.potential_false_assurance}`, ``, ...details.map((item) => `- ${item.document_id} / ${item.requirement_id}: ${item.disagreement_category}`), ``].join("\n"), "utf8");
  console.log(`Shadow report: ${output}`);
  console.log(`Shadow report Markdown: ${markdown}`);
}

const value = options(process.argv.slice(2));
if (value.mode === "mock") await mockRun(value.limit, value.output);
else await report(value.workspaceId, value.analysisRunId, value.output);
