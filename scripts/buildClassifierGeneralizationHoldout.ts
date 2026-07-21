/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { buildDeterministicChunks, extractPdfPages, PDF_EXTRACTION_VERSION } from "../lib/pdfProcessingCore";
import { candidateUnits, emptyGeneralizationReview, generalizationFixtureHash, GENERALIZATION_SCHEMA, DEVELOPMENT_CANARY_SUITE_HASH, type GeneralizationFixture } from "../lib/classifierGeneralizationEval";

const ROOT = resolve("eval/corpora/regspan-v2-realistic-corpus");
const OUTPUT = resolve("eval-fixtures/classifier-generalization/holdout.v1.json");
const WORKSHEET = resolve("eval-fixtures/classifier-generalization/reviewer-worksheet.json");
const MARKDOWN = resolve("eval-fixtures/classifier-generalization/reviewer-worksheet.md");
const SUPPORTED = ["incident_assessment_containment_control", "incident_evidence_log_preservation", "response_recovery_remediation_validation"];

const sha256 = (value: string | Buffer | Uint8Array) => createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.entries(value as Record<string, unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(value);
const stableId = (prefix: string, value: string) => `${prefix}-${sha256(value).slice(0, 24)}`;

function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) { const char = text[index]; if (char === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index++; } else quoted = !quoted; } else if (char === "," && !quoted) { row.push(field); field = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index++; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ""; } else field += char; }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [headers, ...values] = rows; return values.map((items) => Object.fromEntries(headers.map((header, index) => [header, items[index] ?? ""])));
}

