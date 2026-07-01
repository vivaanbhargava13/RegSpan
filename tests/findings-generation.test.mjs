import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateFindingForRequirement,
} from "../lib/findingsAggregation.ts";

const requirement = {
  id: "customer_notification_unauthorized_access",
  title: "Customer notification after unauthorized access",
  description:
    "The organization notifies affected customers after unauthorized access to sensitive customer information.",
  retrievalQuery: "customer notification unauthorized access sensitive customer information",
  directSignals: ["customer notification"],
  actionSignals: ["notify"],
  topicSignals: ["customer information"],
  partialSignals: [],
  backgroundSignals: [],
};

function chunk(overrides = {}) {
  return {
    chunk_id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    filename: "Incident Response Policy.pdf",
    page_start: 4,
    page_end: 5,
    chunk_index: 7,
    section_path: "Incident Response > Customer Notification",
    content_preview: "The firm must notify affected customers after unauthorized access.",
    similarity: 0.91,
    evidence_reason: "substantive policy evidence",
    embedding_input: null,
    source_type: "client_policy",
    evidence_role: "organization_evidence",
    rerank_score: 92,
    rerank_reason: "direct signals",
    grade: "direct",
    grade_reason: "The chunk explicitly requires customer notification.",
    negative_evidence: false,
    negative_evidence_reason: null,
    evidence_relationship: "supports",
    classifier_confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    supporting_quote: "notify affected customers after unauthorized access",
    classifier_provider: "heuristic",
    ...overrides,
  };
}

test("organization evidence can produce covered and partial findings", () => {
  const covered = aggregateFindingForRequirement(requirement, [chunk()]);
  const partial = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      supporting_quote: "affected customers",
    }),
  ]);

  assert.equal(covered.status, "covered");
  assert.equal(covered.severity, "info");
  assert.equal(covered.confidence, "high");
  assert.equal(partial.status, "partial");
  assert.match(partial.remediation, /Clarify ownership/);
});

test("no organization evidence produces a missing finding", () => {
  const finding = aggregateFindingForRequirement(requirement, []);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
  assert.match(finding.summary, /No organization evidence/);
});

test("explicit negative evidence produces conflicting or missing findings", () => {
  const negative = chunk({
    grade: "irrelevant",
    evidence_relationship: "negative_evidence",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    negative_evidence: true,
    negative_evidence_reason: "does not establish customer notification",
    supporting_quote: "does not establish customer notification",
  });

  const conflicting = aggregateFindingForRequirement(requirement, [chunk(), negative]);
  const missing = aggregateFindingForRequirement(requirement, [negative]);

  assert.equal(conflicting.status, "conflicting");
  assert.equal(missing.status, "missing");
  assert.match(conflicting.rationale, /Negative evidence was counted only/);
});

test("public or reference evidence cannot satisfy client compliance", () => {
  const reference = chunk({
    filename: "CISA Guidance.pdf",
    source_type: "regulatory_guidance",
    evidence_role: "requirement_reference",
  });
  const finding = aggregateFindingForRequirement(requirement, [reference]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
  assert.match(finding.rationale, /reference\/supporting-context candidates were ignored/);
});

test("finding evidence preserves citation metadata", () => {
  const finding = aggregateFindingForRequirement(requirement, [chunk()]);

  assert.equal(finding.evidence[0].filename, "Incident Response Policy.pdf");
  assert.equal(finding.evidence[0].page_start, 4);
  assert.equal(finding.evidence[0].page_end, 5);
  assert.equal(finding.evidence[0].section_path, "Incident Response > Customer Notification");
  assert.equal(finding.evidence[0].chunk_index, 7);
  assert.equal(finding.evidence[0].quote, "notify affected customers after unauthorized access");
});

test("findings generation schema and routes preserve workspace/security boundaries", async () => {
  const [migration, generator, route, generateRoute] = await Promise.all([
    readFile("supabase/migrations/016_create_findings_generation_tables.sql", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("app/api/findings/route.ts", "utf8"),
    readFile("app/api/findings/generate/route.ts", "utf8"),
  ]);

  assert.match(migration, /Query name: 016_create_findings_generation_tables/);
  assert.match(migration, /create table if not exists public\.analysis_runs/);
  assert.match(migration, /analysis_runs_workspace_select/);
  assert.match(generator, /evidence_role === "organization_evidence"/);
  assert.match(generator, /createRequirementEvidenceClassifier/);
  assert.match(generator, /retrieveRequirementHybridChunks/);
  assert.match(route, /authenticateRequest/);
  assert.match(route, /getActorWorkspaceId/);
  assert.doesNotMatch(route, /workspace_id.*request/i);
  assert.match(generateRoute, /authenticateRequest/);
  assert.match(generateRoute, /getActorWorkspaceId/);
  assert.match(generateRoute, /EmbeddingProcessingError/);
  assert.doesNotMatch(generateRoute, /workspace_id.*request/i);
  assert.doesNotMatch(generateRoute, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("findings UI shows generation and empty states", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  assert.match(client, /Run analysis/);
  assert.match(client, /No processed evidence yet/);
  assert.match(client, /No findings generated yet/);
  assert.match(client, /Evidence citations/);
  assert.match(client, /\/api\/findings\/generate/);
  assert.match(client, /\/api\/findings/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|EMBEDDING_API_KEY|OPENAI_API_KEY/);
});
