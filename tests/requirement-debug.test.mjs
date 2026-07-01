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
    .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"')
    .replaceAll('from "./requirementEvidenceClassifier"', 'from "./lib__requirementEvidenceClassifier.mjs"');
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
      .replaceAll('from "./negativeEvidence"', 'from "./lib__negativeEvidence.mjs"');
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

function organizationChunk(contentPreview) {
  return {
    ...retrievedChunk(contentPreview),
    filename: "Northstar Incident Response Policy.pdf",
    source_type: "client_policy",
    evidence_role: "organization_evidence",
  };
}

test("requirement debug defines the canonical Reg S-P baseline", async () => {
  const requirements = await readFile("lib/regSpRequirements.ts", "utf8");

  for (const id of [
    "written_incident_response_program",
    "unauthorized_access_detection_escalation",
    "customer_notification_unauthorized_access",
    "regulator_law_enforcement_notification",
    "vendor_incident_handling",
    "customer_information_safeguards",
    "evidence_log_preservation",
    "remediation_recovery_validation",
  ]) {
    assert.match(requirements, new RegExp(`id: "${id}"`));
  }

  const requirementCount = (requirements.match(/id: "/g) ?? []).length;
  assert.equal(requirementCount, 8);
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
  assert.match(retrieval, /inferDocumentSourceType/);
  assert.match(retrieval, /inferEvidenceRole/);
  assert.match(client, /source_type: DocumentSourceType/);
  assert.match(client, /evidence_role: EvidenceRole/);
  assert.match(client, /formatSourceType/);
  assert.match(client, /formatEvidenceRole/);
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
});

test("LLM classifier falls back to deterministic heuristic when requested but not configured", async () => {
  const { createRequirementEvidenceClassifier } = await loadTsModule("lib/requirementEvidenceClassifier.ts");
  const classifier = createRequirementEvidenceClassifier({
    REQUIREMENT_CLASSIFIER_PROVIDER: "openai",
  });

  assert.equal(classifier.provider, "fallback");
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
  assert.match(classifier, /hasExplicitAction && hasVendorIncidentHandlingContext && direct\.count >= 2/);
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
    "The organization should provide notice to affected individuals and consumers after unauthorized access to sensitive information or personal information.",
  ));

  assert.equal(graded.grade, "direct");
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
    "Teams should confirm remediation with a follow-up vulnerability scan, repeated testing, recovery capabilities validation, verify restored assets, corrective actions, lessons learned, and remediation tracking.",
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
    "Meridian maintains a written cyber event response standard approved by the Risk Committee and reviewed annually. The standard assigns decision authority, describes escalation, notice decisions, supplier coordination, evidence custody, corrective action tracking, restoration assurance, and final review.",
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
    "Vendor contracts must require prompt reporting of vendor incidents. Service providers must notify the organization of breaches and coordinate investigation and remediation.",
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
    "Covered supplier contracts must require prompt notice and reporting of supplier incidents, and the supplier shall notify security operations and cooperate with containment, investigation, evidence collection, remediation, and recovery.",
  ));
  const atlasPay = gradeRetrievedChunk(requirement, organizationChunk(
    "Supplier must notify AtlasPay promptly of any security incident, provide incident reports, and cooperate with investigation, containment, evidence preservation, remediation, and recovery activities.",
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
