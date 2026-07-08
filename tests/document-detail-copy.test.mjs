import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document detail copy describes user-facing processing states", async () => {
  const source = await readFile("components/DocumentDetailClient.tsx", "utf8");

  assert.match(source, /Prepare source text/);
  assert.match(source, /Evidence sections/);
  assert.match(source, /Ready for analysis/);
  assert.match(source, /RegSpan could not prepare usable text from this PDF/);
  assert.match(source, /Reprocess the document to prepare source text for analysis/);
  assert.match(source, /Evidence sections are ready\. Run Analysis/);
  assert.doesNotMatch(source, /secure ingestion worker|Document chunks were generated|Chunking|Extracted chunks|Processed chunks|Requirement matching/i);

  for (const staleCopy of [
    "Demo complete",
    "demo review state",
    "Mock document sections",
    "Mock excerpt",
    "no real text reading",
    "document reading is connected",
  ]) {
    assert.doesNotMatch(source, new RegExp(staleCopy, "i"));
  }
});
