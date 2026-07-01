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
  await writeFile(outPath, transpiled.outputText, "utf8");
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
  const matching = await readFile("lib/requirementMatching.ts", "utf8");

  assert.match(matching, /export type EvidenceGrade = "direct" \| "partial" \| "background" \| "irrelevant"/);
  assert.match(matching, /export type RequirementDebugStatus = "strong_match" \| "partial_match" \| "weak_match" \| "no_match"/);
  assert.match(matching, /isValidEvidenceGrade/);
  assert.match(matching, /isValidRequirementStatus/);
});

test("requirement debug output includes source type and evidence role", async () => {
  const [client, retrieval] = await Promise.all([
    readFile("components/RequirementDebugClient.tsx", "utf8"),
    readFile("lib/retrieval.ts", "utf8"),
  ]);

  assert.match(retrieval, /source_type: DocumentSourceType/);
  assert.match(retrieval, /evidence_role: EvidenceRole/);
  assert.match(retrieval, /inferDocumentSourceType/);
  assert.match(retrieval, /evidenceRoleForSourceType/);
  assert.match(client, /source_type: DocumentSourceType/);
  assert.match(client, /evidence_role: EvidenceRole/);
  assert.match(client, /formatSourceType/);
  assert.match(client, /formatEvidenceRole/);
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
  const matching = await readFile("lib/requirementMatching.ts", "utf8");

  assert.match(matching, /const hasExplicitAction = action\.count > 0/);
  assert.match(matching, /hasVendorIncidentHandlingContext/);
  assert.match(matching, /hasExplicitAction && hasVendorIncidentHandlingContext && direct\.count >= 2/);
  assert.match(matching, /direct\.count >= 1[\s\S]*grade: "partial"/);
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

test("requirement debug route uses authenticated workspace-scoped retrieval", async () => {
  const route = await readFile("app/api/requirement-debug/route.ts", "utf8");

  assert.match(route, /authenticateRequest/);
  assert.match(route, /getActorWorkspaceId/);
  assert.match(route, /retrieveRelevantChunks/);
  assert.match(route, /workspaceId,\s*\n\s*queryText: requirement\.retrievalQuery/);
  assert.match(route, /topK: parsed\.topK/);
});

test("requirement debug client does not expose server secrets", async () => {
  const client = await readFile("components/RequirementDebugClient.tsx", "utf8");

  assert.equal(client.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(client.includes("EMBEDDING_API_KEY"), false);
  assert.equal(client.includes("createEmbeddingProvider"), false);
  assert.match(client, /\/api\/requirement-debug/);
});
