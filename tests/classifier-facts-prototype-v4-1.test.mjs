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

async function runTs(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", source], { cwd: root });
  return JSON.parse(stdout);
}

const setup = `
  import { readFile } from "node:fs/promises";
  import { buildV41ExtractionRequests, validateV41ProviderStructure, validateV41ExtractionResponse, v41SchemaHash, v41RequestHash } from "./lib/classifierFactsPrototypeV41.ts";
  import { buildV4ExtractionRequests, mapV3Fact } from "./lib/classifierFactsPrototypeV4.ts";
  import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
  const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
  const requests=buildV41ExtractionRequests(fixtures),v4Requests=buildV4ExtractionRequests(fixtures);
  const complete=(request)=>({units:Object.fromEntries(request.candidates.flatMap(candidate=>candidate.units.map(unit=>[unit.unit_id,{disposition:"no_fact",facts:[],no_fact_reason:"No relevant operative fact."}])))});
  const first=(request)=>{const candidate=request.candidates[0],unit=candidate.units[0];return {candidate,unit};};
  const base=(candidate,unit,id="fact-001")=>({fact_id:id,source_candidate_id:candidate.candidate_id,source_unit_ids:[unit.unit_id],actor:null,action:null,object:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null});
`;

test("V4.1 schemas contain exactly and require every supplied unit ID", async () => {
  const value = await runTs(`${setup}
    console.log(JSON.stringify(requests.map(request=>{const schema=request.body.response_format.json_schema.schema,units=schema.properties.units,expected=request.candidates.flatMap(c=>c.units.map(u=>u.unit_id));return {requirement:request.requirement_id,expected,required:units.required,properties:Object.keys(units.properties),additional:units.additionalProperties,hash:v41SchemaHash(request)};})));
  `);
  assert.deepEqual(value.map((item) => item.expected.length), [11, 9, 15]);
  for (const item of value) {
    assert.deepEqual(new Set(item.required), new Set(item.expected));
    assert.deepEqual(new Set(item.properties), new Set(item.expected));
    assert.equal(item.additional, false);
    assert.match(item.hash, /^[a-f0-9]{64}$/u);
  }
  assert.equal(new Set(value.map((item) => item.hash)).size, 3);
});

test("V4.1 local schema contract accepts a complete synthetic response in any property order", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],raw=complete(request),reversed={units:Object.fromEntries(Object.entries(raw.units).reverse())};
    console.log(JSON.stringify({normal:validateV41ProviderStructure(request,raw),reversed:validateV41ProviderStructure(request,reversed),keys:Object.keys(reversed.units).length}));
  `);
  assert.deepEqual(value, { normal: true, reversed: true, keys: 11 });
});

test("V4.1 rejects omitted and additional unit properties", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],raw=complete(request),entries=Object.entries(raw.units),results={};
    for(const [name,candidate] of Object.entries({omitted:{units:Object.fromEntries(entries.slice(1))},extra:{units:{...raw.units,"unknown:u001:deadbeef":entries[0][1]}}})){try{validateV41ProviderStructure(request,candidate);results[name]=false;}catch(error){results[name]=String(error);}}
    console.log(JSON.stringify(results));
  `);
  assert.match(value.omitted, /unexpected or missing properties/);
  assert.match(value.extra, /unexpected or missing properties/);
});

test("V4.1 duplication is structurally impossible because units are object properties", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],raw=complete(request),id=Object.keys(raw.units)[0];raw.units[id]={disposition:"no_fact",facts:[],no_fact_reason:"replacement"};
    console.log(JSON.stringify({valid:validateV41ProviderStructure(request,raw),keyOccurrences:Object.keys(raw.units).filter(x=>x===id).length,total:Object.keys(raw.units).length}));
  `);
  assert.deepEqual(value, { valid: true, keyOccurrences: 1, total: 11 });
});

test("V4.1 schema branches enforce facts/no_fact exclusivity", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],raw=complete(request),id=Object.keys(raw.units)[0],results={};
    const variants={factsEmpty:{disposition:"facts",facts:[],no_fact_reason:null},factsReason:{disposition:"facts",facts:[{}],no_fact_reason:"reason"},noFactFacts:{disposition:"no_fact",facts:[{}],no_fact_reason:"reason"},noFactEmptyReason:{disposition:"no_fact",facts:[],no_fact_reason:""}};
    for(const [name,decision] of Object.entries(variants)){const candidate={units:{...raw.units,[id]:decision}};try{validateV41ProviderStructure(request,candidate);results[name]=false;}catch(error){results[name]=String(error);}}
    const schema=request.body.response_format.json_schema.schema.properties.units.properties[id];
    console.log(JSON.stringify({results,branches:schema.anyOf}));
  `);
  assert.match(value.results.factsEmpty, /facts branch/);
  assert.match(value.results.factsReason, /facts branch/);
  assert.match(value.results.noFactFacts, /no_fact branch/);
  assert.match(value.results.noFactEmptyReason, /no_fact branch/);
  const [facts, noFact] = value.branches;
  assert.equal(facts.properties.facts.minItems, 1);
  assert.deepEqual(facts.properties.disposition.enum, ["facts"]);
  assert.equal(facts.properties.no_fact_reason.type, "null");
  assert.equal(noFact.properties.facts.maxItems, 0);
  assert.deepEqual(noFact.properties.disposition.enum, ["no_fact"]);
  assert.equal(noFact.properties.no_fact_reason.minLength, 1);
  assert.equal(facts.additionalProperties, false);
  assert.equal(noFact.additionalProperties, false);
});

