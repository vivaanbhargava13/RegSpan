import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  aggregateFindingForRequirement,
  classifyNegativeEvidenceScope,
} from "../lib/findingsAggregation.ts";
import {
  buildMarkdownReport,
  reportEvidenceForFinding,
} from "../lib/findingsReport.ts";

async function loadTsModule(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const outDir = await mkdtemp(join(tmpdir(), "regspan-findings-test-"));
  const outPath = join(outDir, sourcePath.replace(/[\/:]/g, "__").replace(/\.ts$/, ".mjs"));
  const transpile = (input, fileName) => ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName,
  }).outputText;
  const policyOutput = transpile(await readFile("lib/aiProcessingPolicy.ts", "utf8"), "lib/aiProcessingPolicy.ts");
  const negativeOutput = transpile(await readFile("lib/negativeEvidence.ts", "utf8"), "lib/negativeEvidence.ts");
  const classifierOutput = transpile(
    await readFile("lib/requirementEvidenceClassifier.ts", "utf8"),
    "lib/requirementEvidenceClassifier.ts",
  )
    .replaceAll('from "./aiProcessingPolicy"', 'from "./lib__aiProcessingPolicy.mjs"')
    .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"');
  const outputText = transpile(source, sourcePath)
    .replaceAll('from "./requirementEvidenceClassifier"', 'from "./lib__requirementEvidenceClassifier.mjs"');

  await Promise.all([
    writeFile(join(outDir, "lib__aiProcessingPolicy.mjs"), policyOutput, "utf8"),
    writeFile(join(outDir, "lib__negativeEvidence.mjs"), negativeOutput, "utf8"),
    writeFile(join(outDir, "lib__requirementEvidenceClassifier.mjs"), classifierOutput, "utf8"),
    writeFile(outPath, outputText, "utf8"),
  ]);
  return import(pathToFileURL(outPath).href);
}

const requirement = {
  id: "customer_notification_unauthorized_access",
  title: "Customer notification after unauthorized access",
  description:
    "The organization notifies affected customers after unauthorized access to sensitive customer information.",
  retrievalQuery: "customer notification unauthorized access sensitive customer information",
  sourceBasis: "Test source basis.",
  regulatoryRole: "direct_reg_s_p",
  mvpScope: "mvp",
  riskSeverity: "high",
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
    content_preview:
      "The firm must provide customer notification to affected customers after unauthorized access without unreasonable delay and within 30 days.",
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
    supporting_quote:
      "provide customer notification to affected customers after unauthorized access without unreasonable delay and within 30 days",
    classifier_provider: "heuristic",
    ...overrides,
  };
}

function negativeChunk(overrides = {}) {
  return chunk({
    chunk_id: "33333333-3333-4333-8333-333333333333",
    grade: "irrelevant",
    evidence_relationship: "negative_evidence",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    negative_evidence: true,
    classifier_confidence: "high",
    covered_elements: [],
    missing_elements: ["notice_trigger", "notice_timing"],
    negative_evidence_reason: "The firm does not establish customer notification.",
    grade_reason: "The firm does not establish customer notification.",
    supporting_quote: "The firm does not establish customer notification.",
    content_preview: "The firm does not establish customer notification.",
    ...overrides,
  });
}

function classifierClassification(overrides = {}) {
  return {
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: requirement.requiredElementsForCovered,
    missing_elements: [],
    vague_elements: [],
    reason: "The cited text supports the requirement.",
    supporting_quote: null,
    classifier_provider: "openai",
    ...overrides,
  };
}

async function productionPathFinding(testRequirement, retrievedChunks, classifications) {
  const { buildRequirementMatchResultWithClassifier } = await loadTsModule("lib/requirementMatching.ts");
  let index = 0;
  const classifier = {
    provider: "openai",
    async classify() {
      const classification = classifications[index] ?? classifications[classifications.length - 1];
      index += 1;
      return {
        ...classification,
        classifier_provider: classification.classifier_provider ?? "openai",
      };
    },
  };
  const match = await buildRequirementMatchResultWithClassifier(
    testRequirement,
    retrievedChunks,
    classifier,
  );
  return aggregateFindingForRequirement(testRequirement, [
    ...match.direct,
    ...match.partial,
    ...match.background,
    ...match.irrelevant,
  ]);
}

function reportFinding(overrides = {}) {
  return {
    requirement_id: "customer_notification_unauthorized_access",
    requirement_name: "Customer notification trigger and timing",
    status: "partial",
    severity: "high",
    summary: "Partially covered based on reviewed documents.",
    remediation: "Add the missing timing detail.",
    rationale: "The incident response policy mentions customer notification but does not define timing.",
    evidence: [
      {
        relationship: "partially_supports",
        quote: "notify affected customers after unauthorized access",
        evidence_quote: null,
        reason: "The cited section mentions customer notification.",
        filename: "Incident Response Policy.pdf",
        page_start: 4,
        page_end: 5,
        section_path: "Incident Response > Customer Notification",
      },
    ],
    ...overrides,
  };
}

function buildTestReport(findings) {
  return buildMarkdownReport({
    latestRun: {
      requirement_count: findings.length,
      completed_at: "2026-01-15T15:30:00.000Z",
    },
    findings,
    processedDocumentCount: 2,
    workspaceName: "Acme Compliance",
  });
}

test("organization evidence can produce covered and partial findings", () => {
  const covered = aggregateFindingForRequirement(requirement, [chunk()]);
  const partial = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      content_preview: "The policy says customer notification may be sent to affected customers after unauthorized access.",
      supporting_quote: "customer notification may be sent to affected customers after unauthorized access",
    }),
  ]);

  assert.equal(covered.status, "covered");
  assert.equal(covered.severity, "high");
  assert.equal(covered.confidence, "high");
  assert.equal(covered.summary, "Appears covered based on reviewed documents.");
  assert.match(covered.rationale, /states: “The firm must provide customer notification/);
  assert.equal(partial.status, "partial");
  assert.equal(partial.severity, "high");
  assert.equal(partial.summary, "Partially covered based on reviewed documents.");
  assert.match(partial.rationale, /mentions this area/);
  assert.match(partial.remediation, /do not clearly define .*required timing for notice/);
  assert.doesNotMatch(partial.remediation, /missing owner, timing, approval, escalation/);
});

