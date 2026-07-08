import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  aggregateFindingForRequirement,
  classifyNegativeEvidenceScope,
} from "../lib/findingsAggregation.ts";

const requirement = {
  id: "customer_notification_unauthorized_access",
  title: "Customer notification after unauthorized access",
  description:
    "The organization notifies affected customers after unauthorized access to sensitive customer information.",
  retrievalQuery: "customer notification unauthorized access sensitive customer information",
  sourceBasis: "Test source basis.",
  regulatoryRole: "direct_reg_s_p",
  mvpScope: "mvp",
  evidenceCriteria: {
    lookFor: "Test evidence criteria.",
    strongEvidence: "Strong evidence covers trigger and timing.",
    partialEvidence: "Partial evidence covers only one element.",
    missingOrNegativeEvidence: "Missing evidence lacks required elements.",
  },
  coverageElements: [
    {
      id: "notice_trigger",
      label: "Defines when customer notice is required",
      requiredForCovered: true,
      signals: ["unauthorized access", "customer notification"],
    },
    {
      id: "notice_timing",
      label: "Defines notice timing",
      requiredForCovered: true,
      signals: ["30 days", "without unreasonable delay"],
    },
  ],
  requiredElementsForCovered: ["notice_trigger", "notice_timing"],
  optionalElements: [],
  strongEvidenceGuidance: "Strong evidence covers trigger and timing.",
  partialEvidenceGuidance: "Partial evidence covers only one element.",
  missingEvidenceGuidance: "Missing evidence lacks required elements.",
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
    covered_elements: ["notice_trigger", "notice_timing"],
    missing_elements: [],
    vague_elements: [],
    supporting_quote: "notify affected customers after unauthorized access",
    classifier_provider: "heuristic",
    ...overrides,
  };
}

function negativeChunk(overrides = {}) {
  return chunk({
    grade: "irrelevant",
    evidence_relationship: "negative_evidence",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    negative_evidence: true,
    classifier_confidence: "high",
    negative_evidence_reason: "The firm does not establish customer notification.",
    grade_reason: "The firm does not establish customer notification.",
    supporting_quote: "The firm does not establish customer notification.",
    content_preview: "The firm does not establish customer notification.",
    ...overrides,
  });
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
  assert.equal(covered.summary, "Appears covered based on reviewed documents.");
  assert.match(covered.rationale, /states: “notify affected customers/);
  assert.equal(partial.status, "partial");
  assert.equal(partial.summary, "Partially covered based on reviewed documents.");
  assert.match(partial.rationale, /mentions this area/);
  assert.match(partial.remediation, /do not clearly define the full notification trigger and timing/);
  assert.doesNotMatch(partial.remediation, /missing owner, timing, approval, escalation/);
});

test("no organization evidence produces a missing finding", () => {
  const finding = aggregateFindingForRequirement(requirement, []);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
  assert.match(finding.summary, /did not find clear evidence/);
  assert.match(finding.rationale, /did not find clear policy or procedure language/);
  assert.doesNotMatch(finding.summary, /noncompliant/i);
});

test("true organization-level negative evidence produces conflicting or missing findings", () => {
  const negative = negativeChunk();

  const conflicting = aggregateFindingForRequirement(requirement, [chunk(), negative]);
  const missing = aggregateFindingForRequirement(requirement, [negative]);

  assert.equal(conflicting.status, "conflicting");
  assert.equal(missing.status, "missing");
  assert.match(conflicting.summary, /conflict/);
  assert.match(conflicting.rationale, /appears to contradict/);
  assert.equal(conflicting.evidence[1].reason.startsWith("The reviewed document appears to say this requirement is not addressed:"), true);
});

test("strong support with weak document-scope limitation stays covered", () => {
  const limitation = negativeChunk({
    chunk_id: "33333333-3333-4333-8333-333333333333",
    filename: "Acceptable Use Policy.pdf",
    section_path: "Acceptable Use > Scope",
    negative_evidence_reason: "This policy does not define customer notification.",
    grade_reason: "This policy does not define customer notification.",
    supporting_quote: "This policy does not define customer notification.",
    content_preview: "This policy does not define customer notification after unauthorized access.",
    rerank_score: 12,
  });

  const finding = aggregateFindingForRequirement(requirement, [chunk(), limitation]);

  assert.equal(classifyNegativeEvidenceScope(limitation), "document_scope_limitation");
  assert.equal(finding.status, "covered");
  assert.notEqual(finding.status, "conflicting");
  assert.equal(finding.severity, "info");
  assert.match(finding.rationale, /scope limitation/);
  assert.equal(
    finding.evidence.some((evidence) => evidence.reason.startsWith("This document says it does not cover this requirement.")),
    true,
  );
});