async function main() {
  const manifest = JSON.parse(await readFile(resolve(ROOT, "manifest.json"), "utf8"));
  const capability = JSON.parse(await readFile(resolve("eval-fixtures/classifier-capability/fixtures.v2.json"), "utf8"));
  const answers = parseCsv(await readFile(resolve(ROOT, "answer_key.csv"), "utf8"));
  const inventory = new Map(parseCsv(await readFile(resolve(ROOT, "inventory.csv"), "utf8")).map((row) => [row.case_id, row]));
  const requirements = capability.requirements.filter((item: any) => SUPPORTED.includes(item.id)).map((item: any) => ({ id: item.id, title: item.title, required_elements: item.requiredElementsForCovered, element_definitions: item.coverageElements.map(({ id, label }: any) => ({ id, label })) }));
  const candidateSets: GeneralizationFixture["candidate_sets"] = [];
  for (const item of manifest.cases) {
    const sourcePath = `eval/corpora/regspan-v2-realistic-corpus/${item.path}`;
    const bytes = await readFile(resolve(ROOT, item.path.replace(/^documents\//u, "documents/")));
    const expectedHash = inventory.get(item.id)?.sha256;
    if (!expectedHash || sha256(bytes) !== expectedHash) throw new Error(`PDF hash mismatch for ${item.id}.`);
    const pages = await extractPdfPages(new Uint8Array(bytes));
    const documentId = stableId("doc", expectedHash); const workspaceId = stableId("workspace", item.id); const jobId = stableId("job", expectedHash);
    const built = buildDeterministicChunks({ pages, documentId, workspaceId, jobId, filename: item.filename, documentType: item.documentType, sourceType: item.sourceType, evidenceRole: "organization_evidence" });
    const eligible = built.chunks.filter((chunk) => chunk.metadata.retrieval_included);
    const candidates = eligible.map((chunk, index) => {
      const candidateId = stableId("chunk", `${expectedHash}:${chunk.chunk_index}:${chunk.content_hash}`);
      return { candidate_id: candidateId, position: index + 1, text: chunk.content, content_sha256: sha256(chunk.content), units: candidateUnits(candidateId, chunk.content), provenance: { corpus_id: manifest.corpusId, document_sha256: expectedHash, source_path: sourcePath, filename: item.filename, chunk_index: chunk.chunk_index, page_start: chunk.page_start, page_end: chunk.page_end, section_heading: chunk.section_heading, section_path: chunk.section_path, source_type: item.sourceType, extraction_version: PDF_EXTRACTION_VERSION, chunking_version: String(chunk.metadata.chunking_version), retrieval_included: true as const } };
    });
    candidateSets.push({ candidate_set_id: `set-${item.id}`, document_case_id: item.id, document_sha256: expectedHash, candidates });
  }
  const cases = manifest.cases.flatMap((document: any) => SUPPORTED.map((requirementId) => {
    const set = candidateSets.find((entry) => entry.document_case_id === document.id)!;
    const aid = answers.find((row) => row.case_id === document.id && row.requirement_id === requirementId);
    if (!aid) throw new Error(`Missing answer-key row for ${document.id}/${requirementId}.`);
    const review = emptyGeneralizationReview();
    return { case_id: `${document.id}--${requirementId}`, requirement_id: requirementId, document_case_id: document.id, candidate_set_id: set.candidate_set_id, candidate_set_sha256: sha256(canonical(set.candidates)), candidate_count: set.candidates.length, unit_count: set.candidates.reduce((sum, candidate) => sum + candidate.units.length, 0), set_size: set.candidates.length >= 17 ? "noisy" as const : "short" as const, evidence_shape: set.candidates.length > 1 ? "multi_candidate" as const : "single_candidate" as const, development_canary: false as const, answer_key_provenance: { path: "eval/corpora/regspan-v2-realistic-corpus/answer_key.csv", locator: `${document.id}/${requirementId}`, expected_status_review_aid: aid.expected_status, rationale_review_aid: aid.rationale, scoring_authority: false as const }, reviewer_1: { ...review }, reviewer_2: { ...review }, adjudication: { ...review, adjudicator_id: null, adjudicated_at: null, approved: false } };
  }));
  const withoutHash = { schema_version: GENERALIZATION_SCHEMA, development_canary_suite_hash: DEVELOPMENT_CANARY_SUITE_HASH, source_corpus: { id: manifest.corpusId, manifest_path: "eval/corpora/regspan-v2-realistic-corpus/manifest.json", answer_key_path: "eval/corpora/regspan-v2-realistic-corpus/answer_key.csv", inventory_path: "eval/corpora/regspan-v2-realistic-corpus/inventory.csv" }, requirements, candidate_sets: candidateSets, cases };
  const fixture = { ...withoutHash, fixture_hash: generalizationFixtureHash(withoutHash as any) };
  const worksheet = { schema_version: "classifier-generalization-reviewer-worksheet/v1", fixture_hash: fixture.fixture_hash, instructions: { independence: "Reviewer 1 and Reviewer 2 work independently before adjudication.", scoring: "A case is unscored until adjudication.approved is true and every adjudicated field is complete.", answer_key: "Imported answer-key status and rationale are review aids only; they are not atomic gold labels." }, requirements, cases: fixture.cases.map((item: typeof cases[number]) => ({ ...item, candidates: candidateSets.find((set) => set.candidate_set_id === item.candidate_set_id)!.candidates })) };
  const lines = ["# Classifier generalization reviewer worksheet", "", `Fixture hash: \`${fixture.fixture_hash}\``, "", "All 36 cases are excluded from scoring until two independent reviews are adjudicated. Existing corpus answer-key values are review aids, not atomic gold labels.", ""];
  for (const item of worksheet.cases) { lines.push(`## ${item.case_id}`, "", `Requirement: \`${item.requirement_id}\`  `, `Candidate set: \`${item.candidate_set_id}\` (${item.candidate_count} candidates; ${item.unit_count} units)  `, `Answer-key review aid: ${item.answer_key_provenance.expected_status_review_aid} — ${item.answer_key_provenance.rationale_review_aid}`, "", "Reviewer 1: ID ___ | reviewed at ___ | elements ___ | status ___ | support kind ___ | hard-negative category ___ | supporting unit IDs ___ | unit→element support ___ | rationale ___", "", "Reviewer 2: ID ___ | reviewed at ___ | elements ___ | status ___ | support kind ___ | hard-negative category ___ | supporting unit IDs ___ | unit→element support ___ | rationale ___", "", "Adjudication: adjudicator ___ | adjudicated at ___ | approved ___ | elements ___ | status ___ | support kind ___ | hard-negative category ___ | supporting unit IDs ___ | unit→element support ___ | rationale ___", ""); }
  for (const [path, value] of [[OUTPUT, fixture], [WORKSHEET, worksheet]] as const) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
  await writeFile(MARKDOWN, `${lines.join("\n")}\n`, "utf8");
  console.log(JSON.stringify({ fixture_hash: fixture.fixture_hash, cases: cases.length, candidate_sets: candidateSets.length, candidates_per_document: candidateSets.map((set) => ({ id: set.document_case_id, count: set.candidates.length })) }, null, 2));
}

await main();
