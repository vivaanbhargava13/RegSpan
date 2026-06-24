import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document detail copy describes the real ingestion pipeline", async () => {
  const source = await readFile("components/DocumentDetailClient.tsx", "utf8");

  assert.match(source, /PDF text extraction/);
  assert.match(source, /PDF text was extracted by the secure ingestion worker\./);
  assert.match(source, /Document chunks were generated from extracted PDF text\./);
  assert.match(source, /Requirement matching/);
  assert.match(source, /requirement matching (?:has not been implemented|is not connected)/i);

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

