import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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

function createTextPdf(text, {
  catalogExtra = "",
  pageExtra = "",
  extraObjects = [],
  trailerExtra = "",
} = {}) {
  const escapedText = text.replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 16 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${catalogExtra} >>`,
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R ${pageExtra} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ...extraObjects,
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
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra} >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

function createMultiPagePdf(texts) {
  const pageCount = texts.length;
  const fontObject = 3 + pageCount;
  const firstContentObject = fontObject + 1;
  const pageReferences = texts.map((_, index) => `${3 + index} 0 R`).join(" ");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>`,
    ...texts.map((_, index) =>
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`
    ),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...texts.map((text) => {
      const escapedText = text.replace(/([()\\])/g, "\\$1");
      const stream = `BT /F1 16 Tf 72 720 Td (${escapedText}) Tj ET`;
      return `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
    }),
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf));
}

function processingLimits(overrides = {}) {
  return {
    maxPdfPages: 250,
    maxExtractedTextChars: 2_000_000,
    maxPdfPageTextChars: 500_000,
    processingTimeoutMs: 180_000,
    ...overrides,
  };
}

class FakeParserWorker extends EventEmitter {
  terminateCount = 0;

  async terminate() {
    this.terminateCount += 1;
    return 1;
  }
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
  const originalTimeout = process.env.PDF_PROCESSING_TIMEOUT_MS;
  assert.deepEqual(loadPdfProcessingLimits({}), {
    maxPdfPages: 250,
    maxExtractedTextChars: 2_000_000,
    maxPdfPageTextChars: 500_000,
    processingTimeoutMs: 180_000,
  });
  assert.deepEqual(loadPdfProcessingLimits({
    MAX_PDF_PAGES: "2",
    MAX_EXTRACTED_TEXT_CHARS: "20",
    MAX_PDF_PAGE_TEXT_CHARS: "10",
    PDF_PROCESSING_TIMEOUT_MS: "100",
  }), {
    maxPdfPages: 2,
    maxExtractedTextChars: 20,
    maxPdfPageTextChars: 10,
    processingTimeoutMs: 100,
  });

