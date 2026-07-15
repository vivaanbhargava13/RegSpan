import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  quoteDigest,
  toBlindExecutionArtifact,
  toEvaluationProvenanceArtifact,
} from "../scripts/blindHoldoutCore.mjs";

async function loadEvaluationProvenanceModule() {
  const sourcePath = "lib/evaluationProvenance.ts";
  const source = await readFile(sourcePath, "utf8");
  const outDir = await mkdtemp(join(tmpdir(), "regspan-eval-provenance-test-"));
  const outPath = join(outDir, "evaluationProvenance.mjs");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: sourcePath,
  }).outputText;
  await writeFile(outPath, output, "utf8");
  return import(pathToFileURL(outPath).href);
}

function blindState() {
  return {
    runId: "run-one",
    corpusId: "blind-holdout-fixture",
    corpusVersion: 1,
    mode: "isolated",
    selectedCaseIds: ["policy-a"],
    selectedCaseCount: 1,
    filtered: true,
    executionStatus: "completed",
    status: "completed",
    startedAt: "2026-07-15T00:00:00.000Z",
    completedAt: "2026-07-15T00:01:00.000Z",
    workspaces: { "policy-a": { id: "workspace-a" } },
    cases: {
      "policy-a": {
        caseId: "policy-a",
        tier: "holdout",
        filename: "policy-a.pdf",
        workspaceKey: "policy-a",
        completed: true,
        engineOutput: {
          findings: [{ findingId: "finding-a", requirementId: "written_incident_response_program", status: "missing" }],
          evidence: [],
        },
      },
    },
  };
}

test("provenance-disabled blind execution output remains byte-for-byte unchanged", () => {
  const state = blindState();
  const disabled = JSON.stringify(toBlindExecutionArtifact(state));
  const internalTrace = {
    ...state,
    evaluationProvenance: {
      rawQuote: "raw source must never reach the blind artifact",
    },
  };
  assert.equal(JSON.stringify(toBlindExecutionArtifact(internalTrace)), disabled);
});

test("evaluation provenance records observer metadata without mutating candidates or findings", async () => {
  const { createEvaluationProvenanceCollector } = await loadEvaluationProvenanceModule();
  const candidate = {
    chunk_id: "chunk-a",
    rank: 1,
    retrieval_rank: 3,
    retrieval_origin: "merged",
    similarity: 0.91,
    semantic_score: 0.91,
    keyword_score: null,
    rerank_score: 97,
    page_start: 4,
    page_end: 4,
    section_path: "Incident Response > Written Program",
    source_type: "client_policy",
    evidence_role: "organization_evidence",
    content_preview: "RAW CLIENT SOURCE TEXT MUST NOT BE SERIALIZED",
  };
  const classified = {
    ...candidate,
    classifier_provider: "heuristic",
    evidence_relationship: "supports",
    covered_elements: ["detection", "response"],
    supporting_quote: "RAW CLIENT SOURCE TEXT MUST NOT BE SERIALIZED",
  };
  const finding = {
    status: "partial",
    evidence: [{ chunk_id: "chunk-a", quote: "RAW CLIENT SOURCE TEXT MUST NOT BE SERIALIZED" }],
  };
  const before = structuredClone({ candidate, classified, finding });

  assert.equal(createEvaluationProvenanceCollector({
    caseId: "policy-a",
    environment: {},
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    classifierProvider: "heuristic",
    classifierModel: null,
    topK: 25,
    semanticPoolSize: 30,
    keywordPoolSize: 40,
  }), null);

  const collector = createEvaluationProvenanceCollector({
    caseId: "policy-a",
    environment: { ENABLE_EVAL_PROVENANCE: "true" },
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    classifierProvider: "heuristic",
    classifierModel: null,
    topK: 25,
    semanticPoolSize: 30,
    keywordPoolSize: 40,
  });
  collector.recordRetrieved("written_incident_response_program", [candidate]);
  collector.recordClassified("written_incident_response_program", [classified]);
  collector.recordAggregated("written_incident_response_program", finding, [classified]);
  collector.recordPersistence("written_incident_response_program", ["chunk-a"], ["chunk-a"]);

  assert.deepEqual({ candidate, classified, finding }, before);
  const trace = collector.snapshot();
  assert.equal(trace.requirements[0].finalStatus, "partial");
  assert.equal(trace.requirements[0].candidates[0].persistenceOutcome, "persisted");
  assert.equal(trace.requirements[0].candidates[0].quoteHash, quoteDigest(candidate.content_preview));
});

