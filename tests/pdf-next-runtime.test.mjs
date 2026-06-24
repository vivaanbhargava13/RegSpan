import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("PDF parser remains Node-only and external to the Next server bundle", async () => {
  const [route, parser, serverBoundary, nextConfig] = await Promise.all([
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("lib/pdfProcessingCore.ts", "utf8"),
    readFile("lib/pdfIngestion.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
  ]);

  assert.match(route, /export const runtime = ["']nodejs["']/);
  assert.doesNotMatch(parser, /import\s+\{[^}]*PDFParse[^}]*\}\s+from\s+["']pdf-parse["']/);
  assert.match(parser, /await import\(["']pdf-parse["']\)/);
  assert.match(serverBoundary, /import ["']server-only["']/);
  assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*["']pdf-parse["']/s);
  assert.match(nextConfig, /serverExternalPackages:\s*\[[^\]]*["']pdfjs-dist["']/s);
});

