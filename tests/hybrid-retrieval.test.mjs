import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadTsModule(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const outDir = await mkdtemp(join(tmpdir(), "regspan-hybrid-test-"));
  const outPath = join(outDir, sourcePath.replace(/[\/:]/g, "__").replace(/\.ts$/, ".mjs"));
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: sourcePath,
  });
  const outputText = transpiled.outputText
    .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"');
  if (sourcePath !== "lib/negativeEvidence.ts") {
    const negativeSource = await readFile("lib/negativeEvidence.ts", "utf8");
    const negativeTranspiled = ts.transpileModule(negativeSource, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
      fileName: "lib/negativeEvidence.ts",
    });
    await writeFile(join(outDir, "lib__negativeEvidence.mjs"), negativeTranspiled.outputText, "utf8");
  }
  await writeFile(outPath, outputText, "utf8");
  return import(pathToFileURL(outPath).href);
}

function candidate(overrides = {}) {
  return {
    chunk_id: "chunk-a",
    filename: "Incident Response Policy.pdf",
    section_path: "Incident Response > Customer Notification",
    content_preview: "Affected customers must be notified after unauthorized access.",
    similarity: 0.55,
    evidence_reason: "substantive policy evidence",
    source_type: "client_policy",
    evidence_role: "organization_evidence",
    ...overrides,
  };
}

const requirement = {
  title: "Customer notification after unauthorized access",
  description: "Notify affected customers after unauthorized access to sensitive customer information.",
  retrievalQuery: "notify affected customers unauthorized access sensitive customer information",
  directSignals: ["notify affected customers", "unauthorized access"],
  actionSignals: ["notify", "notification"],
  topicSignals: ["affected customers", "customer information"],
  partialSignals: ["notice"],
  backgroundSignals: ["privacy"],
};

test("semantic retrieval path remains intact beside hybrid retrieval", async () => {
  const [retrieval, hybrid, route] = await Promise.all([
    readFile("lib/retrieval.ts", "utf8"),
    readFile("lib/hybridRetrieval.ts", "utf8"),
    readFile("app/api/requirement-debug/route.ts", "utf8"),
  ]);

  assert.match(retrieval, /export async function retrieveRelevantChunks/);
  assert.match(retrieval, /match_document_chunks_v1/);
  assert.match(hybrid, /export async function retrieveRequirementHybridChunks/);
  assert.match(hybrid, /retrieveRelevantChunks/);
  assert.match(route, /retrieveRequirementHybridChunks/);
});

test("hybrid candidate merging deduplicates chunks by id and preserves semantic similarity", async () => {
  const { mergeHybridCandidates } = await loadTsModule("lib/hybridReranking.ts");
  const merged = mergeHybridCandidates(
    [candidate({ chunk_id: "same", similarity: 0.72, evidence_reason: "semantic evidence" })],
    [candidate({ chunk_id: "same", similarity: 0, evidence_reason: "keyword evidence" })],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].chunk_id, "same");
  assert.equal(merged[0].similarity, 0.72);
  assert.equal(merged[0].evidence_reason, "semantic evidence");
});

test("rerank_score rewards direct action topic and section-path matches", async () => {
  const { rerankRequirementChunk } = await loadTsModule("lib/hybridReranking.ts");
  const strong = rerankRequirementChunk(requirement, candidate());
  const weak = rerankRequirementChunk(requirement, candidate({
    chunk_id: "chunk-b",
    section_path: "Appendix",
    content_preview: "General background context for privacy operations.",
    similarity: 0.55,
    evidence_reason: "background context",
  }));

  assert.ok(strong.rerank_score > weak.rerank_score);
  assert.match(strong.rerank_reason, /direct signals/);
  assert.match(strong.rerank_reason, /action signals/);
  assert.match(strong.rerank_reason, /topic signals/);
  assert.match(strong.rerank_reason, /section\/path signals/);
});

