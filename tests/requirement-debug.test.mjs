import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadTsModule(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const outDir = await mkdtemp(join(tmpdir(), "regspan-requirement-test-"));
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
    .replaceAll('from "./aiProcessingPolicy"', 'from "./lib__aiProcessingPolicy.mjs"')
    .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"')
    .replaceAll('from "./requirementEvidenceClassifier"', 'from "./lib__requirementEvidenceClassifier.mjs"')
    .replaceAll('from "./operativeEvidenceRules.mjs"', 'from "./lib__operativeEvidenceRules.mjs"');
  await writeFile(
    join(outDir, "lib__operativeEvidenceRules.mjs"),
    await readFile("lib/operativeEvidenceRules.mjs", "utf8"),
    "utf8",
  );
  if (sourcePath !== "lib/aiProcessingPolicy.ts") {
    const policySource = await readFile("lib/aiProcessingPolicy.ts", "utf8");
    const policyTranspiled = ts.transpileModule(policySource, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
      fileName: "lib/aiProcessingPolicy.ts",
    });
    await writeFile(join(outDir, "lib__aiProcessingPolicy.mjs"), policyTranspiled.outputText, "utf8");
  }
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
  if (sourcePath !== "lib/requirementEvidenceClassifier.ts") {
    const classifierSource = await readFile("lib/requirementEvidenceClassifier.ts", "utf8");
    const classifierTranspiled = ts.transpileModule(classifierSource, {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
      fileName: "lib/requirementEvidenceClassifier.ts",
    });
    const classifierOutput = classifierTranspiled.outputText
      .replaceAll('from "./aiProcessingPolicy"', 'from "./lib__aiProcessingPolicy.mjs"')
      .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"')
      .replaceAll('from "./operativeEvidenceRules.mjs"', 'from "./lib__operativeEvidenceRules.mjs"');
    await writeFile(join(outDir, "lib__requirementEvidenceClassifier.mjs"), classifierOutput, "utf8");
  }
  await writeFile(outPath, outputText, "utf8");
  return import(pathToFileURL(outPath).href);
}

function retrievedChunk(contentPreview) {
  return {
    chunk_id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    filename: "Public guidance.pdf",
    page_start: 1,
    page_end: 1,
    chunk_index: 0,
    section_path: "Guidance",
    content_preview: contentPreview,
    similarity: 0.9,
    evidence_reason: "substantive guidance evidence",
    embedding_input: null,
    source_type: "regulatory_guidance",
    evidence_role: "requirement_reference",
  };
}

function organizationChunk(contentPreview, overrides = {}) {
  return {
    ...retrievedChunk(contentPreview),
    filename: "Northstar Incident Response Policy.pdf",
    source_type: "client_policy",
    evidence_role: "organization_evidence",
    ...overrides,
  };
}