test("no organization evidence produces a missing finding", () => {
  const finding = aggregateFindingForRequirement(requirement, []);

  assert.equal(finding.status, "missing");
  assert.equal(finding.severity, "high");
  assert.equal(finding.evidence.length, 0);
  assert.match(finding.summary, /did not find client policy evidence/);
  assert.match(finding.rationale, /did not find clear policy or procedure language/);
  assert.match(finding.remediation, /Add or point to written procedures that define/);
  assert.doesNotMatch(finding.remediation, /reviewed documents appear to define/i);
  assert.doesNotMatch(finding.summary, /noncompliant/i);
});

test("support partial and negative rows require exact source quotes to count", () => {
  const unquotedSupport = chunk({
    supporting_quote: null,
    grade_reason: "Generated reason says the notice trigger and timing are covered.",
  });
  const paraphrasedPartial = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    covered_elements: ["notice_trigger"],
    missing_elements: ["notice_timing"],
    supporting_quote: "The firm has a mature customer notification program.",
    grade_reason: "Generated reason says customer notification is mentioned.",
  });
  const unquotedNegative = negativeChunk({
    supporting_quote: null,
    grade_reason: "Generated reason says customer notification is not established.",
  });

  const finding = aggregateFindingForRequirement(requirement, [
    unquotedSupport,
    paraphrasedPartial,
    unquotedNegative,
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
  assert.match(finding.rationale, /did not find clear policy or procedure language/);
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

test("unrelated negative evidence cannot make a requirement conflicting", () => {
  const vendorTimingGap = negativeChunk({
    chunk_id: "99999999-9999-4999-8999-999999999999",
    section_path: "Service provider oversight expectations",
    content_preview:
      "Service providers must escalate incidents promptly, but the policy does not establish a 72-hour notice expectation.",
    supporting_quote:
      "Service providers must escalate incidents promptly, but the policy does not establish a 72-hour notice expectation.",
    grade_reason:
      "The cited text does not establish a 72-hour notice expectation for service providers.",
    negative_evidence_reason:
      "The cited text does not establish a 72-hour notice expectation for service providers.",
    missing_elements: ["service_provider_notice_timing"],
  });

  const finding = aggregateFindingForRequirement(requirement, [chunk(), vendorTimingGap]);

  assert.equal(finding.status, "covered");
  assert.notEqual(finding.status, "conflicting");
  assert.doesNotMatch(finding.rationale, /appears to contradict/);
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
  assert.equal(finding.severity, "high");
  assert.doesNotMatch(finding.rationale, /scope limitation|do not cover this requirement/i);
  assert.equal(finding.evidence.some((evidence) => evidence.relationship === "supports"), true);
});

test("generic Reg S-P compliance statements are missing, not needs review", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "background",
      evidence_relationship: "background_context",
      requirement_supported: false,
      covered_elements: [],
      missing_elements: ["notice_trigger", "notice_timing"],
      supporting_quote: "The firm complies with Regulation S-P.",
      content_preview: "The firm complies with Regulation S-P.",
      grade_reason: "The cited text is a generic compliance statement without requirement-specific procedures.",
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.severity, "high");
  assert.match(finding.rationale, /did not find clear policy or procedure language/);
});

test("related but incomplete notification language is partial, not needs review", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_trigger"],
      missing_elements: ["notice_timing"],
      supporting_quote: "Legal may notify customers when appropriate.",
      content_preview: "Legal may notify customers when appropriate.",
      grade_reason: "The cited text mentions customer notification but does not define the required timing.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.match(finding.rationale, /did not find clear language defining .*required timing for notice/);
  assert.doesNotMatch(finding.rationale, /reviewer should confirm/i);
});

test("missing required coverage elements prevents covered findings", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_trigger"],
      missing_elements: ["notice_timing"],
      content_preview: "The procedure requires customer notification to affected customers after unauthorized access.",
      supporting_quote: "The procedure requires customer notification to affected customers after unauthorized access.",
      grade_reason: "The cited text covers the notification trigger but not timing.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.match(finding.rationale, /RegSpan did not find clear language defining .*required timing for notice/);
  assert.doesNotMatch(finding.rationale, /appears to define this control/i);
  assert.doesNotMatch(finding.rationale, /RegSpan did not find clear evidence for:/);
  assert.doesNotMatch(finding.remediation, /appear to define/i);
  assert.match(finding.remediation, /do not clearly define .*required timing for notice/);
});

test("multiple complementary supports can cover required elements", () => {
  const trigger = chunk({
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
    covered_elements: ["notice_trigger"],
    missing_elements: [],
    content_preview: "The procedure requires customer notification to affected customers after unauthorized access.",
    supporting_quote: "The procedure requires customer notification to affected customers after unauthorized access.",
    grade_reason: "The cited text covers the notification trigger.",
  });
  const timing = chunk({
    chunk_id: "66666666-6666-4666-8666-666666666666",
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
    covered_elements: ["notice_timing"],
    missing_elements: [],
    supporting_quote: "notice must be provided without unreasonable delay",
    content_preview: "The incident response procedure states that notice must be provided without unreasonable delay.",
    grade_reason: "The cited text covers notice timing.",
  });

  const finding = aggregateFindingForRequirement(requirement, [trigger, timing]);

  assert.equal(finding.status, "covered");
  assert.match(finding.rationale, /defines when customer notice is required and defines the timing for customer notice/);
  assert.doesNotMatch(finding.rationale, /Reviewed evidence covers:/);
});

test("partial-only complementary evidence remains partial until full support is established", () => {
  const trigger = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    covered_elements: ["notice_trigger"],
    missing_elements: ["notice_timing"],
    content_preview: "The procedure requires customer notification to affected customers after unauthorized access.",
    supporting_quote: "The procedure requires customer notification to affected customers after unauthorized access.",
    grade_reason: "The cited text covers the notification trigger but not timing.",
  });
  const timing = chunk({
    chunk_id: "66666666-6666-4666-8666-666666666666",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    covered_elements: ["notice_timing"],
    missing_elements: ["notice_trigger"],
    supporting_quote: "notice must be provided without unreasonable delay",
    content_preview: "The incident response procedure states that notice must be provided without unreasonable delay.",
    grade_reason: "The cited text covers notice timing but does not establish the full notice standard.",
  });

  const finding = aggregateFindingForRequirement(requirement, [trigger, timing]);

  assert.equal(finding.status, "partial");
  assert.notEqual(finding.status, "covered");
});