test("V4.1 post-response validation still rejects structural corruption", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],raw=complete(request),id=Object.keys(raw.units)[0];delete raw.units[id];let rejected=false;try{validateV41ExtractionResponse(request,raw);}catch(error){rejected=/unexpected or missing properties/.test(String(error));}console.log(JSON.stringify({rejected}));
  `);
  assert.equal(value.rejected, true);
});

test("V4.1 preserves V4 fact-local quarantine and exact quote reconstruction", async () => {
  const value = await runTs(`${setup}
    const request=requests[2],raw=complete(request),candidate=request.candidates.find(x=>x.case_id==="recovery-full-operative-procedure"),unit=candidate.units.find(x=>x.text.includes("restore services"));
    raw.units[unit.unit_id]={disposition:"facts",facts:[{...base(candidate,unit,"fact-001"),action:"restore",object:"service"},{...base(candidate,unit,"fact-002"),action:"validate",object:"remediation_item"}],no_fact_reason:null};
    const result=validateV41ExtractionResponse(request,raw);console.log(JSON.stringify({accepted:result.facts.map(x=>x.fact_id),rejected:result.rejectedFacts.map(x=>({id:x.fact_id,codes:x.rejection_codes})),quote:result.facts[0].reconstructed_quote,mapped:mapV3Fact(request.requirement_id,result.facts[0]).mapped}));
  `);
  assert.deepEqual(value.accepted, ["fact-001"]);
  assert.equal(value.rejected[0].id, "fact-002");
  assert.match(value.rejected[0].codes.join(" "), /action_not_grounded:validate/);
  assert.match(value.quote, /^System owners restore services/);
  assert.deepEqual(value.mapped, ["recovery_steps"]);
});

test("V4.1 changes only response format while preserving every prompt message", async () => {
  const value = await runTs(`${setup}
    console.log(JSON.stringify(requests.map((request,index)=>({sameMessages:JSON.stringify(request.body.messages)===JSON.stringify(v4Requests[index].body.messages),sameModel:request.model===v4Requests[index].model,differentSchema:JSON.stringify(request.body.response_format)!==JSON.stringify(v4Requests[index].body.response_format),requestHash:v41RequestHash(request)}))));
  `);
  assert.equal(value.every((item) => item.sameMessages && item.sameModel && item.differentSchema), true);
  assert.equal(value.every((item) => /^[a-f0-9]{64}$/u.test(item.requestHash)), true);
});

test("V4.1 dry artifact reports exact unit counts, IDs, schema hashes, and request hashes", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4-1/dry-run.json"), "utf8"));
  assert.equal(dry.schema_version, "classifier-facts-prototype-dry-run/v4.1");
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  assert.equal(dry.total_required_unit_properties, 35);
  assert.deepEqual(dry.requests.map((request) => request.required_unit_property_count), [11, 9, 15]);
  for (const request of dry.requests) {
    assert.deepEqual(request.required_unit_ids, [...request.required_unit_ids].sort());
    assert.match(request.response_schema_sha256, /^[a-f0-9]{64}$/u);
    assert.match(request.request_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(request.network_calls, 0);
  }
});

test("V1 through invalid V4 artifacts remain byte-for-byte immutable", async () => {
  const registry = JSON.parse(await readFile(resolve("eval-fixtures/classifier-facts-prototype/artifact-baselines.v4-1.json"), "utf8"));
  assert.equal(registry.artifacts.length, 10);
  for (const artifact of registry.artifacts) {
    const bytes = await readFile(resolve(artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
});

test("V4.1 is isolated from production, V4 prompts, and V3/V4 mapping code", async () => {
  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
  const paths = stdout.trim().split("\n").filter(Boolean).map((line) => line.slice(3));
  assert.equal(paths.some((path) => /^(app|components|supabase\/migrations)\//u.test(path)), false);
  assert.equal(paths.some((path) => /classifierFactsPrototypeV(?:3|4)\.ts$/u.test(path)), false);
  assert.equal(paths.some((path) => /runClassifierFactsPrototypeV(?:3|4)\.ts$/u.test(path)), false);
});