test("requirement debug defines the canonical Reg S-P baseline", async () => {
  const requirements = await readFile("lib/regSpRequirements.ts", "utf8");

  for (const id of [
    "written_incident_response_program",
    "unauthorized_access_detection_escalation",
    "customer_notification_unauthorized_access",
    "customer_notification_content",
    "vendor_incident_handling",
    "customer_information_safeguards",
    "disposal_consumer_customer_information",
    "written_compliance_records",
    "evidence_log_preservation",
    "remediation_recovery_validation",
    "regulator_law_enforcement_notification",
  ]) {
    assert.match(requirements, new RegExp(`id: "${id}"`));
  }

  const requirementCount = (requirements.match(/mvpScope: "/g) ?? []).length;
  assert.equal(requirementCount, 11);
  assert.match(requirements, /sourceBasis/);
  assert.match(requirements, /regulatoryRole/);
  assert.match(requirements, /evidenceCriteria/);
  assert.match(requirements, /retrievalQuery/);
  assert.match(requirements, /directSignals/);
  assert.match(requirements, /actionSignals/);
  assert.match(requirements, /partialSignals/);
  assert.match(requirements, /backgroundSignals/);
});

test("requirement debug grading schema exposes expected grades and statuses", async () => {
  const [matching, classifier] = await Promise.all([
    readFile("lib/requirementMatching.ts", "utf8"),
    readFile("lib/requirementEvidenceClassifier.ts", "utf8"),
  ]);

  assert.match(matching, /export type EvidenceGrade = "direct" \| "partial" \| "background" \| "irrelevant"/);
  assert.match(matching, /export type RequirementDebugStatus = "strong_match" \| "partial_match" \| "weak_match" \| "no_match"/);
  assert.match(matching, /isValidEvidenceGrade/);
  assert.match(matching, /isValidRequirementStatus/);
  assert.match(classifier, /supports/);
  assert.match(classifier, /partially_supports/);
  assert.match(classifier, /negative_evidence/);
  assert.match(classifier, /background_context/);
  assert.match(classifier, /requirement_supported/);
  assert.match(classifier, /control_absent_or_out_of_scope/);
});

test("requirement debug output includes source type and evidence role", async () => {
  const [client, retrieval] = await Promise.all([
    readFile("components/RequirementDebugClient.tsx", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
  ]);

  assert.match(retrieval, /source_type: DocumentSourceType/);
  assert.match(retrieval, /evidence_role: EvidenceRole/);
  assert.match(retrieval, /resolvePersistedDocumentChunkProvenance/);
  assert.match(client, /source_type: DocumentSourceType/);
  assert.match(client, /evidence_role: EvidenceRole/);
  assert.match(client, /formatSourceType/);
  assert.match(client, /formatEvidenceRole/);
});

test("post-processing expands a scoped records quote through its final retention sentence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find((item) => item.id === "written_compliance_records");
  assert.ok(requirement);
  const scope = "Compliance maintains records demonstrating implementation of the safeguards and disposal program.";
  const content = [
    scope,
    "The records include notification investigations, determinations, and copies of customer notices.",
    "These records are preserved for five years in an easily accessible place.",
  ].join(" ");
  const result = postProcessOpenAiClassification({
    relationship: "partially_supports",
    confidence: "high",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: ["compliance_record_scope", "notice_determination_records"],
    missing_elements: ["retention_accessibility"],
    vague_elements: [],
    reason: "The model found scoped records and notice records.",
    supporting_quote: scope,
  }, {
    requirement,
    evaluationGuidance: "Test guidance.",
    chunkContent: content,
    chunkMetadata: {
      filename: "Records procedure.pdf",
      sectionPath: "Program documentation",
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
      sourceType: "client_policy",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive policy evidence",
    },
  });

  assert.match(result.supporting_quote ?? "", /notification investigations/i);
  assert.match(result.supporting_quote ?? "", /preserved for five years in an easily accessible place/i);
  assert.deepEqual(result.covered_elements, [
    "compliance_record_scope",
    "notice_determination_records",
    "retention_accessibility",
  ]);
  assert.ok((result.supporting_quote ?? "").length <= 1_800);
  assert.ok(((result.supporting_quote ?? "").match(/[^.!?]+[.!?]+/g) ?? []).length <= 8);
});

test("post-processing preserves an incident-specific Legal delay procedure as partial evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find((item) => item.id === "regulator_law_enforcement_notification");
  assert.ok(requirement);
  const content = [
    "Legal coordinates with regulators and law-enforcement agencies during significant incidents.",
    "Customer communications may be postponed when law enforcement requests a delay.",
    "Legal records the request and advises management when communications may resume.",
  ].join(" ");

  const result = postProcessOpenAiClassification({
    relationship: "partially_supports",
    confidence: "high",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: ["legal_compliance_coordination"],
    missing_elements: ["external_notification_decisioning"],
    vague_elements: [],
    reason: "The procedure coordinates an authority-requested delay through Legal.",
    supporting_quote: content,
  }, {
    requirement,
    evaluationGuidance: "Test guidance.",
    chunkContent: content,
    chunkMetadata: {
      filename: "Incident response procedure.pdf",
      sectionPath: "External authority coordination",
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
      sourceType: "client_policy",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive policy evidence",
    },
  });

  assert.equal(result.relationship, "partially_supports");
  assert.deepEqual(result.covered_elements, ["legal_compliance_coordination"]);
  assert.ok(result.missing_elements.includes("external_notification_decisioning"));
  assert.match(result.supporting_quote ?? "", /Legal coordinates with regulators/i);
  assert.match(result.supporting_quote ?? "", /communications may be postponed/i);
});

test("requirement evidence classifier exposes prompt and provider abstraction", async () => {
  const classifier = await readFile("lib/requirementEvidenceClassifier.ts", "utf8");
  const envExample = await readFile(".env.example", "utf8");

  assert.match(classifier, /createRequirementEvidenceClassifier/);
  assert.match(classifier, /buildRequirementEvidenceClassifierPrompt/);
  assert.match(classifier, /REQUIREMENT_CLASSIFIER_PROVIDER/);
  assert.match(classifier, /REQUIREMENT_CLASSIFIER_MODEL/);
  assert.match(classifier, /REQUIREMENT_CLASSIFIER_API_KEY/);
  assert.match(classifier, /Do not treat keyword mentions as proof/);
  assert.match(classifier, /does not fully define customer notification/);
  assert.match(classifier, /customer notification is handled in a separate policy/);
  assert.match(classifier, /vendor incident reporting is outside the scope/);
  assert.match(envExample, /REQUIREMENT_CLASSIFIER_PROVIDER=heuristic/);
  assert.match(envExample, /REQUIREMENT_CLASSIFIER_MODEL=/);
  assert.match(envExample, /REQUIREMENT_CLASSIFIER_API_KEY=/);
  assert.match(envExample, /ENABLE_EXTERNAL_AI_PROCESSING=/);
  assert.match(envExample, /ENABLE_EXTERNAL_AI_CLASSIFIER=/);
});

test("LLM classifier falls back to deterministic heuristic when requested but not configured", async () => {
  const { createRequirementEvidenceClassifier } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  const classifier = createRequirementEvidenceClassifier({
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
    REQUIREMENT_CLASSIFIER_PROVIDER: "openai",
  });

  assert.equal(classifier.provider, "fallback");
});

test("classifier telemetry capture preserves deterministic classifications across all paths", async () => {
  const { createRequirementEvidenceClassifier } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  const input = {
    requirement: {
      id: "customer_notification_unauthorized_access",
      title: "Customer notification",
      description: "Notify affected customers after unauthorized access.",
      retrievalQuery: "customer notification unauthorized access",
      directSignals: ["customer notification"],
      actionSignals: ["notify"],
      topicSignals: ["customer"],
      partialSignals: [],
      backgroundSignals: [],
      coverageElements: [],
      requiredElementsForCovered: [],
      optionalElements: [],
    },
    evaluationGuidance: "Classify customer notification evidence.",
    chunkContent: "The policy requires customer notification after unauthorized access.",
    chunkMetadata: {
      filename: "policy.pdf",
      sectionPath: "Incident Response > Notification",
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
      sourceType: "client_policy",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive policy evidence",
    },
  };
  const openAiEnvironment = {
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
    REQUIREMENT_CLASSIFIER_PROVIDER: "openai",
    REQUIREMENT_CLASSIFIER_MODEL: "gpt-test",
    REQUIREMENT_CLASSIFIER_API_KEY: "test-key",
  };
  const enabledPolicy = {
    workspaceId: "workspace-1",
    workspaceConsentEnabled: true,
    externalAiProcessingEnabled: true,
    externalAiClassifierEnabled: true,
    denialReason: null,
  };
  const successResponse = async () => ({
    ok: true,
    async json() {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              relationship: "irrelevant",
              confidence: "low",
              requirement_supported: false,
              control_absent_or_out_of_scope: false,
              covered_elements: [],
              missing_elements: [],
              vague_elements: [],
              reason: "The chunk is not relevant.",
              supporting_quote: null,
            }),
          },
        }],
      };
    },
  });
  const fixtures = [
    {
      name: "heuristic disabled",
      environment: { REQUIREMENT_CLASSIFIER_PROVIDER: "heuristic" },
      fetchImplementation: async () => { throw new Error("fetch should not run"); },
      workspacePolicy: undefined,
      expectedProvider: "heuristic",
      expectedModel: null,
      expectedPath: "heuristic_disabled",
      fixtureInput: input,
    },
    {
      name: "heuristic unconfigured",
      environment: { ...openAiEnvironment, REQUIREMENT_CLASSIFIER_MODEL: "" },
      fetchImplementation: async () => { throw new Error("fetch should not run"); },
      workspacePolicy: enabledPolicy,
      expectedProvider: "fallback",
      expectedModel: null,
      expectedPath: "heuristic_unconfigured",
      fixtureInput: input,
    },
    {
      name: "negative guardrail",
      environment: openAiEnvironment,
      fetchImplementation: async () => { throw new Error("fetch should not run"); },
      workspacePolicy: enabledPolicy,
      expectedProvider: "openai",
      expectedModel: "gpt-test",
      expectedPath: "heuristic_negative_guardrail",
      fixtureInput: {
        ...input,
        chunkContent: "This procedure does not define customer notification after unauthorized access.",
      },
    },
    {
      name: "provider fallback",
      environment: openAiEnvironment,
      fetchImplementation: async () => ({ ok: false, status: 503 }),
      workspacePolicy: enabledPolicy,
      expectedProvider: "openai",
      expectedModel: "gpt-test",
      expectedPath: "fallback_provider_error",
      fixtureInput: input,
    },
    {
      name: "parse fallback",
      environment: openAiEnvironment,
      fetchImplementation: async () => ({ ok: true, async json() { return { choices: [] }; } }),
      workspacePolicy: enabledPolicy,
      expectedProvider: "openai",
      expectedModel: "gpt-test",
      expectedPath: "fallback_parse_error",
      fixtureInput: input,
    },
    {
      name: "OpenAI success",
      environment: openAiEnvironment,
      fetchImplementation: successResponse,
      workspacePolicy: enabledPolicy,
      expectedProvider: "openai",
      expectedModel: "gpt-test",
      expectedPath: "openai_success",
      fixtureInput: input,
    },
  ];

  for (const fixture of fixtures) {
    const withoutCapture = createRequirementEvidenceClassifier(
      fixture.environment,
      fixture.fetchImplementation,
      fixture.workspacePolicy,
    );
    const resolved = [];
    const paths = [];
    const withCapture = createRequirementEvidenceClassifier(
      fixture.environment,
      fixture.fetchImplementation,
      fixture.workspacePolicy,
      {
        recordResolvedClassifier(configuration) { resolved.push(configuration); },
        recordPath(path) { paths.push(path); },
      },
    );

    assert.deepEqual(
      await withCapture.classify(fixture.fixtureInput),
      await withoutCapture.classify(fixture.fixtureInput),
      fixture.name,
    );
    assert.deepEqual(resolved, [{ provider: fixture.expectedProvider, model: fixture.expectedModel }], fixture.name);
    assert.deepEqual(paths, [fixture.expectedPath], fixture.name);
  }
});

