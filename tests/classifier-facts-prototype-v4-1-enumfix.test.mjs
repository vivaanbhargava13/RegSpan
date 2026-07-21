import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const fixturePath = resolve("eval-fixtures/classifier-capability/fixtures.v2.json");
const loader = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];

async function schemas() {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", `
    import { readFile } from "node:fs/promises";
    import { buildV41ExtractionRequests, inspectV41Schema } from "./lib/classifierFactsPrototypeV41.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    console.log(JSON.stringify(buildV41ExtractionRequests(fixtures).map(request=>({requirement_id:request.requirement_id,body:request.body,metrics:inspectV41Schema(request.body.response_format.json_schema.schema)}))));
  `], { cwd: root });
  return JSON.parse(stdout);
}

function priorRequests() {
  return readFile(resolve("eval-results/classifier-facts-prototype/v4-1-namefix/dry-run.json"), "utf8").then(JSON.parse);
}

test("V4.1 enum fix defines the fact schema once and all fact arrays use its ref", async () => {
  for (const request of await schemas()) {
    const schema = request.body.response_format.json_schema.schema;
    assert.deepEqual(Object.keys(schema.$defs), ["fact"]);
    assert.equal(request.metrics.definition_count, 1);
    const units = Object.values(schema.properties.units.properties);
    assert.equal(request.metrics.ref_count, units.length * 2);
    for (const unit of units) {
      for (const branch of unit.anyOf) {
        assert.deepEqual(branch.properties.facts.items, { $ref: "#/$defs/fact" });
        assert.equal(Object.hasOwn(branch.properties.facts.items, "properties"), false);
      }
    }
  }
});

test("each local fact reference resolves to the exact prior inline fact schema", async () => {
  const prior = await priorRequests();
  const current = await schemas();
  for (let index = 0; index < current.length; index += 1) {
    const oldSchema = prior.requests[index].request_body.response_format.json_schema.schema;
    const oldFirstUnit = Object.values(oldSchema.properties.units.properties)[0];
    const priorFact = oldFirstUnit.anyOf[0].properties.facts.items;
    const currentFact = current[index].body.response_format.json_schema.schema.$defs.fact;
    assert.deepEqual(currentFact, priorFact);
  }
});

test("dereferencing the enum-fixed schema reproduces the prior response schema and JSON shape", async () => {
  const prior = await priorRequests();
  const current = await schemas();
  const dereference = (value, fact) => {
    if (Array.isArray(value)) return value.map((item) => dereference(item, fact));
    if (!value || typeof value !== "object") return value;
    if (value.$ref === "#/$defs/fact" && Object.keys(value).length === 1) return structuredClone(fact);
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$defs").map(([key, child]) => [key, dereference(child, fact)]));
  };
  for (let index = 0; index < current.length; index += 1) {
    const schema = current[index].body.response_format.json_schema.schema;
    assert.deepEqual(dereference(schema, schema.$defs.fact), prior.requests[index].request_body.response_format.json_schema.schema);
  }
});

test("exact unit accountability and facts/no_fact exclusivity remain encoded", async () => {
  for (const request of await schemas()) {
    const schema = request.body.response_format.json_schema.schema;
    const units = schema.properties.units;
    assert.equal(units.additionalProperties, false);
    assert.deepEqual(new Set(units.required), new Set(Object.keys(units.properties)));
    for (const decision of Object.values(units.properties)) {
      const [facts, noFact] = decision.anyOf;
      assert.equal(facts.properties.facts.minItems, 1);
      assert.equal(facts.properties.no_fact_reason.type, "null");
      assert.equal(noFact.properties.facts.maxItems, 0);
      assert.equal(noFact.properties.no_fact_reason.minLength, 1);
    }
  }
});

test("literal enum budgets have substantial margin and exact before/after totals", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1-enumfix/dry-run.json"), "utf8"));
  assert.deepEqual(dry.requests.map((request) => request.prior_literal_enum_value_count), [2046, 1674, 2790]);
  assert.deepEqual(dry.requests.map((request) => request.new_literal_enum_value_count), [114, 110, 122]);
  assert.deepEqual(dry.requests.map((request) => request.definition_count), [1, 1, 1]);
  assert.deepEqual(dry.requests.map((request) => request.reference_count), [22, 18, 30]);
  assert.equal(dry.requests.every((request) => request.new_literal_enum_value_count < 200), true);
});

test("fact ontology enum values are unchanged", async () => {
  const prior = await priorRequests();
  const current = await schemas();
  const collectEnums = (value, output = []) => {
    if (Array.isArray(value)) { for (const item of value) collectEnums(item, output); return output; }
    if (!value || typeof value !== "object") return output;
    if (Array.isArray(value.enum)) output.push(value.enum);
    for (const child of Object.values(value)) collectEnums(child, output);
    return output;
  };
  for (let index = 0; index < current.length; index += 1) {
    const priorSchema = prior.requests[index].request_body.response_format.json_schema.schema;
    const priorFact = Object.values(priorSchema.properties.units.properties)[0].anyOf[0].properties.facts.items;
    assert.deepEqual(collectEnums(current[index].body.response_format.json_schema.schema.$defs.fact), collectEnums(priorFact));
  }
});

test("name, strict flag, prompts, model, temperature, candidates, and units are unchanged", async () => {
  const prior = await priorRequests();
  const current = await schemas();
  for (let index = 0; index < current.length; index += 1) {
    const old = prior.requests[index];
    const next = current[index];
    assert.equal(next.body.response_format.json_schema.name, old.request_body.response_format.json_schema.name);
    assert.equal(next.body.response_format.json_schema.strict, old.request_body.response_format.json_schema.strict);
    assert.deepEqual(next.body.messages, old.request_body.messages);
    assert.equal(next.body.model, old.request_body.model);
    assert.equal(next.body.temperature, old.request_body.temperature);
    assert.deepEqual(next.body.response_format.json_schema.schema.properties.units.required, old.request_body.response_format.json_schema.schema.properties.units.required);
  }
});

test("only the schema representation changes in provider request bodies", async () => {
  const prior = await priorRequests();
  const current = await schemas();
  for (let index = 0; index < current.length; index += 1) {
    const oldBody = structuredClone(prior.requests[index].request_body);
    const newBody = structuredClone(current[index].body);
    newBody.response_format.json_schema.schema = oldBody.response_format.json_schema.schema;
    assert.deepEqual(newBody, oldBody);
  }
});

test("paid terminal logging exposes paths and outcomes for valid and invalid runs", async () => {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", `
    import { v41PaidStartLines, v41PaidOutcomeLine, v41PaidCompletionLines } from "./lib/classifierFactsPrototypeV41.ts";
    const outcome={requirement_id:"requirement-a",outcome:"provider_error",raw_provider_exchange_id:null,validation_errors:["HTTP 400"]};
    const valid={valid:true,unit_accountability_complete:true},invalid={valid:false,unit_accountability_complete:false};
    console.log(JSON.stringify({start:v41PaidStartLines(3,"/tmp/result.json","/tmp/report.md"),outcome:v41PaidOutcomeLine(outcome),valid:v41PaidCompletionLines(valid,"/tmp/result.json","/tmp/report.md"),invalid:v41PaidCompletionLines(invalid,"/tmp/result.json","/tmp/report.md")}));
  `], { cwd: root });
  const value = JSON.parse(stdout);
  assert.match(value.start.join("\n"), /V4\.1 paid run starting[\s\S]*Request count: 3[\s\S]*\/tmp\/result\.json[\s\S]*\/tmp\/report\.md/);
  assert.match(value.outcome, /outcome=provider_error; provider_request_id=none; failure=HTTP 400/);
  assert.match(value.valid.join("\n"), /Run valid: yes[\s\S]*Unit accountability complete: yes[\s\S]*Exit status: 0/);
  assert.match(value.invalid.join("\n"), /Run valid: no[\s\S]*Unit accountability complete: no[\s\S]*Exit status: 1/);
});

test("enum-fix dry artifact contains hashes, counts, and zero network calls", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1-enumfix/dry-run.json"), "utf8"));
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  assert.deepEqual(dry.requests.map((request) => request.required_unit_property_count), [11, 9, 15]);
  for (const request of dry.requests) {
    assert.match(request.response_schema_sha256, /^[a-f0-9]{64}$/u);
    assert.match(request.prompt_sha256, /^[a-f0-9]{64}$/u);
    assert.match(request.request_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(request.network_calls, 0);
  }
});

test("all failed attempts and prior artifacts remain byte-for-byte unchanged", async () => {
  const baseline = JSON.parse(await readFile(resolve("eval-fixtures/classifier-facts-prototype/artifact-baselines.v4-1-enumfix.json"), "utf8"));
  assert.equal(baseline.artifacts.length, 16);
  for (const artifact of baseline.artifacts) {
    const bytes = await readFile(resolve(artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
});

test("enum fix remains isolated from production and historical prototype code", async () => {
  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
  const paths = stdout.trim().split("\n").filter(Boolean).map((line) => line.slice(3));
  assert.equal(paths.some((path) => /^(app|components|supabase\/migrations)\//u.test(path)), false);
  assert.equal(paths.some((path) => /classifierFactsPrototypeV(?:3|4)\.ts$/u.test(path)), false);
  assert.equal(paths.some((path) => /runClassifierFactsPrototypeV4\.ts$/u.test(path)), false);
});
