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

async function generatedNames() {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", `
    import { readFile } from "node:fs/promises";
    import { buildV41ExtractionRequests } from "./lib/classifierFactsPrototypeV41.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    console.log(JSON.stringify(buildV41ExtractionRequests(fixtures).map(request=>request.body.response_format.json_schema.name)));
  `], { cwd: root });
  return JSON.parse(stdout);
}

test("V4.1 name fix emits short, valid, unique schema names", async () => {
  const names = await generatedNames();
  assert.equal(names.length, 3);
  assert.equal(new Set(names).size, 3);
  for (const name of names) {
    assert.equal(name.length <= 64, true);
    assert.match(name, /^[A-Za-z0-9_-]+$/u);
    assert.equal(name.length < 50, true);
  }
});

test("V4.1 schema names are deterministic across repeated request generation", async () => {
  assert.deepEqual(await generatedNames(), await generatedNames());
});

test("only json_schema.name changed from the failed V4.1 serialized requests", async () => {
  const failed = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1/dry-run.json"), "utf8"));
  const fixed = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1-namefix/dry-run.json"), "utf8"));
  assert.equal(failed.requests.length, fixed.requests.length);
  for (let index = 0; index < failed.requests.length; index += 1) {
    const oldRequest = failed.requests[index].request_body;
    const newRequest = structuredClone(fixed.requests[index].request_body);
    assert.notEqual(newRequest.response_format.json_schema.name, oldRequest.response_format.json_schema.name);
    newRequest.response_format.json_schema.name = oldRequest.response_format.json_schema.name;
    assert.deepEqual(newRequest, oldRequest);
  }
});

test("schema bodies and prompt messages are byte-identical to failed V4.1", async () => {
  const failed = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1/dry-run.json"), "utf8"));
  const fixed = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1-namefix/dry-run.json"), "utf8"));
  const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  for (let index = 0; index < failed.requests.length; index += 1) {
    assert.equal(digest(fixed.requests[index].request_body.response_format.json_schema.schema), digest(failed.requests[index].request_body.response_format.json_schema.schema));
    assert.equal(digest(fixed.requests[index].request_body.messages), digest(failed.requests[index].request_body.messages));
    assert.equal(fixed.requests[index].request_body.model, failed.requests[index].request_body.model);
    assert.equal(fixed.requests[index].request_body.temperature, failed.requests[index].request_body.temperature);
  }
});

test("name-fix dry artifact reports old/new names and zero network calls", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1-namefix/dry-run.json"), "utf8"));
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  assert.deepEqual(dry.requests.map((request) => request.old_schema_name_length), [79, 74, 80]);
  assert.deepEqual(dry.requests.map((request) => request.new_schema_name_length), [40, 38, 38]);
  for (const request of dry.requests) {
    assert.equal(request.new_schema_name.length, request.new_schema_name_length);
    assert.match(request.response_schema_sha256, /^[a-f0-9]{64}$/u);
    assert.match(request.prompt_sha256, /^[a-f0-9]{64}$/u);
    assert.match(request.request_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(request.network_calls, 0);
  }
});

test("failed V4.1 and all prior paid artifacts remain byte-for-byte unchanged", async () => {
  const registry = JSON.parse(await readFile(resolve("eval-fixtures/classifier-facts-prototype/artifact-baselines.v4-1-namefix.json"), "utf8"));
  assert.equal(registry.artifacts.length, 13);
  for (const artifact of registry.artifacts) {
    const bytes = await readFile(resolve(artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
});

test("name fix historical prototype files remain frozen during shadow queue integration", async () => {
  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
  const paths = stdout.trim().split("\n").filter(Boolean).map((line) => line.slice(3));
  assert.equal(paths.some((path) => /classifierFactsPrototypeV(?:3|4)\.ts$/u.test(path)), false);
  assert.equal(paths.some((path) => /runClassifierFactsPrototypeV4\.ts$/u.test(path)), false);
});