test("OpenAI classifier is blocked by server policy unless both AI flags are enabled", async () => {
  const { createRequirementEvidenceClassifier } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  let fetchCalled = false;
  const classifier = createRequirementEvidenceClassifier(
    {
      ENABLE_EXTERNAL_AI_PROCESSING: "true",
      ENABLE_EXTERNAL_AI_CLASSIFIER: "",
      REQUIREMENT_CLASSIFIER_PROVIDER: "openai",
      REQUIREMENT_CLASSIFIER_MODEL: "gpt-test",
      REQUIREMENT_CLASSIFIER_API_KEY: "test-key",
    },
    async () => {
      fetchCalled = true;
      return Response.json({});
    },
    {
      workspaceId: "workspace-1",
      workspaceConsentEnabled: true,
      externalAiProcessingEnabled: true,
      externalAiClassifierEnabled: false,
      denialReason: "server_policy_disabled",
    },
  );

  assert.equal(classifier.provider, "fallback");
  const result = await classifier.classify({
    requirement: {
      id: "customer_notification_unauthorized_access",
      title: "Customer notification",
      description: "Notify affected customers after unauthorized access.",
      retrievalQuery: "customer notification unauthorized access",
      directSignals: ["customer notification"],
      actionSignals: ["notify"],
      topicSignals: ["customer"],
      partialSignals: [],
      backgroundSignals: [],
    },
    evaluationGuidance: "Classify customer notification evidence.",
    chunkContent: "The policy requires customer notification after unauthorized access.",
    chunkMetadata: {
      filename: "policy.pdf",
      sectionPath: "Incident Response > Notification",
      pageStart: 1,
      pageEnd: 1,
      chunkIndex: 0,
      sourceType: "client_policy",
      evidenceRole: "organization_evidence",
      evidenceReason: "substantive policy evidence",
    },
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.classifier_provider, "fallback");
  assert.match(result.reason, /external AI classification is disabled by workspace and server policy/);
});

test("OpenAI classifier downgrades silence-only negative evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, {
    classifierInputForChunk,
    createRequirementEvidenceClassifier,
  }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const classifier = createRequirementEvidenceClassifier(
    {
      ENABLE_EXTERNAL_AI_PROCESSING: "true",
      ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
      REQUIREMENT_CLASSIFIER_PROVIDER: "openai",
      REQUIREMENT_CLASSIFIER_MODEL: "gpt-test",
      REQUIREMENT_CLASSIFIER_API_KEY: "test-key",
    },
    async () => ({
      ok: true,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                relationship: "negative_evidence",
                confidence: "high",
                requirement_supported: false,
                control_absent_or_out_of_scope: true,
                reason: "The chunk does not mention customer notification.",
                supporting_quote: "does not mention customer notification",
              }),
            },
          }],
        };
      },
    }),
    {
      workspaceId: "workspace-1",
      workspaceConsentEnabled: true,
      externalAiProcessingEnabled: true,
      externalAiClassifierEnabled: true,
      denialReason: null,
    },
  );

  const result = await classifier.classify(classifierInputForChunk(
    requirement,
    organizationChunk("Safeguards and Access Controls Customer information is protected through encryption, MFA, logging, and least privilege access."),
  ));

  assert.equal(result.classifier_provider, "openai");
  assert.equal(result.relationship, "irrelevant");
  assert.equal(result.requirement_supported, false);
  assert.equal(result.control_absent_or_out_of_scope, false);
  assert.equal(result.supporting_quote, null);
  assert.match(result.reason, /cannot be inferred from silence/);
});

