import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  EmbeddingProcessingError,
  planEmbeddingUpdates,
} from "../lib/embeddingCore.ts";

const chunks = [
  { id: "chunk-a", content: "Stable policy text", content_hash: "a".repeat(64) },
  { id: "chunk-b", content: "Changed policy text", content_hash: "b".repeat(64) },
];

test("unchanged chunks are not scheduled for re-embedding", () => {
  const pending = planEmbeddingUpdates(chunks, [
    { chunk_id: "chunk-a", content_hash: "a".repeat(64), embedding_model: "model-v1" },
    { chunk_id: "chunk-b", content_hash: "b".repeat(64), embedding_model: "model-v1" },
  ], "model-v1");

  assert.deepEqual(pending, []);
});

test("changed and missing chunks are scheduled for embedding", () => {
  const pending = planEmbeddingUpdates(chunks, [
    { chunk_id: "chunk-a", content_hash: "c".repeat(64), embedding_model: "model-v1" },
  ], "model-v1");

  assert.deepEqual(pending.map((chunk) => chunk.id), ["chunk-a", "chunk-b"]);
});

test("embedding configuration is server-controlled and validated", () => {
  assert.throws(
    () => createEmbeddingProvider({}, async () => new Response()),
    (error) => error instanceof EmbeddingProcessingError
      && error.code === "embedding_not_configured",
  );
  assert.throws(
    () => createEmbeddingProvider({
      EMBEDDING_PROVIDER: "unsupported",
      EMBEDDING_MODEL: "model-v1",
      EMBEDDING_API_KEY: "server-secret",
    }, async () => new Response()),
    (error) => error instanceof EmbeddingProcessingError
      && error.code === "unsupported_embedding_provider",
  );
});

test("configured provider returns validated vectors without exposing configuration", async () => {
  const provider = createEmbeddingProvider({
    EMBEDDING_PROVIDER: "openai",
    EMBEDDING_MODEL: "embedding-test-model",
    EMBEDDING_API_KEY: "server-secret",
  }, async (_url, init) => {
    assert.equal(init?.headers?.Authorization, "Bearer server-secret");
    return Response.json({
      data: [{ index: 0, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.01) }],
    });
  });

  const vectors = await provider.embedTexts(["citation-grade policy evidence"]);
  assert.equal(provider.model, "embedding-test-model");
  assert.equal(vectors.length, 1);
  assert.equal(vectors[0].length, EMBEDDING_DIMENSIONS);
});
