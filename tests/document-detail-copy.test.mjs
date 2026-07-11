import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document detail copy describes user-facing processing states", async () => {
  const source = await readFile("components/DocumentDetailClient.tsx", "utf8");

  assert.match(source, /Prepare source text/);
  assert.match(source, /Client source excerpts/);
  assert.match(source, /Ready for Analysis/);
  assert.match(source, /RegSpan could not prepare usable text from this PDF/);
  assert.match(source, /Reprocess this document to prepare client source excerpts/);
  assert.match(source, /activeAction === "reprocess" \? "Reprocessing\.\.\." : "Reprocess"/);
  assert.match(source, /Client source excerpts are ready\. Run Analysis/);
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

test("document detail progressively reveals client source excerpts", async () => {
  const source = await readFile("components/DocumentDetailClient.tsx", "utf8");

  assert.match(source, /INITIAL_VISIBLE_SOURCE_EXCERPTS = 3/);
  assert.match(source, /SOURCE_EXCERPT_PAGE_SIZE = 10/);
  assert.match(source, /const visibleChunks = chunks\.slice\(0, visibleExcerptCount\)/);
  assert.match(source, /Showing \{visibleSourceExcerptCount\} of \{chunks\.length\} source excerpts/);
  assert.match(source, /visibleChunks\.map/);
  assert.match(source, /Show more/);
  assert.match(source, /Show less/);
  assert.doesNotMatch(source, /chunks\.map\(\(chunk\) =>/);
});

test("document detail renders one generic lifecycle badge without a duplicate status label", async () => {
  const source = await readFile("components/DocumentDetailClient.tsx", "utf8");
  const statusStrip = source.slice(
    source.indexOf('<div className="border-b border-app-border bg-app-elevated/55'),
    source.indexOf('<dl className="grid divide-y divide-app-border'),
  );

  assert.match(statusStrip, /<LifecycleBadge label=\{documentLifecycleLabel\(document\.status\)\} value=\{document\.status\} \/>/);
  assert.doesNotMatch(statusStrip, /<StatusBadge showDot=\{false\}>\{documentLifecycleLabel\(document\.status\)\}<\/StatusBadge>/);
  assert.match(source, /function documentLifecycleLabel\(status: DocumentStatus\)/);
  assert.match(source, /case "Processed":/);
  assert.match(source, /case "Processing":/);
  assert.match(source, /case "Failed":/);
});