test("OpenAI classifier preserves explicit absence and out-of-scope negative evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const customer = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const vendor = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );

  const customerText = "This procedure does not define customer notification after unauthorized access.";
  const vendorText = "Vendor incident reporting is outside the scope of this procedure.";
  const customerResult = postProcessOpenAiClassification({
    relationship: "negative_evidence",
    confidence: "high",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    reason: "The chunk explicitly states it does not define customer notification.",
    supporting_quote: customerText,
  }, classifierInputForChunk(customer, organizationChunk(customerText)));
  const vendorResult = postProcessOpenAiClassification({
    relationship: "negative_evidence",
    confidence: "high",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    reason: "The chunk states vendor incident reporting is outside the scope.",
    supporting_quote: vendorText,
  }, classifierInputForChunk(vendor, organizationChunk(vendorText)));

  assert.equal(customerResult.relationship, "negative_evidence");
  assert.equal(customerResult.control_absent_or_out_of_scope, true);
  assert.equal(customerResult.supporting_quote, customerText);
  assert.equal(vendorResult.relationship, "negative_evidence");
  assert.equal(vendorResult.control_absent_or_out_of_scope, true);
  assert.equal(vendorResult.supporting_quote, vendorText);
});

test("OpenAI classifier downgrades adjacent-control absence that is not about the requirement", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_information_safeguards",
  );
  const text = "This policy does not define customer notification or law enforcement reporting. Employees must protect business records from unauthorized disclosure.";

  const result = postProcessOpenAiClassification({
    relationship: "negative_evidence",
    confidence: "high",
    requirement_supported: false,
    control_absent_or_out_of_scope: true,
    reason: "The chunk explicitly states that the policy does not define customer notification, which implies safeguards are not established.",
    supporting_quote: "This policy does not define customer notification or law enforcement reporting.",
  }, classifierInputForChunk(requirement, organizationChunk(text)));

  assert.equal(result.relationship, "irrelevant");
  assert.equal(result.requirement_supported, false);
  assert.equal(result.control_absent_or_out_of_scope, false);
  assert.equal(result.supporting_quote, null);
  assert.match(result.reason, /adjacent controls/);
});

test("vendor 72-hour notice gap does not become incident assessment negative evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { classifyRequirementEvidenceHeuristically, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const incidentAssessment = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "unauthorized_access_detection_escalation",
  );
  const vendorNotice = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );
  const noticeContent = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_content",
  );
  const complianceRecords = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_compliance_records",
  );
  const text = "Service providers must escalate incidents promptly, but the policy does not establish a 72-hour notice expectation.";

  const incidentResult = classifyRequirementEvidenceHeuristically(
    classifierInputForChunk(incidentAssessment, organizationChunk(text)),
  );
  const vendorResult = classifyRequirementEvidenceHeuristically(
    classifierInputForChunk(vendorNotice, organizationChunk(text)),
  );
  const contentResult = classifyRequirementEvidenceHeuristically(
    classifierInputForChunk(noticeContent, organizationChunk(text)),
  );
  const recordsResult = classifyRequirementEvidenceHeuristically(
    classifierInputForChunk(complianceRecords, organizationChunk(text)),
  );

  assert.notEqual(incidentResult.relationship, "negative_evidence");
  assert.notEqual(incidentResult.relationship, "partially_supports");
  assert.equal(incidentResult.control_absent_or_out_of_scope, false);
  assert.equal(vendorResult.relationship, "negative_evidence");
  assert.deepEqual(vendorResult.missing_elements, ["notice_to_firm"]);
  assert.equal(vendorResult.supporting_quote, text);
  assert.notEqual(contentResult.relationship, "negative_evidence");
  assert.notEqual(contentResult.relationship, "partially_supports");
  assert.equal(contentResult.control_absent_or_out_of_scope, false);
  assert.notEqual(recordsResult.relationship, "negative_evidence");
  assert.notEqual(recordsResult.relationship, "partially_supports");
  assert.equal(recordsResult.control_absent_or_out_of_scope, false);
});

test("heading-only quotes cannot satisfy written incident response evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );
  const chunk = organizationChunk("Written incident response program");

  const result = postProcessOpenAiClassification({
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: requirement.requiredElementsForCovered,
    missing_elements: [],
    vague_elements: [],
    reason: "The heading says this is the written incident response program.",
    supporting_quote: "Written incident response program",
  }, classifierInputForChunk(requirement, chunk));

  assert.equal(result.relationship, "background_context");
  assert.equal(result.requirement_supported, false);
  assert.equal(result.supporting_quote, null);
});

test("substantive written incident response evidence is recovered below a heading", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );
  const sourceQuote =
    "The firm maintains a written cyber event response standard for customer information that assigns response and recovery responsibilities.";
  const chunk = organizationChunk(`Written incident response program\n${sourceQuote}`);

  const result = postProcessOpenAiClassification({
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: requirement.requiredElementsForCovered,
    missing_elements: [],
    vague_elements: [],
    reason: "The chunk supports the written incident response requirement.",
    supporting_quote: "Written incident response program",
  }, classifierInputForChunk(requirement, chunk));

  assert.equal(result.relationship, "supports");
  assert.equal(result.requirement_supported, true);
  assert.notEqual(result.supporting_quote, "Written incident response program");
  assert.match(result.supporting_quote, /written cyber event response standard/);
  assert.match(result.supporting_quote, /response and recovery responsibilities/);
});

test("limitation-only quotes are not partial support", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_content",
  );
  const text = "This policy does not define customer notification content requirements.";

  const result = postProcessOpenAiClassification({
    relationship: "partially_supports",
    confidence: "medium",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: ["incident_description"],
    missing_elements: ["information_involved", "protective_steps"],
    vague_elements: [],
    reason: "The text discusses notice content but is incomplete.",
    supporting_quote: text,
  }, classifierInputForChunk(requirement, organizationChunk(text)));

  assert.equal(result.relationship, "background_context");
  assert.equal(result.supporting_quote, null);
  assert.deepEqual(result.covered_elements, []);
});

