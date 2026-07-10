import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEmbeddingCoreModule() {
  const outDir = await mkdtemp(join(tmpdir(), "regspan-embedding-test-"));
  const [embeddingSource, policySource] = await Promise.all([
    readFile("lib/embeddingCore.ts", "utf8"),
    readFile("lib/aiProcessingPolicy.ts", "utf8"),
  ]);
  const compilerOptions = {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  const embeddingOutput = ts.transpileModule(embeddingSource, {
    compilerOptions,
    fileName: "lib/embeddingCore.ts",
  }).outputText.replaceAll('from "./aiProcessingPolicy"', 'from "./lib__aiProcessingPolicy.mjs"');
  const policyOutput = ts.transpileModule(policySource, {
    compilerOptions,
    fileName: "lib/aiProcessingPolicy.ts",
  }).outputText;
  const embeddingOutPath = join(outDir, "lib__embeddingCore.mjs");
  await Promise.all([
    writeFile(embeddingOutPath, embeddingOutput, "utf8"),
    writeFile(join(outDir, "lib__aiProcessingPolicy.mjs"), policyOutput, "utf8"),
  ]);
  return import(pathToFileURL(embeddingOutPath).href);
}

const {
  createEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  EmbeddingProcessingError,
  planEmbeddingUpdates,
} = await loadEmbeddingCoreModule();
const { createWorkspaceExternalAiProcessingPolicy } = await import("../lib/aiProcessingPolicy.ts");

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
    () => createEmbeddingProvider({
      ENABLE_EXTERNAL_AI_PROCESSING: "true",
    }, async () => new Response(), createWorkspaceExternalAiProcessingPolicy({
      workspaceId: "workspace-1",
      workspaceConsentEnabled: true,
      environment: { ENABLE_EXTERNAL_AI_PROCESSING: "true" },
    })),
    (error) => error instanceof EmbeddingProcessingError
      && error.code === "embedding_not_configured",
  );
  assert.throws(
    () => createEmbeddingProvider({
      ENABLE_EXTERNAL_AI_PROCESSING: "true",
      EMBEDDING_PROVIDER: "unsupported",
      EMBEDDING_MODEL: "model-v1",
      EMBEDDING_API_KEY: "server-secret",
    }, async () => new Response(), createWorkspaceExternalAiProcessingPolicy({
      workspaceId: "workspace-1",
      workspaceConsentEnabled: true,
      environment: { ENABLE_EXTERNAL_AI_PROCESSING: "true" },
    })),
    (error) => error instanceof EmbeddingProcessingError
      && error.code === "unsupported_embedding_provider",
  );
});

test("external AI embedding calls require server policy and workspace consent", () => {
  let fetchCalled = false;

  assert.throws(
    () => createEmbeddingProvider({
      EMBEDDING_PROVIDER: "openai",
      EMBEDDING_MODEL: "embedding-test-model",
      EMBEDDING_API_KEY: "server-secret",
    }, async () => {
      fetchCalled = true;
      return new Response();
    }, createWorkspaceExternalAiProcessingPolicy({
      workspaceId: "workspace-1",
      workspaceConsentEnabled: false,
      environment: { ENABLE_EXTERNAL_AI_PROCESSING: "true" },
    })),
    (error) => error instanceof EmbeddingProcessingError
      && error.code === "external_ai_processing_disabled"
      && error.safeMessage === "External AI processing is disabled by workspace and server policy.",
  );
  assert.throws(
    () => createEmbeddingProvider({
      ENABLE_EXTERNAL_AI_PROCESSING: "false",
      EMBEDDING_PROVIDER: "openai",
      EMBEDDING_MODEL: "embedding-test-model",
      EMBEDDING_API_KEY: "server-secret",
    }, async () => new Response(), createWorkspaceExternalAiProcessingPolicy({
      workspaceId: "workspace-1",
      workspaceConsentEnabled: true,
      environment: { ENABLE_EXTERNAL_AI_PROCESSING: "false" },
    })),
    (error) => error instanceof EmbeddingProcessingError
      && error.code === "external_ai_processing_disabled",
  );
  assert.equal(fetchCalled, false);
});

test("configured provider returns validated vectors without exposing configuration", async () => {
  const provider = createEmbeddingProvider({
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    EMBEDDING_PROVIDER: "openai",
    EMBEDDING_MODEL: "embedding-test-model",
    EMBEDDING_API_KEY: "server-secret",
  }, async (_url, init) => {
    assert.equal(init?.headers?.Authorization, "Bearer server-secret");
    return Response.json({
      data: [{ index: 0, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.01) }],
    });
  }, createWorkspaceExternalAiProcessingPolicy({
    workspaceId: "workspace-1",
    workspaceConsentEnabled: true,
    environment: { ENABLE_EXTERNAL_AI_PROCESSING: "true" },
  }));

  const vectors = await provider.embedTexts(["citation-grade policy evidence"]);
  assert.equal(provider.model, "embedding-test-model");
  assert.equal(vectors.length, 1);
  assert.equal(vectors[0].length, EMBEDDING_DIMENSIONS);
});
