import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import {
  aggregateFindingForRequirement,
  canonicalElementIdsForFinalPositiveQuote,
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
  const operativeEvidenceRules = await readFile("lib/operativeEvidenceRules.mjs", "utf8");
  const classifierOutput = transpile(
    await readFile("lib/requirementEvidenceClassifier.ts", "utf8"),
    "lib/requirementEvidenceClassifier.ts",
  )
    .replaceAll('from "./aiProcessingPolicy"', 'from "./lib__aiProcessingPolicy.mjs"')
    .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"')
    .replaceAll('from "./classifierSourceHydration"', 'from "./lib__classifierSourceHydration.mjs"')
    .replaceAll('from "./operativeEvidenceRules.mjs"', 'from "./lib__operativeEvidenceRules.mjs"');
  const sourceHydrationOutput = transpile(
    await readFile("lib/classifierSourceHydration.ts", "utf8"),
    "lib/classifierSourceHydration.ts",
  );
  if (sourcePath === "lib/requirementEvidenceClassifier.ts") {
    await Promise.all([
      writeFile(join(outDir, "lib__aiProcessingPolicy.mjs"), policyOutput, "utf8"),
      writeFile(join(outDir, "lib__negativeEvidence.mjs"), negativeOutput, "utf8"),
      writeFile(join(outDir, "lib__operativeEvidenceRules.mjs"), operativeEvidenceRules, "utf8"),
      writeFile(outPath, classifierOutput, "utf8"),
    ]);
    return import(pathToFileURL(outPath).href);
  }
  const outputText = transpile(source, sourcePath)
    .replaceAll('from "./requirementEvidenceClassifier"', 'from "./lib__requirementEvidenceClassifier.mjs"')
    .replaceAll('from "./operativeEvidenceRules.mjs"', 'from "./lib__operativeEvidenceRules.mjs"');

  await Promise.all([
    writeFile(join(outDir, "lib__aiProcessingPolicy.mjs"), policyOutput, "utf8"),
    writeFile(join(outDir, "lib__negativeEvidence.mjs"), negativeOutput, "utf8"),
    writeFile(join(outDir, "lib__operativeEvidenceRules.mjs"), operativeEvidenceRules, "utf8"),
    writeFile(join(outDir, "lib__classifierSourceHydration.mjs"), sourceHydrationOutput, "utf8"),
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

test("classifier candidate concurrency never exceeds five and preserves all candidates", async () => {
  const { buildRequirementMatchResultWithClassifier } = await loadTsModule("lib/requirementMatching.ts");
  let active = 0;
  let maximumActive = 0;
  const classifier = {
    provider: "openai",
    async classify() {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return classifierClassification();
    },
  };
  const chunks = Array.from({ length: 12 }, (_, index) => chunk({
    chunk_id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    chunk_index: index,
  }));
  const match = await buildRequirementMatchResultWithClassifier(requirement, chunks, classifier);
  assert.equal(maximumActive, 5);
  assert.equal(match.direct.length, 12);
  assert.deepEqual(match.direct.map((entry) => entry.chunk_id), chunks.map((entry) => entry.chunk_id));
});

test("post-processing and final aggregation downgrade incomplete notice content from covered to partial", async () => {
  const noticeRequirement = {
    ...requirement,
    id: "customer_notification_content",
    title: "Customer notification content",
    coverageElements: [
      { id: "incident_description", label: "Describes the incident", requiredForCovered: true, signals: ["describe"] },
      { id: "information_involved", label: "Identifies information", requiredForCovered: true, signals: ["information involved"] },
      { id: "protective_steps", label: "Protective steps", requiredForCovered: true, signals: ["monitor accounts"] },
      { id: "contact_information", label: "Contact information", requiredForCovered: true, signals: ["toll-free"] },
      { id: "fraud_credit_identity_resources", label: "Identity resources", requiredForCovered: true, signals: ["fraud alert"] },
      { id: "written_delivery_requirements", label: "Written delivery", requiredForCovered: true, signals: ["clear and conspicuous"] },
    ],
    requiredElementsForCovered: [
      "incident_description",
      "information_involved",
      "protective_steps",
      "contact_information",
      "fraud_credit_identity_resources",
      "written_delivery_requirements",
    ],
  };
  const content = "Customer notices describe the incident, identify the categories of information involved, provide a toll-free response line, and advise customers to monitor accounts for suspicious activity.";
  const { postProcessOpenAiClassification } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  const classification = postProcessOpenAiClassification({
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: noticeRequirement.requiredElementsForCovered,
    missing_elements: [],
    vague_elements: [],
    reason: "The notice has all required content.",
    supporting_quote: content,
  }, {
    requirement: noticeRequirement,
    evaluationGuidance: "Test guidance.",
    chunkContent: content,
    chunkMetadata: {
      filename: "Customer Notice Procedure.pdf",
      sectionPath: "Notice content",
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
      sourceType: "client_policy",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive policy evidence",
    },
  });

  assert.equal(classification.relationship, "partially_supports");
  assert.deepEqual(classification.covered_elements, [
    "incident_description",
    "information_involved",
    "protective_steps",
    "contact_information",
  ]);

  const finding = await productionPathFinding(noticeRequirement, [
    chunk({ content_preview: content }),
  ], [classification]);
  assert.equal(finding.status, "partial");
  assert.match(finding.rationale, /identity-theft resources/i);
  assert.match(finding.remediation, /written notice and delivery/i);
});

test("production path preserves grounded partial procedures without promoting them to covered", async () => {
  const notificationRequirement = {
    ...requirement,
    id: "customer_notification_unauthorized_access",
    title: "Customer notification after unauthorized access",
    coverageElements: [
      { id: "unauthorized_access_or_use", label: "Defines unauthorized access to customer information", requiredForCovered: true, signals: ["unauthorized access", "customer information"] },
      { id: "notice_trigger_standard", label: "Defines the notice decision standard", requiredForCovered: true, signals: ["substantial harm"] },
      { id: "notice_timing", label: "Defines customer-notice timing", requiredForCovered: true, signals: ["30 days"] },
    ],
    requiredElementsForCovered: ["unauthorized_access_or_use", "notice_trigger_standard", "notice_timing"],
  };
  const providerRequirement = {
    ...requirement,
    id: "vendor_incident_handling",
    title: "Service provider incident oversight and notice",
    coverageElements: [
      { id: "service_provider_scope", label: "Requires provider due diligence and monitoring", requiredForCovered: true, signals: ["vendor review"] },
      { id: "provider_safeguards", label: "Requires provider safeguards", requiredForCovered: true, signals: ["protect customer information"] },
      { id: "notice_to_firm", label: "Requires provider notice", requiredForCovered: true, signals: ["notify the firm"] },
    ],
    requiredElementsForCovered: ["service_provider_scope", "provider_safeguards", "notice_to_firm"],
  };
  const recordsRequirement = {
    ...requirement,
    id: "written_compliance_records",
    title: "Written compliance records",
    coverageElements: [
      { id: "compliance_record_scope", label: "Requires written compliance records", requiredForCovered: true, signals: ["compliance maintains records"] },
      { id: "notice_determination_records", label: "Documents notice determinations", requiredForCovered: true, signals: ["notice determinations"] },
      { id: "retention_accessibility", label: "Defines retention or accessible storage", requiredForCovered: true, signals: ["three years"] },
    ],
    requiredElementsForCovered: ["compliance_record_scope", "notice_determination_records", "retention_accessibility"],
  };
  const evidenceRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      { id: "incident_materials", label: "Captures incident materials", requiredForCovered: true, signals: ["system reports"] },
      { id: "preservation_process", label: "Defines a preservation process", requiredForCovered: true, signals: ["legal hold"] },
    ],
    requiredElementsForCovered: ["incident_materials", "preservation_process"],
  };
  const scenarios = [
    {
      requirement: notificationRequirement,
      content: "Legal evaluates customer notification after unauthorized access to sensitive customer information. The goal is to send notice as soon as practical, with 30 days used as an internal target. Legal may extend the target when the investigation remains active or material facts are still developing.",
      expectedElements: ["unauthorized_access_or_use", "notice_timing"],
      missingRemediation: /decision standard for when notice is required/i,
    },
    {
      requirement: providerRequirement,
      content: "The firm obtains security questionnaires and assurance reports from selected vendors and requires vendors to cooperate with investigations. Vendors must report incidents promptly. Business owners escalate provider notices to Compliance and Technology for review and follow-up.",
      expectedElements: ["service_provider_scope", "notice_to_firm"],
      missingRemediation: /provider safeguards/i,
    },
    {
      requirement: recordsRequirement,
      content: "Incident and vendor records must be retained for a minimum of three years unless Legal directs otherwise. The records are stored in the compliance repository and may be retained longer when the matter remains open.",
      expectedElements: ["compliance_record_scope", "retention_accessibility"],
      missingRemediation: /incident or notification determinations/i,
    },
    {
      requirement: evidenceRequirement,
      content: "The response coordinator records major actions and decisions in the incident ticket and attaches available screenshots or system reports. The incident owner chooses the attachments needed to explain the response and resolution.",
      expectedElements: ["incident_materials"],
      missingRemediation: /defined process for preserving relevant logs or evidence/i,
    },
  ];
  const { postProcessOpenAiClassification } = await loadTsModule("lib/requirementEvidenceClassifier.ts");

  for (const scenario of scenarios) {
    const classification = postProcessOpenAiClassification({
      relationship: "supports",
      confidence: "high",
      requirement_supported: true,
      control_absent_or_out_of_scope: false,
      covered_elements: scenario.requirement.requiredElementsForCovered,
      missing_elements: [],
      vague_elements: [],
      reason: "The cited text fully supports the requirement.",
      supporting_quote: scenario.content,
    }, {
      requirement: scenario.requirement,
      evaluationGuidance: "Test guidance.",
      chunkContent: scenario.content,
      chunkMetadata: {
        filename: "Client procedure.pdf",
        sectionPath: "Client procedure",
        pageStart: 1,
        pageEnd: 1,
        chunkIndex: 0,
        sourceType: "client_procedure",
        evidenceRole: "organization_evidence",
        evidenceReason: "substantive procedure evidence",
      },
    });

    assert.equal(classification.relationship, "partially_supports");
    assert.deepEqual(classification.covered_elements, scenario.expectedElements);

    const finding = await productionPathFinding(scenario.requirement, [
      chunk({ content_preview: scenario.content, source_type: "client_procedure" }),
    ], [classification]);
    assert.equal(finding.status, "partial");
    assert.deepEqual(
      canonicalElementIdsForFinalPositiveQuote(scenario.requirement, finding.evidence[0].quote),
      scenario.expectedElements,
    );
    assert.match(finding.remediation, scenario.missingRemediation);
  }
});

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
  assert.match(conflicting.evidence[1].reason, /explicitly limits/i);
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
      supporting_quote: "The firm must dispose of customer information after its retention period expires.",
      content_preview: "The firm must dispose of customer information after its retention period expires.",
      grade_reason: "The cited text identifies disposal scope but not secure disposal methods.",
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
  assert.match(partial.evidence[0].reason, /discusses customer-notice decisioning\. Additional required elements are not proven by this quote/);
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
      expected: /Additional required elements are not proven by this quote/,
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
            id: "legal_compliance_coordination",
            label: "Coordinates external notifications through legal or compliance",
            requiredForCovered: true,
            signals: ["legal coordinates regulatory notification"],
          },
        ],
        requiredElementsForCovered: ["external_notification_decisioning", "legal_compliance_coordination"],
      },
      coveredElements: ["external_notification_decisioning"],
      missingElements: ["legal_compliance_coordination"],
      quote: "The incident lead determines whether regulator notification is required after an incident.",
      expected: /Additional required elements are not proven by this quote/,
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
      expected: /Additional required elements are not proven by this quote/,
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
  assert.match(client, /aria-expanded=\{isExpanded\}/);
  assert.match(client, /Client source excerpts/);
  assert.match(client, /Show source excerpts/);
  assert.match(client, /Hide source excerpts/);
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
        id: "legal_compliance_coordination",
        label: "Coordinates external notifications through legal or compliance",
        requiredForCovered: true,
        signals: ["legal coordinates regulatory notification"],
      },
    ],
    requiredElementsForCovered: ["external_notification_decisioning", "legal_compliance_coordination"],
  };
  const support = chunk({
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    section_path: "Law enforcement and regulator coordination",
    content_preview: "The incident lead determines whether regulator notification is required after an incident.",
    supporting_quote: "The incident lead determines whether regulator notification is required after an incident.",
    covered_elements: ["external_notification_decisioning"],
    missing_elements: ["legal_compliance_coordination"],
    grade_reason: "The cited text identifies external notification decisioning but not ownership.",
  });

  const finding = aggregateFindingForRequirement(regulatorRequirement, [support]);

  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].relationship, "partially_supports");
});

