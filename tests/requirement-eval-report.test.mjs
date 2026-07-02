import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildRequirementEvalReport,
  formatPageRange,
  formatRequirementEvalMarkdown,
  shapeRequirementEvidenceChunk,
} from "../scripts/requirementEvalReport.mjs";

const SAMPLE_REQUIREMENT = {
  id: "customer_notification_unauthorized_access",
  title: "Customer notification after unauthorized access",
  description: "Notify affected customers after unauthorized access to sensitive customer information.",
};

const SAMPLE_CHUNK = {
  rank: 1,
  filename: "Incident Response Policy.pdf",
  document_id: "11111111-1111-4111-8111-111111111111",
  page_start: 4,
  page_end: 5,
  chunk_index: 7,
  section_path: "Incident Response > Customer Notification",
  similarity: 0.8123,
  rerank_score: 124.25,
  rerank_reason: "semantic 81.2; direct signals: notify affected customers; role organization_evidence",
  grade: "direct",
  grade_reason: "Direct evidence signals matched: notify affected customers.",
  negative_evidence: false,
  negative_evidence_reason: null,
  evidence_relationship: "supports",
  classifier_confidence: "high",
  requirement_supported: true,
  control_absent_or_out_of_scope: false,
  supporting_quote: "Affected customers must be notified after unauthorized access.",
  classifier_provider: "heuristic",
  source_type: "client_policy",
  evidence_role: "organization_evidence",
  evidence_reason: "substantive policy evidence",
  content_preview: "Affected customers must be notified after unauthorized access.",
};

function sampleMatchResult(overrides = {}) {
  return {
    requirement: SAMPLE_REQUIREMENT,
    status: "strong_match",
    status_reason: "At least one retrieved candidate was graded as direct organization evidence.",
    direct: [SAMPLE_CHUNK],
    partial: [],
    background: [],
    irrelevant: [],
    ...overrides,
  };
}

test("requirement eval report generation captures counts and source-aware fields", () => {
  const report = buildRequirementEvalReport({
    generatedAt: "2026-06-30T00:00:00.000Z",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workspaceName: "Vivaan's Workspace",
    topK: 15,
    requirementId: "all",
    results: [sampleMatchResult()],
  });

  assert.equal(report.reportVersion, "requirement-eval-v1");
  assert.equal(report.requirementCount, 1);
  assert.equal(report.requirements[0].requirement_id, SAMPLE_REQUIREMENT.id);
  assert.equal(report.requirements[0].top_k, 15);
  assert.equal(report.requirements[0].candidate_count, 1);
  assert.equal(report.requirements[0].direct_count, 1);
  assert.equal(report.requirements[0].negative_evidence_count, 0);
  assert.equal(report.requirements[0].organization_evidence_count, 1);
  assert.equal(report.requirements[0].requirement_reference_count, 0);
  assert.equal(report.requirements[0].source_type_mix.client_policy, 1);
  assert.equal(report.requirements[0].classifier_provider_mix.heuristic, 1);
  assert.equal(report.requirements[0].top_evidence_chunks[0].source_type, "client_policy");
  assert.equal(report.requirements[0].top_evidence_chunks[0].evidence_role, "organization_evidence");
  assert.equal(report.requirements[0].top_evidence_chunks[0].classifier_provider, "heuristic");
  assert.equal(report.requirements[0].top_evidence_chunks[0].evidence_relationship, "supports");
  assert.equal(report.requirements[0].top_evidence_chunks[0].requirement_supported, true);
  assert.equal(report.requirements[0].top_evidence_chunks[0].rerank_score, 124.25);
  assert.match(report.requirements[0].top_evidence_chunks[0].rerank_reason, /direct signals/);
});