test("background context does not count toward covered status", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "background",
      evidence_relationship: "background_context",
      requirement_supported: false,
      covered_elements: ["notice_trigger", "notice_timing"],
      missing_elements: [],
      supporting_quote: "The firm complies with Regulation S-P.",
      content_preview: "The firm complies with Regulation S-P.",
      grade_reason: "Generated context mentions coverage, but the source text is generic.",
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.notEqual(finding.status, "covered");
});

test("response recovery remains partial when remediation tracking is missing", () => {
  const recoveryRequirement = {
    ...requirement,
    id: "remediation_recovery_validation",
    title: "Response recovery and remediation validation",
    description: "Define recovery, remediation tracking, and validation after incidents.",
    coverageElements: [
      { id: "recovery_steps", label: "Defines recovery steps", requiredForCovered: true, signals: ["recovery"] },
      { id: "remediation_tracking", label: "Tracks remediation", requiredForCovered: true, signals: ["remediation tracking"] },
      { id: "validation_testing", label: "Validates remediation", requiredForCovered: true, signals: ["validation"] },
    ],
    requiredElementsForCovered: ["recovery_steps", "remediation_tracking", "validation_testing"],
  };
  const finding = aggregateFindingForRequirement(recoveryRequirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["recovery_steps", "validation_testing"],
      missing_elements: ["remediation_tracking"],
      supporting_quote: "The incident team restores affected systems and validates recovery before closure.",
      content_preview: "The incident team restores affected systems and validates recovery before closure.",
      grade_reason: "The cited text covers recovery and validation but not remediation tracking.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.match(finding.remediation, /remediation or corrective-action tracking/);
});

test("disposal remains partial unless all required disposal elements are source-supported", () => {
  const disposalRequirement = {
    ...requirement,
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    description: "Require secure disposal of consumer and customer information.",
    coverageElements: [
      { id: "disposal_scope", label: "Applies to consumer or customer information", requiredForCovered: true, signals: ["customer information"] },
      { id: "secure_disposal_method", label: "Requires secure disposal methods", requiredForCovered: true, signals: ["secure disposal"] },
    ],
    requiredElementsForCovered: ["disposal_scope", "secure_disposal_method"],
  };
  const finding = aggregateFindingForRequirement(disposalRequirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["disposal_scope"],
      missing_elements: ["secure_disposal_method"],
      supporting_quote: "Customer information is retained according to the records schedule.",
      content_preview: "Customer information is retained according to the records schedule.",
      grade_reason: "The cited text identifies customer information but not secure disposal methods.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.match(finding.rationale, /secure disposal/);
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
      content_preview: "The procedure requires customer notification to affected customers after unauthorized access.",
      supporting_quote: "The procedure requires customer notification to affected customers after unauthorized access.",
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
      quote: "The safeguards program requires access controls and encryption.",
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
          {
            id: "legal_compliance_owner",
            label: "Assigns legal or compliance ownership",
            requiredForCovered: true,
            signals: ["legal owner"],
          },
        ],
        requiredElementsForCovered: ["external_notification_decisioning", "legal_compliance_owner"],
      },
      coveredElements: ["external_notification_decisioning"],
      missingElements: ["legal_compliance_owner"],
      quote: "Legal reviews the regulator notification decision after incident escalation.",
      expected: /does not clearly define legal or compliance ownership/,
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
          {
            id: "integrity_or_chain_of_custody",
            label: "Maintains evidence integrity or chain of custody",
            requiredForCovered: true,
            signals: ["chain of custody"],
          },
        ],
        requiredElementsForCovered: ["incident_materials", "integrity_or_chain_of_custody"],
      },
      coveredElements: ["incident_materials"],
      missingElements: ["integrity_or_chain_of_custody"],
      quote: "The procedure requires teams to preserve logs and relevant investigation evidence.",
      expected: /does not clearly define evidence integrity or chain-of-custody requirements/,
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
        content_preview: testCase.quote,
        supporting_quote: testCase.quote,
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
  assert.match(client, /Risk if unresolved: \$\{humanize\(finding\.severity\)\}/);
  assert.match(client, /<RiskBadge label=\{`Risk if unresolved:/);
  assert.match(client, /<details className="rounded-md border border-app-border bg-app-elevated\/35">/);
  assert.match(client, /Client source excerpts/);
  assert.match(client, /View supporting document excerpts/);
  assert.match(client, /Document excerpt/);
  assert.match(client, /Supports this conclusion/);
  assert.match(client, /Partially supports this conclusion/);
  assert.match(client, /Requirement basis/);
  assert.match(client, /Reg S-P basis/);
  assert.equal((client.match(/View Requirement/g) ?? []).length, 1);
  assert.match(client, /<p className="mt-2 text-xs font-medium leading-5 text-app-muted">\s*\{basis\.label\}\s*<\/p>/);
  assert.doesNotMatch(client, /Requirement basis:[\s\S]{0,320}<a/);
  assert.match(client, /href=\{basis\.href\}/);
  assert.match(client, /`\/controls#control-\$\{controlKey\}`/);
  assert.match(client, /REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID/);
  assert.doesNotMatch(client, /Supports this finding/);
  assert.doesNotMatch(client, /Partially supports this finding/);
  assert.doesNotMatch(client, /Evidence citations/);
  assert.doesNotMatch(client, /organization evidence/i);
  assert.doesNotMatch(client, /coverage element/i);
  assert.doesNotMatch(client, /chunk_synopsis|Retrieval synopsis/i);
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
  assert.match(client, /className=\{`absolute inset-y-0 left-0 w-1 \$\{findingAccentClasses\[finding\.status\]\}`\}/);
  assert.match(client, /<Surface\s+key=\{finding\.id\}\s+as="article"\s+padding="none"/);
  assert.match(client, /<section className="space-y-4" aria-label="Analysis results">/);
});

