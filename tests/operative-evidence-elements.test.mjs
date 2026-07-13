import assert from "node:assert/strict";
import test from "node:test";
import { aggregateFindingForRequirement } from "../lib/findingsAggregation.ts";
import { requirementSpecificElementMatch } from "../lib/operativeEvidenceRules.mjs";
import { getRegSpRequirement } from "../lib/regSpRequirements.ts";

function requirement(id) {
  const value = getRegSpRequirement(id);
  assert.ok(value, `missing requirement ${id}`);
  return value;
}

function gradedChunk(requirementDefinition, text, overrides = {}) {
  return {
    chunk_id: "11111111-1111-4111-8111-111111111111",
    document_id: "22222222-2222-4222-8222-222222222222",
    filename: "Policy.pdf",
    page_start: 1,
    page_end: 1,
    chunk_index: 0,
    section_path: "Policy section",
    content_preview: text,
    similarity: 0.9,
    evidence_reason: "substantive policy evidence",
    embedding_input: null,
    source_type: "client_policy",
    evidence_role: "organization_evidence",
    rerank_score: 90,
    rerank_reason: "direct evidence",
    grade: "partial",
    grade_reason: "The cited text is related.",
    negative_evidence: false,
    negative_evidence_reason: null,
    evidence_relationship: "partially_supports",
    classifier_confidence: "high",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: [],
    missing_elements: requirementDefinition.requiredElementsForCovered,
    vague_elements: [],
    supporting_quote: text,
    classifier_provider: "heuristic",
    ...overrides,
  };
}

test("discretionary customer communications do not establish a customer-notification trigger", () => {
  const definition = requirement("customer_notification_unauthorized_access");
  const text = "Customer communications may be issued when management considers them appropriate. Management determines the timing and audience for any customer communication based on the circumstances of the event.";

  assert.equal(requirementSpecificElementMatch(definition.id, "unauthorized_access_or_use", text), false);
  assert.equal(requirementSpecificElementMatch(definition.id, "notice_trigger_standard", text), false);
  assert.equal(requirementSpecificElementMatch(definition.id, "notice_timing", text), false);
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "missing");
});

test("an incomplete mandatory customer breach-notification obligation remains partial", () => {
  const definition = requirement("customer_notification_unauthorized_access");
  const text = "The firm must notify affected customers after a breach involving customer information.";
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]);

  assert.equal(finding.status, "partial");
  assert.deepEqual(
    requirementSpecificElementMatch(definition.id, "unauthorized_access_or_use", text),
    true,
  );
});

test("a notice presumption with a customer-information trigger and timing remains covered", () => {
  const definition = requirement("customer_notification_unauthorized_access");
  const text = [
    "Compliance determines whether notice is required whenever sensitive customer information was accessed or used without authorization.",
    "Notice is presumed unless a reasonable investigation supports a documented determination that the information is not likely to be used in a manner that would result in substantial harm or inconvenience.",
    "The firm provides notice as soon as practicable and no later than 30 days after becoming aware of unauthorized access to or use of customer information.",
  ].join(" ");

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
});

test("an internal service-provider coordinator role does not establish provider duties", () => {
  const definition = requirement("vendor_incident_handling");
  const text = "The service-provider owner coordinates vendor evidence, notices, remediation, and follow-up.";

  assert.equal(requirementSpecificElementMatch(definition.id, "service_provider_scope", text), false);
  assert.equal(requirementSpecificElementMatch(definition.id, "notice_to_firm", text), false);
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "missing");
});

test("operative provider safeguards and 72-hour notice remain covered", () => {
  const definition = requirement("vendor_incident_handling");
  const text = [
    "The firm must perform due diligence and ongoing monitoring of service providers handling customer information.",
    "Service providers must protect customer information and notify the firm within 72 hours of a breach.",
  ].join(" ");
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].reason, /due diligence and monitoring/i);
  assert.match(finding.evidence[0].reason, /notify the firm/i);
});

test("firm-enforced provider oversight remains operative without treating internal ownership as provider evidence", () => {
  const definition = requirement("vendor_incident_handling");
  const text = [
    "The firm maintains written procedures for due diligence and ongoing monitoring of service providers handling customer information.",
    "Oversight is designed to ensure that service providers protect against unauthorized access to customer information and notify the firm no later than 72 hours after a breach.",
  ].join(" ");

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
});

test("generic operational retention does not establish written compliance records", () => {
  const definition = requirement("written_compliance_records");
  const text = "Other operational records are retained according to department practice.";

  assert.equal(requirementSpecificElementMatch(definition.id, "retention_accessibility", text), false);
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "missing");
});

test("records documenting safeguards and disposal implementation remain covered", () => {
  const definition = requirement("written_compliance_records");
  const text = [
    "Compliance maintains true, accurate, and current records demonstrating implementation of the safeguards and disposal program.",
    "Customer-notice determinations and copies of notices are retained for six years in an easily accessible place.",
  ].join(" ");
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].reason, /written compliance records/i);
  assert.doesNotMatch(finding.evidence[0].reason, /additional required elements/i);
});

test("a scoped records program recognizes preserved multi-year accessible records", () => {
  const definition = requirement("written_compliance_records");
  const text = [
    "Compliance maintains records demonstrating implementation of the safeguards and disposal program.",
    "The records include notification investigations, determinations, and copies of customer notices.",
    "These records are preserved for five years in an easily accessible place.",
  ].join(" ");

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
});

test("contact authority alone does not cover external-notification coordination", () => {
  const definition = requirement("regulator_law_enforcement_notification");
  const text = "Only senior management may contact regulators or law-enforcement authorities. Employees should refer external inquiries to Legal.";

  assert.equal(requirementSpecificElementMatch(definition.id, "external_notification_decisioning", text), false);
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "missing");
});

test("incident-specific external-notification decisioning and legal coordination remain covered", () => {
  const definition = requirement("regulator_law_enforcement_notification");
  const text = "Following a security incident, Legal determines whether regulator notification is required and coordinates the required external reporting with Compliance.";
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].reason, /incident-specific external notification decisioning/i);
  assert.match(finding.evidence[0].reason, /legal or compliance/i);
});

test("the Attorney General and Commission customer-notice delay process remains covered", () => {
  const definition = requirement("regulator_law_enforcement_notification");
  const text = [
    "Legal determines whether communications with regulators or law-enforcement authorities are required and preserves related decisions.",
    "Customer notice may be delayed only when the United States Attorney General determines that notice poses a substantial risk to national security or public safety and notifies the Securities and Exchange Commission in writing.",
  ].join(" ");

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    grade: "direct",
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
});

test("targeted operative-element rules do not apply to assessment or recovery", () => {
  const assessment = requirement("unauthorized_access_detection_escalation");
  const recovery = requirement("remediation_recovery_validation");
  const assessmentText = "Technology staff investigate alerts and may take systems offline when needed.";
  const recoveryText = "Technology repairs affected systems and resumes operations when management determines that service is stable.";

  assert.equal(requirementSpecificElementMatch(assessment.id, "containment_control", assessmentText), null);
  assert.equal(requirementSpecificElementMatch(recovery.id, "recovery_steps", recoveryText), null);
});