test("production path retains an incident-specific Legal delay procedure as partial coordination evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
  ]);
  const regulatorRequirement = REG_SP_REQUIREMENTS.find((item) => item.id === "regulator_law_enforcement_notification");
  assert.ok(regulatorRequirement);
  const content = [
    "Legal coordinates with regulators and law-enforcement agencies during significant incidents.",
    "Customer communications may be postponed when law enforcement requests a delay.",
    "Legal records the request and advises management when communications may resume.",
  ].join(" ");

  const finding = await productionPathFinding(regulatorRequirement, [
    chunk({
      content_preview: content,
      section_path: "National security and public safety delay",
    }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["legal_compliance_coordination"],
      missing_elements: ["external_notification_decisioning"],
      supporting_quote: content,
      reason: "Legal coordinates the authority-requested delay and records the request.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].relationship, "partially_supports");
  assert.match(finding.evidence[0].quote, /Legal coordinates with regulators/i);
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(regulatorRequirement, finding.evidence[0].quote),
    ["legal_compliance_coordination"],
  );
  assert.match(finding.rationale, /who decides whether external notification is required/i);
  assert.match(finding.remediation, /Attorney General and Commission procedure/i);
});

test("production path prefers a grounded delay procedure over a high-signal records inventory", async () => {
  const [{ REG_SP_REQUIREMENTS }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
  ]);
  const regulatorRequirement = REG_SP_REQUIREMENTS.find((item) => item.id === "regulator_law_enforcement_notification");
  assert.ok(regulatorRequirement);
  const inventory = [
    "Books and records include notification investigations, determinations, supporting facts, and the basis for any no-notice decision.",
    "The file also includes written documentation from the Attorney General concerning any delay in notice.",
    "These records are preserved for five years.",
  ].join("\n• ");
  const procedure = [
    "Legal coordinates with appropriate regulators and law-enforcement agencies during significant incidents.",
    "Customer communications may be postponed when law enforcement requests a delay or when disclosure could interfere with an active investigation.",
    "Legal records the request and advises management when external communications may resume.",
  ].join(" ");

  const finding = await productionPathFinding(regulatorRequirement, [
    chunk({
      chunk_id: "44444444-4444-4444-8444-444444444444",
      content_preview: inventory,
      section_path: "Books and records",
      rerank_score: 99,
    }),
    chunk({
      chunk_id: "55555555-5555-4555-8555-555555555555",
      content_preview: procedure,
      section_path: "Law-enforcement delay procedure",
      rerank_score: 80,
    }),
  ], [
    classifierClassification({
      covered_elements: ["external_notification_decisioning", "legal_compliance_coordination"],
      supporting_quote: inventory,
      reason: "The records list references notification decisions and an Attorney General delay.",
    }),
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["legal_compliance_coordination"],
      missing_elements: ["external_notification_decisioning"],
      supporting_quote: procedure,
      reason: "Legal coordinates an authority-requested delay and resumption procedure.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence.length, 1);
  assert.match(finding.evidence[0].quote, /Legal coordinates with appropriate regulators/i);
  assert.match(finding.evidence[0].quote, /communications may be postponed when law enforcement requests a delay/i);
  assert.doesNotMatch(finding.evidence[0].quote, /Books and records/i);
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(regulatorRequirement, finding.evidence[0].quote),
    ["legal_compliance_coordination"],
  );
  assert.match(finding.rationale, /legal or compliance/i);
  assert.match(finding.remediation, /who decides whether external notification is required/i);
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

  assert.equal(finding.status, "covered");
  assert.equal(
    finding.evidence[0].quote,
    "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and documenting remaining open issues.",
  );
  assert.equal(finding.evidence[0].relationship, "supports");
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
      "Vendor contracts require due diligence and ongoing monitoring for vendors handling customer information, safeguards to protect that information against unauthorized access, and notice to the firm within 72 hours. Vendor cooperation is required for investigation, remediation, and recovery support.",
    supporting_quote:
      "within 72 hours. Vendor cooperation is required for investigation, remediation, and recovery support.",
  });

  const finding = aggregateFindingForRequirement(vendorRequirement, [vendorEvidence]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote ?? "", /^Vendor contracts require due diligence/i);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^within 72 hours/i);
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
      supporting_quote: "Compliance must determine whether the customer-notification requirement applies to municipal advisory accounts before this procedure is used.",
      content_preview: "Compliance must determine whether the customer-notification requirement applies to municipal advisory accounts before this procedure is used.",
      grade_reason: "The cited source directly leaves applicability unresolved for a defined account population.",
    }),
  ]);

  assert.equal(finding.status, "needs_review");
  assert.equal(finding.severity, "high");
  assert.match(finding.summary, /not enough detail to confirm full coverage/);
  assert.match(finding.rationale, /applicability question/);
  assert.doesNotMatch(finding.remediation, /reviewed documents appear to define/i);
});

test("needs review requires a grounded source ambiguity rather than a generic applicability inference", () => {
  const evidenceFree = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "background",
      evidence_relationship: "background_context",
      requirement_supported: false,
      covered_elements: [],
      missing_elements: [],
      supporting_quote: null,
      content_preview: "Operations guidance for customer-facing teams.",
      grade_reason: "The classifier inferred that applicability might depend on business context.",
    }),
  ]);
  const genericScope = aggregateFindingForRequirement(requirement, [
    chunk({
      grade: "background",
      evidence_relationship: "background_context",
      requirement_supported: false,
      covered_elements: [],
      missing_elements: [],
      supporting_quote: "Customer notification duties apply as applicable.",
      content_preview: "Customer notification duties apply as applicable.",
      grade_reason: "The source uses generic applicability language.",
    }),
  ]);
  const explicitLimitation = aggregateFindingForRequirement(requirement, [
    negativeChunk({
      supporting_quote: "This handbook does not establish a customer-notification decision procedure.",
      content_preview: "This handbook does not establish a customer-notification decision procedure.",
      grade_reason: "This handbook does not establish a customer-notification decision procedure.",
      negative_evidence_reason: "This handbook does not establish a customer-notification decision procedure.",
    }),
  ]);
  const auditedLimitation = aggregateFindingForRequirement(requirement, [
    negativeChunk({
      supporting_quote: "A future policy revision may consolidate privacy and cyber response. This governance document does not establish an end-to-end program designed around detection, response, and restoration sequence for unauthorized access to or use of securityholder information.",
      content_preview: "A future policy revision may consolidate privacy and cyber response. This governance document does not establish an end-to-end program designed around detection, response, and restoration sequence for unauthorized access to or use of securityholder information.",
      grade_reason: "The current document expressly limits an incident-response program without identifying another controlling source.",
      negative_evidence_reason: "The current document expressly limits an incident-response program without identifying another controlling source.",
    }),
  ]);
  const unrelatedCrossReference = aggregateFindingForRequirement(requirement, [
    negativeChunk({
      supporting_quote: "Vendor onboarding is defined in the Third-Party Standard.",
      content_preview: "Vendor onboarding is defined in the Third-Party Standard.",
      grade_reason: "Vendor onboarding is defined in the Third-Party Standard.",
      negative_evidence_reason: "Vendor onboarding is defined in the Third-Party Standard.",
    }),
  ]);

  for (const finding of [evidenceFree, genericScope, explicitLimitation, auditedLimitation, unrelatedCrossReference]) {
    assert.equal(finding.status, "missing");
    assert.notEqual(finding.status, "needs_review");
  }
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

test("production path avoids heading and fragment boundaries in incident-assessment quotes", async () => {
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
  const content = [
    "The assessment identifies affected platforms.",
    "",
    "Containment, control, and preservation of affected systems",
    "",
    "systems and information types.",
    "The assessment identifies affected customer information systems and information types.",
    "The incident team takes containment and control steps to prevent additional unauthorized access or use.",
  ].join("\n");

  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote:
        "platforms.\n\nContainment, control, and preservation of affected systems\n\nsystems and information types.",
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote ?? "", /^The assessment identifies affected customer information systems/);
  assert.match(finding.evidence[0].quote ?? "", /\.$/);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /Containment, control, and preservation of affected systems/);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^platforms/i);
});

test("production path starts preservation quotes at the retention sentence", async () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      {
        id: "incident_materials",
        label: "Preserves incident logs, evidence, or investigation materials",
        requiredForCovered: true,
        signals: ["investigation materials", "incident record"],
      },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const content =
    "Incident records document categories, containment actions, and closure approval. Investigation materials are retained with the incident record for seven years.";

  const finding = await productionPathFinding(preservationRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["incident_materials"],
      supporting_quote:
        "categories, containment actions, and closure approval. Investigation materials are retained with the incident record",
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, "Investigation materials are retained with the incident record for seven years.");
});