test("findings header keeps requirement basis readable without a duplicate action", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  assert.match(client, /label: finding\.requirement_name \?\? "Untitled requirement"/);
  assert.match(client, /Requirement basis/);
  assert.match(client, /<p className="mt-2 text-xs font-medium leading-5 text-app-muted">\s*\{basis\.label\}\s*<\/p>/);
  assert.doesNotMatch(client, /label: finding\.requirement_name \?\? "View requirement"/);
  assert.match(client, /<h3 className="text-xs font-bold uppercase tracking-\[0\.1em\] text-app-subtle">\s*Reg S-P basis/);
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

test("document-scope limitation without support is missing unless it points to another policy", () => {
  const limitation = negativeChunk({
    filename: "Privacy Procedure.pdf",
    section_path: "Scope and Limitations",
    negative_evidence_reason: "This policy does not define customer notification.",
    grade_reason: "This policy does not define customer notification.",
    supporting_quote: "This policy does not define customer notification.",
    content_preview: "This policy does not define customer notification.",
  });

  const finding = aggregateFindingForRequirement(requirement, [limitation]);

  assert.equal(classifyNegativeEvidenceScope(limitation), "document_scope_limitation");
  assert.equal(finding.status, "missing");
  assert.equal(finding.severity, "high");
  assert.match(finding.summary, /did not find client policy evidence/);
  assert.match(finding.rationale, /did not find clear policy or procedure language/);
});

test("document-scope limitation with some support is partial, not needs review", () => {
  const support = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    covered_elements: ["notice_trigger"],
    missing_elements: ["notice_timing"],
    supporting_quote: "The firm notifies affected customers after unauthorized access.",
    content_preview: "The firm notifies affected customers after unauthorized access.",
    grade_reason: "The cited text covers the notification trigger but not timing.",
  });
  const limitation = negativeChunk({
    chunk_id: "77777777-7777-4777-8777-777777777777",
    filename: "Privacy Procedure.pdf",
    section_path: "Scope and Limitations",
    negative_evidence_reason: "This policy does not define the 30-day notification timeline.",
    grade_reason: "This policy does not define the 30-day notification timeline.",
    supporting_quote: "This policy does not define the 30-day notification timeline.",
    content_preview: "This policy does not define the 30-day notification timeline.",
  });

  const finding = aggregateFindingForRequirement(requirement, [support, limitation]);

  assert.equal(classifyNegativeEvidenceScope(limitation), "document_scope_limitation");
  assert.equal(finding.status, "partial");
  assert.match(finding.rationale, /did not find clear language defining .*required timing for notice/);
  assert.doesNotMatch(finding.rationale, /reviewer should confirm/i);
});

test("mixed support and limitation evidence produces partial, not missing", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "partial",
      evidence_relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_trigger"],
      missing_elements: ["notice_timing"],
      supporting_quote: "The firm notifies affected customers after unauthorized access.",
      grade_reason:
        "The cited text supports the customer-notification trigger; nearby limitation language does not define timing.",
      content_preview:
        "The firm notifies affected customers after unauthorized access. This policy does not fully define the 30-day notification timeline.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.notEqual(finding.status, "missing");
  assert.match(finding.rationale, /notifies affected customers|mentions this area/);
  assert.match(finding.remediation, /do not clearly define .*required timing for notice/);
  assert.doesNotMatch(finding.remediation, /reviewed documents appear to define/i);
});

test("covered findings persist only evidence rows that improve required-element coverage", () => {
  const weakPartial = chunk({
    chunk_id: "77777777-7777-4777-8777-777777777777",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    section_path: "Service provider oversight expectations",
    content_preview: "Service providers discuss incident communications but do not define the customer notice timing standard.",
    supporting_quote: "Service providers discuss incident communications but do not define the customer notice timing standard.",
    covered_elements: [],
    missing_elements: ["notice_timing"],
    grade_reason: "The cited text is adjacent but does not improve required-element coverage.",
  });

  const finding = aggregateFindingForRequirement(requirement, [chunk(), weakPartial]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence.length, 1);
  assert.equal(finding.evidence[0].chunk_id, "11111111-1111-4111-8111-111111111111");
});

test("missing findings do not persist partially-supporting rows that do not improve coverage", () => {
  const weakPartial = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    section_path: "Safeguards for customer information review",
    content_preview: "Safeguards for customer information review.",
    supporting_quote: "Safeguards for customer information review.",
    covered_elements: [],
    missing_elements: ["notice_trigger", "notice_timing"],
    grade_reason: "The cited text is adjacent but does not prove the notification requirement.",
  });

  const finding = aggregateFindingForRequirement(requirement, [weakPartial]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("customer notification content curation prefers direct customer-notification sections over vendor sections", () => {
  const contentRequirement = {
    ...requirement,
    id: "customer_notification_content",
    title: "Customer notification content",
    coverageElements: [
      {
        id: "incident_description",
        label: "Requires a description of the incident",
        requiredForCovered: true,
        signals: ["description of the incident", "what happened"],
      },
      {
        id: "information_involved",
        label: "Identifies the sensitive customer information involved",
        requiredForCovered: true,
        signals: ["information involved"],
      },
      {
        id: "protective_steps",
        label: "Includes protective steps for affected individuals",
        requiredForCovered: true,
        signals: ["protective steps", "identity theft"],
      },
    ],
    requiredElementsForCovered: ["incident_description", "information_involved", "protective_steps"],
  };
  const directNoticeGap = negativeChunk({
    chunk_id: "88888888-8888-4888-8888-888888888888",
    section_path: "Customer notification content requirements",
    content_preview: "The notice procedure does not define protective steps or identity theft resources for affected individuals.",
    supporting_quote: "The notice procedure does not define protective steps or identity theft resources for affected individuals.",
    missing_elements: ["protective_steps"],
    grade_reason: "The notice procedure does not define protective steps.",
    negative_evidence_reason: "The notice procedure does not define protective steps.",
  });
  const vendorGap = negativeChunk({
    chunk_id: "99999999-9999-4999-8999-999999999999",
    section_path: "Service provider oversight expectations",
    content_preview: "Service providers must notify the firm within 72 hours but do not define customer notice content.",
    supporting_quote: "Service providers must notify the firm within 72 hours but do not define customer notice content.",
    missing_elements: ["incident_description", "information_involved", "protective_steps"],
    grade_reason: "The vendor section does not define customer notice content.",
    negative_evidence_reason: "The vendor section does not define customer notice content.",
  });

  const finding = aggregateFindingForRequirement(contentRequirement, [vendorGap, directNoticeGap]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence[0].section_path, "Customer notification content requirements");
});

test("regulator and law-enforcement partial evidence yields partial instead of missing", () => {
  const regulatorRequirement = {
    ...requirement,
    id: "regulator_law_enforcement_notification_coordination",
    title: "Regulator and law enforcement notification coordination",
    coverageElements: [
      {
        id: "external_notification_decisioning",
        label: "Defines external notification decisioning",
        requiredForCovered: true,
        signals: ["regulator notification decision"],
      },
      {
        id: "legal_compliance_owner",
        label: "Assigns legal or compliance ownership",
        requiredForCovered: true,
        signals: ["legal owner"],
      },
    ],
    requiredElementsForCovered: ["external_notification_decisioning", "legal_compliance_owner"],
  };
  const support = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    section_path: "Law enforcement and regulator coordination",
    content_preview: "Legal reviews the regulator notification decision after incident escalation.",
    supporting_quote: "Legal reviews the regulator notification decision after incident escalation.",
    covered_elements: ["external_notification_decisioning"],
    missing_elements: ["legal_compliance_owner"],
    grade_reason: "The cited text identifies external notification decisioning but not ownership.",
  });

  const finding = aggregateFindingForRequirement(regulatorRequirement, [support]);

  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].relationship, "partially_supports");
});

