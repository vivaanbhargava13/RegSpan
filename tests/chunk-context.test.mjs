import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadChunkContextModules() {
  const outDir = await mkdtemp(join(tmpdir(), "regspan-chunk-context-test-"));
  const compilerOptions = {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
    verbatimModuleSyntax: false,
  };
  const [contextSource, processingSource, policySource] = await Promise.all([
    readFile("lib/chunkContext.ts", "utf8"),
    readFile("lib/pdfProcessingCore.ts", "utf8"),
    readFile("lib/aiProcessingPolicy.ts", "utf8"),
  ]);
  const contextOutput = ts.transpileModule(contextSource, {
    compilerOptions,
    fileName: "lib/chunkContext.ts",
  }).outputText
    .replaceAll('from "./aiProcessingPolicy"', 'from "./lib__aiProcessingPolicy.mjs"')
    .replaceAll('from "./pdfProcessingCore"', 'from "./lib__pdfProcessingCore.mjs"');
  const processingOutput = ts.transpileModule(processingSource, {
    compilerOptions,
    fileName: "lib/pdfProcessingCore.ts",
  }).outputText;
  const policyOutput = ts.transpileModule(policySource, {
    compilerOptions,
    fileName: "lib/aiProcessingPolicy.ts",
  }).outputText;

  await Promise.all([
    writeFile(join(outDir, "lib__chunkContext.mjs"), contextOutput, "utf8"),
    writeFile(join(outDir, "lib__pdfProcessingCore.mjs"), processingOutput, "utf8"),
    writeFile(join(outDir, "lib__aiProcessingPolicy.mjs"), policyOutput, "utf8"),
  ]);

  const [context, processing] = await Promise.all([
    import(pathToFileURL(join(outDir, "lib__chunkContext.mjs")).href),
    import(pathToFileURL(join(outDir, "lib__pdfProcessingCore.mjs")).href),
  ]);
  return { context, processing };
}

const identifiers = {
  documentId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  jobId: "30000000-0000-4000-8000-000000000003",
  filename: "safeguards-policy.pdf",
};

test("external AI disabled path keeps deterministic retrieval context", async () => {
  const { context, processing } = await loadChunkContextModules();
  const { chunks } = processing.buildDeterministicChunks({
    ...identifiers,
    pages: [{
      pageNumber: 3,
      text: [
        "Safeguards Program",
        "",
        "Customer information repositories require access approval, periodic access review, and encryption.",
      ].join("\n"),
    }],
    documentType: "Policy",
    sourceType: "client_policy",
    evidenceRole: "organization_evidence",
  });
  let fetchCalled = false;

  const [annotated] = await context.addOptionalChunkSynopses({
    chunks,
    environment: {},
    async fetchImplementation() {
      fetchCalled = true;
      return Response.json({});
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(annotated.content, chunks[0].content);
  assert.equal(annotated.metadata.chunk_synopsis, null);
  assert.equal(annotated.metadata.chunk_annotation_version, null);
  assert.match(annotated.metadata.embedding_input, /Document type: Policy/);
  assert.match(annotated.metadata.embedding_input, /Section: Safeguards Program/);
  assert.match(annotated.metadata.deterministic_retrieval_context, /Safeguards Program/);
});

test("optional synopsis is embedded as retrieval context but not raw source content", async () => {
  const { context, processing } = await loadChunkContextModules();
  const { chunks } = processing.buildDeterministicChunks({
    ...identifiers,
    pages: [{
      pageNumber: 7,
      text: [
        "Access Management",
        "",
        "Customer information repositories require access approval, periodic access review, and encryption.",
      ].join("\n"),
    }],
    documentType: "Policy",
    sourceType: "client_policy",
    evidenceRole: "organization_evidence",
  });
  const synopsis = "This policy excerpt is partial support for safeguards because it describes access approval, periodic review, and encryption for customer information repositories, while not covering all administrative, technical, and physical safeguards.";

  const [annotated] = await context.addOptionalChunkSynopses({
    chunks,
    environment: {
      ENABLE_EXTERNAL_AI_PROCESSING: "true",
      CHUNK_SYNOPSIS_MODEL: "gpt-test",
      CHUNK_SYNOPSIS_API_KEY: "server-secret",
    },
    workspacePolicy: {
      workspaceId: identifiers.workspaceId,
      workspaceConsentEnabled: true,
      externalAiProcessingEnabled: true,
      externalAiClassifierEnabled: false,
      denialReason: null,
    },
    async fetchImplementation(_url, init) {
      assert.equal(init?.headers?.Authorization, "Bearer server-secret");
      return Response.json({
        choices: [{ message: { content: synopsis } }],
      });
    },
  });

  assert.equal(annotated.content, chunks[0].content);
  assert.doesNotMatch(annotated.content, /partial support for safeguards/);
  assert.match(annotated.metadata.embedding_input, /Retrieval synopsis: This policy excerpt is partial support/);
  assert.equal(annotated.metadata.chunk_synopsis, synopsis);
  assert.equal(annotated.metadata.chunk_annotation_version, "chunk-synopsis-v1");
  assert.notEqual(annotated.content_hash, chunks[0].content_hash);
  assert.equal(annotated.metadata.source_content_hash, chunks[0].metadata.source_content_hash);
});
