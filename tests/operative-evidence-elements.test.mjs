import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateFindingForRequirement,
  canonicalElementIdsForFinalPositiveQuote,
} from "../lib/findingsAggregation.ts";
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

test("notice-content coverage requires material resources and written delivery for covered", () => {
  const definition = requirement("customer_notification_content");
  const complete = [
    "The clear and conspicuous written notice is delivered by mail or email.",
    "It describes the incident, identifies the categories of sensitive customer information involved, provides a toll-free contact number, and advises customers to monitor accounts for suspicious activity.",
    "The notice explains fraud alerts, nationwide credit reports, free report instructions, and Federal Trade Commission identity-theft resources.",
  ].join(" ");
  const incomplete = [
    "Customer notices describe the incident, identify the categories of information involved, and provide an estimated incident date when available.",
    "The notice directs customers to a toll-free response line and incident email address and advises customers to monitor accounts for suspicious activity.",
  ].join(" ");

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, complete, {
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, incomplete)]).status, "partial");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(
    definition,
    "Management coordinates customer communications after significant events.",
  )]).status, "missing");
});

test("assessment coverage requires direct assessment, affected-system, and containment actions", () => {
  const definition = requirement("unauthorized_access_detection_escalation");
  const complete = "The response team assesses the nature and scope of unauthorized access, identifies affected customer information systems and information types, and isolates affected systems to contain and control the incident.";
  const incomplete = "The response team reviews the security incident and records its operational impact.";
  const generic = "The incident lead opens a case, assigns severity, and coordinates assessment, containment, and closure.";

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, complete, {
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, incomplete)]).status, "partial");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, generic)]).status, "missing");
});

test("written incident-response program coverage excludes provider notice and narrower workflows", () => {
  const definition = requirement("written_incident_response_program");
  const complete = "The firm maintains a written incident response program for customer information that is designed to detect, respond to, and recover from unauthorized access or use.";
  const narrow = "The procedures address investigation, escalation, restoration of important services, and communication with management. Customer information events follow the same general workflow used for other cybersecurity incidents.";
  const providerOnly = "Service providers notify the firm within 72 hours after a breach involving a customer information system. The firm then initiates its incident response program.";

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, complete, {
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, narrow)]).status, "partial");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, providerOnly)]).status, "missing");
});

test("safeguards coverage requires administrative, technical, and physical safeguards", () => {
  const definition = requirement("customer_information_safeguards");
  const complete = "The written safeguards program protects customer information through administrative safeguards including training and access reviews, technical safeguards including encryption and multifactor authentication, and physical safeguards including locked facilities and visitor access controls.";
  const partial = "Customer data is protected through access restrictions, passwords, encryption, employee confidentiality obligations, access approval, and annual training.";

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, complete, {
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, partial)]).status, "partial");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(
    definition,
    "The organization follows generally accepted security practices.",
  )]).status, "missing");
});

test("incident evidence coverage requires a preservation process for covered", () => {
  const definition = requirement("evidence_log_preservation");
  const complete = "The incident response procedure requires preserving relevant access logs and investigation evidence for review, with a documented retention process and chain of custody.";
  const partial = "Teams retain emails and notes relating to significant incidents and provide them to Compliance upon request.";

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, complete, {
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, partial)]).status, "partial");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(
    definition,
    "The incident team documents its response activities.",
  )]).status, "missing");
});

test("recovery inventories cannot establish an operative recovery procedure", () => {
  const definition = requirement("remediation_recovery_validation");
  const complete = "System owners restore affected services, assign remediation owners and due dates, validate restored access and logging, and obtain closure approval after completion evidence is reviewed.";
  const partial = "System owners restore affected services after an incident.";
  const inventory = "Appendix A - Incident File Minimum Contents: investigation timeline, containment actions, recovery steps, corrective actions, validation results, and closure approval.";

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, complete, {
    evidence_relationship: "supports",
    requirement_supported: true,
  })]).status, "covered");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, partial)]).status, "partial");
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, inventory)]).status, "missing");
});

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

test("a bounded scoped records span includes a dependent final retention sentence", () => {
  const definition = requirement("written_compliance_records");
  const scope = "Compliance maintains records demonstrating implementation of the safeguards and disposal program.";
  const text = [
    scope,
    "The records include notification investigations, determinations, and copies of customer notices.",
    "These records are preserved for five years in an easily accessible place.",
  ].join(" ");
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    supporting_quote: scope,
  })]);

  assert.equal(finding.status, "covered");
  assert.match(finding.evidence[0].quote, /notification investigations/i);
  assert.match(finding.evidence[0].quote, /preserved for five years in an easily accessible place/i);
  assert.ok(finding.evidence[0].quote.length <= 1_800);
  assert.ok((finding.evidence[0].quote.match(/[^.!?]+[.!?]+/g) ?? []).length <= 8);
  assert.match(finding.evidence[0].reason, /written compliance records/i);
  assert.doesNotMatch(finding.remediation, /Add or update/i);
});