test("incident assessment can be covered by a broader direct quote spanning assessment, systems, and containment", () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment, containment, and control",
    coverageElements: [
      {
        id: "assesses_scope",
        label: "Assesses the nature and scope of unauthorized access or use",
        requiredForCovered: true,
        signals: ["nature and scope"],
      },
      {
        id: "customer_information_systems",
        label: "Identifies affected customer information systems or information types",
        requiredForCovered: true,
        signals: ["customer information systems"],
      },
      {
        id: "containment_control",
        label: "Requires containment or control steps",
        requiredForCovered: true,
        signals: ["contain and control"],
      },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const support = chunk({
    section_path: "Assessment of unauthorized access or use",
    content_preview:
      "The incident team assesses the nature and scope of unauthorized access, identifies affected customer information systems, and takes steps to contain and control the incident.",
    supporting_quote:
      "assesses the nature and scope of unauthorized access, identifies affected customer information systems, and takes steps to contain and control the incident",
  });

  const finding = aggregateFindingForRequirement(assessmentRequirement, [support]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].section_path, "Assessment of unauthorized access or use");
  assert.equal(
    finding.evidence[0].quote,
    "The incident team assesses the nature and scope of unauthorized access, identifies affected customer information systems, and takes steps to contain and control the incident.",
  );
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^systems and information types/i);
});

test("incident evidence preservation recognizes logs and investigation evidence", () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
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
  };
  const support = chunk({
    section_path: "Monitoring, logging, and alert review",
    content_preview: "The incident response record requires preserving relevant logs and evidence for investigation materials.",
    supporting_quote: "requires preserving relevant logs and evidence for investigation materials",
  });

  const finding = aggregateFindingForRequirement(preservationRequirement, [support]);

  assert.equal(finding.status, "covered");
});

test("incident evidence preservation is not covered by an incident-record sentence without preservation", () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      {
        id: "incident_materials",
        label: "Preserves logs, evidence, or investigation records",
        requiredForCovered: true,
        signals: ["incident records"],
      },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const incidentRecordOnly = chunk({
    section_path: "Written incident response program",
    content_preview:
      "The incident lead opens an incident record, documents known facts, identifies affected systems, and assigns response tasks.",
    supporting_quote:
      "The incident lead opens an incident record, documents known facts, identifies affected systems, and assigns response tasks.",
  });

  const finding = aggregateFindingForRequirement(preservationRequirement, [incidentRecordOnly]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("recovery evidence curation prefers substantive recovery activity quotes over fragments", () => {
  const recoveryRequirement = {
    ...requirement,
    id: "response_recovery_remediation_validation",
    title: "Response recovery and remediation validation",
    coverageElements: [
      {
        id: "recovery_steps",
        label: "Defines recovery after unauthorized access or use",
        requiredForCovered: true,
        signals: ["restoring affected services"],
      },
      {
        id: "remediation_tracking",
        label: "Tracks remediation or corrective actions",
        requiredForCovered: true,
        signals: ["corrective action tracking"],
      },
      {
        id: "validation_testing",
        label: "Validates recovery or remediation",
        requiredForCovered: true,
        signals: ["validating user access"],
      },
    ],
    requiredElementsForCovered: ["recovery_steps", "remediation_tracking", "validation_testing"],
  };
  const weakFragment = chunk({
    chunk_id: "23232323-2323-4323-8323-232323232323",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    section_path: "Incident recovery and remediation validation",
    content_preview: "Incident recovery and remediation validation / communications are delayed pending legal review.",
    supporting_quote: "Incident recovery and remediation validation / communications are delayed pending legal review.",
    covered_elements: ["recovery_steps", "validation_testing"],
    missing_elements: ["remediation_tracking"],
    grade_reason: "The cited text is a fragment and does not establish recovery procedures.",
  });
  const substantive = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    section_path: "Incident recovery and remediation validation",
    content_preview:
      "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and documenting remaining open issues.",
    supporting_quote:
      "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and documenting remaining open issues.",
    covered_elements: ["recovery_steps", "validation_testing"],
    missing_elements: ["remediation_tracking"],
    grade_reason: "The cited text supports recovery and validation but not corrective-action tracking.",
  });

  const finding = aggregateFindingForRequirement(recoveryRequirement, [weakFragment, substantive]);

  assert.equal(finding.status, "partial");
  assert.equal(
    finding.evidence[0].quote,
    "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and documenting remaining open issues.",
  );
  assert.match(finding.remediation, /corrective-action tracking/);
});

