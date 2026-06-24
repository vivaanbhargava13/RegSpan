import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSupportedPdf,
  buildDeterministicChunks,
  extractPdfPages,
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
  assert.equal(result.chunks[0].metadata.section_path, "Extracted PDF > Page 1");
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
