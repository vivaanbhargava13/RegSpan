import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PDF parser remains isolated, Node-only, and external to the Next server bundle", async () => {
  const [route, parser, parserWorker, serverBoundary, nextConfig, envExample, documentation] = await Promise.all([
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("lib/pdfProcessingCore.ts", "utf8"),
    readFile("lib/pdfParserWorker.js", "utf8"),
    readFile("lib/pdfIngestion.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile(".env.example", "utf8"),
    readFile("docs/security/pdf-processing-hardening.md", "utf8"),
  ]);

  assert.match(route, /export const runtime = ["']nodejs["']/);
  assert.match(parser, /isolatedPdfParserWorkerMain\.toString\(\)/);
  assert.match(parser, /eval: true/);
  assert.match(parser, /resourceLimits:/);
  assert.match(parserWorker, /new Function\("specifier", "return import\(specifier\)"\)/);
  for (const option of [
    "isEvalSupported: false",
    "useWorkerFetch: false",
    "disableAutoFetch: true",
    "disableRange: true",
    "disableStream: true",
    "stopAtErrors: true",
    "enableXfa: false",
    "useSystemFonts: false",
  ]) {
    assert.match(parserWorker, new RegExp(option));
  }
  assert.doesNotMatch(parserWorker, /url:\s*|password:\s*|docBaseUrl:\s*|withCredentials:\s*true/);
  assert.match(serverBoundary, /import ["']server-only["']/);
  assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*["']pdfjs-dist["']/s);
  assert.doesNotMatch(nextConfig, /pdf-parse/);
  assert.match(envExample, /PDF_PROCESSING_TIMEOUT_MS=180000/);
  assert.match(envExample, /MAX_PDF_PAGE_TEXT_CHARS=500000/);
  assert.match(documentation, /actual\s+worker-thread termination/i);
  assert.match(documentation, /Storage object is intentionally retained/i);
});