test("OpenAI classifier replaces invented supporting quotes with extracted raw source quotes", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const chunk = organizationChunk(
    "Affected customers must be notified after unauthorized access to sensitive customer information that is reasonably likely to cause substantial harm or inconvenience, without unreasonable delay and no later than 30 days.",
  );

  const result = postProcessOpenAiClassification({
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: requirement.requiredElementsForCovered,
    missing_elements: [],
    vague_elements: [],
    reason: "The chunk supports customer notification.",
    supporting_quote: "The organization has a robust customer notice workflow.",
  }, classifierInputForChunk(requirement, chunk));

  assert.equal(result.relationship, "supports");
  assert.equal(result.requirement_supported, true);
  assert.equal(
    result.supporting_quote,
    "Affected customers must be notified after unauthorized access to sensitive customer information that is reasonably likely to cause substantial harm or inconvenience, without unreasonable delay and no later than 30 days.",
  );
  assert.notEqual(result.supporting_quote, "The organization has a robust customer notice workflow.");
});

test("generated classifier reasons cannot replace exact source quotes but raw quotes are recovered", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const chunk = organizationChunk("Legal must notify affected customers after unauthorized access to customer information.");

  const result = postProcessOpenAiClassification({
    relationship: "partially_supports",
    confidence: "medium",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: ["unauthorized_access_or_use"],
    missing_elements: ["notice_trigger_standard", "notice_timing"],
    vague_elements: [],
    reason: "Legal must notify affected customers after unauthorized access, but the timing element is missing.",
    supporting_quote: null,
  }, classifierInputForChunk(requirement, chunk));

  assert.equal(result.relationship, "partially_supports");
  assert.equal(result.supporting_quote, "Legal must notify affected customers after unauthorized access to customer information.");
  assert.notEqual(result.supporting_quote, result.reason);
  assert.deepEqual(result.covered_elements, ["unauthorized_access_or_use"]);
});

test("support without an extractable raw quote is downgraded", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const chunk = organizationChunk("This section lists communications governance contacts.");

  const result = postProcessOpenAiClassification({
    relationship: "supports",
    confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: requirement.requiredElementsForCovered,
    missing_elements: [],
    vague_elements: [],
    reason: "The generated reason says customer notification after unauthorized access is covered.",
    supporting_quote: null,
  }, classifierInputForChunk(requirement, chunk));

  assert.equal(result.relationship, "background_context");
  assert.equal(result.supporting_quote, null);
  assert.equal(result.covered_elements.length, 0);
  assert.match(result.reason, /must include an exact source quote/);
});

test("source quote extraction recovers real evidence across core requirements", async () => {
  const [{ REG_SP_REQUIREMENTS }, { postProcessOpenAiClassification, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const cases = [
    {
      id: "written_incident_response_program",
      text:
        "The firm maintains a written cyber event response standard for incidents involving customer information, designed to detect, respond to, and recover from unauthorized access or use. The standard assigns decision authority, describes escalation, notice decisions, supplier coordination, evidence custody, corrective action tracking, restoration assurance, recovery responsibilities, and final review.",
      relationship: "supports",
      covered: "all",
      missing: [],
      expectedQuote: /written cyber event response standard|assigns decision authority/,
    },
    {
      id: "evidence_log_preservation",
      text: "Responders must collect and preserve data, preserve evidence, maintain chain of custody, and retain forensic evidence and incident records for investigations.",
      relationship: "supports",
      covered: "all",
      missing: [],
      expectedQuote: /collect and preserve data/,
    },
    {
      id: "disposal_consumer_customer_information",
      text: "The firm must dispose of customer information after the records retention period expires.",
      relationship: "partially_supports",
      covered: ["disposal_scope"],
      missing: ["secure_disposal_method"],
      expectedQuote: /must dispose of customer information/,
    },
    {
      id: "customer_information_safeguards",
      text: "Customer information repositories require access approval, periodic access review, encryption, authentication, least privilege controls, and physical safeguards including locked facilities and visitor access controls.",
      relationship: "supports",
      covered: "all",
      missing: [],
      expectedQuote: /access approval, periodic access review, encryption/,
    },
    {
      id: "remediation_recovery_validation",
      text: "The incident team restores affected systems and validates recovery before closure.",
      relationship: "partially_supports",
      covered: ["recovery_steps", "validation_testing"],
      missing: ["remediation_tracking"],
      expectedQuote: /validates recovery before closure/,
    },
  ];

  for (const testCase of cases) {
    const requirement = REG_SP_REQUIREMENTS.find((item) => item.id === testCase.id);
    const coveredElements = testCase.covered === "all"
      ? requirement.requiredElementsForCovered
      : testCase.covered;
    const result = postProcessOpenAiClassification({
      relationship: testCase.relationship,
      confidence: "high",
      requirement_supported: testCase.relationship === "supports",
      control_absent_or_out_of_scope: false,
      covered_elements: coveredElements,
      missing_elements: testCase.missing,
      vague_elements: [],
      reason: "The model identified support but omitted the exact quote.",
      supporting_quote: null,
    }, classifierInputForChunk(requirement, organizationChunk(testCase.text)));

    assert.equal(result.relationship, testCase.relationship);
    assert.match(result.supporting_quote ?? "", testCase.expectedQuote);
    assert.equal(testCase.text.includes(result.supporting_quote ?? ""), true);
  }
});

test("synopsis and embedding input cannot satisfy findings without raw chunk evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { classifyRequirementEvidenceHeuristically, classifierInputForChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementEvidenceClassifier.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_content",
  );
  const chunk = organizationChunk("This section provides general communications background.", {
    section_path: "Customer notification content requirements",
    embedding_input: [
      "Section: Customer notification content requirements",
      "Retrieval synopsis: Notices include incident description, information involved, fraud alerts, credit reports, and contact information.",
      "",
      "This section provides general communications background.",
    ].join("\n"),
  });

  const result = classifyRequirementEvidenceHeuristically(
    classifierInputForChunk(requirement, chunk),
  );

  assert.notEqual(result.relationship, "supports");
  assert.notEqual(result.relationship, "partially_supports");
  assert.equal(result.relationship, "background_context");
  assert.equal(result.requirement_supported, false);
  assert.equal(result.covered_elements.length, 0);
});