  for (const environment of [
    { NODE_ENV: "production", MAX_PDF_PAGES: "0" },
    { NODE_ENV: "production", MAX_PDF_PAGES: "2.5" },
    { NODE_ENV: "production", MAX_EXTRACTED_TEXT_CHARS: "invalid" },
    { NODE_ENV: "production", MAX_PDF_PAGE_TEXT_CHARS: "-1" },
    { NODE_ENV: "production", PDF_PROCESSING_TIMEOUT_MS: "0" },
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
  assert.equal(process.env.PDF_PROCESSING_TIMEOUT_MS, originalTimeout);
});

test("actual parser accepts exact limits and rejects the next page or character", async () => {
  const twoPages = createMultiPagePdf([
    "First page contains enough policy text.",
    "Second page contains enough policy text.",
  ]);
  const exactPages = await extractPdfPages(
    twoPages,
    processingLimits({ maxPdfPages: 2 }),
  );
  assert.equal(exactPages.length, 2);
  await assert.rejects(
    extractPdfPages(
      createMultiPagePdf([
        "First page contains enough policy text.",
        "Second page contains enough policy text.",
      ]),
      processingLimits({ maxPdfPages: 1 }),
    ),
    (error) => error.code === "pdf_page_limit_exceeded",
  );

  const exactText = "12345678901234567890";
  assert.equal(exactText.length, 20);
  const textPdf = createTextPdf(exactText);
  const exactTextPages = await extractPdfPages(
    textPdf,
    processingLimits({
      maxExtractedTextChars: 20,
      maxPdfPageTextChars: 20,
    }),
  );
  assert.equal(exactTextPages[0].text, exactText);
  await assert.rejects(
    extractPdfPages(
      createTextPdf(exactText),
      processingLimits({
        maxExtractedTextChars: 19,
        maxPdfPageTextChars: 20,
      }),
    ),
    (error) => error.code === "pdf_text_limit_exceeded",
  );
  await assert.rejects(
    extractPdfPages(
      createTextPdf(exactText),
      processingLimits({
        maxExtractedTextChars: 20,
        maxPdfPageTextChars: 19,
      }),
    ),
    (error) => error.code === "pdf_page_text_limit_exceeded",
  );
});

test("PDF page and extracted-text limits reject before chunking or embeddings", async () => {
  const belowLimit = normalizeAndValidateExtractedPdfPages(
    [{ num: 1, text: "policy text ".repeat(3) }],
    1,
    processingLimits({ maxPdfPages: 2, maxExtractedTextChars: 100 }),
  );
  assert.equal(belowLimit.length, 1);

  const atLimit = normalizeAndValidateExtractedPdfPages(
    [
      { num: 1, text: "a".repeat(10) },
      { num: 2, text: "b".repeat(10) },
    ],
    2,
    processingLimits({
      maxPdfPages: 2,
      maxExtractedTextChars: 20,
      maxPdfPageTextChars: 10,
    }),
  );
  assert.equal(atLimit.length, 2);
  assert.equal(atLimit.reduce((total, page) => total + page.text.length, 0), 20);

  assert.throws(
    () => normalizeAndValidateExtractedPdfPages(
      [{ num: 1, text: "policy text".repeat(3) }],
      3,
      processingLimits({ maxPdfPages: 2, maxExtractedTextChars: 1_000 }),
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
      processingLimits({ maxPdfPages: 2, maxExtractedTextChars: 20 }),
    ),
    (error) =>
      error instanceof PdfProcessingError &&
      error.code === "pdf_text_limit_exceeded" &&
      error.safeMessage === "This PDF contains more text than RegSpan can safely process." &&
      !error.safeMessage.includes(extractedText),
  );

  const worker = await readFile("app/api/internal/ingest/process-job/route.ts", "utf8");
  assert.ok(
    worker.indexOf("let pages = await extractPdfPages") <
      worker.indexOf("let chunkBuild = buildChunks"),
    "page and text limits must run before chunk construction",
  );
  assert.ok(
    worker.indexOf("let pages = await extractPdfPages") <
      worker.indexOf("const embeddingResult = await embedDocumentChunks"),
    "page and text limits must run before embedding",
  );
  assert.match(worker, /await markWorkerFailure\(supabase, payload, safeMessage\)/);
  assert.match(worker, /fail_ingestion_job_v1/);
});

test("isolated parser timeout terminates work and clears timers without late completion", async () => {
  const parserWorker = new FakeParserWorker();
  let timeoutCallback;
  let clearCount = 0;
  const parsing = extractPdfPages(
    createTextPdf("This parser request intentionally never resolves."),
    processingLimits({ processingTimeoutMs: 10 }),
    {
      createWorker: () => parserWorker,
      setTimer: (callback) => {
        timeoutCallback = callback;
        return { testTimer: true };
      },
      clearTimer: () => {
        clearCount += 1;
      },
    },
  );

  timeoutCallback();
  await assert.rejects(
    parsing,
    (error) =>
      error instanceof PdfProcessingError &&
      error.code === "pdf_processing_timeout" &&
      error.safeMessage === "This PDF took too long to process.",
  );
  assert.equal(parserWorker.terminateCount, 1);
  assert.equal(clearCount, 1);

  parserWorker.emit("message", {
    ok: true,
    pages: [{ pageNumber: 1, text: "late parser result" }],
    cleanupCompleted: true,
  });
  assert.equal(parserWorker.terminateCount, 1);
});

test("isolated parser clears timers and terminates workers after success and failure", async () => {
  for (const result of [
    {
      ok: true,
      pages: [{ pageNumber: 1, text: "successful parser result" }],
      cleanupCompleted: true,
    },
    {
      ok: false,
      code: "pdf_malformed",
      safeMessage: "This PDF could not be processed safely.",
      status: 422,
      cleanupCompleted: true,
    },
  ]) {
    const parserWorker = new FakeParserWorker();
    let clearCount = 0;
    const parsing = extractPdfPages(
      createTextPdf("A normal document used for controlled worker completion."),
      processingLimits(),
      {
        createWorker: () => {
          queueMicrotask(() => parserWorker.emit("message", result));
          return parserWorker;
        },
        clearTimer: (timer) => {
          clearCount += 1;
          clearTimeout(timer);
        },
      },
    );

    if (result.ok) {
      assert.equal((await parsing)[0].text, "successful parser result");
    } else {
      await assert.rejects(parsing, (error) => error.code === "pdf_malformed");
    }
    assert.equal(parserWorker.terminateCount, 1);
    assert.equal(clearCount, 1);
  }
});

test("active or embedded PDF content is rejected while normal hyperlinks remain valid", async () => {
  const activeFixtures = [
    createTextPdf("Attachment-bearing policy document text.", {
      catalogExtra: "/Names << /EmbeddedFiles << /Names [(payload.txt) 7 0 R] >> >>",
      extraObjects: [
        "<< /Type /EmbeddedFile /Length 7 >>\nstream\npayload\nendstream",
        "<< /Type /Filespec /F (payload.txt) /EF << /F 6 0 R >> >>",
      ],
    }),
    createTextPdf("Document JavaScript policy text.", {
      catalogExtra: "/OpenAction 6 0 R",
      extraObjects: ["<< /S /JavaScript /JS (app.alert\\(1\\)) >>"],
    }),
    createTextPdf("Page JavaScript action policy text.", {
      pageExtra: "/AA << /O 6 0 R >>",
      extraObjects: ["<< /S /JavaScript /JS (app.alert\\(1\\)) >>"],
    }),
    createTextPdf("Launch action policy text.", {
      pageExtra: "/Annots [6 0 R]",
      extraObjects: [
        "<< /Type /Annot /Subtype /Link /Rect [72 680 200 700] /A << /S /Launch /F (payload.exe) >> >>",
      ],
    }),
    createTextPdf("Unsupported XFA policy text.", {
      catalogExtra: "/AcroForm 7 0 R",
      extraObjects: [
        "<< /Length 21 >>\nstream\n<xfa><form/></xfa>\nendstream",
        "<< /XFA 6 0 R >>",
      ],
    }),
  ];

  for (const fixture of activeFixtures) {
    await assert.rejects(
      extractPdfPages(fixture),
      (error) =>
        error instanceof PdfProcessingError &&
        error.code === "pdf_unsupported_active_content" &&
        error.safeMessage === "This PDF contains unsupported active or embedded content.",
    );
  }

  const hyperlink = createTextPdf("Normal hyperlink policy text remains accepted.", {
    pageExtra: "/Annots [6 0 R]",
    extraObjects: [
      "<< /Type /Annot /Subtype /Link /Rect [72 680 200 700] /A << /S /URI /URI (https://example.invalid/policy) >> >>",
    ],
  });
  assert.equal((await extractPdfPages(hyperlink)).length, 1);

  const staticAcroForm = createTextPdf("Static form policy text remains accepted.", {
    catalogExtra: "/AcroForm 7 0 R",
    pageExtra: "/Annots [6 0 R]",
    extraObjects: [
      "<< /Type /Annot /Subtype /Widget /FT /Tx /T (PolicyField) /V (Static value) /Rect [72 640 240 670] /P 3 0 R >>",
      "<< /Fields [6 0 R] >>",
    ],
  });
  assert.equal((await extractPdfPages(staticAcroForm)).length, 1);
});

test("password-protected and malformed PDFs fail with safe categorized errors", async () => {
  const owner = "00".repeat(32);
  const user = "00".repeat(32);
  const fileId = "11".repeat(16);
  const passwordProtected = createTextPdf("Encrypted policy text is not processed.", {
    extraObjects: [
      `<< /Filter /Standard /V 1 /R 2 /O <${owner}> /U <${user}> /P -4 >>`,
    ],
    trailerExtra: `/Encrypt 6 0 R /ID [<${fileId}> <${fileId}>]`,
  });
  await assert.rejects(
    extractPdfPages(passwordProtected),
    (error) =>
      error instanceof PdfProcessingError &&
      error.code === "pdf_password_protected" &&
      error.safeMessage === "Password-protected PDFs are not supported.",
  );

  const parserSecret = "sensitive parser exception text";
  for (const malformed of [
    new Uint8Array(Buffer.from("%PDF-1.7\ntruncated")),
    new Uint8Array(Buffer.from(`%PDF-1.7\n${parserSecret}\n%%EOF`)),
  ]) {
    await assert.rejects(
      extractPdfPages(malformed),
      (error) =>
        error instanceof PdfProcessingError &&
        ["pdf_malformed", "pdf_processing_failed"].includes(error.code) &&
        error.safeMessage === "This PDF could not be processed safely." &&
        !error.safeMessage.includes(parserSecret),
    );
  }
});

test("production worker failure remains idempotent and cannot finalize a failed job", async () => {
  const [route, failureMigration, completionMigration, parserWorker] = await Promise.all([
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("supabase/migrations/013_create_internal_ingestion_worker.sql", "utf8"),
    readFile("supabase/migrations/015_create_chunk_embeddings.sql", "utf8"),
    readFile("lib/pdfParserWorker.js", "utf8"),
  ]);

  assert.equal(route.match(/await markWorkerFailure\(supabase, payload, safeMessage\)/g)?.length, 1);
  assert.match(failureMigration, /pj\.status in \('Queued', 'Processing', 'Reprocessing'\)/);
  assert.match(failureMigration, /status = 'Failed'/);
  assert.match(completionMigration, /if current_job\.status <> 'Processing' then/);
  assert.match(parserWorker, /await document\?\.cleanup\(\)/);
  assert.match(parserWorker, /await loadingTask\.destroy\(\)/);
  assert.ok(
    parserWorker.indexOf("document.numPages > limits.maxPdfPages") <
      parserWorker.indexOf("document.getPage(pageNumber)"),
    "the page ceiling must be checked before any page extraction",
  );
  assert.doesNotMatch(route, /console\.(?:error|warn|info)\([^)]*(?:fileBlob|storage_path)/s);
  assert.doesNotMatch(route, /console\.(?:error|warn|info)\([^)]*(?:content|source_text|extracted_text):/s);
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

test("notice-content obligations survive contact-block filtering when contact details are included", () => {
  const result = buildDeterministicChunks({
    pages: [{
      pageNumber: 1,
      text: [
        "Customer notice content",
        "Each notice must be clear and conspicuous, written in understandable language, and include a description of the incident and the type of sensitive customer information involved.",
        "The notice must identify protective steps customers can take, including fraud alerts and credit monitoring, and provide contact information by phone at 555-0100, email at help@example.test, and mail at 100 Main Street.",
      ].join("\n"),
    }],
    documentId: "10000000-0000-4000-8000-000000000011",
    workspaceId: "20000000-0000-4000-8000-000000000012",
    jobId: "30000000-0000-4000-8000-000000000013",
    filename: "notice-policy.pdf",
  });

  assert.ok(result.chunks.length > 0);
  assert.ok(result.chunks.some((item) => /clear and conspicuous/i.test(item.content)));
  assert.ok(result.chunks.every((item) => item.metadata.evidence_class !== "contact_block"));
});

test("pure contact directories remain excluded from substantive retrieval while retaining page coverage", () => {
  const result = buildDeterministicChunks({
    pages: [{
      pageNumber: 1,
      text: "Contact us by phone at 555-0100, email at help@example.test, or mail at 100 Main Street, Suite 200.",
    }],
    documentId: "10000000-0000-4000-8000-000000000021",
    workspaceId: "20000000-0000-4000-8000-000000000022",
    jobId: "30000000-0000-4000-8000-000000000023",
    filename: "contacts.pdf",
  });
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].metadata.evidence_class, "contact_block");
  assert.equal(result.chunks[0].metadata.retrieval_included, false);
  assert.equal(result.completeness.finalCompletenessStatus, "complete");
});