test("safeguards curation prefers access approval, periodic review, and encryption evidence", () => {
  const safeguardsRequirement = {
    ...requirement,
    id: "safeguards_customer_information",
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
        signals: ["access controls", "encryption"],
      },
    ],
    requiredElementsForCovered: ["customer_information_scope", "safeguards_controls"],
  };
  const accessEvidence = chunk({
    section_path: "Access management and privileged access review",
    content_preview:
      "Customer information repositories require access approval, periodic access review, and encryption for approved storage and transmission channels.",
    supporting_quote:
      "Customer information repositories require access approval, periodic access review, and encryption for approved",
  });
  const adjacentEvidence = chunk({
    chunk_id: "12121212-1212-4212-8212-121212121212",
    section_path: "Incident response program",
    content_preview: "Incident response procedures mention customer information and encryption during response.",
    supporting_quote: "Incident response procedures mention customer information and encryption during response",
  });

  const finding = aggregateFindingForRequirement(safeguardsRequirement, [adjacentEvidence, accessEvidence]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].section_path, "Access management and privileged access review");
  assert.equal(
    finding.evidence[0].quote,
    "Customer information repositories require access approval, periodic access review, and encryption for approved storage and transmission channels.",
  );
  assert.match(finding.evidence[0].reason, /safeguards for customer information|applies safeguards to customer information/);
  assert.doesNotMatch(finding.evidence[0].reason, /does not clearly define that the safeguards apply to customer information/);
});

test("service provider evidence quotes start at a clean sentence instead of a leading fragment", () => {
  const vendorRequirement = {
    ...requirement,
    id: "service_provider_incident_oversight_notice",
    title: "Service provider incident oversight and notice",
    coverageElements: [
      {
        id: "service_provider_scope",
        label: "Applies to service providers or vendors handling customer information",
        requiredForCovered: true,
        signals: ["vendor", "customer information"],
      },
      {
        id: "notice_to_firm",
        label: "Requires service-provider notice to the firm",
        requiredForCovered: true,
        signals: ["72 hours", "notice"],
      },
      {
        id: "cooperation_remediation",
        label: "Requires cooperation, investigation, remediation, or recovery support",
        requiredForCovered: true,
        signals: ["cooperation", "remediation"],
      },
    ],
    requiredElementsForCovered: ["service_provider_scope", "notice_to_firm", "cooperation_remediation"],
  };
  const vendorEvidence = chunk({
    section_path: "Vendor cooperation, investigation, and remediation support",
    content_preview:
      "Vendor contracts covering customer information require notice to the firm within 72 hours or comparable timing commitment. Vendor cooperation is required for investigation, remediation, and recovery support.",
    supporting_quote:
      "or comparable timing commitment. Vendor cooperation is required for investigation, remediation, and recovery support.",
  });

  const finding = aggregateFindingForRequirement(vendorRequirement, [vendorEvidence]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote ?? "", /^Vendor contracts covering customer information/);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^or comparable/i);
});

test("service provider heading-only quotes are not persisted as substantive evidence", () => {
  const vendorRequirement = {
    ...requirement,
    id: "service_provider_incident_oversight_notice",
    title: "Service provider incident oversight and notice",
    coverageElements: [
      {
        id: "service_provider_scope",
        label: "Applies to service providers or vendors handling customer information",
        requiredForCovered: true,
        signals: ["service provider", "vendor"],
      },
    ],
    requiredElementsForCovered: ["service_provider_scope"],
  };
  const headingOnly = chunk({
    section_path: "Vendor cooperation, investigation, and remediation support",
    content_preview: "Vendor cooperation, investigation, and remediation support",
    supporting_quote: "Vendor cooperation, investigation, and remediation support",
  });

  const finding = aggregateFindingForRequirement(vendorRequirement, [headingOnly]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("cross-reference to an unavailable policy needs review", () => {
  const limitation = negativeChunk({
    filename: "Privacy Procedure.pdf",
    section_path: "Scope and Limitations",
    negative_evidence_reason: "Customer notification timing is defined in the Customer Notice Standard.",
    grade_reason: "Customer notification timing is defined in the Customer Notice Standard.",
    supporting_quote: "Customer notification timing is defined in the Customer Notice Standard.",
    content_preview: "Customer notification timing is defined in the Customer Notice Standard.",
  });

  const finding = aggregateFindingForRequirement(requirement, [limitation]);

  assert.equal(classifyNegativeEvidenceScope(limitation), "document_scope_limitation");
  assert.equal(finding.status, "needs_review");
  assert.equal(finding.severity, "high");
  assert.match(finding.summary, /not enough detail to confirm full coverage/);
  assert.match(finding.rationale, /points to another policy or procedure/);
  assert.match(finding.rationale, /referenced document is available/);
  assert.match(finding.remediation, /Add or point to the procedure that defines/);
  assert.match(finding.remediation, /A reviewer should confirm whether another policy already contains this detail/);
  assert.doesNotMatch(finding.remediation, /reviewed documents appear to define/i);
});

test("unclear applicability can need review and retains high unresolved risk", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "background",
      evidence_relationship: "background_context",
      requirement_supported: false,
      covered_elements: [],
      missing_elements: [],
      supporting_quote: "Customer notification obligations apply where applicable under the business unit applicability matrix.",
      content_preview: "Customer notification obligations apply where applicable under the business unit applicability matrix.",
      grade_reason: "The cited text raises applicability but does not confirm whether this requirement applies.",
    }),
  ]);

  assert.equal(finding.status, "needs_review");
  assert.equal(finding.severity, "high");
  assert.match(finding.summary, /not enough detail to confirm full coverage/);
  assert.match(finding.rationale, /applicability question/);
  assert.doesNotMatch(finding.remediation, /reviewed documents appear to define/i);
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
  assert.doesNotMatch(finding.rationale, /Related documents say they do not cover this requirement/);
  assert.doesNotMatch(primaryText, /control is defined|satisfy this control|covered control|missing control/i);
});

test("finding evidence preserves citation metadata", () => {
  const finding = aggregateFindingForRequirement(requirement, [chunk()]);

  assert.equal(finding.evidence[0].filename, "Incident Response Policy.pdf");
  assert.equal(finding.evidence[0].page_start, 4);
  assert.equal(finding.evidence[0].page_end, 5);
  assert.equal(finding.evidence[0].section_path, "Incident Response > Customer Notification");
  assert.equal(finding.evidence[0].chunk_index, 7);
  assert.equal(
    finding.evidence[0].quote,
    "The firm must provide customer notification to affected customers after unauthorized access without unreasonable delay and within 30 days.",
  );
});