test("production path rejects revision-history metadata but keeps operative responsibility statements", async () => {
  const writtenProgramRequirement = {
    ...requirement,
    id: "written_incident_response_program",
    title: "Written incident response program",
    coverageElements: [
      {
        id: "written_program",
        label: "Maintains a written incident response program",
        requiredForCovered: true,
        signals: ["written incident response program"],
      },
    ],
    requiredElementsForCovered: ["written_program"],
  };
  const revisionHistory = "Updated ownership, terminology, and responsibilities.";
  const metadataFinding = await productionPathFinding(writtenProgramRequirement, [
    chunk({ content_preview: `Revision history\n${revisionHistory}` }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["written_program"],
      missing_elements: [],
      supporting_quote: revisionHistory,
    }),
  ]);
  assert.equal(metadataFinding.status, "missing");
  assert.equal(metadataFinding.evidence.length, 0);

  const operativeStatement =
    "The firm maintains a written incident response program and assigns the incident manager responsibility for response coordination.";
  const operativeFinding = await productionPathFinding(writtenProgramRequirement, [
    chunk({ content_preview: operativeStatement }),
  ], [
    classifierClassification({
      covered_elements: ["written_program"],
      supporting_quote: operativeStatement,
    }),
  ]);
  assert.equal(operativeFinding.status, "covered");
  assert.equal(operativeFinding.evidence[0].quote, operativeStatement);
});

test("production path derives containment support and its reason from the final quote", async () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "assesses_scope", label: "Assesses scope", requiredForCovered: true, signals: ["assesses the nature and scope"] },
      { id: "customer_information_systems", label: "Identifies affected systems", requiredForCovered: true, signals: ["affected customer information systems"] },
      { id: "containment_control", label: "Requires containment", requiredForCovered: true, signals: ["containment and control"] },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const genericQuote = "The depth of review depends on the sensitivity of customer information.";
  const scopeQuote = "The incident manager assesses the nature and scope and identifies affected customer information systems.";
  const containmentQuote = "The technical lead takes containment and control steps to limit ongoing harm.";
  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({ content_preview: `${genericQuote}\n${scopeQuote}\n${containmentQuote}` }),
  ], [
    classifierClassification({
      covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote: genericQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote ?? "", /containment and control/i);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^The depth of review/i);
  assert.match(finding.evidence[0].reason, /containment or control steps/i);
  assert.match(finding.evidence[0].reason, /assessment of the nature and scope/i);
});

test("classifier recovers a line-wrapped retention sentence without merging unrelated sentences", async () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      {
        id: "incident_materials",
        label: "Preserves incident logs or evidence",
        requiredForCovered: true,
        signals: ["preserve logs"],
      },
      {
        id: "evidence_integrity",
        label: "Preserves evidence integrity",
        requiredForCovered: true,
        signals: ["chain of custody"],
      },
    ],
    requiredElementsForCovered: ["incident_materials", "evidence_integrity"],
  };
  const unrelated = "The ticket remains available under the standard service-management retention schedule.";
  const retained = "Security-console exports used during the\nresponse are retained for at least 90 days unless ordinary platform limits provide a longer period.";
  const content = `${unrelated}\n${retained}`;
  const { postProcessOpenAiClassification } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  const classification = postProcessOpenAiClassification({
    relationship: "partially_supports",
    confidence: "medium",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: ["incident_materials"],
    missing_elements: [],
    vague_elements: [],
    reason: "The cited text retains security-console exports.",
    supporting_quote:
      "Security-console exports used during the response are retained for at least 90 days unless ordinary platform limits provide a longer period.",
  }, {
    requirement: preservationRequirement,
    evaluationGuidance: "Test guidance.",
    chunkContent: content,
    chunkMetadata: {
      filename: "Incident Record Procedure.pdf",
      sectionPath: "Log collection",
      pageStart: 4,
      pageEnd: 4,
      chunkIndex: 3,
      sourceType: "client_procedure",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive requirement or procedure",
    },
  });

  assert.equal(classification.relationship, "partially_supports");
  assert.equal(classification.supporting_quote, retained);
  assert.doesNotMatch(classification.supporting_quote ?? "", /ticket remains available/i);

  const finding = await productionPathFinding(preservationRequirement, [
    chunk({ content_preview: content }),
  ], [classification]);
  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].quote, retained);
});

test("production path retains a bounded accountable incident-evidence process span", async () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      {
        id: "incident_materials",
        label: "Preserves incident logs or evidence",
        requiredForCovered: true,
        signals: ["preserve logs", "volatile information", "investigation notes"],
      },
      {
        id: "preservation_process",
        label: "Defines a preservation process",
        requiredForCovered: true,
        signals: ["incident file", "access-controlled case folders", "legal hold"],
      },
    ],
    requiredElementsForCovered: ["incident_materials", "preservation_process"],
    directSignals: ["incident file", "preserve logs", "access-controlled case folders", "legal hold"],
    actionSignals: ["maintains", "preserved", "stored", "retention"],
    topicSignals: ["logs", "evidence", "investigation"],
    partialSignals: ["records", "retention"],
  };
  const content = [
    "The incident manager maintains a contemporaneous incident file containing alerts, system and identity logs, relevant exports, screenshots, and investigation notes.",
    "Relevant logs and volatile information are preserved promptly.",
    "Exports are stored in access-controlled case folders with source, collection time, custodian, and integrity information when material to the investigation.",
    "Routine log retention is not shortened while an incident, investigation, examination, or legal hold is open.",
  ].join(" ");
  const { postProcessOpenAiClassification } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  const classification = postProcessOpenAiClassification({
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: ["incident_materials", "preservation_process"],
    missing_elements: [],
    vague_elements: [],
    reason: "The policy defines an incident evidence process.",
    supporting_quote: "Relevant logs and volatile information are preserved promptly.",
  }, {
    requirement: preservationRequirement,
    evaluationGuidance: "Test guidance.",
    chunkContent: content,
    chunkMetadata: {
      filename: "Incident Procedure.pdf",
      sectionPath: "Incident documentation",
      pageStart: 4,
      pageEnd: 4,
      chunkIndex: 3,
      sourceType: "client_procedure",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive procedure evidence",
    },
  });

  assert.equal(classification.relationship, "supports");
  assert.deepEqual(classification.covered_elements, ["incident_materials", "preservation_process"]);
  assert.match(classification.supporting_quote ?? "", /incident manager maintains a contemporaneous incident file/i);
  assert.match(classification.supporting_quote ?? "", /access-controlled case folders/i);

  const finding = await productionPathFinding(preservationRequirement, [
    chunk({ content_preview: content }),
  ], [classification]);
  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote ?? "", /access-controlled case folders/i);
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(preservationRequirement, finding.evidence[0].quote),
    ["incident_materials", "preservation_process"],
  );
  assert.doesNotMatch(finding.rationale, /do not clearly define how logs, evidence, or investigation records must be preserved/i);
});

test("optional evidence-integrity limitations do not conflict with retained incident materials", () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      { id: "incident_materials", label: "Preserves incident materials", requiredForCovered: true, signals: ["preserve logs"] },
      { id: "integrity_or_chain_of_custody", label: "Maintains chain of custody", requiredForCovered: false, signals: ["chain of custody", "custody"] },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const support = chunk({
    content_preview: "The procedure must preserve logs for incident investigation.",
    supporting_quote: "The procedure must preserve logs for incident investigation.",
    covered_elements: ["incident_materials"],
  });
  const optionalLimitation = chunk({
    chunk_id: "78787878-7878-4787-8787-787878787878",
    content_preview: "The procedure does not establish chain of custody.",
    supporting_quote: "The procedure does not establish chain of custody.",
    grade: "irrelevant",
    evidence_relationship: "negative_evidence",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    negative_evidence: true,
    covered_elements: [],
    missing_elements: ["integrity_or_chain_of_custody"],
    grade_reason: "The broader chunk mentions a chain-of-custody limitation.",
  });

  const finding = aggregateFindingForRequirement(preservationRequirement, [support, optionalLimitation]);
  assert.equal(finding.status, "partial");
  assert.deepEqual(finding.evidence.map((evidence) => evidence.relationship), ["supports", "negative_evidence"]);
  const negative = finding.evidence.find((evidence) => evidence.relationship === "negative_evidence");
  assert.equal(negative?.quote, optionalLimitation.supporting_quote);
  assert.match(negative?.reason ?? "", /explicitly limits evidence integrity or chain-of-custody requirements/i);
});

test("sentence-scoped negative evidence excludes neutral incident-record leads", () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      { id: "incident_materials", label: "Preserves incident materials", requiredForCovered: true, signals: ["incident records"] },
      { id: "integrity_or_chain_of_custody", label: "Maintains chain of custody", requiredForCovered: false, signals: ["chain of custody", "custody"] },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const support = chunk({
    content_preview: "Security-console exports used during the response are retained for at least 90 days.",
    supporting_quote: "Security-console exports used during the response are retained for at least 90 days.",
    covered_elements: ["incident_materials"],
  });
  const neutralLead = "This procedure describes basic incident records maintained by Technology Operations.";
  const integrityLimitation = "The procedure does not establish forensic collection standards, chain-of-custody requirements, immutable evidence storage, or cryptographic integrity checks.";
  const limitation = chunk({
    chunk_id: "78787878-7878-4787-8787-787878787879",
    content_preview: `${neutralLead} ${integrityLimitation}`,
    supporting_quote: `${neutralLead} ${integrityLimitation}`,
    grade: "irrelevant",
    evidence_relationship: "negative_evidence",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    negative_evidence: true,
    covered_elements: [],
    missing_elements: ["integrity_or_chain_of_custody"],
    grade_reason: "The procedure limits chain-of-custody controls.",
  });

  const finding = aggregateFindingForRequirement(preservationRequirement, [support, limitation]);
  assert.equal(finding.status, "partial");
  const negative = finding.evidence.find((evidence) => evidence.relationship === "negative_evidence");
  assert.equal(negative?.quote, integrityLimitation);
  assert.doesNotMatch(negative?.quote ?? "", /basic incident records/i);
  assert.match(negative?.reason ?? "", /explicitly limits evidence integrity or chain-of-custody requirements/i);
});

test("same required element support and negative evidence remain conflicting with quote-grounded reason", () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      { id: "incident_materials", label: "Preserves incident materials", requiredForCovered: true, signals: ["preserve logs"] },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const support = chunk({
    content_preview: "The procedure must preserve logs for incident investigation.",
    supporting_quote: "The procedure must preserve logs for incident investigation.",
    covered_elements: ["incident_materials"],
  });
  const contradiction = chunk({
    chunk_id: "79797979-7979-4797-8797-797979797979",
    content_preview: "The firm does not preserve logs for incident investigation.",
    supporting_quote: "The firm does not preserve logs for incident investigation.",
    grade: "irrelevant",
    evidence_relationship: "negative_evidence",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    negative_evidence: true,
    covered_elements: [],
    missing_elements: ["incident_materials"],
    grade_reason: "The broader chunk also discusses unrelated forensic procedures.",
  });

  const finding = aggregateFindingForRequirement(preservationRequirement, [support, contradiction]);
  assert.equal(finding.status, "conflicting");
  const negative = finding.evidence.find((evidence) => evidence.relationship === "negative_evidence");
  assert.equal(negative?.quote, contradiction.supporting_quote);
  assert.match(negative?.reason ?? "", /explicitly limits how logs, evidence, or investigation records must be preserved/i);
  assert.doesNotMatch(negative?.reason ?? "", /unrelated forensic/i);
});

