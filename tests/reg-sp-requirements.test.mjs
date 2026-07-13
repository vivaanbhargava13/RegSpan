import assert from "node:assert/strict";
import test from "node:test";
import {
  REG_SP_REQUIREMENTS,
  REG_SP_REQUIREMENT_FUTURE_SCOPE,
  getRegSpRequirement,
} from "../lib/regSpRequirements.ts";

const vagueOnlyWords = /\b(cybersecurity|privacy|governance|compliance|risk management)\b/i;

test("every Reg S-P requirement has source basis and clear evidence criteria", () => {
  for (const requirement of REG_SP_REQUIREMENTS) {
    assert.ok(requirement.sourceBasis.length > 20, `${requirement.id} needs source basis`);
    assert.ok(
      ["direct_reg_s_p", "supporting_control", "future_scope"].includes(requirement.regulatoryRole),
      `${requirement.id} needs regulatory role`,
    );
    assert.ok(requirement.evidenceCriteria.lookFor.length > 40, `${requirement.id} needs look-for criteria`);
    assert.ok(requirement.evidenceCriteria.strongEvidence.length > 40, `${requirement.id} needs strong evidence criteria`);
    assert.ok(requirement.evidenceCriteria.partialEvidence.length > 40, `${requirement.id} needs partial evidence criteria`);
    assert.ok(requirement.evidenceCriteria.missingOrNegativeEvidence.length > 40, `${requirement.id} needs missing evidence criteria`);
    assert.ok(requirement.directSignals.length >= 5, `${requirement.id} needs concrete direct signals`);
    assert.ok(requirement.actionSignals.length >= 3, `${requirement.id} needs concrete action signals`);
    assert.notEqual(
      vagueOnlyWords.test(requirement.title) && requirement.directSignals.length < 5,
      true,
      `${requirement.id} cannot be only a vague buzzword`,
    );
  }
});

test("customer notification trigger is modeled precisely", () => {
  const requirement = getRegSpRequirement("customer_notification_unauthorized_access");
  assert.ok(requirement);
  const text = [
    requirement.title,
    requirement.description,
    requirement.evidenceCriteria.strongEvidence,
    requirement.retrievalQuery,
    requirement.directSignals.join(" "),
  ].join(" ");

  assert.match(text, /sensitive customer information/i);
  assert.match(text, /substantial harm/i);
  assert.match(text, /inconvenience/i);
  assert.match(text, /30 days/i);
  assert.match(text, /as soon as practicable/i);
  assert.equal(requirement.regulatoryRole, "direct_reg_s_p");
});

test("written compliance records are represented in MVP scope", () => {
  const requirement = getRegSpRequirement("written_compliance_records");
  assert.ok(requirement);
  assert.equal(requirement.regulatoryRole, "direct_reg_s_p");
  assert.equal(requirement.mvpScope, "mvp");
  assert.match(requirement.description, /written records/i);
  assert.match(requirement.evidenceCriteria.strongEvidence, /retention|notice|determinations/i);
  assert.match(requirement.sourceBasis, /recordkeeping|248\.30\(c\)/i);
});

test("service-provider coverage models the direct oversight, safeguards, and notice obligations", () => {
  const requirement = getRegSpRequirement("vendor_incident_handling");
  assert.ok(requirement);
  assert.deepEqual(requirement.requiredElementsForCovered, [
    "service_provider_scope",
    "provider_safeguards",
    "notice_to_firm",
  ]);
  assert.deepEqual(requirement.optionalElements, ["cooperation_remediation"]);
});

test("supporting guidance controls are not mislabeled as direct SEC obligations", () => {
  const evidencePreservation = getRegSpRequirement("evidence_log_preservation");
  const regulatorNotice = getRegSpRequirement("regulator_law_enforcement_notification");

  assert.ok(evidencePreservation);
  assert.ok(regulatorNotice);
  assert.equal(evidencePreservation.regulatoryRole, "supporting_control");
  assert.equal(regulatorNotice.regulatoryRole, "supporting_control");
  assert.match(evidencePreservation.sourceBasis, /not a standalone quoted Regulation S-P/i);
  assert.match(regulatorNotice.sourceBasis, /not create a broad standalone/i);
});

test("future-scope Reg S-P areas are documented outside the MVP requirement set", () => {
  const futureIds = REG_SP_REQUIREMENT_FUTURE_SCOPE.map((item) => item.id);

  assert.deepEqual(futureIds, [
    "annual_privacy_notice_exception",
    "transfer_agent_applicability",
  ]);
  assert.equal(getRegSpRequirement("annual_privacy_notice_exception"), null);
});