test("evaluation provenance records filtering and classifier provenance without carrying an LLM model into heuristic rows", async () => {
  const { createEvaluationProvenanceCollector } = await loadEvaluationProvenanceModule();
  const organizationCandidate = {
    chunk_id: "chunk-organization",
    rank: 1,
    retrieval_rank: 2,
    retrieval_origin: "semantic",
    similarity: 0.86,
    keyword_score: 4,
    page_start: 3,
    page_end: 3,
    section_path: "Incident Response\n  Program",
    source_type: "client_policy",
    evidence_role: "organization_evidence",
  };
  const regulatoryCandidate = {
    chunk_id: "chunk-regulatory",
    rank: 2,
    retrieval_rank: 1,
    retrieval_origin: "keyword",
    similarity: 0.89,
    page_start: 4,
    page_end: 4,
    section_path: "Reference Material",
    source_type: "regulatory_guidance",
    evidence_role: "requirement_reference",
  };
  const collector = createEvaluationProvenanceCollector({
    caseId: "policy-a",
    environment: { ENABLE_EVAL_PROVENANCE: "true" },
    embeddingProvider: "openai",
    embeddingModel: "text-embedding-3-small",
    classifierProvider: "openai",
    classifierModel: "gpt-4.1-mini",
    topK: 25,
    semanticPoolSize: 30,
    keywordPoolSize: 40,
  });
  collector.recordRetrieved("written_incident_response_program", [organizationCandidate, regulatoryCandidate]);
  collector.recordClassified("written_incident_response_program", [{
    ...organizationCandidate,
    classifier_provider: "heuristic",
    evidence_relationship: "partially_supports",
    covered_elements: ["response"],
    supporting_quote: "The organization maintains a response process.",
  }]);
  collector.recordAggregated("written_incident_response_program", {
    status: "partial",
    evidence: [{
      chunk_id: "chunk-organization",
      quote: "The organization maintains a response process.",
    }],
  }, [organizationCandidate, regulatoryCandidate]);
  collector.recordPersistence("written_incident_response_program", ["chunk-organization"], ["chunk-organization"]);

  const candidates = collector.snapshot().requirements[0].candidates;
  const organization = candidates.find((candidate) => candidate.candidateId === "chunk-organization");
  const regulatory = candidates.find((candidate) => candidate.candidateId === "chunk-regulatory");
  assert.equal(organization.classifierProvider, "heuristic");
  assert.equal(organization.classifierModel, null);
  assert.equal(organization.aggregationOutcome, "included");
  assert.equal(organization.persistenceOutcome, "persisted");
  assert.equal(organization.keywordScore, 4);
  assert.equal(organization.sectionPath, "Incident Response Program");
  assert.equal(regulatory.filteringOutcome, "filtered_out");
  assert.equal(regulatory.filteringReason, "evidence_role_not_organization_evidence");
  assert.equal(regulatory.classifierRelationship, null);
  assert.equal(regulatory.aggregationOutcome, "excluded");
  assert.equal(regulatory.aggregationReason, "filtered_before_classification");
  assert.equal(regulatory.persistenceOutcome, "not_persisted");
});

test("provenance serializer writes an allowlist and never raw source text or secrets", () => {
  const rawSource = "RAW CLIENT SOURCE TEXT MUST NOT BE SERIALIZED";
  const artifact = toEvaluationProvenanceArtifact({
    runId: "run-one",
    corpusId: "blind-holdout-fixture",
    corpusVersion: 1,
    mode: "isolated",
    selectedCaseIds: ["policy-a"],
    runConfig: {
      embeddingProvider: "openai",
      embeddingModel: "text-embedding-3-small",
      classifierProvider: "heuristic",
      classifierModel: null,
      apiKey: "never-serialize-secrets",
      retrieval: { topK: 25, semanticPoolSize: 30, keywordPoolSize: 40 },
      featureFlags: { enableEvalProvenance: true, enableExternalAiProcessing: true, enableExternalAiClassifier: false },
    },
    cases: {
      "policy-a": {
        analysisRunId: "analysis-a",
        requirements: [{
          caseId: "policy-a",
          requirementId: "written_incident_response_program",
          finalStatus: "missing",
          rawQuote: rawSource,
          candidates: [{
            candidateId: "chunk-a",
            sectionPath: "Incident Response > Written Program",
            quoteHash: quoteDigest(rawSource),
            content_preview: rawSource,
            supportingQuote: rawSource,
            apiKey: "never-serialize-secrets",
          }],
        }],
      },
    },
  });
  const serialized = JSON.stringify(artifact);
  assert.doesNotMatch(serialized, /RAW CLIENT SOURCE TEXT MUST NOT BE SERIALIZED|never-serialize-secrets|apiKey|content_preview|supportingQuote/);
  assert.match(serialized, new RegExp(quoteDigest(rawSource)));
});