test("requirement debug has no old satisfied display/status text", async () => {
  const [matching, client, docs] = await Promise.all([
    readFile("lib/requirementMatching.ts", "utf8"),
    readFile("components/RequirementDebugClient.tsx", "utf8"),
    readFile("docs/requirement-debug-eval.md", "utf8"),
  ]);

  assert.equal(matching.includes("satisfied"), false);
  assert.equal(client.includes("Satisfied"), false);
  assert.equal(client.includes("satisfied"), false);
  assert.equal(docs.includes("satisfied"), false);
});

test("requirement debug status labels render debug-safe wording", async () => {
  const client = await readFile("components/RequirementDebugClient.tsx", "utf8");

  assert.match(client, /strong_match: "Strong match"/);
  assert.match(client, /partial_match: "Partial match"/);
  assert.match(client, /weak_match: "Weak match"/);
  assert.match(client, /no_match: "No match"/);
  assert.match(client, /function formatStatusLabel/);
});

test("requirement cards render collapsed by default with quick controls", async () => {
  const client = await readFile("components/RequirementDebugClient.tsx", "utf8");

  assert.match(client, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(client, /setExpandedRequirementIds\(new Set\(\)\)/);
  assert.match(client, /Expand all requirements/);
  assert.match(client, /Collapse all requirements/);
  assert.match(client, /Show only weak\/no-match requirements/);
  assert.match(client, /isExpanded \? \(/);
  assert.match(client, /aria-expanded=\{isExpanded\}/);
});

test("evidence buckets and chunk text are collapsed by default", async () => {
  const client = await readFile("components/RequirementDebugClient.tsx", "utf8");

  assert.match(client, /<details className="group rounded-2xl border border-app-border bg-app-elevated\/45">/);
  assert.match(client, /Read chunk text/);
  assert.match(client, /<details className="mt-3 rounded-lg border border-app-border bg-app-elevated\/35">/);
  assert.match(client, /chunk\.content_preview/);
});

test("strong_match requires direct evidence", async () => {
  const matching = await readFile("lib/requirementMatching.ts", "utf8");
  const aggregateBlock = matching.slice(
    matching.indexOf("export function aggregateRequirementStatus"),
    matching.indexOf("export function buildRequirementMatchResult"),
  );

  const strongOccurrences = aggregateBlock.match(/status: "strong_match"/g) ?? [];
  assert.equal(strongOccurrences.length, 2);
  const strongReturnIndex = aggregateBlock.indexOf('status: "strong_match"');
  const beforeStrongReturn = aggregateBlock.slice(0, strongReturnIndex);
  assert.match(beforeStrongReturn, /if \(directCount >= 1\) \{/);
  assert.doesNotMatch(beforeStrongReturn, /partialCount >=/);
  assert.doesNotMatch(beforeStrongReturn, /backgroundCount >=/);
});

test("guidance-only direct evidence is strong debug match but not client compliance proof", async () => {
  const matching = await readFile("lib/requirementMatching.ts", "utf8");

  assert.match(matching, /directOrganizationEvidenceCount/);
  assert.match(matching, /directReferenceEvidenceCount/);
  assert.match(matching, /guidance\/reference evidence/);
  assert.match(matching, /not proof of client compliance/);
  assert.match(matching, /direct organization evidence/);
});

test("vendor direct grading requires explicit incident handling language", async () => {
  const requirements = await readFile("lib/regSpRequirements.ts", "utf8");
  const vendorBlock = requirements.slice(
    requirements.indexOf('id: "vendor_incident_handling"'),
    requirements.indexOf('id: "customer_information_safeguards"'),
  );

  assert.match(vendorBlock, /vendor notification/);
  assert.match(vendorBlock, /service provider notification/);
  assert.match(vendorBlock, /vendor breach/);
  assert.match(vendorBlock, /service provider responsibilities/);
  assert.match(vendorBlock, /actionSignals/);
  assert.match(vendorBlock, /escalation/);
  assert.match(vendorBlock, /coordination/);
  assert.doesNotMatch(vendorBlock, /"service provider",\n\s+"vendor incident"/);
});

test("third-party role background alone is not enough for direct grading", async () => {
  const classifier = await readFile("lib/requirementEvidenceClassifier.ts", "utf8");

  assert.match(classifier, /const hasExplicitAction = action\.count > 0/);
  assert.match(classifier, /hasVendorIncidentHandlingContext/);
  assert.match(classifier, /hasCompleteOperativeCoverage/);
  assert.match(classifier, /hasExplicitAction && direct\.count >= 2/);
  assert.match(classifier, /direct\.count >= 1[\s\S]*relationship: "partially_supports"/);
});

test("customer notification explicit language remains direct-capable", async () => {
  const requirements = await readFile("lib/regSpRequirements.ts", "utf8");
  const customerNotificationBlock = requirements.slice(
    requirements.indexOf('id: "customer_notification_unauthorized_access"'),
    requirements.indexOf('id: "regulator_law_enforcement_notification"'),
  );

  assert.match(customerNotificationBlock, /notify affected customers/);
  assert.match(customerNotificationBlock, /notify affected individuals/);
  assert.match(customerNotificationBlock, /notify consumers/);
  assert.match(customerNotificationBlock, /customer notification/);
  assert.match(customerNotificationBlock, /sensitive customer information/);
  assert.match(customerNotificationBlock, /personal information/);
  assert.match(customerNotificationBlock, /unauthorized access/);
  assert.match(customerNotificationBlock, /breach notification/);
});

test("customer notification reference language can grade direct when explicit", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );

  const graded = gradeRetrievedChunk(requirement, retrievedChunk(
    "The organization must provide notice to affected individuals after unauthorized access to sensitive customer information when the incident is reasonably likely to result in substantial harm or inconvenience. Notice must be sent as soon as practicable and not later than 30 days.",
  ));

  assert.equal(graded.grade, "direct");
  assert.deepEqual(graded.missing_elements, []);
});

test("generic customer notice language does not cover notice-content requirement", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_content",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "The firm will notify affected customers after a qualifying security incident.",
  ));

  assert.notEqual(graded.grade, "direct");
  assert.equal(graded.missing_elements.includes("incident_description"), true);
  assert.equal(graded.missing_elements.includes("information_involved"), true);
  assert.equal(graded.missing_elements.includes("protective_steps"), true);
});

