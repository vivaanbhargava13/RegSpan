import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("retrieval debug validation rejects missing queries", async () => {
  const validator = await readFile("lib/retrievalDebug.ts", "utf8");

  assert.match(validator, /missing_query/);
  assert.match(validator, /Enter a retrieval query before searching\./);
  assert.match(validator, /DEFAULT_RETRIEVAL_DEBUG_TOP_K = 5/);
  assert.match(validator, /MAX_RETRIEVAL_DEBUG_TOP_K = 20/);
});

test("retrieval debug keeps embedding secrets server-side", async () => {
  const [client, route, retrieval] = await Promise.all([
    readFile("components/RetrievalDebugClient.tsx", "utf8"),
    readFile("app/api/retrieval-debug/route.ts", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
  ]);

  assert.equal(client.includes("EMBEDDING_API_KEY"), false);
  assert.equal(client.includes("createEmbeddingProvider"), false);
  assert.match(route, /authenticateRequest/);
  assert.match(route, /retrieveRelevantChunks/);
  assert.match(retrieval, /createEmbeddingProvider/);
  assert.match(retrieval, /import ["']server-only["']/);
});

test("retrieval debug route enforces workspace-scoped retrieval", async () => {
  const [route, retrieval] = await Promise.all([
    readFile("app/api/retrieval-debug/route.ts", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
  ]);

  assert.match(route, /getActorWorkspaceId/);
  assert.match(route, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(route, /workspaceId,\s*\n\s*queryText: parsed\.query/);
  assert.match(retrieval, /p_workspace_id: workspaceId/);
  assert.match(retrieval, /\.eq\("workspace_id", workspaceId\)/);
});

test("retrieval debug exposes citation and embedding-input metadata", async () => {
  const [client, retrieval] = await Promise.all([
    readFile("components/RetrievalDebugClient.tsx", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
  ]);

  assert.match(retrieval, /evidence_reason/);
  assert.match(retrieval, /embedding_input/);
  assert.match(client, /Evidence reason:/);
  assert.match(client, /Debug embedding input/);
  assert.match(client, /Similarity/);
});
