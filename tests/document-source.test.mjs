import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("document source model exposes required source types and evidence roles", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  for (const sourceType of [
    "client_policy",
    "client_procedure",
    "vendor_contract",
    "regulatory_guidance",
    "control_framework",
    "sample_template",
    "unknown",
  ]) {
    assert.match(source, new RegExp(`"${sourceType}"`));
  }

  for (const role of [
    "organization_evidence",
    "requirement_reference",
    "supporting_context",
  ]) {
    assert.match(source, new RegExp(`"${role}"`));
  }
});

test("guidance and framework publishers are classified away from client policy evidence", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  assert.match(source, /nist/);
  assert.match(source, /ffiec/);
  assert.match(source, /ftc/);
  assert.match(source, /cisa/);
  assert.match(source, /return "control_framework"/);
  assert.match(source, /return "regulatory_guidance"/);

  const frameworkBlock = source.slice(
    source.indexOf("const controlFrameworkSignals"),
    source.indexOf("const sampleTemplateSignals"),
  );
  assert.doesNotMatch(frameworkBlock, /return "client_policy"/);
});

test("client policy, procedure, and vendor contract sources map to organization evidence", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  assert.match(source, /clientPolicySignals/);
  assert.match(source, /clientProcedureSignals/);
  assert.match(source, /vendorContractSignals/);
  assert.match(source, /sourceType === "client_policy"/);
  assert.match(source, /sourceType === "client_procedure"/);
  assert.match(source, /sourceType === "vendor_contract"/);
  assert.match(source, /return "organization_evidence"/);
});

test("guidance and framework source types map to requirement reference role", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  assert.match(source, /sourceType === "regulatory_guidance" \|\| sourceType === "control_framework"/);
  assert.match(source, /return "requirement_reference"/);
  assert.match(source, /return "supporting_context"/);
});