test("notice-content evidence covers customer notification content", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_content",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "Clear and conspicuous written notices delivered by mail or email must include a description of the incident, the type of sensitive customer information involved, the incident date range, contact information, and protective steps such as fraud alert placement, nationwide credit report and free report instructions, account statement monitoring, and Federal Trade Commission identity theft resources.",
  ));

  assert.equal(graded.grade, "direct");
  assert.deepEqual(graded.missing_elements, []);
});

test("generic safeguards do not cover disposal but disposal evidence does", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "disposal_consumer_customer_information",
  );

  const generic = gradeRetrievedChunk(requirement, organizationChunk(
    "The firm protects customer information with access controls, authentication, monitoring, and encryption.",
  ));
  const disposal = gradeRetrievedChunk(requirement, organizationChunk(
    "The firm must properly dispose of consumer information and customer information through secure disposal, secure destruction, shredding, wiping, or media sanitization.",
  ));

  assert.notEqual(generic.grade, "direct");
  assert.equal(disposal.grade, "direct");
});

test("safeguards support with nearby limitation is partial support, not negative evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_information_safeguards",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    [
      "Customer information repositories require access approval, periodic access review, encryption, authentication, and least privilege controls.",
      "This policy does not fully define customer information safeguards ownership.",
    ].join(" "),
  ));

  assert.equal(graded.grade, "partial");
  assert.equal(graded.evidence_relationship, "partially_supports");
  assert.equal(graded.negative_evidence, false);
  assert.equal(graded.control_absent_or_out_of_scope, false);
  assert.deepEqual(graded.covered_elements, [
    "customer_information_scope",
    "safeguards_controls",
    "administrative_safeguards",
    "technical_safeguards",
  ]);
  assert.match(graded.supporting_quote, /Customer information repositories require access approval/);
  assert.doesNotMatch(graded.supporting_quote ?? "", /does not fully define/);
});

test("adjacent limitation language does not contaminate a safeguards support quote", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_information_safeguards",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    [
      "Customer information repositories require access approval, periodic access review, encryption, authentication, and least privilege controls.",
      "This policy does not fully define customer notification timing.",
    ].join(" "),
  ));

  assert.notEqual(graded.evidence_relationship, "negative_evidence");
  assert.equal(graded.negative_evidence, false);
  assert.match(graded.supporting_quote, /Customer information repositories require access approval/);
  assert.doesNotMatch(graded.supporting_quote ?? "", /customer notification timing/);
});

test("generic logging does not cover written compliance records but recordkeeping evidence does", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_compliance_records",
  );

  const generic = gradeRetrievedChunk(requirement, organizationChunk(
    "Security tools retain system logs for investigations.",
  ));
  const records = gradeRetrievedChunk(requirement, organizationChunk(
    "The firm must make and maintain written records documenting compliance, including the determination made for customer notice, a copy of any notice transmitted, policies and procedures in effect, and retention for six years in an easily accessible place.",
  ));

  assert.notEqual(generic.grade, "direct");
  assert.equal(records.grade, "direct");
});

test("internal escalation does not cover vendor notice but vendor notice and cooperation does", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );

  const internal = gradeRetrievedChunk(requirement, organizationChunk(
    "The internal incident team escalates supplier-related issues to management.",
  ));
  const vendor = gradeRetrievedChunk(requirement, organizationChunk(
    "The firm performs due diligence and ongoing monitoring of service providers and suppliers that handle customer information, requires them to protect against unauthorized access to or use of that information, and requires them to notify the firm no later than 72 hours after a breach.",
  ));

  assert.notEqual(internal.grade, "direct");
  assert.equal(vendor.grade, "direct");
});

test("evidence and log preservation reference language can grade direct when explicit", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "evidence_log_preservation",
  );

  const graded = gradeRetrievedChunk(requirement, retrievedChunk(
    "Responders must collect and preserve data, preserve evidence, maintain chain of custody, and retain forensic evidence and incident records for investigations.",
  ));

  assert.equal(graded.grade, "direct");
});

test("remediation and recovery validation reference language can grade direct when explicit", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "remediation_recovery_validation",
  );

  const graded = gradeRetrievedChunk(requirement, retrievedChunk(
    "The recovery procedure restores affected services, assigns remediation owners and due dates, validates restored assets through follow-up testing, and records closure approval.",
  ));

  assert.equal(graded.grade, "direct");
});

test("vendor direct grading remains conservative for generic third-party assistance", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );

  const graded = gradeRetrievedChunk(requirement, retrievedChunk(
    "Third parties may assist the incident response team during analysis and recovery activities.",
  ));

  assert.notEqual(graded.grade, "direct");
});

test("written incident response negative language is not direct evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This procedure does not define a written incident response program and is reserved for another policy.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
  assert.match(graded.grade_reason, /Negative evidence/);
});

test("equivalent written cyber event response standard grades direct when maintained and governed", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "The firm maintains a written cyber event response standard for incidents involving customer information, designed to detect, respond to, and recover from unauthorized access or use. The standard assigns decision authority, describes escalation, notice decisions, supplier coordination, evidence custody, corrective action tracking, restoration assurance, recovery responsibilities, and final review.",
  ));

  assert.equal(graded.grade, "direct");
  assert.equal(graded.negative_evidence, false);
});

test("customer notification absence language is not direct evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This policy does not establish customer notification after unauthorized access to customer information.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
});