test("finding evidence uses raw quote rather than retrieval synopsis text", () => {
  const finding = aggregateFindingForRequirement(requirement, [
    chunk({
      embedding_input:
        "Retrieval synopsis: This excerpt says customer notice must be sent not later than 30 days.",
      content_preview: "The firm notifies affected customers after unauthorized access.",
      supporting_quote: "notifies affected customers after unauthorized access",
      covered_elements: ["notice_trigger"],
      missing_elements: ["notice_timing"],
      evidence_relationship: "partially_supports",
      requirement_supported: false,
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].quote, "The firm notifies affected customers after unauthorized access.");
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /30 days/);
  assert.doesNotMatch(finding.rationale, /not later than 30 days/);
});

test("production path finalizes recovery quotes to substantive source sentences", async () => {
  const recoveryRequirement = {
    ...requirement,
    id: "response_recovery_remediation_validation",
    title: "Response recovery and remediation validation",
    coverageElements: [
      { id: "recovery_steps", label: "Defines recovery steps", requiredForCovered: true, signals: ["restoring affected services"] },
      { id: "remediation_tracking", label: "Tracks remediation", requiredForCovered: true, signals: ["confirming remediation tasks"] },
      { id: "validation_testing", label: "Validates remediation", requiredForCovered: true, signals: ["validating user access"] },
    ],
    requiredElementsForCovered: ["recovery_steps", "remediation_tracking", "validation_testing"],
  };
  const content = [
    "Incident recovery and remediation validation",
    "",
    "Communications are delayed because of an active investigation.",
    "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and documenting remaining open issues.",
  ].join("\n");

  const finding = await productionPathFinding(recoveryRequirement, [
    chunk({
      content_preview: content,
      supporting_quote: null,
    }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["recovery_steps", "validation_testing"],
      missing_elements: ["remediation_tracking"],
      supporting_quote:
        "Incident recovery and remediation validation\n\nCommunications are delayed because of an active investigation.",
      reason: "The classifier selected nearby recovery text.",
    }),
  ]);

  assert.equal(finding.evidence[0].quote,
    "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and documenting remaining open issues.");
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^Incident recovery and remediation validation/);
  assert.doesNotMatch(finding.evidence[0].reason, /classifier selected/i);
});

test("production path expands truncated safeguards quotes to the full source sentence", async () => {
  const safeguardsRequirement = {
    ...requirement,
    id: "safeguards_customer_information",
    title: "Safeguards for customer information",
    coverageElements: [
      { id: "customer_information_scope", label: "Applies to customer information", requiredForCovered: true, signals: ["customer information repositories"] },
      { id: "safeguards_controls", label: "Defines safeguards", requiredForCovered: true, signals: ["access approval", "periodic access review", "encryption"] },
    ],
    requiredElementsForCovered: ["customer_information_scope", "safeguards_controls"],
  };
  const content =
    "Customer information repositories require access approval, periodic access review, and encryption for approved storage and transmission channels.";

  const finding = await productionPathFinding(safeguardsRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["customer_information_scope", "safeguards_controls"],
      supporting_quote:
        "Customer information repositories require access approval, periodic access review, and encryption for approved",
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, content);
});

test("production path expands service-provider quotes that start with continuation fragments", async () => {
  const vendorRequirement = {
    ...requirement,
    id: "service_provider_incident_oversight_notice",
    title: "Service provider incident oversight and notice",
    coverageElements: [
      { id: "service_provider_scope", label: "Applies to service providers", requiredForCovered: true, signals: ["vendor contracts", "customer information"] },
      { id: "notice_to_firm", label: "Requires notice to the firm", requiredForCovered: true, signals: ["72 hours", "notice to the firm"] },
      { id: "cooperation_remediation", label: "Requires cooperation", requiredForCovered: true, signals: ["vendor cooperation"] },
    ],
    requiredElementsForCovered: ["service_provider_scope", "notice_to_firm", "cooperation_remediation"],
  };
  const content =
    "Vendor contracts covering customer information require notice to the firm within 72 hours or comparable timing commitment. Vendor cooperation is required where contract terms allow it.";

  const finding = await productionPathFinding(vendorRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["service_provider_scope", "notice_to_firm", "cooperation_remediation"],
      supporting_quote:
        "or comparable timing commitment. Vendor cooperation is required where contract terms allow it.",
    }),
  ]);

  assert.match(finding.evidence[0].quote ?? "", /^Vendor contracts covering customer information/);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^or comparable/i);
});

test("production path expands incident-assessment quotes that start mid-sentence", async () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "assesses_scope", label: "Assesses unauthorized access", requiredForCovered: true, signals: ["assessment identifies"] },
      { id: "customer_information_systems", label: "Identifies affected systems", requiredForCovered: true, signals: ["customer information systems", "information types"] },
      { id: "containment_control", label: "Contains the incident", requiredForCovered: true, signals: ["containment and control"] },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const content =
    "Assessment identifies affected customer information systems and information types. Takes containment and control steps to prevent additional unauthorized access or use while preserving evidence.";

  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote:
        "systems and information types. Takes containment and control steps to prevent additional unauthorized access or use while preserving evidence.",
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote ?? "", /^Assessment identifies affected customer information systems/);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^systems and information types/i);
});

test("production path does not cover incident evidence preservation from incidental containment language", async () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      {
        id: "incident_materials",
        label: "Preserves incident logs, evidence, or investigation materials",
        requiredForCovered: true,
        signals: ["preserving evidence", "preserve relevant logs", "investigation materials"],
      },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const content =
    "Takes containment and control steps to prevent additional unauthorized access or use while preserving evidence.";

  const finding = await productionPathFinding(preservationRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["incident_materials"],
      supporting_quote: content,
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
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
  assert.match(client, /Reviewing documents/);
  assert.match(client, /No documents ready for analysis yet/);
  assert.match(client, /No findings generated yet/);
  assert.match(client, /Prepare at least one document before running analysis/);
  assert.match(client, /Client source excerpts/);
  assert.match(client, /\/api\/findings\/generate/);
  assert.match(client, /\/api\/findings/);
  assert.match(client, /High risk open/);
  assert.match(client, /View Requirement/);
  assert.match(client, /finding\.status !== "covered"/);
  assert.match(client, /Risk if unresolved:/);
  assert.match(client, /DEFAULT_VISIBLE_EVIDENCE_COUNT = 4/);
  assert.match(client, /Show additional source excerpts/);
  assert.match(client, /background_context/);
  assert.match(client, /subdued/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|EMBEDDING_API_KEY|OPENAI_API_KEY/);
});

