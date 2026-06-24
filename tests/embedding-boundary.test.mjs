import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("embedding credentials remain behind server-only boundaries", async () => {
  const [embeddingBoundary, chunkWorker, retrieval, componentNames] = await Promise.all([
    readFile("lib/embeddings.ts", "utf8"),
    readFile("lib/chunkEmbeddings.ts", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
    readdir("components"),
  ]);

  assert.match(embeddingBoundary, /import ["']server-only["']/);
  assert.match(chunkWorker, /import ["']server-only["']/);
  assert.match(retrieval, /import ["']server-only["']/);

  const clientSources = await Promise.all(
    componentNames
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .map((name) => readFile(`components/${name}`, "utf8")),
  );
  assert.equal(clientSources.some((source) => source.includes("EMBEDDING_API_KEY")), false);
});
