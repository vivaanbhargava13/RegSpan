import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertSupportedPdf,
  buildDeterministicChunks,
  extractPdfPages,
  loadPdfProcessingLimits,
  normalizeAndValidateExtractedPdfPages,
  PdfProcessingError,
} from "../lib/pdfProcessingCore.ts";

function createTextPdf(text) {
  const escapedText = text.replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 16 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

test("valid PDF text is extracted and chunked", async () => {
  const pages = await extractPdfPages(
    createTextPdf("RegSpan extracts cybersecurity policy text deterministically."),
  );
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /RegSpan extracts cybersecurity policy text/);

  const result = buildDeterministicChunks({
    pages,
    documentId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    jobId: "30000000-0000-4000-8000-000000000003",
    filename: "policy.pdf",
  });
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].chunk_index, 0);
  assert.equal(result.chunks[0].page_start, 1);
  assert.equal(result.chunks[0].filename, "policy.pdf");
  assert.equal(result.chunks[0].processing_job_id, "30000000-0000-4000-8000-000000000003");
  assert.equal(result.chunks[0].char_start, 0);
  assert.equal(result.chunks[0].char_end, result.chunks[0].content.length);
  assert.equal(result.chunks[0].token_estimate, Math.ceil(result.chunks[0].content.length / 4));
  assert.match(result.chunks[0].content_hash, /^[0-9a-f]{64}$/);
  assert.equal(result.chunks[0].metadata.content_hash, result.chunks[0].content_hash);
  assert.match(result.chunks[0].metadata.source_content_hash, /^[0-9a-f]{64}$/);
  assert.equal(result.chunks[0].metadata.section_path, "Document Overview");
  assert.match(result.chunks[0].metadata.embedding_input, /Filename: policy\.pdf/);
  assert.match(result.chunks[0].metadata.embedding_input, /Section: Document Overview/);
  assert.equal(result.chunks[0].metadata.embedding_input.endsWith(result.chunks[0].content), true);
  assert.equal(result.hierarchy.headings.length, 1);
});

test("unsupported file type is rejected", () => {
  assert.throws(
    () => assertSupportedPdf("policy.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    (error) => error instanceof PdfProcessingError && error.code === "unsupported_file_type",
  );
});

test("empty and low-text PDFs are rejected", async () => {
  await assert.rejects(
    () => extractPdfPages(new Uint8Array()),
    (error) => error instanceof PdfProcessingError && error.code === "empty_pdf",
  );
  await assert.rejects(
    () => extractPdfPages(createTextPdf("Hi")),
    (error) => error instanceof PdfProcessingError && error.code === "insufficient_pdf_text",
  );
});

test("PDF processing limits use safe defaults and reject invalid configuration", () => {
  assert.deepEqual(loadPdfProcessingLimits({}), {
    maxPdfPages: 250,
    maxExtractedTextChars: 2_000_000,
  });
  assert.deepEqual(loadPdfProcessingLimits({
    MAX_PDF_PAGES: "2",
    MAX_EXTRACTED_TEXT_CHARS: "20",
  }), {
    maxPdfPages: 2,
    maxExtractedTextChars: 20,
  });

  for (const environment of [
    { NODE_ENV: "production", MAX_PDF_PAGES: "0" },
    { NODE_ENV: "production", MAX_PDF_PAGES: "2.5" },
    { NODE_ENV: "production", MAX_EXTRACTED_TEXT_CHARS: "invalid" },
  ]) {
    assert.throws(
      () => loadPdfProcessingLimits(environment),
      (error) =>
        error instanceof PdfProcessingError &&
        error.code === "invalid_pdf_processing_limits" &&
        error.status === 500 &&
        error.safeMessage === "PDF processing limits are not configured correctly.",
    );
  }
});

test("PDF page and extracted-text limits reject before chunking or embeddings", async () => {
  const belowLimit = normalizeAndValidateExtractedPdfPages(
    [{ num: 1, text: "policy text ".repeat(3) }],
    1,
    { maxPdfPages: 2, maxExtractedTextChars: 100 },
  );
  assert.equal(belowLimit.length, 1);

  const atLimit = normalizeAndValidateExtractedPdfPages(
    [
      { num: 1, text: "a".repeat(10) },
      { num: 2, text: "b".repeat(10) },
    ],
    2,
    { maxPdfPages: 2, maxExtractedTextChars: 20 },
  );
  assert.equal(atLimit.length, 2);
  assert.equal(atLimit.reduce((total, page) => total + page.text.length, 0), 20);

  assert.throws(
    () => normalizeAndValidateExtractedPdfPages(
      [{ num: 1, text: "policy text".repeat(3) }],
      3,
      { maxPdfPages: 2, maxExtractedTextChars: 1_000 },
    ),
    (error) =>
      error instanceof PdfProcessingError &&
      error.code === "pdf_page_limit_exceeded" &&
      error.safeMessage === "This PDF exceeds the supported page limit.",
  );

  const extractedText = "Sensitive client source excerpt ".repeat(2);
  const laterPage = { num: 2 };
  Object.defineProperty(laterPage, "text", {
    get() {
      throw new Error("text processing continued after the configured limit");
    },
  });
  assert.throws(
    () => normalizeAndValidateExtractedPdfPages(
      [{ num: 1, text: extractedText }, laterPage],
      2,
      { maxPdfPages: 2, maxExtractedTextChars: 20 },
    ),
    (error) =>
      error instanceof PdfProcessingError &&
      error.code === "pdf_text_limit_exceeded" &&
      error.safeMessage === "This PDF contains more text than RegSpan can safely process." &&
      !error.safeMessage.includes(extractedText),
  );

  const worker = await readFile("app/api/internal/ingest/process-job/route.ts", "utf8");
  assert.ok(
    worker.indexOf("const pages = await extractPdfPages") <
      worker.indexOf("const { chunks, hierarchy } = buildDeterministicChunks"),
    "page and text limits must run before chunk construction",
  );
  assert.ok(
    worker.indexOf("const pages = await extractPdfPages") <
      worker.indexOf("const embeddingResult = await embedDocumentChunks"),
    "page and text limits must run before embedding",
  );
  assert.match(worker, /await markWorkerFailure\(supabase, payload, safeMessage\)/);
  assert.match(worker, /fail_ingestion_job_v1/);
});

test("chunk construction is deterministic across retries", () => {
  const input = {
    pages: [{ pageNumber: 1, text: "Policy requirement. ".repeat(240) }],
    documentId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    jobId: "30000000-0000-4000-8000-000000000003",
    filename: "policy.pdf",
  };
  const first = buildDeterministicChunks(input);
  const retry = buildDeterministicChunks(input);
  assert.deepEqual(retry, first);
  assert.deepEqual(
    first.chunks.map((chunk) => chunk.chunk_index),
    first.chunks.map((_, index) => index),
  );
});