test("Markdown report omits unresolved-risk line for covered findings", () => {
  const report = buildTestReport([
    reportFinding({
      status: "covered",
      summary: "Appears covered based on reviewed documents.",
      remediation: "Keep this procedure current.",
      rationale:
        "The reviewed document states: “notify affected customers after unauthorized access.” Related documents say they do not cover this requirement, which appears to be a scope limitation for those documents rather than a contradiction.",
    }),
  ]);

  assert.match(report, /Status: Covered/);
  assert.doesNotMatch(report, /Risk if unresolved:/);
  assert.doesNotMatch(report, /Not shown for covered findings/);
  assert.doesNotMatch(report, /Related documents say they do not cover this requirement/);
});

test("Markdown report uses uncertainty-aware needs-review remediation", () => {
  const report = buildTestReport([
    reportFinding({
      status: "needs_review",
      remediation:
        "The reviewed documents appear to define when affected individuals must be notified. A reviewer should confirm coverage.",
      rationale: "RegSpan found related policy language, but not enough detail to confirm full coverage.",
    }),
  ]);

  assert.match(report, /Recommended next step: Add or point to the procedure that defines/);
  assert.match(report, /A reviewer should confirm whether another policy already contains this detail/);
  assert.doesNotMatch(report, /reviewed documents appear to define/i);
});

test("Markdown report avoids duplicate summary and finding text", () => {
  const duplicate = "RegSpan found related policy language, but not enough detail to confirm full coverage.";
  const report = buildTestReport([
    reportFinding({
      status: "needs_review",
      summary: duplicate,
      rationale: duplicate,
    }),
  ]);

  assert.match(report, /Summary: Reviewer confirmation required\./);
  assert.match(report, /What RegSpan found: Reviewed client evidence is related to Customer notification trigger and timing/);
  assert.doesNotMatch(report, new RegExp(`Summary: ${duplicate}[\\s\\S]*What RegSpan found: ${duplicate}`));
});

test("Markdown report limits source excerpts to the top three per finding", () => {
  const evidence = Array.from({ length: 5 }, (_, index) => ({
    relationship: "supports",
    quote: `customer notification quote ${index + 1}`,
    evidence_quote: null,
    reason: "The cited section supports customer notification.",
    filename: `Policy ${index + 1}.pdf`,
    page_start: index + 1,
    page_end: index + 1,
    section_path: "Incident Response > Customer Notification",
  }));
  const report = buildTestReport([
    reportFinding({
      status: "partial",
      evidence,
    }),
  ]);

  assert.equal((report.match(/^- /gm) ?? []).length, 3);
  assert.match(report, /customer notification quote 1/);
  assert.doesNotMatch(report, /customer notification quote 5/);
});

test("Markdown report prefers quoted excerpts over generic section-only references", () => {
  const generic = {
    relationship: "supports",
    quote: null,
    evidence_quote: null,
    reason: "Generic policy purpose section.",
    filename: "Incident Response Policy.pdf",
    page_start: 1,
    page_end: 1,
    section_path: "Policy > Purpose",
  };
  const quoted = {
    relationship: "supports",
    quote: "notify affected customers after unauthorized access",
    evidence_quote: null,
    reason: "The cited section supports customer notification.",
    filename: "Incident Response Policy.pdf",
    page_start: 4,
    page_end: 4,
    section_path: "Incident Response > Customer Notification",
  };
  const finding = reportFinding({ evidence: [generic, quoted] });
  const report = buildTestReport([finding]);

  assert.equal(reportEvidenceForFinding(finding)[0], quoted);
  assert.match(report, /notify affected customers after unauthorized access/);
  assert.doesNotMatch(report, /Policy > Purpose/);
});

test("findings UI can copy or export a Markdown report", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");
  const reportHelper = await readFile("lib/findingsReport.ts", "utf8");

  assert.match(client, /buildMarkdownReport/);
  assert.match(client, /getCurrentWorkspace/);
  assert.match(reportHelper, /# RegSpan Reg S-P Analysis Report/);
  assert.match(reportHelper, /Workspace: \$\{workspaceReportName\(workspaceName\)\}/);
  assert.match(reportHelper, /REPORT_WORKSPACE_FALLBACK = "Current workspace"/);
  assert.doesNotMatch(client, /RegSpan local workspace/);
  assert.doesNotMatch(reportHelper, /RegSpan local workspace/);
  assert.match(reportHelper, /Documents reviewed:/);
  assert.match(reportHelper, /Requirements reviewed:/);
  assert.match(reportHelper, /High-risk open:/);
  assert.match(reportHelper, /Needs reviewer confirmation:/);
  assert.match(reportHelper, /What RegSpan found:/);
  assert.match(reportHelper, /Recommended next step:/);
  assert.match(reportHelper, /Client source excerpts:/);
  assert.match(reportHelper, /Reg S-P basis: \$\{basis\.label\} \(\$\{basis\.href\}\)/);
  assert.match(client, /navigator\.clipboard\.writeText/);
  assert.match(client, /Export Markdown/);
  assert.match(client, /text\/markdown/);
});

test("findings report keeps client evidence separate from Reg S-P basis", async () => {
  const reportHelper = await readFile("lib/findingsReport.ts", "utf8");

  assert.match(reportHelper, /Reg S-P basis:/);
  assert.match(reportHelper, /Client source excerpts:/);
  assert.match(reportHelper, /No client source excerpts were stored for this finding/);
  assert.doesNotMatch(reportHelper, /regulatory_source_chunks/);
  assert.doesNotMatch(reportHelper, /Reg S-P basis:[\s\S]{0,120}Client source excerpts:/);
});