test("final curation prefers operative containment actions over generic review context", () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "customer_information_systems", label: "Identifies affected customer information", requiredForCovered: true, signals: ["customer information"] },
      { id: "containment_control", label: "Requires containment or control", requiredForCovered: true, signals: ["containment"] },
    ],
    requiredElementsForCovered: ["customer_information_systems", "containment_control"],
  };
  const generic = chunk({
    chunk_id: "80808080-8080-4808-8808-808080808080",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    content_preview: "The depth of review depends on the sensitivity of customer information.",
    supporting_quote: "The depth of review depends on the sensitivity of customer information.",
    covered_elements: ["customer_information_systems"],
    missing_elements: ["containment_control"],
  });
  const operative = chunk({
    chunk_id: "81818181-8181-4818-8818-818181818181",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    content_preview: "The technical lead selects containment actions intended to limit ongoing harm.",
    supporting_quote: "The technical lead selects containment actions intended to limit ongoing harm.",
    covered_elements: ["containment_control"],
    missing_elements: ["customer_information_systems"],
  });

  const finding = aggregateFindingForRequirement(assessmentRequirement, [generic, operative]);
  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].quote, operative.supporting_quote);
  assert.match(finding.evidence[0].reason, /containment or control/i);
  assert.doesNotMatch(finding.evidence[0].reason, /customer information/i);
});

test("final curation prefers direct recovery validation over generic restoration context", () => {
  const recoveryRequirement = {
    ...requirement,
    id: "response_recovery_remediation_validation",
    title: "Response recovery and remediation validation",
    coverageElements: [
      { id: "recovery_steps", label: "Defines recovery steps", requiredForCovered: true, signals: ["recovery", "restore", "restoration"] },
      { id: "validation_testing", label: "Validates recovery", requiredForCovered: true, signals: ["validating network connectivity", "validation"] },
    ],
    requiredElementsForCovered: ["recovery_steps", "validation_testing"],
  };
  const generic = chunk({
    chunk_id: "82828282-8282-4828-8828-828282828282",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    content_preview: "The organization applies a risk-based approach to identity-service restoration.",
    supporting_quote: "The organization applies a risk-based approach to identity-service restoration.",
    covered_elements: ["recovery_steps"],
    missing_elements: ["validation_testing"],
  });
  const operative = chunk({
    chunk_id: "83838383-8383-4838-8838-838383838383",
    grade: "partial",
    evidence_relationship: "partially_supports",
    requirement_supported: false,
    content_preview: "Technical teams follow approved runbooks for restoration from backups and validating network connectivity.",
    supporting_quote: "Technical teams follow approved runbooks for restoration from backups and validating network connectivity.",
    covered_elements: ["recovery_steps", "validation_testing"],
    missing_elements: [],
  });

  const finding = aggregateFindingForRequirement(recoveryRequirement, [generic, operative]);
  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, operative.supporting_quote);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /risk-based approach/i);

  const restorationOnly = aggregateFindingForRequirement(recoveryRequirement, [generic]);
  assert.equal(restorationOnly.status, "partial");
  assert.equal(restorationOnly.evidence[0].quote, generic.supporting_quote);
});

test("canonical element matching evaluates only the final positive quote", () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "containment_control", label: "Requires containment or control", requiredForCovered: true, signals: ["containment"] },
    ],
    requiredElementsForCovered: ["containment_control"],
  };
  const recoveryRequirement = {
    ...requirement,
    id: "response_recovery_remediation_validation",
    title: "Response recovery and remediation validation",
    coverageElements: [
      { id: "recovery_steps", label: "Defines recovery steps", requiredForCovered: true, signals: ["recovery", "restoration"] },
    ],
    requiredElementsForCovered: ["recovery_steps"],
  };

  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(
      assessmentRequirement,
      "The technical lead selects containment actions intended to limit ongoing harm.",
    ),
    ["containment_control"],
  );
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(
      recoveryRequirement,
      "Technical teams follow approved runbooks for restoration from backups.",
    ),
    ["recovery_steps"],
  );
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(
      assessmentRequirement,
      "The depth of review depends on the sensitivity of customer information.",
    ),
    [],
  );
});

test("production path omits truncated recovery follow-on sentences", async () => {
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
  const goodSentence =
    "Recovery activities include restoring affected services, validating user access, confirming remediation tasks, and\ndocumenting remaining open issues.";
  const content = `${goodSentence} Validation steps are defined for major incidents but are less complete for`;

  const finding = await productionPathFinding(recoveryRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["recovery_steps", "remediation_tracking", "validation_testing"],
      supporting_quote: content,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, goodSentence);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /\bfor$/);
});

test("production path expands written incident response quote to full sentence", async () => {
  const writtenRequirement = {
    ...requirement,
    id: "written_incident_response_program",
    title: "Written incident response program",
    coverageElements: [
      { id: "written_program", label: "Maintains a written incident response program", requiredForCovered: true, signals: ["maintains a written incident response procedure"] },
      { id: "customer_information_scope", label: "Applies to customer information", requiredForCovered: true, signals: ["customer information"] },
    ],
    requiredElementsForCovered: ["written_program", "customer_information_scope"],
  };
  const content =
    "Meridian Valley Securities Inc. maintains a written incident response procedure for events involving customer information systems and sensitive customer records.";

  const finding = await productionPathFinding(writtenRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["written_program", "customer_information_scope"],
      supporting_quote:
        "Meridian Valley Securities Inc. maintains a written incident response procedure for events involving customer",
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, content);
});

test("production path suppresses adjacent partial rows that add no required-element coverage", async () => {
  const writtenRequirement = {
    ...requirement,
    id: "written_incident_response_program",
    title: "Written incident response program",
    coverageElements: [
      { id: "written_program", label: "Maintains a written incident response program", requiredForCovered: true, signals: ["written incident response procedure"] },
      { id: "customer_information_scope", label: "Applies to customer information", requiredForCovered: true, signals: ["customer information"] },
    ],
    requiredElementsForCovered: ["written_program", "customer_information_scope"],
  };
  const directContent =
    "The firm maintains a written incident response procedure for events involving customer information systems and customer records.";
  const adjacentContent =
    "Vendor safeguards documentation references customer information but does not define the written incident response procedure.";

  const finding = await productionPathFinding(writtenRequirement, [
    chunk({ content_preview: directContent }),
    chunk({
      chunk_id: "45454545-4545-4454-8454-454545454545",
      content_preview: adjacentContent,
      section_path: "Vendor safeguards review",
    }),
  ], [
    classifierClassification({
      covered_elements: ["written_program", "customer_information_scope"],
      supporting_quote: directContent,
    }),
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["customer_information_scope"],
      missing_elements: ["written_program"],
      supporting_quote: adjacentContent,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence.length, 1);
  assert.equal(finding.evidence[0].quote, directContent);
});

test("production path covers strong customer notification content from one substantive quote", async () => {
  const noticeContentRequirement = {
    ...requirement,
    id: "customer_notification_content",
    title: "Customer notification content",
    coverageElements: [
      { id: "incident_description", label: "Requires an incident description", requiredForCovered: true, signals: ["description of the incident"] },
      { id: "information_involved", label: "Identifies affected information", requiredForCovered: true, signals: ["information involved"] },
      { id: "protective_steps", label: "Includes protective steps", requiredForCovered: true, signals: ["protective steps", "account-protection resources"] },
      { id: "contact_information", label: "Provides contact information", requiredForCovered: true, signals: ["contact information"] },
    ],
    requiredElementsForCovered: ["incident_description", "information_involved", "protective_steps", "contact_information"],
  };
  const quote =
    "Each notice must include a description of the incident in plain language, the information involved when known, steps taken by the firm, actions customers can take to protect themselves, contact information, and any credit monitoring or account-protection resources approved for the event.";

  const finding = await productionPathFinding(noticeContentRequirement, [
    chunk({
      content_preview: quote,
    }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["incident_description", "information_involved"],
      missing_elements: ["protective_steps", "contact_information"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].relationship, "supports");
  assert.equal(finding.evidence[0].quote, quote);
});

test("production path covers strong safeguards controls from one substantive quote", async () => {
  const safeguardsRequirement = {
    ...requirement,
    id: "safeguards_customer_information",
    title: "Safeguards for customer information",
    coverageElements: [
      { id: "customer_information_scope", label: "Applies safeguards to customer information systems", requiredForCovered: true, signals: ["customer information systems"] },
      { id: "safeguards_controls", label: "Defines administrative or technical safeguards", requiredForCovered: true, signals: ["role-based access", "multifactor authentication", "encryption", "periodic access review"] },
    ],
    requiredElementsForCovered: ["customer_information_scope", "safeguards_controls"],
  };
  const quote =
    "Customer information systems require role-based access, multifactor authentication where available, encryption in transit, encryption at rest for approved repositories, privileged access logging, change management, periodic access review, and physical safeguards for locked facilities and visitor access.";

  const finding = await productionPathFinding(safeguardsRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["safeguards_controls"],
      missing_elements: ["customer_information_scope"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].relationship, "supports");
  assert.equal(finding.evidence[0].quote, quote);
});

test("production path rejects mixed internal heading and orphan-fragment contamination", async () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "assesses_scope", label: "Assesses unauthorized access", requiredForCovered: true, signals: ["assesses unauthorized access"] },
      { id: "customer_information_systems", label: "Identifies affected systems", requiredForCovered: true, signals: ["affected customer information systems", "information types"] },
      { id: "containment_control", label: "Contains the incident", requiredForCovered: true, signals: ["containment and control"] },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const cleanQuote =
    "The incident team assesses unauthorized access, identifies affected customer information systems and information types, and performs containment and control steps.";
  const content = [
    "Incident intake, triage, and escalation",
    "",
    "systems and information types.",
    cleanQuote,
  ].join("\n");

  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote: "Incident intake, triage, and escalation\n\nsystems and information types.",
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, cleanQuote);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /Incident intake, triage, and escalation/);
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /^systems and information types/i);
});