test("missing required coverage elements prevents covered findings", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_trigger"],
      missing_elements: ["notice_timing"],
      supporting_quote: "notify affected customers after unauthorized access",
      grade_reason: "The cited text covers the notification trigger but not timing.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.match(finding.rationale, /RegSpan did not find clear language defining the required timing for notice/);
  assert.doesNotMatch(finding.rationale, /appears to define this control/i);
  assert.doesNotMatch(finding.rationale, /RegSpan did not find clear evidence for:/);
  assert.doesNotMatch(finding.remediation, /appear to define/i);
  assert.match(finding.remediation, /do not clearly define the full notification trigger and timing/);
});

test("multiple complementary supports can cover required elements", () => {
  const trigger = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    covered_elements: ["notice_trigger"],
    missing_elements: ["notice_timing"],
    supporting_quote: "notify affected customers after unauthorized access",
    grade_reason: "The cited text covers the notification trigger.",
  });
  const timing = chunk({
    chunk_id: "66666666-6666-4666-8666-666666666666",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    covered_elements: ["notice_timing"],
    missing_elements: ["notice_trigger"],
    supporting_quote: "notice must be provided without unreasonable delay",
    grade_reason: "The cited text covers notice timing.",
  });

  const finding = aggregateFindingForRequirement(requirement, [trigger, timing]);

  assert.equal(finding.status, "covered");
  assert.match(finding.rationale, /defines when customer notice is required and defines the timing for customer notice/);
  assert.doesNotMatch(finding.rationale, /Reviewed evidence covers:/);
});

test("covered and partial evidence explanations use natural language", () => {
  const covered = aggregateFindingForRequirement(requirement, [chunk()]);
  const partial = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_trigger"],
      missing_elements: ["notice_timing"],
      supporting_quote: "notify affected customers after unauthorized access",
      grade_reason: "The cited text covers the notification trigger but not timing.",
    }),
  ]);

  assert.doesNotMatch(covered.rationale, /provides reviewed evidence for the required elements/);
  assert.doesNotMatch(covered.rationale, /Reviewed evidence covers:/);
  assert.doesNotMatch(partial.rationale, /RegSpan did not find clear evidence for:/);
  assert.doesNotMatch(covered.evidence[0].reason, /^This section supports:/);
  assert.match(covered.evidence[0].reason, /The cited section defines when customer notice is required and defines the timing for customer notice/);
  assert.match(partial.evidence[0].reason, /discusses customer-notice decisioning, but it does not clearly define the required timing for notice/);
  assert.doesNotMatch(partial.evidence[0].reason, /This section partially addresses this requirement/);
  assert.doesNotMatch(covered.evidence[0].reason, /the cited text explicitly/i);
});

