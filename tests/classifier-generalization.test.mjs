import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const loader = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];
const fixturePath = resolve("eval-fixtures/classifier-generalization/holdout.v1.json");

async function runTs(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", source], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const setup = `
  import { readFile } from "node:fs/promises";
  import { buildGeneralizationRequestPlan, caseIsAdjudicated, isolatedCaseForV41Request, scoreGeneralizationArm, scorePairedGeneralization, validateGeneralizationFixture, validateGeneralizationRequestPlan, verifyIdenticalEvidence } from "./lib/classifierGeneralizationEval.ts";
  import { validateV41ExtractionResponse } from "./lib/classifierFactsPrototypeV41.ts";
  import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
  const fixture=validateGeneralizationFixture(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
  const canaries=validateClassifierCapabilityFixtures(JSON.parse(await readFile("eval-fixtures/classifier-capability/fixtures.v2.json","utf8")));
`;

test("holdout contains 36 non-canary cases across exactly three families", async () => {
  const value = await runTs(`${setup} console.log(JSON.stringify({count:fixture.cases.length,families:[...new Set(fixture.cases.map(x=>x.requirement_id))],canaries:fixture.cases.filter(x=>x.development_canary),hash:fixture.fixture_hash}));`);
  assert.equal(value.count, 36);
  assert.equal(value.families.length, 3);
  assert.deepEqual(value.canaries, []);
  assert.match(value.hash, /^[a-f0-9]{64}$/u);
});

test("both arms receive identical frozen candidates and V4.1 has one request per case", async () => {
  const value = await runTs(`${setup} const plan=buildGeneralizationRequestPlan(fixture,canaries),pairs=plan.v4_1_requests.map(x=>x.case_id+"/"+x.requirement_id); console.log(JSON.stringify({identical:verifyIdenticalEvidence(fixture,plan),current:plan.model_calls.current,v41:plan.model_calls.v4_1,total:plan.request_count,totalCandidates:fixture.cases.reduce((n,x)=>n+x.candidate_count,0),model:plan.model,unique:new Set(pairs).size,allSingle:plan.v4_1_requests.every(x=>new Set(x.candidates.map(c=>c.case_id)).size===1)}));`);
  assert.equal(value.identical, true);
  assert.equal(value.current, value.totalCandidates);
  assert.equal(value.v41, 36);
  assert.equal(value.total, 621);
  assert.equal(value.unique, 36);
  assert.equal(value.allSingle, true);
  assert.equal(value.model, "gpt-4o-mini-2024-07-18");
});

test("every Arm B request contains exactly one frozen document candidate set", async () => {
  const value = await runTs(`${setup} const plan=buildGeneralizationRequestPlan(fixture,canaries); console.log(JSON.stringify(plan.v4_1_requests.map(request=>{const item=isolatedCaseForV41Request(fixture,request),set=fixture.candidate_sets.find(x=>x.candidate_set_id===item.candidate_set_id);return {case_id:request.case_id,document:request.document_case_id,candidateHash:request.candidate_set_sha256===item.candidate_set_sha256,candidates:JSON.stringify(request.candidate_ids)===JSON.stringify(set.candidates.map(x=>x.candidate_id)),units:JSON.stringify(request.unit_ids)===JSON.stringify(set.candidates.flatMap(x=>x.units.map(u=>u.unit_id))),required:request.body.response_format.json_schema.schema.properties.units.required.length};})));`);
  assert.equal(value.length, 36);
  assert.equal(value.every((item) => item.candidateHash && item.candidates && item.units && item.required > 0), true);
  assert.equal(new Set(value.map((item) => item.case_id)).size, 36);
});

test("request-plan validation rejects duplicates, omissions, and frozen evidence drift", async () => {
  const value = await runTs(`${setup} const original=buildGeneralizationRequestPlan(fixture,canaries),results={}; for(const [name,mutate] of Object.entries({duplicate:p=>p.v4_1_requests.push(p.v4_1_requests[0]),missing:p=>p.v4_1_requests.pop(),candidate:p=>p.v4_1_requests[0].candidate_ids.pop(),unit:p=>p.v4_1_requests[0].unit_ids.pop(),text:p=>p.v4_1_requests[0].candidates[0].text+=" drift"})){const plan=structuredClone(original);mutate(plan);try{validateGeneralizationRequestPlan(fixture,plan);results[name]=false;}catch(error){results[name]=String(error);}} console.log(JSON.stringify(results));`);
  assert.match(value.duplicate, /Duplicate/);
  assert.match(value.missing, /Missing/);
  assert.match(value.candidate, /evidence drift/);
  assert.match(value.unit, /evidence drift/);
  assert.match(value.text, /text, order, provenance, or unit drift/);
});

test("Arm B response validation rejects cross-case candidate and unit references", async () => {
  const value = await runTs(`${setup} const plan=buildGeneralizationRequestPlan(fixture,canaries),request=plan.v4_1_requests[0],other=plan.v4_1_requests[1],units=Object.fromEntries(request.unit_ids.map(id=>[id,{disposition:"no_fact",facts:[],no_fact_reason:"No operative fact."}])),id=request.unit_ids[0],foreignCandidate=other.candidate_ids[0],foreignUnit=other.unit_ids[0],fact={fact_id:"fact-001",source_candidate_id:foreignCandidate,source_unit_ids:[foreignUnit],actor:null,action:null,object:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null};units[id]={disposition:"facts",facts:[fact],no_fact_reason:null};let error=null;try{validateV41ExtractionResponse(request,{units});}catch(caught){error=String(caught);}console.log(JSON.stringify({error}));`);
  assert.match(value.error, /source isolation|unknown|candidate|unit/i);
});

test("an Arm B failure resolves to and suppresses only its paired case", async () => {
  const value = await runTs(`${setup} const plan=buildGeneralizationRequestPlan(fixture,canaries),request=plan.v4_1_requests[0],item=isolatedCaseForV41Request(fixture,request),others=fixture.cases.filter(x=>x.case_id!==item.case_id); console.log(JSON.stringify({failed:item.case_id,affected:fixture.cases.filter(x=>x.case_id===request.case_id&&x.requirement_id===request.requirement_id).map(x=>x.case_id),unaffected:others.length}));`);
  assert.equal(value.affected.length, 1);
  assert.equal(value.affected[0], value.failed);
  assert.equal(value.unaffected, 35);
});

test("unlabeled cases are excluded and dual independent review plus adjudication is mandatory", async () => {
  const value = await runTs(`${setup}
    const item=structuredClone(fixture.cases[0]); const review={reviewer_id:"one",reviewed_at:"2026-01-01T00:00:00.000Z",expected_elements:[],expected_status:"missing",support_kind:"negative",hard_negative_category:"inventory",supporting_unit_ids:[],unit_element_support:[],rationale:"No operative support."};
    const before=caseIsAdjudicated(item); item.reviewer_1=review;item.reviewer_2={...review};item.adjudication={...review,adjudicator_id:"three",adjudicated_at:"2026-01-02T00:00:00.000Z",approved:true};const sameReviewer=caseIsAdjudicated(item);item.reviewer_2={...review,reviewer_id:"two"};const complete=caseIsAdjudicated(item);
    console.log(JSON.stringify({before,sameReviewer,complete,unlabeled:scoreGeneralizationArm(fixture,[]).labeled_cases}));`);
  assert.deepEqual(value, { before: false, sameReviewer: false, complete: true, unlabeled: 0 });
});

test("worksheet can represent genuine complementary multi-candidate evidence", async () => {
  const value = await runTs(`${setup} const item=fixture.cases[0],set=fixture.candidate_sets.find(x=>x.candidate_set_id===item.candidate_set_id),a=set.candidates[0].units[0],b=set.candidates[1].units[0]; const support=[{unit_id:a.unit_id,elements:[fixture.requirements[0].required_elements[0]]},{unit_id:b.unit_id,elements:[fixture.requirements[0].required_elements[1]]}]; console.log(JSON.stringify({candidatesDistinct:a.unit_id.split(":")[0]!==b.unit_id.split(":")[0],unique:[...new Set(support.flatMap(x=>x.elements))].length,support}));`);
  assert.equal(value.candidatesDistinct, true);
  assert.equal(value.unique, 2);
});

test("false assurance is detected and any invalid scored arm suppresses metrics", async () => {
  const value = await runTs(`${setup}
    const f=structuredClone(fixture),item=f.cases[0],base={reviewer_id:"one",reviewed_at:"2026-01-01T00:00:00.000Z",expected_elements:[],expected_status:"missing",support_kind:"negative",hard_negative_category:"adjacent_workflow",supporting_unit_ids:[],unit_element_support:[],rationale:"negative"};item.reviewer_1=base;item.reviewer_2={...base,reviewer_id:"two"};item.adjudication={...base,adjudicator_id:"three",adjudicated_at:"2026-01-02T00:00:00.000Z",approved:true};
    const falseResult={case_id:item.case_id,outcome:"model_success",predicted_elements:[f.requirements[0].required_elements[0]],predicted_status:"partial",exact_source_unit_valid:true}; const invalid={...falseResult,outcome:"provider_failure",predicted_status:null};
    console.log(JSON.stringify({falseAssurance:scoreGeneralizationArm(f,[falseResult]).false_assurance,suppressed:scoreGeneralizationArm(f,[invalid]).metrics_suppressed,paired:scorePairedGeneralization(f,[falseResult],[invalid]).gate.advances}));`);
  assert.deepEqual(value, { falseAssurance: 1, suppressed: true, paired: false });
});

test("candidate and unit hashes preserve exact quotes and order", async () => {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  for (const set of fixture.candidate_sets) for (const [index, candidate] of set.candidates.entries()) {
    assert.equal(candidate.position, index + 1);
    assert.equal(createHash("sha256").update(candidate.text).digest("hex"), candidate.content_sha256);
    for (const unit of candidate.units) {
      assert.ok(candidate.text.includes(unit.text));
      assert.equal(createHash("sha256").update(unit.text).digest("hex"), unit.text_sha256);
    }
  }
});

test("dry artifact proves zero network calls and records immutable request hashes", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-generalization/v1-case-isolated/dry-run.json"), "utf8"));
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 621);
  assert.deepEqual(dry.model_calls, { current: 585, v4_1: 36 });
  assert.equal(dry.arm_b_provider_preflight.length, 36);
  assert.equal(dry.arm_b_provider_preflight.every((item) => item.required_unit_property_count === item.unit_count && item.schema_name_length <= 64 && item.literal_enum_value_count < 1000), true);
  assert.match(dry.request_plan_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(dry.requests.every((item) => /^[a-f0-9]{64}$/u.test(item.body_sha256)), true);
});

test("V4.1, current classifier, and prior generalization artifacts remain immutable", async () => {
  const registry = JSON.parse(await readFile(resolve("eval-fixtures/classifier-generalization/artifact-baselines.v1.json"), "utf8"));
  for (const artifact of registry.artifacts) assert.equal(createHash("sha256").update(await readFile(resolve(artifact.path))).digest("hex"), artifact.sha256);
  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
  const paths = stdout.trim().split("\n").filter(Boolean).map((line) => line.slice(3));
  assert.equal(paths.some((path) => /classifierFactsPrototypeV(?:3|4|41)\.ts$|requirementEvidenceClassifier\.ts$/u.test(path)), false);
});

test("paid readiness is blocked before review without contacting a provider", async () => {
  await assert.rejects(execFileAsync(process.execPath, [...loader, "scripts/runClassifierGeneralizationEval.ts", "readiness"], { cwd: root }), (error) => error.code === 2 && /36 cases lack approved dual-review adjudication/u.test(error.stdout));
});