test("production path keeps complementary direct recovery evidence that adds required coverage", async () => {
  const recoveryRequirement = {
    ...requirement,
    id: "response_recovery_remediation_validation",
    title: "Response recovery and remediation validation",
    coverageElements: [
      { id: "recovery_steps", label: "Defines recovery steps", requiredForCovered: true, signals: ["restoring affected services"] },
      { id: "remediation_tracking", label: "Tracks remediation", requiredForCovered: true, signals: ["corrective-action tracking", "remediation tasks"] },
      { id: "validation_testing", label: "Validates recovery", requiredForCovered: true, signals: ["validating user access", "validation evidence"] },
    ],
    requiredElementsForCovered: ["recovery_steps", "remediation_tracking", "validation_testing"],
  };
  const recoveryQuote =
    "Recovery activities include restoring affected services and validating user access before business restart.";
  const remediationQuote =
    "Corrective-action tracking records remediation tasks, owners, closure criteria, and validation evidence.";

  const finding = await productionPathFinding(recoveryRequirement, [
    chunk({
      chunk_id: "56565656-5656-4565-8565-565656565656",
      section_path: "Incident recovery and remediation validation",
      content_preview: recoveryQuote,
    }),
    chunk({
      chunk_id: "57575757-5757-4575-8575-575757575757",
      section_path: "Incident recovery and remediation validation",
      content_preview: remediationQuote,
    }),
  ], [
    classifierClassification({
      covered_elements: ["recovery_steps", "validation_testing"],
      supporting_quote: recoveryQuote,
    }),
    classifierClassification({
      covered_elements: ["remediation_tracking", "validation_testing"],
      supporting_quote: remediationQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence.length, 2);
  assert.deepEqual(finding.evidence.map((row) => row.quote), [recoveryQuote, remediationQuote]);
});

test("production path prefers direct recovery evidence over vendor questionnaire evidence", async () => {
  const recoveryRequirement = {
    ...requirement,
    id: "response_recovery_remediation_validation",
    title: "Response recovery and remediation validation",
    coverageElements: [
      { id: "recovery_steps", label: "Defines recovery steps", requiredForCovered: true, signals: ["restoring affected services"] },
      { id: "remediation_tracking", label: "Tracks remediation", requiredForCovered: true, signals: ["corrective-action tracking", "remediation plan"] },
      { id: "validation_testing", label: "Validates recovery", requiredForCovered: true, signals: ["validating user access", "recovery evidence"] },
    ],
    requiredElementsForCovered: ["recovery_steps", "remediation_tracking", "validation_testing"],
  };
  const vendorQuote =
    "The vendor incident questionnaire requires affected systems, data categories, date of discovery, containment status, forensic support, customer notification support, remediation plan, and recovery evidence.";
  const recoveryQuote =
    "Incident recovery procedures require restoring affected services and validating user access before business restart.";
  const closureQuote =
    "Corrective-action tracking records remediation tasks, closure approval, and validation evidence.";

  const finding = await productionPathFinding(recoveryRequirement, [
    chunk({
      chunk_id: "60606060-6060-4060-8060-606060606060",
      section_path: "Customer notification content requirements",
      content_preview: vendorQuote,
      rerank_score: 99,
    }),
    chunk({
      chunk_id: "61616161-6161-4161-8161-616161616161",
      section_path: "Incident recovery procedures",
      content_preview: recoveryQuote,
    }),
    chunk({
      chunk_id: "62626262-6262-4262-8262-626262626262",
      section_path: "Corrective action closure review",
      content_preview: closureQuote,
    }),
  ], [
    classifierClassification({
      covered_elements: ["recovery_steps", "remediation_tracking", "validation_testing"],
      supporting_quote: vendorQuote,
    }),
    classifierClassification({
      covered_elements: ["recovery_steps", "validation_testing"],
      supporting_quote: recoveryQuote,
    }),
    classifierClassification({
      covered_elements: ["remediation_tracking", "validation_testing"],
      supporting_quote: closureQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.deepEqual(finding.evidence.map((row) => row.quote), [recoveryQuote, closureQuote]);
  assert.notEqual(finding.evidence[0].quote, vendorQuote);
});

test("production path prefers direct assessment and containment evidence over vendor questionnaire evidence", async () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "assesses_scope", label: "Assesses nature and scope", requiredForCovered: true, signals: ["assesses the nature and scope"] },
      { id: "customer_information_systems", label: "Identifies affected systems", requiredForCovered: true, signals: ["affected customer information systems", "information types"] },
      { id: "containment_control", label: "Requires containment", requiredForCovered: true, signals: ["containment and control"] },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const vendorQuote =
    "The vendor questionnaire collects affected systems, data categories, date of discovery, containment status, and customer impact assessment.";
  const directQuote =
    "Incident intake and triage assesses the nature and scope of unauthorized access, identifies affected customer information systems and information types, and starts containment and control steps.";

  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({
      chunk_id: "63636363-6363-4363-8363-636363636363",
      section_path: "Vendor incident questionnaire",
      content_preview: vendorQuote,
      rerank_score: 99,
    }),
    chunk({
      chunk_id: "64646464-6464-4464-8464-646464646464",
      section_path: "Incident intake and triage assessment",
      content_preview: directQuote,
    }),
  ], [
    classifierClassification({
      covered_elements: ["customer_information_systems", "containment_control"],
      supporting_quote: vendorQuote,
    }),
    classifierClassification({
      covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote: directQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence.length, 1);
  assert.equal(finding.evidence[0].quote, directQuote);
});

test("production path keeps complementary written compliance record evidence", async () => {
  const recordsRequirement = {
    ...requirement,
    id: "written_compliance_records",
    title: "Written compliance records",
    coverageElements: [
      { id: "compliance_record_scope", label: "Requires written compliance records", requiredForCovered: true, signals: ["written compliance records", "compliance review materials"] },
      { id: "notice_determination_records", label: "Documents incident or notice determinations", requiredForCovered: true, signals: ["incident determinations", "notification determinations", "customer notices"] },
      { id: "retention_accessibility", label: "Defines retention", requiredForCovered: true, signals: ["retained", "retention schedule", "disposal register"] },
    ],
    requiredElementsForCovered: ["compliance_record_scope", "notice_determination_records", "retention_accessibility"],
  };
  const disposalQuote =
    "Certificates of destruction are retained with the disposal register under the retention schedule.";
  const complianceQuote =
    "Compliance maintains written records demonstrating implementation of the safeguards and disposal program, including incident determinations, notification determinations, customer notices, and compliance review materials.";

  const finding = await productionPathFinding(recordsRequirement, [
    chunk({
      chunk_id: "58585858-5858-4585-8585-585858585858",
      section_path: "Record retention and compliance evidence",
      content_preview: disposalQuote,
    }),
    chunk({
      chunk_id: "59595959-5959-4595-8595-595959595959",
      section_path: "Record retention and compliance evidence",
      content_preview: complianceQuote,
    }),
  ], [
    classifierClassification({
      covered_elements: ["retention_accessibility"],
      supporting_quote: disposalQuote,
    }),
    classifierClassification({
      covered_elements: ["compliance_record_scope", "notice_determination_records"],
      supporting_quote: complianceQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence.length, 2);
  assert.deepEqual(finding.evidence.map((row) => row.quote), [complianceQuote, disposalQuote]);
});

function serviceProviderRequirementFixture() {
  return {
    ...requirement,
    id: "service_provider_incident_oversight_notice",
    title: "Service provider incident oversight and notice",
    coverageElements: [
      { id: "service_provider_scope", label: "Requires provider oversight", requiredForCovered: true, signals: ["due diligence", "ongoing monitoring"] },
      { id: "provider_safeguards", label: "Requires provider safeguards", requiredForCovered: true, signals: ["protect customer information", "unauthorized access"] },
      { id: "notice_to_firm", label: "Requires notice to the firm", requiredForCovered: true, signals: ["notify the firm", "72 hours"] },
      { id: "cooperation_remediation", label: "Requires cooperation", requiredForCovered: false, signals: ["status updates", "forensic support", "remediation plan", "recovery evidence"] },
    ],
    requiredElementsForCovered: ["service_provider_scope", "provider_safeguards", "notice_to_firm"],
    optionalElements: ["cooperation_remediation"],
  };
}

function directServiceProviderRequirementFixture() {
  return {
    ...requirement,
    id: "service_provider_incident_oversight_notice",
    title: "Service provider incident oversight and notice",
    coverageElements: [
      {
        id: "service_provider_scope",
        label: "Requires due diligence and monitoring for service providers",
        requiredForCovered: true,
        signals: ["due diligence", "ongoing monitoring of service providers"],
      },
      {
        id: "provider_safeguards",
        label: "Requires service-provider safeguards",
        requiredForCovered: true,
        signals: ["protect against unauthorized access"],
      },
      {
        id: "notice_to_firm",
        label: "Requires notice to the firm",
        requiredForCovered: true,
        signals: ["notify the firm", "72 hours"],
      },
      {
        id: "cooperation_remediation",
        label: "Requires cooperation",
        requiredForCovered: false,
        signals: ["cooperation"],
      },
    ],
    requiredElementsForCovered: ["service_provider_scope", "provider_safeguards", "notice_to_firm"],
    optionalElements: ["cooperation_remediation"],
  };
}

test("production path covers direct provider oversight, safeguards, and notice without a cooperation requirement", async () => {
  const providerRequirement = directServiceProviderRequirementFixture();
  const directQuote =
    "The firm performs due diligence and ongoing monitoring of service providers handling customer information and requires those providers to protect against unauthorized access to or use of customer information and notify the firm as soon as possible, but no later than 72 hours after becoming aware of a breach.";
  const recoveryQuote =
    "Before returning a material customer information system to normal operation, the owner validates security logging and updates procedures, safeguards, and service-provider requirements.";

  const finding = await productionPathFinding(providerRequirement, [
    chunk({
      chunk_id: "66555555-5555-4555-8555-555555555555",
      section_path: "Service provider oversight",
      content_preview: directQuote,
      rerank_score: 80,
    }),
    chunk({
      chunk_id: "66666666-6666-4666-8666-666666666667",
      section_path: "Recovery validation",
      content_preview: recoveryQuote,
      rerank_score: 99,
    }),
  ], [
    classifierClassification({
      covered_elements: providerRequirement.requiredElementsForCovered,
      supporting_quote: directQuote,
    }),
    classifierClassification({
      covered_elements: providerRequirement.requiredElementsForCovered,
      supporting_quote: recoveryQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.deepEqual(finding.evidence.map((row) => row.quote), [directQuote]);
  assert.doesNotMatch(JSON.stringify(finding.evidence), /returning a material|recovery validation/i);
  assert.match(finding.evidence[0].reason, /due diligence|service providers|safeguards|notify/i);
  assert.doesNotMatch(finding.evidence[0].reason, /recovery|remediation/i);
});

test("production path recognizes operative compliance-program records but rejects generic departmental retention", async () => {
  const recordsRequirement = {
    ...requirement,
    id: "written_compliance_records",
    title: "Written compliance records",
    coverageElements: [
      { id: "compliance_record_scope", label: "Requires records documenting compliance", requiredForCovered: true, signals: ["records demonstrating implementation"] },
      { id: "notice_determination_records", label: "Documents notices", requiredForCovered: true, signals: ["notification determinations"] },
      { id: "retention_accessibility", label: "Defines retention", requiredForCovered: true, signals: ["easily accessible"] },
    ],
    requiredElementsForCovered: ["compliance_record_scope", "notice_determination_records", "retention_accessibility"],
  };
  const complianceQuote = [
    "Compliance maintains true, accurate, and current records demonstrating implementation of the safeguards and disposal program.",
    "The records include incident and notification determinations.",
    "These records are retained for five years in an easily accessible place.",
  ].join(" ");

  const finding = await productionPathFinding(recordsRequirement, [
    chunk({ content_preview: complianceQuote, section_path: "Compliance records" }),
  ], [
    classifierClassification({
      covered_elements: recordsRequirement.requiredElementsForCovered,
      supporting_quote: complianceQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote, /^Compliance maintains true, accurate, and current records demonstrating implementation/i);
  assert.match(finding.evidence[0].reason, /written compliance records|records documenting/i);

  const genericRetention = "Compliance retains departmental records for five years under the ordinary retention schedule.";
  const genericFinding = await productionPathFinding(recordsRequirement, [
    chunk({ content_preview: genericRetention, section_path: "Departmental retention" }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["compliance_record_scope"],
      supporting_quote: genericRetention,
    }),
  ]);

  assert.equal(genericFinding.status, "missing");
  assert.deepEqual(genericFinding.evidence, []);
});

test("production path retains a bounded contiguous same-chunk records span for complete coverage", async () => {
  const recordsRequirement = {
    ...requirement,
    id: "written_compliance_records",
    title: "Written compliance records",
    coverageElements: [
      { id: "compliance_record_scope", label: "Requires records documenting compliance", requiredForCovered: true, signals: ["records demonstrating implementation"] },
      { id: "notice_determination_records", label: "Documents notices", requiredForCovered: true, signals: ["customer notices"] },
      { id: "retention_accessibility", label: "Defines retention", requiredForCovered: true, signals: ["easily accessible place"] },
    ],
    requiredElementsForCovered: ["compliance_record_scope", "notice_determination_records", "retention_accessibility"],
  };
  const fullSection = [
    "Program Documentation",
    "Compliance maintains true, accurate, and current records demonstrating implementation of the safeguards and disposal program.",
    "Records are indexed by incident, requirement, and responsible owner and are available for examination.",
    "• current and prior written safeguards and disposal policies;",
    "• notification investigations, determinations, supporting facts, and the basis for any no-notice decision;",
    "• copies of customer notices and delivery records, including notices sent by service providers;",
    "These records are preserved for three years in an easily accessible place.",
  ].join("\n");
  const narrowQuote = [
    "• notification investigations, determinations, supporting facts, and the basis for any no-notice decision;",
    "• copies of customer notices and delivery records, including notices sent by service providers;",
  ].join("\n");

  const finding = await productionPathFinding(recordsRequirement, [
    chunk({ content_preview: fullSection, section_path: "Program documentation" }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_determination_records", "retention_accessibility"],
      missing_elements: ["compliance_record_scope"],
      supporting_quote: narrowQuote,
    }),
  ]);

  const [evidence] = finding.evidence;
  assert.equal(finding.status, "covered");
  assert.equal(evidence.relationship, "supports");
  assert.match(evidence.quote, /^Compliance maintains true, accurate, and current records demonstrating implementation/i);
  assert.match(evidence.quote, /copies of customer notices/i);
  assert.match(evidence.quote, /easily accessible place/i);
  assert.ok(evidence.quote.length <= 1_800);
  assert.ok((evidence.quote.match(/[^.!?]+[.!?]+/g) ?? []).length <= 8);
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(recordsRequirement, evidence.quote),
    ["compliance_record_scope", "notice_determination_records", "retention_accessibility"],
  );
  assert.match(evidence.reason, /requires written compliance records/i);
  assert.doesNotMatch(evidence.reason, /additional required elements are not proven/i);
  assert.match(finding.remediation, /^Keep this procedure current/i);
});

test("same-chunk curation does not merge non-contiguous compliance-record passages", async () => {
  const recordsRequirement = {
    ...requirement,
    id: "written_compliance_records",
    title: "Written compliance records",
    coverageElements: [
      { id: "compliance_record_scope", label: "Requires records documenting compliance", requiredForCovered: true, signals: ["records demonstrating implementation"] },
      { id: "notice_determination_records", label: "Documents notices", requiredForCovered: true, signals: ["customer notices"] },
      { id: "retention_accessibility", label: "Defines retention", requiredForCovered: true, signals: ["easily accessible place"] },
    ],
    requiredElementsForCovered: ["compliance_record_scope", "notice_determination_records", "retention_accessibility"],
  };
  const separatedSection = [
    "Compliance maintains records demonstrating implementation of the safeguards and disposal program.",
    ...Array.from({ length: 8 }, (_, index) => `General background statement ${index + 1}.`),
    "Copies of customer notices are retained in an easily accessible place.",
  ].join(" ");
  const finding = await productionPathFinding(recordsRequirement, [
    chunk({ content_preview: separatedSection, section_path: "Program documentation" }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_determination_records", "retention_accessibility"],
      missing_elements: ["compliance_record_scope"],
      supporting_quote: "Copies of customer notices are retained in an easily accessible place.",
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.match(finding.evidence[0].quote, /records demonstrating implementation/i);
  assert.doesNotMatch(finding.evidence[0].quote, /copies of customer notices/i);
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(recordsRequirement, finding.evidence[0].quote),
    ["compliance_record_scope"],
  );
});

test("production path recognizes incident material preservation grammar without accepting generic retention", async () => {
  const preservationRequirement = {
    ...requirement,
    id: "incident_evidence_log_preservation",
    title: "Incident evidence and log preservation",
    coverageElements: [
      { id: "incident_materials", label: "Preserves incident materials", requiredForCovered: true, signals: ["preserve logs"] },
    ],
    requiredElementsForCovered: ["incident_materials"],
  };
  const preservationQuote = "Relevant logs and volatile information are preserved promptly.";
  const finding = await productionPathFinding(preservationRequirement, [
    chunk({ content_preview: preservationQuote, section_path: "Incident evidence" }),
  ], [
    classifierClassification({
      covered_elements: ["incident_materials"],
      supporting_quote: preservationQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, preservationQuote);

  const genericRetention = "The organization retains all policy documents under its ordinary records schedule.";
  const genericFinding = await productionPathFinding(preservationRequirement, [
    chunk({ content_preview: genericRetention, section_path: "Records retention" }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["incident_materials"],
      supporting_quote: genericRetention,
    }),
  ]);

  assert.equal(genericFinding.status, "missing");
  assert.equal(genericFinding.evidence.length, 0);
});

test("production path rejects customer-notification and disposal leakage from service-provider evidence", async () => {
  const vendorRequirement = serviceProviderRequirementFixture();
  const customerQuote = "The firm communicates promptly with affected customers after customer notification is approved.";
  const vendorQuote = "The firm performs due diligence and ongoing monitoring of service providers handling customer information and requires them to protect that information against unauthorized access.";
  const duplicateVendorQuote = "Vendors coordinate incident remediation with the firm.";
  const disposalQuote = "This policy does not define disposal methods for vendor-held customer records or backups.";

  const finding = await productionPathFinding(vendorRequirement, [
    chunk({
      chunk_id: "60606060-6060-4606-8606-606060606060",
      section_path: "Customer communications",
      content_preview: customerQuote,
    }),
    chunk({
      chunk_id: "61616161-6161-4616-8616-616161616161",
      section_path: "Third-party incident oversight",
      content_preview: vendorQuote,
    }),
    chunk({
      chunk_id: "62626262-6262-4626-8626-626262626262",
      section_path: "Third-party incident oversight",
      content_preview: duplicateVendorQuote,
    }),
    chunk({
      chunk_id: "63636363-6363-4636-8636-636363636363",
      section_path: "Records disposal",
      content_preview: disposalQuote,
    }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["notice_to_firm"],
      missing_elements: ["service_provider_scope", "cooperation_remediation"],
      supporting_quote: customerQuote,
    }),
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["service_provider_scope", "provider_safeguards"],
      missing_elements: ["notice_to_firm"],
      supporting_quote: vendorQuote,
    }),
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["service_provider_scope", "provider_safeguards"],
      missing_elements: ["notice_to_firm"],
      supporting_quote: duplicateVendorQuote,
    }),
    classifierClassification({
      relationship: "negative_evidence",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: [],
      missing_elements: ["service_provider_scope", "provider_safeguards", "notice_to_firm"],
      supporting_quote: disposalQuote,
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.deepEqual(finding.evidence.map((row) => row.quote), [vendorQuote]);
  assert.doesNotMatch(JSON.stringify(finding.evidence), /affected customers|disposal methods/i);
  assert.equal(finding.evidence[0].quote, finding.evidence[0].quote?.trim());
});

test("production path retains provider-notice limitations only when scoped to provider notice", async () => {
  const vendorRequirement = serviceProviderRequirementFixture();
  const vendorQuote = "The firm performs due diligence and ongoing monitoring of vendors handling customer information and requires them to protect customer information against unauthorized access.";
  const deadlineQuote = "The firm does not require service providers to notify it within a defined incident-reporting deadline.";
  const disposalQuote = "This procedure does not establish destruction methods for supplier-held customer records.";

  const finding = await productionPathFinding(vendorRequirement, [
    chunk({
      chunk_id: "64646464-6464-4646-8646-646464646464",
      section_path: "Provider incident coordination",
      content_preview: vendorQuote,
    }),
    chunk({
      chunk_id: "65656565-6565-4656-8656-656565656565",
      section_path: "Provider incident reporting",
      content_preview: deadlineQuote,
    }),
    chunk({
      chunk_id: "66666666-6666-4666-8666-666666666666",
      section_path: "Records disposal",
      content_preview: disposalQuote,
    }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["service_provider_scope", "provider_safeguards"],
      missing_elements: ["notice_to_firm"],
      supporting_quote: vendorQuote,
    }),
    classifierClassification({
      relationship: "negative_evidence",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: [],
      missing_elements: ["notice_to_firm"],
      supporting_quote: deadlineQuote,
    }),
    classifierClassification({
      relationship: "negative_evidence",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: [],
      missing_elements: ["service_provider_scope"],
      supporting_quote: disposalQuote,
    }),
  ]);

  assert.equal(finding.status, "partial");
  assert.deepEqual(finding.evidence.map((row) => row.quote), [vendorQuote, deadlineQuote]);
  assert.deepEqual(finding.evidence.map((row) => row.relationship), ["partially_supports", "negative_evidence"]);
  assert.ok(finding.evidence.every((row) => row.quote && [vendorQuote, deadlineQuote].includes(row.quote)));
});

test("production path keeps vendor questionnaire evidence for service-provider requirements", async () => {
  const vendorRequirement = serviceProviderRequirementFixture();
  const vendorQuote =
    "The vendor incident questionnaire requires due diligence and monitoring of service providers handling customer information, safeguards that protect against unauthorized access to customer information, and notice to the firm no later than 72 hours after a breach.";

  const finding = await productionPathFinding(vendorRequirement, [
    chunk({
      section_path: "Service provider oversight questionnaire",
      content_preview: vendorQuote,
    }),
  ], [
    classifierClassification({
      covered_elements: ["service_provider_scope", "provider_safeguards", "notice_to_firm"],
      supporting_quote: vendorQuote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, vendorQuote);
});

test("production path rejects current-page-focus scaffolding as primary evidence", async () => {
  const disposalRequirement = {
    ...requirement,
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    coverageElements: [
      { id: "disposal_scope", label: "Applies to consumer or customer information", requiredForCovered: true, signals: ["consumer and customer information"] },
      { id: "secure_disposal_method", label: "Requires secure disposal methods", requiredForCovered: true, signals: ["secure disposal"] },
    ],
    requiredElementsForCovered: ["disposal_scope", "secure_disposal_method"],
  };
  const finding = await productionPathFinding(disposalRequirement, [
    chunk({ content_preview: "Current page focus: Disposal of consumer and customer information." }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["disposal_scope"],
      missing_elements: ["secure_disposal_method"],
      supporting_quote: "Current page focus: Disposal of consumer and customer information.",
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("production path does not persist scaffold lines embedded in otherwise related spans", async () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "assesses_scope", label: "Assesses unauthorized access", requiredForCovered: true, signals: ["assessment of unauthorized access"] },
      { id: "customer_information_systems", label: "Identifies affected systems", requiredForCovered: true, signals: ["affected customer information systems"] },
      { id: "containment_control", label: "Contains the incident", requiredForCovered: true, signals: ["containment steps"] },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const content = [
    "Current page focus: Assessment of unauthorized access or use.",
    "The assessment of unauthorized access identifies affected customer information systems and information types.",
    "The response team performs containment steps to prevent additional unauthorized access.",
  ].join("\n");
  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({ content_preview: content }),
  ], [
    classifierClassification({
      covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote: content,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.doesNotMatch(finding.evidence[0].quote ?? "", /Current page focus:/);
  assert.match(finding.evidence[0].quote ?? "", /^The assessment of unauthorized access/);
});

test("production path does not use customer-notification negative evidence for disposal", async () => {
  const disposalRequirement = {
    ...requirement,
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    coverageElements: [
      { id: "disposal_scope", label: "Applies to consumer or customer information", requiredForCovered: true, signals: ["customer information"] },
      { id: "secure_disposal_method", label: "Requires secure disposal methods", requiredForCovered: true, signals: ["secure disposal"] },
    ],
    requiredElementsForCovered: ["disposal_scope", "secure_disposal_method"],
  };
  const quote =
    "This document does not define a customer notification decision standard for unauthorized access to or use of sensitive customer information.";
  const finding = await productionPathFinding(disposalRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      relationship: "negative_evidence",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: [],
      missing_elements: ["disposal_scope", "secure_disposal_method"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("production path does not accept generic escalation language as disposal support", async () => {
  const disposalRequirement = {
    ...requirement,
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    coverageElements: [
      { id: "disposal_scope", label: "Applies to consumer or customer information", requiredForCovered: true, signals: ["customer information"] },
      { id: "secure_disposal_method", label: "Requires secure disposal methods", requiredForCovered: true, signals: ["secure disposal"] },
    ],
    requiredElementsForCovered: ["disposal_scope", "secure_disposal_method"],
  };
  const quote =
    "Managers should escalate unusual events to Legal, Compliance, or Information Security when they believe customer information may be affected.";
  const finding = await productionPathFinding(disposalRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["disposal_scope"],
      missing_elements: ["secure_disposal_method"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("production path accepts disposal-aligned destruction and shredding evidence", async () => {
  const disposalRequirement = {
    ...requirement,
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    coverageElements: [
      { id: "disposal_scope", label: "Applies to consumer or customer information", requiredForCovered: true, signals: ["customer information"] },
      { id: "secure_disposal_method", label: "Requires secure disposal methods", requiredForCovered: true, signals: ["shredding", "destruction"] },
    ],
    requiredElementsForCovered: ["disposal_scope", "secure_disposal_method"],
  };
  const quote =
    "Customer information records are disposed of through secure destruction, shredding, or approved media wiping.";
  const finding = await productionPathFinding(disposalRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      covered_elements: ["disposal_scope", "secure_disposal_method"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, quote);
});

test("production path rejects incident-impact destruction wording as disposal evidence", async () => {
  const disposalRequirement = {
    ...requirement,
    id: "disposal_consumer_customer_information",
    title: "Disposal of consumer and customer information",
    coverageElements: [
      { id: "disposal_scope", label: "Applies to consumer or customer information", requiredForCovered: true, signals: ["customer information"] },
      { id: "secure_disposal_method", label: "Requires secure disposal methods", requiredForCovered: true, signals: ["secure disposal"] },
    ],
    requiredElementsForCovered: ["disposal_scope", "secure_disposal_method"],
  };
  const quote = "For every suspected incident involving unauthorized access to customer information, the assessment identifies whether data was viewed, copied, altered, transmitted, or destroyed.";
  const finding = await productionPathFinding(disposalRequirement, [
    chunk({ content_preview: quote, section_path: "Incident assessment" }),
  ], [
    classifierClassification({
      covered_elements: ["disposal_scope", "secure_disposal_method"],
      supporting_quote: quote,
      reason: "The assessment describes destruction of customer information.",
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("production path does not use customer-notification negative evidence for incident assessment", async () => {
  const assessmentRequirement = {
    ...requirement,
    id: "incident_assessment_containment_control",
    title: "Incident assessment and containment",
    coverageElements: [
      { id: "assesses_scope", label: "Assesses unauthorized access", requiredForCovered: true, signals: ["assessment"] },
      { id: "customer_information_systems", label: "Identifies affected systems", requiredForCovered: true, signals: ["customer information systems"] },
      { id: "containment_control", label: "Contains the incident", requiredForCovered: true, signals: ["containment"] },
    ],
    requiredElementsForCovered: ["assesses_scope", "customer_information_systems", "containment_control"],
  };
  const quote =
    "This document does not define a customer notification decision standard for unauthorized access to or use of sensitive customer information.";
  const finding = await productionPathFinding(assessmentRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      relationship: "negative_evidence",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: [],
      missing_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("production path does not count limitation-only incident response text as positive partial support", async () => {
  const writtenRequirement = {
    ...requirement,
    id: "written_incident_response_program",
    title: "Written incident response program",
    coverageElements: [
      { id: "written_program", label: "Maintains a written incident response program", requiredForCovered: true, signals: ["written incident response program"] },
      { id: "customer_information_scope", label: "Applies to customer information", requiredForCovered: true, signals: ["customer information"] },
    ],
    requiredElementsForCovered: ["written_program", "customer_information_scope"],
  };
  const quote =
    "The list identifies teams, but it does not define a complete written incident response program for customer information events.";
  const finding = await productionPathFinding(writtenRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      relationship: "partially_supports",
      requirement_supported: false,
      covered_elements: ["written_program", "customer_information_scope"],
      missing_elements: [],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "missing");
  assert.equal(finding.evidence.length, 0);
});

test("production path still accepts substantive weak-document style policy sentences", async () => {
  const safeguardsRequirement = {
    ...requirement,
    id: "safeguards_customer_information",
    title: "Safeguards for customer information",
    coverageElements: [
      { id: "customer_information_scope", label: "Applies safeguards to customer information", requiredForCovered: true, signals: ["customer information repositories"] },
      { id: "safeguards_controls", label: "Defines safeguards", requiredForCovered: true, signals: ["access approval", "encryption"] },
    ],
    requiredElementsForCovered: ["customer_information_scope", "safeguards_controls"],
  };
  const quote =
    "Customer information repositories require access approval, periodic access review, and encryption for approved storage and transmission channels.";
  const finding = await productionPathFinding(safeguardsRequirement, [
    chunk({ content_preview: quote }),
  ], [
    classifierClassification({
      covered_elements: ["customer_information_scope", "safeguards_controls"],
      supporting_quote: quote,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].quote, quote);
});

test("findings generation schema and routes preserve workspace/security boundaries", async () => {
  const [migration, generator, route, generateRoute, securityHelper] = await Promise.all([
    readFile("supabase/migrations/016_create_findings_generation_tables.sql", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("app/api/findings/route.ts", "utf8"),
    readFile("app/api/findings/generate/route.ts", "utf8"),
    readFile("lib/documentSecurity.ts", "utf8"),
  ]);

  assert.match(migration, /Query name: 016_create_findings_generation_tables/);
  assert.match(migration, /create table if not exists public\.analysis_runs/);
  assert.match(migration, /analysis_runs_workspace_select/);
  assert.match(generator, /evidence_role === "organization_evidence"/);
  assert.match(generator, /createRequirementEvidenceClassifier/);
  assert.match(generator, /retrieveRequirementHybridChunks/);
  assert.match(route, /authenticateRequestOrSession/);
  assert.match(route, /getActorWorkspaceId/);
  assert.match(route, /get_analysis_report_state_v1/);
  assert.match(route, /analysis_run_documents/);
  assert.doesNotMatch(route, /workspace_id.*request/i);
  assert.match(securityHelper, /getServerSupabaseAuthClient/);
  assert.match(securityHelper, /export async function authenticateRequestOrSession/);
  assert.match(securityHelper, /authSource: "cookie"/);
  assert.match(securityHelper, /"authentication_required"/);
  assert.match(generateRoute, /authenticateRequest/);
  assert.match(generateRoute, /getActorWorkspaceId/);
  assert.match(generateRoute, /EmbeddingProcessingError/);
  assert.doesNotMatch(generateRoute, /workspace_id.*request/i);
  assert.doesNotMatch(generateRoute, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("findings generation keeps classifier source hydration cache invocation-local", async () => {
  const generator = await readFile("lib/findingsGeneration.ts", "utf8");
  const hydrationBody = generator.slice(
    generator.indexOf("async function hydrateSelectedClassifierCandidateSources"),
    generator.indexOf("function sourceQuoteForEvidence"),
  );
  const generationBody = generator.slice(
    generator.indexOf("export async function generateFindingsForWorkspace"),
  );

  assert.match(generator, /createClassifierSourceTextCache/);
  assert.match(hydrationBody, /hydrateSelectedCandidateSourceTextsWithCache/);
  assert.match(hydrationBody, /\.in\("id", chunkIds\)/);
  assert.match(generationBody, /const classifierSourceTextCache = createClassifierSourceTextCache\(\)/);
  assert.match(generationBody, /candidates: organizationCandidates,[\s\S]{0,100}sourceTextCache: classifierSourceTextCache/);
});

test("findings persistence stores primary evidence rows and guards completed runs", async () => {
  const generator = await readFile("lib/findingsGeneration.ts", "utf8");
  const storeFindingBody = generator.slice(
    generator.indexOf("async function storeFinding"),
    generator.indexOf("async function completeAnalysisRun"),
  );
  const generateBody = generator.slice(
    generator.indexOf("export async function generateFindingsForWorkspace"),
  );

  assert.match(generator, /export function evidenceRowsForInsert/);
  assert.match(generator, /function sourceQuoteForEvidence/);
  assert.match(generator, /evidence\.quote,\s*\n\s*evidence\.evidence_quote,\s*\n\s*evidence\.source_quote/);
  assert.match(generator, /quote: string;/);
  assert.match(generator, /evidence_quote: string;/);
  assert.match(generator, /workspace_id: workspaceId/);
  assert.match(generator, /document_id: evidence\.document_id \?\? null/);
  assert.match(generator, /chunk_id: evidence\.chunk_id \?\? null/);
  assert.match(generator, /chunk_index: evidence\.chunk_index \?\? null/);
  assert.match(generator, /relationship === "supports"/);
  assert.match(generator, /relationship === "partially_supports"/);
  assert.match(generator, /relationship === "negative_evidence"/);
  assert.match(storeFindingBody, /\.from\("finding_evidence"\)\s*\n\s*\.insert\(evidenceRows\)\s*\n\s*\.select\("id"\)/);
  assert.match(storeFindingBody, /finding_evidence_insert_failed/);
  assert.match(storeFindingBody, /finding_evidence_insert_incomplete/);
  assert.match(storeFindingBody, /finding_primary_evidence_missing/);
  assert.doesNotMatch(storeFindingBody, /if \(finding\.evidence\.length > 0\)/);
  assert.match(generator, /function assertCompletedRunHasPrimaryEvidence/);
  assert.match(generator, /analysis_primary_evidence_invariant_failed/);
  assert.match(generateBody, /const storedFindings: StoredFindingResult\[\] = \[\]/);
  assert.match(generateBody, /storedFindings\.push\(storedFinding\)/);
  assert.match(generateBody, /assertCompletedRunHasPrimaryEvidence\(storedFindings\);[\s\S]{0,240}await completeAnalysisRun/);
});

test("findings UI shows generation and empty states", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  assert.match(client, /Run Analysis/);
  assert.match(client, /Reviewing documents/);
  assert.match(client, /No documents ready for analysis yet/);
  assert.match(client, /No findings generated yet/);
  assert.match(client, /Prepare at least one document before running Analysis/);
  assert.match(client, /Client source excerpts/);
  assert.match(client, /\/api\/findings\/generate/);
  assert.match(client, /\/api\/findings/);
  assert.match(client, /High risk open/);
  assert.match(client, /View Requirement/);
  assert.match(client, /finding\.status !== "covered"/);
  assert.match(client, /Risk if unresolved:/);
  assert.match(client, /DEFAULT_VISIBLE_EVIDENCE_COUNT = 4/);
  assert.match(client, /Show additional source excerpts/);
  assert.match(client, /Show source excerpts/);
  assert.match(client, /Hide source excerpts/);
  assert.match(client, /let headers: HeadersInit \| undefined/);
  assert.match(client, /headers = \{ Authorization: `Bearer \$\{token\}` \}/);
  assert.match(client, /catch \{\s+headers = undefined;\s+\}/);
  assert.match(client, /background_context/);
  assert.match(client, /subdued/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY|EMBEDDING_API_KEY|OPENAI_API_KEY/);
});

test("findings UI displays stored client evidence rows and exact quote fallbacks", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");
  const route = await readFile("app/api/findings/route.ts", "utf8");
  const evidenceLookup = route.slice(route.indexOf('.from("finding_evidence")'), route.indexOf("if (evidenceError)"));

  assert.match(route, /\.from\("finding_evidence"\)/);
  assert.match(route, /quote, evidence_quote/);
  assert.match(route, /source_quote: row\.quote\?\.trim\(\) \? row\.quote : row\.evidence_quote/);
  assert.match(route, /get_analysis_report_state_v1/);
  assert.match(route, /invalidLatestRun/);
  assert.match(route, /\.eq\("analysis_run_id", latestRun\.id\)/);
  assert.match(evidenceLookup, /\.in\("finding_id", findingIds\)/);
  assert.match(evidenceLookup, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(route, /evidenceByFindingId\[finding\.id as string\] \?\? \[\]/);
  assert.match(client, /normalizeFindingEvidence/);
  assert.match(client, /finding_evidence\?: FindingEvidence\[\]/);
  assert.match(client, /findingEvidence\?: FindingEvidence\[\]/);
  assert.match(client, /source_excerpts\?: FindingEvidence\[\]/);
  assert.match(client, /\(body\.findings \?\? \[\]\)\.map\(normalizeFindingEvidence\)/);
  assert.match(client, /function sourceQuoteForEvidence/);
  assert.match(client, /evidence\.quote\?\.trim\(\)/);
  assert.match(client, /evidence\.evidence_quote\?\.trim\(\)/);
  assert.match(client, /evidence\.source_quote\?\.trim\(\)/);
  assert.match(client, /<EvidenceList evidence=\{finding\.evidence\} \/>/);
  assert.match(client, /finding\.evidence\.length === 0/);
});

test("findings UI handles real API-like evidence payload variants", async () => {
  const client = await readFile("components/FindingsClient.tsx", "utf8");

  const apiLikeEvidenceArray = {
    evidence: [{
      quote: "The procedure requires notice content.",
      evidence_quote: null,
      filename: "policy.pdf",
      page_start: 3,
      page_end: 4,
      section_path: "Incident response / Notice content",
      chunk_index: 12,
      relationship: "supports",
      confidence: "high",
    }],
  };
  const nestedRelationShape = {
    finding_evidence: [{
      quote: "",
      evidence_quote: "The procedure requires customer protective steps.",
      filename: "policy.pdf",
      page_start: 5,
      page_end: 5,
      section_path: "Notice content",
      chunk_index: 13,
      relationship: "partially_supports",
      confidence: "medium",
    }],
  };
  const camelCaseShape = {
    findingEvidence: [{
      quote: null,
      evidence_quote: null,
      source_quote: "Records are retained with the compliance file.",
      relationship: "supports",
      confidence: "high",
    }],
  };

  assert.equal(apiLikeEvidenceArray.evidence[0].quote, "The procedure requires notice content.");
  assert.equal(nestedRelationShape.finding_evidence[0].evidence_quote, "The procedure requires customer protective steps.");
  assert.equal(camelCaseShape.findingEvidence[0].source_quote, "Records are retained with the compliance file.");
  assert.match(client, /Array\.isArray\(finding\.evidence\)/);
  assert.match(client, /Array\.isArray\(finding\.finding_evidence\)/);
  assert.match(client, /Array\.isArray\(finding\.findingEvidence\)/);
  assert.match(client, /Array\.isArray\(finding\.source_excerpts\)/);
  assert.match(client, /sourceQuoteForEvidence\(evidence\)/);
  assert.doesNotMatch(client, /evidence\.quote \?\? evidence\.evidence_quote/);
  assert.match(client, /isExpanded \? "Hide source excerpts" : "Show source excerpts"/);
  assert.match(client, /onClick=\{\(\) => setIsExpanded\(\(current\) => !current\)\}/);
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

test("analysis lifecycle uses an active-only run lock, document snapshots, and a database evidence guard", async () => {
  const [migration, generator, retrieval, hybrid] = await Promise.all([
    readFile("supabase/migrations/020_fix_analysis_run_quota_and_lifecycle.sql", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
    readFile("lib/hybridRetrieval.ts", "utf8"),
  ]);

  assert.match(migration, /Query name: 020_fix_analysis_run_quota_and_lifecycle/);
  assert.match(migration, /create table if not exists public\.analysis_run_documents/);
  assert.match(migration, /where status = 'running'/);
  assert.match(migration, /and ar\.status = 'running'/);
  assert.doesNotMatch(migration, /status\s*!=\s*'failed'/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /idx_analysis_runs_one_active_per_workspace/);
  assert.match(migration, /d\.status in \('Processed', 'Ready'\)/);
  assert.match(migration, /complete_analysis_run_with_evidence_guard_v1/);
  assert.match(migration, /analysis_primary_evidence_invariant_failed/);
  assert.match(migration, /get_analysis_report_state_v1/);
  assert.match(migration, /match_analysis_run_document_chunks_v1/);

  assert.match(generator, /result\.result === "reused_active_run"/);
  assert.match(generator, /result\.result !== "started_new_run"/);
  assert.match(generator, /analysisRunId: runStart\.analysisRun\.id/);
  assert.match(generator, /analysisRunId: analysisRun\.id/);
  assert.match(generator, /complete_analysis_run_with_evidence_guard_v1/);
  assert.match(generator, /analysisRunId: analysisRun\.id,[\s\S]{0,100}findingCount/);

  assert.match(retrieval, /analysisRunId\?: string \| null/);
  assert.match(retrieval, /match_analysis_run_document_chunks_v1/);
  assert.match(hybrid, /\.from\("analysis_run_documents"\)/);
  assert.match(hybrid, /documentIds: snapshotDocumentIds/);
});

test("findings API and client reconcile active, previous, and invalid analysis states", async () => {
  const [route, generateRoute, client] = await Promise.all([
    readFile("app/api/findings/route.ts", "utf8"),
    readFile("app/api/findings/generate/route.ts", "utf8"),
    readFile("components/FindingsClient.tsx", "utf8"),
  ]);

  assert.match(route, /get_analysis_report_state_v1/);
  assert.match(route, /activeRun/);
  assert.match(route, /invalidLatestRun/);
  assert.match(route, /reviewedDocuments/);
  assert.match(route, /invalidCompletedAt > latestCompletedAt/);
  assert.match(generateRoute, /state: "reused_active_run"/);
  assert.match(generateRoute, /state: "completed"/);
  assert.match(generateRoute, /state: rateLimited\.status === 429 \? "rate_limited" : "configuration_error"/);

  assert.match(client, /const submissionInFlight = useRef\(false\)/);
  assert.match(client, /if \(isGenerating \|\| activeRun \|\| submissionInFlight\.current\) return/);
  assert.match(client, /setInterval\(\(\) => \{\s+void loadFindings\(\{ silent: true \}\)/);
  assert.match(client, /body\.state === "reused_active_run"/);
  assert.match(client, /Analysis is already running\. Showing live progress\./);
  assert.match(client, /activeRun && !error/);
  assert.match(client, /Previous analysis/);
  assert.match(client, /Documents reviewed/);
  assert.match(client, /const showMessage = useCallback\([\s\S]{0,120}setError\(""\)/);
  assert.match(client, /const showError = useCallback\([\s\S]{0,120}setMessage\(""\)/);
});
