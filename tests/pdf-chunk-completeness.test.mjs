import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertPdfChunkCompleteness,
  buildDeterministicChunks,
  PdfProcessingError,
  validatePersistedChunkCompleteness,
} from "../lib/pdfProcessingCore.ts";

const identifiers = {
  documentId: "10000000-0000-4000-8000-000000000101",
  workspaceId: "20000000-0000-4000-8000-000000000102",
  jobId: "30000000-0000-4000-8000-000000000103",
  filename: "independent-policy-fixture.pdf",
};

function build(pages) {
  return buildDeterministicChunks({ pages, ...identifiers });
}

function representedPages(chunks) {
  return new Set(chunks.flatMap((chunk) => Array.from(
    { length: chunk.page_end - chunk.page_start + 1 },
    (_, offset) => chunk.page_start + offset,
  )));
}

test("section text spanning a page boundary retains both page coverage and continuation", () => {
  const result = build([
    {
      pageNumber: 1,
      text: [
        "Incident Response",
        "",
        "The response lead must open an incident record and preserve the available evidence.",
      ].join("\n"),
    },
    {
      pageNumber: 2,
      text: "The response lead must continue the record until containment and recovery are complete.",
    },
  ]);

  assert.deepEqual(result.completeness.missingPageNumbers, []);
  assert.ok(representedPages(result.chunks).has(2));
  assert.ok(result.chunks.some((chunk) => /continue the record until containment/i.test(chunk.content)));
});

test("operative text near a page end remains in a stored chunk", () => {
  const result = build([{
    pageNumber: 1,
    text: [
      "Records Management",
      "",
      "Background context. ".repeat(360),
      "Before closing the case, the records officer must retain the final decision in the governed archive.",
    ].join("\n"),
  }]);

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.some((chunk) => /Before closing the case/i.test(chunk.content)));
  assert.equal(result.completeness.finalCompletenessStatus, "complete");
});

test("a short material page between dense pages remains represented", () => {
  const result = build([
    { pageNumber: 1, text: `Access Controls\n\n${"The organization reviews access records. ".repeat(130)}` },
    { pageNumber: 2, text: "Records\n\nThe firm shall retain incident decisions for the required period." },
    { pageNumber: 3, text: `Recovery\n\n${"The recovery owner verifies restored services. ".repeat(130)}` },
  ]);

  assert.ok(result.completeness.materiallyNonemptyPages.includes(2));
  assert.ok(result.completeness.pagesRepresentedInChunks.includes(2));
  assert.ok(result.chunks.some((chunk) => /retain incident decisions/i.test(chunk.content)));
});

test("repeated headers and footers do not remove the page's operative content", () => {
  const result = build([
    {
      pageNumber: 1,
      text: [
        "INTERNAL SECURITY STANDARD",
        "Retention",
        "The company must preserve relevant logs after a security incident.",
        "INTERNAL SECURITY STANDARD | 1",
      ].join("\n"),
    },
    {
      pageNumber: 2,
      text: [
        "INTERNAL SECURITY STANDARD",
        "Retention",
        "The company must restrict access to the preserved material.",
        "INTERNAL SECURITY STANDARD | 2",
      ].join("\n"),
    },
  ]);

  assert.equal(result.completeness.finalCompletenessStatus, "complete");
  assert.ok(result.chunks.some((chunk) => /restrict access to the preserved material/i.test(chunk.content)));
});

test("a repeated boundary label does not split an operative sentence across pages", () => {
  const result = build([
    {
      pageNumber: 1,
      text: [
        "Records Procedure",
        "The records owner must retain the final decision in the governed archival",
        "Control Required practice",
      ].join("\n"),
    },
    {
      pageNumber: 2,
      text: [
        "Control Required practice",
        "system for the required retention period.",
        "The custodian must keep access limited to authorized personnel.",
      ].join("\n"),
    },
  ]);

  assert.ok(result.chunks.some((chunk) => /governed archival\s+system for the required retention period/i.test(chunk.content)));
  assert.equal(result.completeness.finalCompletenessStatus, "complete");
});

test("blank pages do not create false completeness failures", () => {
  const result = build([
    { pageNumber: 1, text: "Safeguards\n\nThe institution must encrypt customer information in transit." },
    { pageNumber: 2, text: "" },
    { pageNumber: 3, text: "Disposal\n\nThe institution must sanitize retired media." },
  ]);

  assert.deepEqual(result.completeness.materiallyNonemptyPages, [1, 3]);
  assert.equal(result.completeness.finalCompletenessStatus, "complete");
});

test("a long final section is split deterministically without losing its continuation", () => {
  const result = build([{
    pageNumber: 1,
    text: [
      "Recovery Procedures",
      "",
      "The recovery team documents each restoration step. ".repeat(520),
      "After restoration, the team must validate normal service before closing the incident.",
    ].join("\n"),
  }]);

  assert.ok(result.chunks.length > 1);
  assert.ok(result.chunks.some((chunk) => /must validate normal service/i.test(chunk.content)));
  assert.equal(result.completeness.unexplainedUncoveredRanges.length, 0);
});

test("a final section continuation on the next page remains stored with accurate page metadata", () => {
  const result = build([
    { pageNumber: 1, text: "Customer Notice\n\nThe notice owner must prepare the written communication." },
    { pageNumber: 2, text: "The notice must identify a contact and the steps recipients can take to protect themselves." },
  ]);

  const continuation = result.chunks.find((chunk) => /steps recipients can take/i.test(chunk.content));
  assert.ok(continuation);
  assert.equal(continuation.page_start <= 2 && continuation.page_end >= 2, true);
});

test("persistence validation identifies an omitted material page", () => {
  const result = build([
    { pageNumber: 1, text: "Access Controls\n\nThe organization must approve privileged access." },
    { pageNumber: 2, text: "Incident Response\n\nThe organization must preserve evidence after an incident." },
  ]);
  const persisted = result.chunks.filter((chunk) => chunk.page_start !== 2 && chunk.page_end !== 2);
  const diagnostic = validatePersistedChunkCompleteness(result.chunks, persisted);

  assert.equal(diagnostic.finalCompletenessStatus, "incomplete");
  assert.ok(diagnostic.missingPageNumbers.includes(2));
  assert.ok(diagnostic.missingChunkIndexes.length > 0);
});

test("an extracted page sequence gap prevents a document from being marked complete", () => {
  const result = build([
    { pageNumber: 1, text: "Records\n\nThe company must retain required compliance records." },
    { pageNumber: 3, text: "Recovery\n\nThe company must validate restored systems." },
  ]);

  assert.equal(result.completeness.finalCompletenessStatus, "incomplete");
  assert.deepEqual(result.completeness.extractedPageNumberGaps, [2]);
  assert.throws(
    () => assertPdfChunkCompleteness(result.completeness),
    (error) => error instanceof PdfProcessingError && error.code === "pdf_chunk_completeness_failed",
  );
});

test("ingestion verifies stored chunk completeness before embeddings can finalize processing", async () => {
  const [route, completionMigration] = await Promise.all([
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("supabase/migrations/026_finalize_only_retrieval_eligible_chunk_embeddings.sql", "utf8"),
  ]);
  assert.ok(
    route.indexOf("verify_stored_document_chunk_completeness") < route.indexOf("generate_chunk_embeddings"),
  );
  assert.match(route, /pdf_chunk_persistence_incomplete/);
  assert.match(completionMigration, /retrieval_included' = 'true'/);
  assert.match(completionMigration, /evidence_class' = 'evidence'/);
});