test("generic operational retention cannot extend an otherwise scoped records span", () => {
  const definition = requirement("written_compliance_records");
  const scope = "Compliance maintains records demonstrating implementation of the safeguards and disposal program.";
  const text = [
    scope,
    "Other operational records are retained according to department practice.",
  ].join(" ");
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text, {
    supporting_quote: scope,
  })]);

  assert.equal(finding.status, "partial");
  assert.doesNotMatch(finding.evidence[0].quote, /department practice/i);
  assert.equal(requirementSpecificElementMatch(definition.id, "retention_accessibility", text), false);
});

test("a complete recovery quote outranks a higher-confidence partial recovery-start quote", () => {
  const definition = requirement("remediation_recovery_validation");
  const recoveryStart = "Recovery begins after the response lead confirms that immediate containment is stable.";
  const completeProcedure = "The incident recovery procedure restores affected services, assigns remediation owners and due dates, validates restored access, and obtains closure approval after completion evidence is reviewed.";
  const finding = aggregateFindingForRequirement(definition, [
    gradedChunk(definition, recoveryStart, {
      chunk_id: "11111111-1111-4111-8111-111111111111",
      evidence_relationship: "partially_supports",
      classifier_confidence: "high",
      supporting_quote: recoveryStart,
    }),
    gradedChunk(definition, completeProcedure, {
      chunk_id: "22222222-2222-4222-8222-222222222222",
      evidence_relationship: "supports",
      classifier_confidence: "medium",
      requirement_supported: true,
      supporting_quote: completeProcedure,
    }),
  ]);

  assert.equal(finding.status, "covered");
  assert.equal(finding.evidence[0].relationship, "supports");
  assert.equal(finding.evidence[0].quote, completeProcedure);
  assert.match(finding.evidence[0].reason, /recovery steps/i);
  assert.match(finding.evidence[0].reason, /remediation/i);
  assert.match(finding.evidence[0].reason, /validates/i);
  assert.doesNotMatch(finding.remediation, /Add or update/i);
});

test("generic recovery-start language remains partial without remediation and validation", () => {
  const definition = requirement("remediation_recovery_validation");
  const text = "Recovery begins after the response lead confirms that immediate containment is stable.";

  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "partial");
});

test("contact authority alone does not cover external-notification coordination", () => {
  const definition = requirement("regulator_law_enforcement_notification");
  const text = "Only senior management may contact regulators or law-enforcement authorities. Employees should refer external inquiries to Legal.";

  assert.equal(requirementSpecificElementMatch(definition.id, "external_notification_decisioning", text), false);
  assert.equal(requirementSpecificElementMatch(definition.id, "legal_compliance_coordination", text), false);
  assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "missing");
});

test("incident-specific Legal delay and resumption coordination remains partial", () => {
  const definition = requirement("regulator_law_enforcement_notification");
  const text = [
    "Legal coordinates with regulators and law-enforcement agencies during significant incidents.",
    "Customer communications may be postponed when law enforcement requests a delay.",
    "Legal records the request and advises management when communications may resume.",
  ].join(" ");
  const finding = aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]);

  assert.equal(requirementSpecificElementMatch(definition.id, "legal_compliance_coordination", text), true);
  assert.equal(requirementSpecificElementMatch(definition.id, "external_notification_decisioning", text), false);
  assert.equal(finding.status, "partial");
  assert.equal(finding.evidence[0].relationship, "partially_supports");
  assert.match(finding.evidence[0].quote, /Legal coordinates with regulators/i);
  assert.match(finding.evidence[0].quote, /communications may be postponed/i);
  assert.deepEqual(
    canonicalElementIdsForFinalPositiveQuote(definition, finding.evidence[0].quote),
    ["legal_compliance_coordination"],
  );
  assert.match(finding.rationale, /who decides whether external notification is required/i);
  assert.match(finding.remediation, /Attorney General and Commission procedure/i);
});

test("generic regulator contact and delay language do not establish legal coordination", () => {
  const definition = requirement("regulator_law_enforcement_notification");
  for (const text of [
    "Legal serves as the regulatory contact.",
    "Compliance handles regulator communications.",
    "Customer communications may be delayed when appropriate.",
  ]) {
    assert.equal(requirementSpecificElementMatch(definition.id, "legal_compliance_coordination", text), false);
    assert.equal(requirementSpecificElementMatch(definition.id, "external_notification_decisioning", text), false);
    assert.equal(aggregateFindingForRequirement(definition, [gradedChunk(definition, text)]).status, "missing");
  }
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

test("assessment and recovery operative rules reject generic activity language", () => {
  const assessment = requirement("unauthorized_access_detection_escalation");
  const recovery = requirement("remediation_recovery_validation");
  const assessmentText = "Technology staff investigate alerts and may take systems offline when needed.";
  const recoveryText = "Technology repairs affected systems and resumes operations when management determines that service is stable.";

  assert.equal(requirementSpecificElementMatch(assessment.id, "containment_control", assessmentText), false);
  assert.equal(requirementSpecificElementMatch(recovery.id, "recovery_steps", recoveryText), false);
});