test("rerank_score can use inherited embedding context when raw text lacks heading terms", async () => {
  const { rerankRequirementChunk } = await loadTsModule("lib/hybridReranking.ts");
  const inheritedContext = rerankRequirementChunk(requirement, candidate({
    chunk_id: "chunk-context",
    section_path: "Document Overview",
    content_preview: "Legal and Privacy review the timing before delivery.",
    embedding_input: [
      "Filename: Incident Response Policy.pdf",
      "Section: Incident Response > Customer Notification",
      "Parent heading: Incident Response",
      "Citation: Page 12",
      "",
      "Legal and Privacy review the timing before delivery.",
    ].join("\n"),
  }));
  const generic = rerankRequirementChunk(requirement, candidate({
    chunk_id: "chunk-generic",
    section_path: "Document Overview",
    content_preview: "Legal and Privacy review the timing before delivery.",
    embedding_input: null,
  }));

  assert.ok(inheritedContext.rerank_score > generic.rerank_score);
  assert.match(inheritedContext.rerank_reason, /direct signals|action signals|topic signals/);
});

test("customer notification content reranks direct notice-content sections over vendor sections", async () => {
  const { rerankRequirementCandidates } = await loadTsModule("lib/hybridReranking.ts");
  const contentRequirement = {
    id: "customer_notification_content",
    title: "Customer notification content",
    description: "Define the required contents of customer notices to affected individuals.",
    retrievalQuery: "customer notification content requirements incident description information involved protective steps contact information",
    directSignals: ["incident description", "information involved", "fraud alert", "credit report"],
    actionSignals: ["include", "describe", "explain"],
    topicSignals: ["notice", "affected individuals", "sensitive customer information"],
    partialSignals: ["notification", "template"],
    backgroundSignals: ["communications"],
  };
  const [top] = rerankRequirementCandidates(contentRequirement, [
    candidate({
      chunk_id: "vendor-section",
      section_path: "Service provider oversight expectations",
      content_preview: "Service providers must escalate incidents promptly and cooperate with investigation support.",
      similarity: 0.62,
    }),
    candidate({
      chunk_id: "notice-content-section",
      section_path: "Customer notification content requirements",
      content_preview: "Notices include an incident description, information involved, fraud alert guidance, credit report resources, and contact information.",
      similarity: 0.57,
    }),
  ], 2);

  assert.equal(top.chunk_id, "notice-content-section");
  assert.match(top.rerank_reason, /preferred sections/);
});

test("reranked chunks retain source type evidence role and reason fields", async () => {
  const { rerankRequirementCandidates } = await loadTsModule("lib/hybridReranking.ts");
  const [result] = rerankRequirementCandidates(requirement, [candidate()], 1);

  assert.equal(result.rank, 1);
  assert.equal(result.source_type, "client_policy");
  assert.equal(result.evidence_role, "organization_evidence");
  assert.equal(typeof result.rerank_score, "number");
  assert.match(result.rerank_reason, /role organization_evidence/);
});

test("rerank_score does not boost negated requirement language", async () => {
  const { rerankRequirementChunk } = await loadTsModule("lib/hybridReranking.ts");
  const positive = rerankRequirementChunk(requirement, candidate());
  const negative = rerankRequirementChunk(requirement, candidate({
    chunk_id: "chunk-negative",
    content_preview:
      "This policy does not establish customer notification after unauthorized access to customer information.",
  }));

  assert.ok(positive.rerank_score > negative.rerank_score);
  assert.match(negative.rerank_reason, /negative evidence/);
});

test("hybrid retrieval and requirement debug do not expose server secrets to client code", async () => {
  const [client, hybrid] = await Promise.all([
    readFile("components/RequirementDebugClient.tsx", "utf8"),
    readFile("lib/hybridRetrieval.ts", "utf8"),
  ]);

  assert.equal(client.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(client.includes("EMBEDDING_API_KEY"), false);
  assert.match(hybrid, /server-only/);
});
