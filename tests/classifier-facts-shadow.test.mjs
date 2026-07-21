import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const loader = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];

async function runTs(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", source], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}

const setup = `
  import { readFile } from "node:fs/promises";
  import { buildClassifierFactsShadowRequest, categorizeClassifierFactsShadowDisagreement, executeClassifierFactsShadow, isClassifierFactsShadowEnabled, runClassifierFactsShadowFailOpen } from "./lib/classifierFactsShadow.ts";
  import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
  const capability=validateClassifierCapabilityFixtures(JSON.parse(await readFile("eval-fixtures/classifier-capability/fixtures.v2.json","utf8")));
  const requirement=capability.requirements.find(x=>x.id==="incident_assessment_containment_control");
  const candidate=(id="chunk-1",document="document-1",text="The incident response team assesses the nature and scope of the incident.")=>({chunk_id:id,document_id:document,filename:"policy.pdf",page_start:1,page_end:1,chunk_index:0,section_path:"Incident response",content_preview:text,similarity:0.9,evidence_reason:null,embedding_input:null,source_type:"client_policy",evidence_role:"organization_evidence",rerank_score:null,rerank_reason:null});
  const graded=(value)=>({...value,grade:"irrelevant",grade_reason:"",negative_evidence:false,negative_evidence_reason:null,evidence_relationship:"irrelevant",classifier_confidence:"low",requirement_supported:false,control_absent_or_out_of_scope:false,covered_elements:[],missing_elements:[],vague_elements:[],supporting_quote:null,classifier_provider:"heuristic"});
  const policy={workspaceId:"workspace",workspaceConsentEnabled:true,externalAiProcessingEnabled:true,externalAiClassifierEnabled:true,denialReason:null};
`;

test("review detour is removed while the case-isolated generalization harness remains", async () => {
  for (const path of ["lib/classifierGeneralizationReview.ts", "scripts/runClassifierGeneralizationReview.ts", "tests/classifier-generalization-review.test.mjs"]) {
    await assert.rejects(access(resolve(path)));
  }
  const [pkg, harness, fixture] = await Promise.all([
    readFile("package.json", "utf8"), readFile("lib/classifierGeneralizationEval.ts", "utf8"), readFile("eval-fixtures/classifier-generalization/holdout.v1.json", "utf8"),
  ]);
  assert.doesNotMatch(pkg, /classifier-generalization:review/u);
  assert.match(pkg, /eval:classifier-generalization:dry/u);
  assert.match(harness, /Expected .* V4\.1 requests/u);
  assert.equal(JSON.parse(fixture).cases.length, 36);
});

test("shadow requires every server and workspace gate and ignores unsupported requirements", async () => {
  const value = await runTs(`${setup}
    const base={CLASSIFIER_FACTS_SHADOW_ENABLED:"true",CLASSIFIER_FACTS_SHADOW_REQUIREMENTS:"incident_assessment_containment_control",ENABLE_EXTERNAL_AI_PROCESSING:"true",ENABLE_EXTERNAL_AI_CLASSIFIER:"true"};
    console.log(JSON.stringify({enabled:isClassifierFactsShadowEnabled({requirementId:requirement.id,workspacePolicy:policy,environment:base}),disabled:isClassifierFactsShadowEnabled({requirementId:requirement.id,workspacePolicy:policy,environment:{...base,CLASSIFIER_FACTS_SHADOW_ENABLED:"false"}}),unsupported:isClassifierFactsShadowEnabled({requirementId:"written_incident_response_program",workspacePolicy:policy,environment:base}),noConsent:isClassifierFactsShadowEnabled({requirementId:requirement.id,workspacePolicy:{...policy,externalAiProcessingEnabled:false},environment:base})}));
  `);
  assert.deepEqual(value, { enabled: true, disabled: false, unsupported: false, noConsent: false });
});

test("disabled mode performs no fetch and no persistence work", async () => {
  const value = await runTs(`${setup}
    let fetches=0,inserts=0;const supabase={from(){inserts++;return{insert:async()=>({error:null})}}};
    const result=await runClassifierFactsShadowFailOpen({supabase,workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[candidate()],gradedCandidates:[graded(candidate())],workspacePolicy:policy,environment:{CLASSIFIER_FACTS_SHADOW_ENABLED:"false"},fetchImpl:async()=>{fetches++;throw new Error("unexpected")}});
    console.log(JSON.stringify({result,fetches,inserts}));
  `);
  assert.deepEqual(value, { result: [], fetches: 0, inserts: 0 });
});

test("one V4.1 request preserves candidate order and rejects cross-document input", async () => {
  const value = await runTs(`${setup}
    const candidates=[candidate("a"),candidate("b")],request=buildClassifierFactsShadowRequest(requirement,candidates);let cross=null;try{buildClassifierFactsShadowRequest(requirement,[candidate("a","one"),candidate("b","two")]);}catch(error){cross=String(error)}
    console.log(JSON.stringify({requestCount:1,ids:request.candidates.map(x=>x.candidate_id),model:request.model,unitCount:request.candidates.flatMap(x=>x.units).length,cross}));
  `);
  assert.equal(value.requestCount, 1);
  assert.deepEqual(value.ids, ["a", "b"]);
  assert.equal(value.model, "gpt-4o-mini-2024-07-18");
  assert.ok(value.unitCount >= 2);
  assert.match(value.cross, /one document/u);
});

test("fact-local quarantine preserves exact reconstructed source evidence", async () => {
  const value = await runTs(`${setup}
    const source=candidate(),request=buildClassifierFactsShadowRequest(requirement,[source]),unit=request.candidates[0].units[0];
    const base={source_candidate_id:source.chunk_id,source_unit_ids:[unit.unit_id],actor:"incident response team",workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null};
    const facts=[{...base,fact_id:"fact-001",action:"assess",object:"incident_nature_and_scope"},{...base,fact_id:"fact-002",action:"validate",object:"security_control"}];
    const units=Object.fromEntries(request.candidates.flatMap(c=>c.units.map(u=>[u.unit_id,{disposition:"no_fact",facts:[],no_fact_reason:"No fact."}])));units[unit.unit_id]={disposition:"facts",facts,no_fact_reason:null};
    const fetchImpl=async()=>new Response(JSON.stringify({id:"mock",choices:[{message:{content:JSON.stringify({units})}}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}),{status:200});
    const result=await executeClassifierFactsShadow({workspaceId:"workspace",documentId:"document-1",analysisRunId:"run",requirement,candidates:[source],gradedCandidates:[graded(source)],apiKey:"mock",fetchImpl});
    console.log(JSON.stringify({valid:result.valid,accepted:result.accepted_facts.length,rejected:result.rejected_facts.length,quote:result.source_unit_citations[0].exact_quote,status:result.shadow_status,elements:result.shadow_elements}));
  `);
  assert.equal(value.valid, true);
  assert.equal(value.accepted, 1);
  assert.equal(value.rejected, 1);
  assert.equal(value.quote, "The incident response team assesses the nature and scope of the incident.");
  assert.deepEqual(value.elements, ["assesses_scope"]);
  assert.equal(value.status, "partial");
});

test("shadow transport and persistence failures remain isolated from production", async () => {
  const value = await runTs(`${setup}
    let inserts=0;const supabase={from(name){return{insert:async(row)=>{inserts++;return{error:{code:"mock_failure"}}}}}};
    const environment={CLASSIFIER_FACTS_SHADOW_ENABLED:"true",CLASSIFIER_FACTS_SHADOW_REQUIREMENTS:requirement.id,ENABLE_EXTERNAL_AI_PROCESSING:"true",ENABLE_EXTERNAL_AI_CLASSIFIER:"true",REQUIREMENT_CLASSIFIER_API_KEY:"mock"};
    const result=await runClassifierFactsShadowFailOpen({supabase,workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[candidate()],gradedCandidates:[graded(candidate())],workspacePolicy:policy,environment,fetchImpl:async()=>{throw new Error("transport down")}});
    console.log(JSON.stringify({returned:result.length,outcome:result[0]?.outcome,inserts}));
  `);
  assert.deepEqual(value, { returned: 1, outcome: "transport_failure", inserts: 1 });
});

test("disagreements are categorized deterministically", async () => {
  const value = await runTs(`${setup}
    const make=(current,shadow,ce=[],se=[],valid=true)=>({valid,current_status:current,shadow_status:shadow,current_elements:ce,shadow_elements:se});
    console.log(JSON.stringify([categorizeClassifierFactsShadowDisagreement(make("covered","covered",["a"],["a"])),categorizeClassifierFactsShadowDisagreement(make("covered","covered",["a"],["b"])),categorizeClassifierFactsShadowDisagreement(make("covered","partial")),categorizeClassifierFactsShadowDisagreement(make("missing","covered")),categorizeClassifierFactsShadowDisagreement(make("missing",null,[],[],false))]));
  `);
  assert.deepEqual(value, ["exact agreement", "same status, different evidence", "current covered, shadow partial", "current missing, shadow covered", "shadow invalid"]);
});

test("shadow persistence is service-role-only and cannot write findings tables", async () => {
  const [module, migration, generator] = await Promise.all([
    readFile("lib/classifierFactsShadow.ts", "utf8"), readFile("supabase/migrations/027_add_classifier_facts_shadow_results.sql", "utf8"), readFile("lib/findingsGeneration.ts", "utf8"),
  ]);
  assert.match(module, /from\("classifier_facts_shadow_results"\)\.insert/u);
  assert.doesNotMatch(module, /from\("(?:findings|finding_evidence)"\)/u);
  assert.match(migration, /enable row level security/u);
  assert.match(migration, /revoke all .* authenticated/u);
  assert.match(migration, /grant select, insert, update, delete .* service_role/u);
  assert.match(generator, /runClassifierFactsShadowFailOpen/u);
  assert.ok(generator.indexOf("storeFinding({") < generator.indexOf("runClassifierFactsShadowFailOpen({"));
});

test("frozen V4.1 implementation and prior artifacts remain unchanged", async () => {
  const baselines = JSON.parse(await readFile("eval-fixtures/classifier-generalization/artifact-baselines.v1.json", "utf8"));
  for (const artifact of baselines.artifacts) {
    const actual = createHash("sha256").update(await readFile(artifact.path)).digest("hex");
    assert.equal(actual, artifact.sha256, artifact.path);
  }
  assert.equal(createHash("sha256").update(await readFile("lib/classifierFactsPrototypeV41.ts")).digest("hex"), "d2507a9840b61b4826c1391e6aacb249fff643ccc0f0067a89f4386c84d34b84");
});