test("requirement eval markdown includes manual reviewer fields", () => {
  const markdown = formatRequirementEvalMarkdown(buildRequirementEvalReport({
    generatedAt: "2026-06-30T00:00:00.000Z",
    workspaceId: "22222222-2222-4222-8222-222222222222",
    workspaceName: "Vivaan's Workspace",
    topK: 15,
    requirementId: "all",
    results: [sampleMatchResult()],
  }));

  assert.match(markdown, /# RegSpan requirement matching evaluation report/);
  assert.match(markdown, /correct status\?:/);
  assert.match(markdown, /best evidence present\?:/);
  assert.match(markdown, /source role correct\?:/);
  assert.match(markdown, /grading issue\?:/);
  assert.match(markdown, /retrieval issue\?:/);
  assert.match(markdown, /chunking issue\?:/);
  assert.match(markdown, /notes:/);
  assert.match(markdown, /Source type: client_policy/);
  assert.match(markdown, /Evidence role: organization_evidence/);
  assert.match(markdown, /Semantic similarity: 0\.8123/);
  assert.match(markdown, /Rerank score: 124\.25/);
  assert.match(markdown, /Rerank reason:/);
  assert.match(markdown, /Classifier provider: heuristic/);
  assert.match(markdown, /Classifier confidence: high/);
  assert.match(markdown, /Evidence relationship: supports/);
  assert.match(markdown, /Requirement supported: yes/);
  assert.match(markdown, /Control absent\/out of scope: no/);
  assert.match(markdown, /Supporting quote:/);
  assert.match(markdown, /Negative evidence: no/);
  assert.match(markdown, /Negative evidence count: 0/);
  assert.equal(formatPageRange(4, 5), "Pages 4–5");
});

test("requirement eval runner defaults to all requirements and supports single requirement filtering", async () => {
  const [runner, requirements] = await Promise.all([
    readFile("scripts/runRequirementEval.mjs", "utf8"),
    readFile("lib/regSpRequirements.ts", "utf8"),
  ]);

  const requirementCount = (requirements.match(/mvpScope: "/g) ?? []).length;
  assert.equal(requirementCount, 11);
  assert.match(runner, /REG_SP_REQUIREMENTS/);
  assert.match(runner, /createRequirementEvidenceClassifier/);
  assert.match(runner, /buildRequirementMatchResultWithClassifier/);
  assert.match(runner, /--requirement-id/);
  assert.match(runner, /getRegSpRequirement\(requirementId\)/);
  assert.match(runner, /return REG_SP_REQUIREMENTS/);
});

test("requirement eval output paths and npm command are configured and gitignored", async () => {
  const [runner, gitignore, packageJson] = await Promise.all([
    readFile("scripts/runRequirementEval.mjs", "utf8"),
    readFile(".gitignore", "utf8"),
    readFile("package.json", "utf8"),
  ]);

  assert.match(runner, /requirement-eval-latest\.json/);
  assert.match(runner, /requirement-eval-latest\.md/);
  assert.match(runner, /eval-results/);
  assert.match(runner, /requireExternalAiProcessingEnabled/);
  assert.match(runner, /ENABLE_EXTERNAL_AI_PROCESSING=true/);
  assert.match(gitignore, /eval-results\//);
  assert.match(packageJson, /"eval:requirements": "node scripts\/runRequirementEval\.mjs"/);
});

test("requirement eval shaping preserves source type and evidence role in each chunk", () => {
  const shaped = shapeRequirementEvidenceChunk(SAMPLE_CHUNK);

  assert.equal(shaped.rank, 1);
  assert.equal(shaped.filename, "Incident Response Policy.pdf");
  assert.equal(shaped.grade, "direct");
  assert.equal(shaped.grade_reason, SAMPLE_CHUNK.grade_reason);
  assert.equal(shaped.source_type, "client_policy");
  assert.equal(shaped.evidence_role, "organization_evidence");
  assert.equal(shaped.rerank_score, 124.25);
  assert.match(shaped.rerank_reason, /semantic 81\.2/);
  assert.equal(shaped.negative_evidence, false);
  assert.equal(shaped.negative_evidence_reason, null);
  assert.equal(shaped.classifier_provider, "heuristic");
  assert.equal(shaped.evidence_relationship, "supports");
  assert.equal(shaped.classifier_confidence, "high");
  assert.equal(shaped.requirement_supported, true);
  assert.equal(shaped.control_absent_or_out_of_scope, false);
  assert.match(shaped.supporting_quote, /Affected customers/);
  assert.match(shaped.content_preview, /Affected customers/);
});
