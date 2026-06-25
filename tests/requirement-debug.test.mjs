import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal(strongOccurrences.length, 1);
  const strongReturnIndex = aggregateBlock.indexOf('status: "strong_match"');
  const beforeStrongReturn = aggregateBlock.slice(0, strongReturnIndex);
  assert.match(beforeStrongReturn, /if \(directCount >= 1\) \{/);
  assert.doesNotMatch(beforeStrongReturn, /partialCount >=/);
  assert.doesNotMatch(beforeStrongReturn, /backgroundCount >=/);
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
  assert.match(customerNotificationBlock, /customer notification/);
  assert.match(customerNotificationBlock, /sensitive customer information/);
  assert.match(customerNotificationBlock, /unauthorized access/);
  assert.match(customerNotificationBlock, /actionSignals: \["notify", "notification", "notice", "affected customers", "breach notification"\]/);
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