test("unseen absence language is classified as negative evidence without exact phrase rules", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const customer = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const regulator = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "regulator_law_enforcement_notification",
  );
  const vendor = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );
  const replacement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );

  const cases = [
    [
      customer,
      "This procedure does not fully define customer notification after unauthorized access; customer notification is handled in a separate policy.",
    ],
    [
      regulator,
      "This document excludes law enforcement reporting and regulator notification from its workflow.",
    ],
    [
      vendor,
      "Vendor incident reporting is outside the scope of this procedure and delegated to a separate supplier governance document.",
    ],
    [
      replacement,
      "This addendum does not replace internal incident response procedures or the enterprise cyber event response standard.",
    ],
  ];

  for (const [requirement, text] of cases) {
    const graded = gradeRetrievedChunk(requirement, organizationChunk(text));
    assert.equal(graded.grade, "irrelevant");
    assert.equal(graded.negative_evidence, true);
    assert.equal(graded.evidence_relationship, "negative_evidence");
    assert.equal(graded.control_absent_or_out_of_scope, true);
    assert.equal(graded.requirement_supported, false);
  }
});

test("regulator and law enforcement absence language is not direct evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "regulator_law_enforcement_notification",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This standard does not establish regulator notification or law enforcement reporting requirements.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
});

test("vendor absence language is not direct or positive partial evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This policy does not impose service-provider incident reporting obligations or vendor notification responsibilities.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
});

test("strong vendor incident handling policy language remains direct evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "Vendor contracts must require due diligence and monitoring of service providers, safeguards that protect customer information against unauthorized access to or use, and notice to the organization no later than 72 hours after a breach. Service providers coordinate investigation and remediation.",
  ));

  assert.equal(graded.grade, "direct");
  assert.equal(graded.negative_evidence, false);
});

test("remediation recovery validation absence language is not direct evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "remediation_recovery_validation",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This recovery checklist does not require repeated testing or formal recovery validation after remediation.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
});

test("multi-control limitation text is negative for written program evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This appendix does not define formal evidence preservation, recovery validation, or a written incident response plan; those topics are reserved for separate governance documents.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
  assert.match(graded.negative_evidence_reason, /does not define/);
});

test("multi-control limitation text is negative for preservation and recovery evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const preservation = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "evidence_log_preservation",
  );
  const recovery = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "remediation_recovery_validation",
  );
  const text = "This appendix does not define formal evidence preservation, recovery validation, or a written incident response plan; those topics are reserved for separate governance documents.";

  const preservationGrade = gradeRetrievedChunk(preservation, organizationChunk(text));
  const recoveryGrade = gradeRetrievedChunk(recovery, organizationChunk(text));

  assert.equal(preservationGrade.grade, "irrelevant");
  assert.equal(preservationGrade.negative_evidence, true);
  assert.equal(recoveryGrade.grade, "irrelevant");
  assert.equal(recoveryGrade.negative_evidence, true);
});

test("breach notice and supplier obligation limitation text is negative evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const customer = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "customer_notification_unauthorized_access",
  );
  const regulator = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "regulator_law_enforcement_notification",
  );
  const vendor = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );
  const text = "This workflow does not authorize customer breach notices, regulator reports, law enforcement reports, or supplier notification obligations.";

  for (const requirement of [customer, regulator, vendor]) {
    const graded = gradeRetrievedChunk(requirement, organizationChunk(text));
    assert.equal(graded.grade, "irrelevant");
    assert.equal(graded.negative_evidence, true);
  }
});

test("not-enterprise-plan and does-not-replace phrasing is negative for written program evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This checklist is not the enterprise cyber incident response plan and does not replace the written incident response program.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
});

test("negated cyber event response standard names do not become direct evidence", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "written_incident_response_program",
  );

  const graded = gradeRetrievedChunk(requirement, organizationChunk(
    "This job aid is not a cyber incident response program and does not define a cyber event response standard or breach response standard.",
  ));

  assert.equal(graded.grade, "irrelevant");
  assert.equal(graded.negative_evidence, true);
});

test("supplier contract reporting and cooperation obligations grade direct for vendor handling", async () => {
  const [{ REG_SP_REQUIREMENTS }, { gradeRetrievedChunk }] = await Promise.all([
    loadTsModule("lib/regSpRequirements.ts"),
    loadTsModule("lib/requirementMatching.ts"),
  ]);
  const requirement = REG_SP_REQUIREMENTS.find(
    (item) => item.id === "vendor_incident_handling",
  );

  const meridian = gradeRetrievedChunk(requirement, organizationChunk(
    "Covered supplier contracts must require due diligence and monitoring of service providers, safeguards that protect customer information against unauthorized access to or use, and notice to the firm no later than 72 hours after a supplier breach. The supplier shall notify security operations and cooperate with containment, investigation, evidence collection, remediation, and recovery.",
  ));
  const atlasPay = gradeRetrievedChunk(requirement, organizationChunk(
    "AtlasPay performs due diligence and monitoring of suppliers handling customer information and requires suppliers to protect customer information against unauthorized access to or use and notify AtlasPay no later than 72 hours after a security incident. Suppliers cooperate with investigation, containment, evidence preservation, remediation, and recovery activities.",
  ));

  assert.equal(meridian.grade, "direct");
  assert.equal(atlasPay.grade, "direct");
  assert.equal(meridian.negative_evidence, false);
  assert.equal(atlasPay.negative_evidence, false);
});

test("requirement debug route uses authenticated workspace-scoped retrieval", async () => {
  const route = await readFile("app/api/requirement-debug/route.ts", "utf8");

  assert.match(route, /authenticateRequest/);
  assert.match(route, /getActorWorkspaceId/);
  assert.match(route, /retrieveRequirementHybridChunks/);
  assert.match(route, /workspaceId,\s*\n\s*requirement,/);
  assert.match(route, /topK: parsed\.topK/);
});

test("requirement debug client does not expose server secrets", async () => {
  const client = await readFile("components/RequirementDebugClient.tsx", "utf8");

  assert.equal(client.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(client.includes("EMBEDDING_API_KEY"), false);
  assert.equal(client.includes("createEmbeddingProvider"), false);
  assert.match(client, /\/api\/requirement-debug/);
});