test("evidence explanations avoid raw coverage-element grammar artifacts", () => {
  const cases = [
    {
      requirement: {
        ...requirement,
        id: "customer_information_safeguards",
        title: "Safeguards for customer information",
        coverageElements: [
          {
            id: "customer_information_scope",
            label: "Applies safeguards to customer records or information",
            requiredForCovered: true,
            signals: ["customer information"],
          },
          {
            id: "safeguards_controls",
            label: "Defines administrative, technical, or physical safeguards",
            requiredForCovered: true,
            signals: ["safeguards"],
          },
        ],
        requiredElementsForCovered: ["customer_information_scope", "safeguards_controls"],
      },
      coveredElements: ["safeguards_controls"],
      missingElements: ["customer_information_scope"],
      expected: /does not clearly define that the safeguards apply to customer information/,
    },
    {
      requirement: {
        ...requirement,
        id: "regulator_law_enforcement_notification",
        title: "Regulator and law enforcement notification coordination",
        coverageElements: [
          {
            id: "external_notification_decisioning",
            label: "Defines external notification decisioning",
            requiredForCovered: true,
            signals: ["regulator"],
          },
        ],
        requiredElementsForCovered: ["external_notification_decisioning"],
      },
      coveredElements: [],
      missingElements: ["external_notification_decisioning"],
      expected: /does not clearly define who decides when external notification is required/,
    },
    {
      requirement: {
        ...requirement,
        id: "evidence_log_preservation",
        title: "Incident evidence and log preservation",
        coverageElements: [
          {
            id: "incident_materials",
            label: "Preserves logs, evidence, or investigation records",
            requiredForCovered: true,
            signals: ["preserve logs"],
          },
        ],
        requiredElementsForCovered: ["incident_materials"],
      },
      coveredElements: [],
      missingElements: ["incident_materials"],
      expected: /does not clearly define how logs, evidence, or investigation records must be preserved/,
    },
  ];

  for (const testCase of cases) {
    const finding = aggregateFindingForRequirement(testCase.requirement, [
      chunk({
        grade: "partial",
        evidence_relationship: "partially_supports",
        requirement_supported: false,
        covered_elements: testCase.coveredElements,
        missing_elements: testCase.missingElements,
        grade_reason: "The cited text mentions the topic but leaves details unclear.",
      }),
    ]);
    const reason = finding.evidence[0]?.reason ?? "";

    assert.equal(finding.status, "partial");
    assert.match(reason, testCase.expected);
    assert.doesNotMatch(reason, /does not clearly define applies/i);
    assert.doesNotMatch(reason, /does not clearly define defines/i);
    assert.doesNotMatch(reason, /does not clearly define preserves/i);
  }
});

test("findings UI keeps covered cards quiet and collapses source excerpts", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  assert.match(client, /if \(finding\.status === "covered"\) \{\s+return statusBadge;/);
  assert.doesNotMatch(client, /Risk if missing/);
  assert.match(client, /Risk if unresolved: \{humanize\(finding\.severity\)\}/);
  assert.match(client, /high: "border-app-danger\/20 bg-app-danger-soft text-app-danger"/);
  assert.match(client, /<details className="rounded-xl border border-app-border bg-app-elevated\/35">/);
  assert.match(client, /Source excerpts/);
  assert.match(client, /View supporting document excerpts/);
  assert.match(client, /Document excerpt/);
  assert.match(client, /Supports this conclusion/);
  assert.match(client, /Partially supports this conclusion/);
  assert.match(client, /Requirement basis:/);
  assert.match(client, /Reg S-P basis:/);
  assert.equal((client.match(/View requirement/g) ?? []).length, 1);
  assert.match(client, /Requirement basis:\{" "\}\s+<span className="text-app-muted">\{basis\.label\}<\/span>/);
  assert.doesNotMatch(client, /Requirement basis:[\s\S]{0,320}<a/);
  assert.match(client, /href=\{basis\.href\}/);
  assert.match(client, /`\/controls#control-\$\{controlKey\}`/);
  assert.match(client, /REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID/);
  assert.doesNotMatch(client, /Supports this finding/);
  assert.doesNotMatch(client, /Partially supports this finding/);
  assert.doesNotMatch(client, /Evidence citations/);
  assert.doesNotMatch(client, /organization evidence/i);
  assert.doesNotMatch(client, /coverage element/i);
  assert.doesNotMatch(client, /classifier/i);
  assert.doesNotMatch(client, /heuristic/i);
  assert.doesNotMatch(client, /retrieval/i);
  assert.doesNotMatch(client, /candidate/i);
  assert.doesNotMatch(client, /chunk/i);
  assert.doesNotMatch(client, /control is defined/i);
});

test("findings UI uses status accent rails and stronger card separation", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  assert.match(client, /const findingAccentClasses: Record<Finding\["status"\], string> = \{/);
  assert.match(client, /covered: "bg-app-success"/);
  assert.match(client, /partial: "bg-app-warning"/);
  assert.match(client, /missing: "bg-app-danger"/);
  assert.match(client, /conflicting: "bg-app-danger"/);
  assert.match(client, /needs_review: "bg-app-review"/);
  assert.match(client, /className=\{`h-1 \$\{findingAccentClasses\[finding\.status\]\}`\}/);
  assert.match(client, /className="app-card overflow-hidden border-app-border-strong\/70 bg-gradient-to-br/);
  assert.match(client, /<section className="space-y-6" aria-label="Generated findings">/);
});

test("findings header keeps requirement basis readable without a duplicate action", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  assert.match(client, /label: finding\.requirement_name \?\? "Untitled requirement"/);
  assert.match(client, /Requirement basis:\{" "\}/);
  assert.match(client, /<span className="text-app-muted">\{basis\.label\}<\/span>/);
  assert.doesNotMatch(client, /label: finding\.requirement_name \?\? "View requirement"/);
  assert.equal((client.match(/Reg S-P basis:/g) ?? []).length, 1);
});

