import assert from "node:assert/strict";
import test from "node:test";
import {
  CLASSIFIER_SOURCE_TEXT_MAX_CHARS,
  SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS,
  createClassifierSourceTextCache,
  hydrateSelectedCandidateSourceTextsWithCache,
  hydrateSelectedCandidateSourceTexts,
} from "../lib/classifierSourceHydration.ts";

function candidate(chunkId, preview, overrides = {}) {
  return {
    chunk_id: chunkId,
    content_preview: preview,
    rank: 1,
    similarity: 0.8,
    rerank_score: 13,
    rerank_reason: "selected before hydration",
    metadata: { source: "test" },
    ...overrides,
  };
}

function selectionFields(candidateValue) {
  const fields = { ...candidateValue };
  delete fields.content_preview;
  return fields;
}

test("selected source hydration preserves short candidates byte-for-byte", () => {
  const short = candidate("short", "A complete short source passage.");
  const [result] = hydrateSelectedCandidateSourceTexts(
    [short],
    new Map([[short.chunk_id, short.content_preview]]),
  );

  assert.equal(result, short);
  assert.deepEqual(result, short);
});

test("selected source hydration exposes operative text beyond the semantic preview", () => {
  const preview = "x".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
  const operativeTail = " The policy requires secure destruction after the retention period.";
  const selected = candidate("truncated", preview);
  const [result] = hydrateSelectedCandidateSourceTexts(
    [selected],
    new Map([[selected.chunk_id, preview + operativeTail]]),
  );

  assert.match(result.content_preview, /requires secure destruction/);
  assert.ok(result.content_preview.length > SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
});

test("selected source hydration keeps candidate order, scores, and metadata unchanged", () => {
  const first = candidate("first", "a".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS), {
    rank: 1,
    similarity: 0.91,
    rerank_score: 25,
  });
  const second = candidate("second", "short source", {
    rank: 2,
    similarity: 0.72,
    rerank_score: 14,
  });
  const selected = [first, second];
  const hydrated = hydrateSelectedCandidateSourceTexts(selected, new Map([
    [first.chunk_id, first.content_preview + " later source text"],
    [second.chunk_id, second.content_preview],
  ]));

  assert.deepEqual(hydrated.map((item) => item.chunk_id), ["first", "second"]);
  assert.deepEqual(
    hydrated.map(selectionFields),
    selected.map(selectionFields),
  );
  assert.equal(hydrated[1], second);
  assert.ok(hydrated[0].content_preview.endsWith("later source text"));
});

test("selected source hydration caps long classifier source text", () => {
  const preview = "x".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
  const selected = candidate("long", preview);
  const [result] = hydrateSelectedCandidateSourceTexts(
    [selected],
    new Map([[selected.chunk_id, "x".repeat(CLASSIFIER_SOURCE_TEXT_MAX_CHARS + 500)]]),
  );

  assert.equal(result.content_preview.length, CLASSIFIER_SOURCE_TEXT_MAX_CHARS);
});

test("selected chunks shared across requirements are fetched once per workspace invocation", async () => {
  const preview = "x".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
  const selected = candidate("shared", preview);
  const sourceTextCache = createClassifierSourceTextCache();
  const queries = [];
  const loadSourceTextRows = async (chunkIds) => {
    queries.push(chunkIds);
    return chunkIds.map((id) => ({
      id,
      content: `${preview} The policy requires secure destruction.`,
    }));
  };

  const first = await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-a",
    candidates: [selected],
    sourceTextCache,
    loadSourceTextRows,
  });
  const second = await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-a",
    candidates: [selected],
    sourceTextCache,
    loadSourceTextRows,
  });

  assert.deepEqual(queries, [["shared"]]);
  assert.deepEqual(second, first);
  assert.match(second[0].content_preview, /requires secure destruction/);
});

test("later requirements query only selected source IDs that are not yet cached", async () => {
  const preview = "x".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
  const sourceTextCache = createClassifierSourceTextCache();
  const queries = [];
  const loadSourceTextRows = async (chunkIds) => {
    queries.push(chunkIds);
    return chunkIds.map((id) => ({ id, content: `${preview} ${id} source text` }));
  };

  await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-a",
    candidates: [candidate("first", preview), candidate("shared", preview)],
    sourceTextCache,
    loadSourceTextRows,
  });
  await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-a",
    candidates: [candidate("shared", preview), candidate("later", preview)],
    sourceTextCache,
    loadSourceTextRows,
  });

  assert.deepEqual(queries, [["first", "shared"], ["later"]]);
});

test("source text cache includes workspace in its key", async () => {
  const preview = "x".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
  const selected = candidate("shared", preview);
  const sourceTextCache = createClassifierSourceTextCache();
  const queries = [];
  const loadSourceTextRows = async (chunkIds) => {
    queries.push(chunkIds);
    return chunkIds.map((id) => ({ id, content: `${preview} ${id} source text` }));
  };

  await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-a",
    candidates: [selected],
    sourceTextCache,
    loadSourceTextRows,
  });
  await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-b",
    candidates: [selected],
    sourceTextCache,
    loadSourceTextRows,
  });

  assert.deepEqual(queries, [["shared"], ["shared"]]);
});

test("cached hydration preserves candidates and leaves missing or invalid source rows unchanged", async () => {
  const preview = "x".repeat(SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS);
  const first = candidate("hydrated", preview, { rank: 1, rerank_score: 25 });
  const missing = candidate("missing", "complete source", { rank: 2, rerank_score: 14 });
  const invalid = candidate("invalid", "another complete source", { rank: 3, rerank_score: 12 });
  const selected = [first, missing, invalid];
  const hydratedSourceText = `${preview} operative source text`;
  const expected = hydrateSelectedCandidateSourceTexts(selected, new Map([
    [first.chunk_id, hydratedSourceText],
  ]));
  const queries = [];
  const hydrated = await hydrateSelectedCandidateSourceTextsWithCache({
    workspaceId: "workspace-a",
    candidates: selected,
    sourceTextCache: createClassifierSourceTextCache(),
    async loadSourceTextRows(chunkIds) {
      queries.push(chunkIds);
      return [
        { id: first.chunk_id, content: hydratedSourceText },
        { id: invalid.chunk_id, content: null },
      ];
    },
  });

  assert.deepEqual(hydrated.map((item) => item.chunk_id), selected.map((item) => item.chunk_id));
  assert.deepEqual(hydrated.map(selectionFields), selected.map(selectionFields));
  assert.deepEqual(hydrated, expected);
  assert.deepEqual(queries, [["hydrated", "missing", "invalid"]]);
  assert.equal(hydrated[1], missing);
  assert.equal(hydrated[2], invalid);
  assert.match(hydrated[0].content_preview, /operative source text/);
});