test("strong support with partial procedure scope limitation is not conflicting", () => {
  const procedureLimitation = negativeChunk({
    chunk_id: "44444444-4444-4444-8444-444444444444",
    filename: "Information Security Procedure.pdf",
    section_path: "Procedure Scope",
    negative_evidence_reason: "This procedure does not establish customer notification.",
    grade_reason: "This procedure does not establish customer notification.",
    supporting_quote: "This procedure does not establish customer notification.",
    content_preview: "This procedure does not establish customer notification or consumer notice timing.",
    rerank_score: 28,
  });

  const finding = aggregateFindingForRequirement(requirement, [chunk(), procedureLimitation]);

  assert.equal(classifyNegativeEvidenceScope(procedureLimitation), "document_scope_limitation");
  assert.equal(finding.status, "covered");
  assert.notEqual(finding.status, "conflicting");
});

test("document-scope limitation without support needs review", () => {
  const limitation = negativeChunk({
    filename: "Privacy Procedure.pdf",
    section_path: "Scope and Limitations",
    negative_evidence_reason: "Outside the scope of this procedure: customer notification is reserved for another policy.",
    grade_reason: "Outside the scope of this procedure: customer notification is reserved for another policy.",
    supporting_quote: "Outside the scope of this procedure",
    content_preview: "Outside the scope of this procedure: customer notification is reserved for another policy.",
  });

  const finding = aggregateFindingForRequirement(requirement, [limitation]);

  assert.equal(classifyNegativeEvidenceScope(limitation), "document_scope_limitation");
  assert.equal(finding.status, "needs_review");
  assert.equal(finding.severity, "medium");
  assert.match(finding.summary, /reviewed by a person/);
  assert.match(finding.rationale, /limits of that document/);
});

test("negative evidence scope classifier distinguishes organization from document limitations", () => {
  assert.equal(
    classifyNegativeEvidenceScope(negativeChunk({
      content_preview: "There is no customer notification procedure.",
      grade_reason: "There is no customer notification procedure.",
    })),
    "organization_level_negative",
  );
  assert.equal(
    classifyNegativeEvidenceScope(negativeChunk({
      filename: "Acceptable Use Policy.pdf",
      content_preview: "This policy does not define customer notification.",
      grade_reason: "This policy does not define customer notification.",
      negative_evidence_reason: "This policy does not define customer notification.",
      supporting_quote: "This policy does not define customer notification.",
    })),
    "document_scope_limitation",
  );
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
  assert.match(finding.rationale, /Public guidance or other reference material was not treated as proof/);
});

test("primary finding text avoids internal classifier terminology", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk(),
    negativeChunk({
      chunk_id: "55555555-5555-4555-8555-555555555555",
      filename: "Acceptable Use Policy.pdf",
      negative_evidence_reason: "This policy does not define customer notification.",
      grade_reason: "This policy does not define customer notification.",
      supporting_quote: "This policy does not define customer notification.",
      content_preview: "This policy does not define customer notification.",
    }),
  ]);
  const primaryText = [finding.summary, finding.rationale, finding.remediation].join(" ");

  assert.doesNotMatch(primaryText, /candidate|heuristic|classifier|retrieval|chunk|status was assigned|document-scope/i);
  assert.match(finding.rationale, /Related documents say they do not cover this requirement/);
  assert.doesNotMatch(primaryText, /control is defined|satisfy this control|covered control|missing control/i);
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
  assert.match(client, /Source excerpts/);
  assert.match(client, /\/api\/findings\/generate/);
  assert.match(client, /\/api\/findings/);
  assert.match(client, /High risk open/);
  assert.match(client, /View requirement/);
  assert.match(client, /finding\.status !== "covered"/);
  assert.match(client, /Risk if unresolved:/);
  assert.match(client, /DEFAULT_VISIBLE_EVIDENCE_COUNT = 4/);
  assert.match(client, /Show additional source excerpts/);
  assert.match(client, /background_context/);
  assert.match(client, /subdued/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|EMBEDDING_API_KEY|OPENAI_API_KEY/);
});
