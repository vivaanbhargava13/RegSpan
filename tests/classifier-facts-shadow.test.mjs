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
  return JSON.parse(stdout.trim().split("\n").at(-1));
}

const setup = `
  import { readFile } from "node:fs/promises";
  import { buildClassifierFactsShadowJobSnapshots, buildClassifierFactsShadowRequest, categorizeClassifierFactsShadowDisagreement, enqueueClassifierFactsShadowJobsFailOpen, enqueueClassifierFactsShadowSnapshotsFailOpen, executeClassifierFactsShadow, isClassifierFactsShadowEnabled, isClassifierFactsShadowWorkerEnabled, processClassifierFactsShadowJob, summarizeClassifierFactsShadowRows, validateClassifierFactsShadowJobSnapshot } from "./lib/classifierFactsShadow.ts";
  import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
  const capability=validateClassifierCapabilityFixtures(JSON.parse(await readFile("eval-fixtures/classifier-capability/fixtures.v2.json","utf8")));
  const requirement=capability.requirements.find(x=>x.id==="incident_assessment_containment_control");
  const recovery=capability.requirements.find(x=>x.id==="response_recovery_remediation_validation");
  const candidate=(id="chunk-1",document="document-1",text="The incident response team assesses the nature and scope of the incident.")=>({chunk_id:id,document_id:document,filename:"policy.pdf",page_start:1,page_end:1,chunk_index:0,section_path:"Incident response",content_preview:text,similarity:0.9,evidence_reason:null,embedding_input:null,source_type:"client_policy",evidence_role:"organization_evidence",rerank_score:null,rerank_reason:null});
  const graded=(value,elements=[])=>({...value,grade:elements.length?"partial":"irrelevant",grade_reason:"",negative_evidence:false,negative_evidence_reason:null,evidence_relationship:elements.length?"partially_supports":"irrelevant",classifier_confidence:"medium",requirement_supported:false,control_absent_or_out_of_scope:false,covered_elements:elements,missing_elements:[],vague_elements:[],supporting_quote:elements.length?value.content_preview:null,classifier_provider:"openai"});
  const policy={workspaceId:"workspace",workspaceConsentEnabled:true,externalAiProcessingEnabled:true,externalAiClassifierEnabled:true,denialReason:null};
  const environment={CLASSIFIER_FACTS_SHADOW_ENABLED:"true",CLASSIFIER_FACTS_SHADOW_REQUIREMENTS:"incident_assessment_containment_control",ENABLE_EXTERNAL_AI_PROCESSING:"true",ENABLE_EXTERNAL_AI_CLASSIFIER:"true"};
  const makeJob=(snapshot,id="00000000-0000-4000-8000-000000000010")=>({id,workspace_id:snapshot.workspace_id,document_id:snapshot.document_id,analysis_run_id:snapshot.analysis_run_id,requirement_id:snapshot.requirement_id,status:"running",attempts:1,snapshot,claimed_at:"2026-01-01T00:00:00.000Z",completed_at:null,last_error:null});
  const workerDb=()=>{const results=[],updates=[];const supabase={from(table){if(table==="classifier_facts_shadow_results")return{upsert:async row=>{results.push(row);return{error:null}}};if(table==="classifier_facts_shadow_jobs")return{update:value=>({eq:()=>({eq:async()=>{updates.push(value);return{error:null}}})})};throw new Error("unexpected table")}};return{supabase,results,updates}};
  const noFactFetch=async(_url,init)=>{const body=JSON.parse(String(init.body)),ids=Object.keys(body.response_format.json_schema.schema.properties.units.properties),units=Object.fromEntries(ids.map(id=>[id,{disposition:"no_fact",facts:[],no_fact_reason:"No fact."}]));return new Response(JSON.stringify({id:"mock",choices:[{message:{content:JSON.stringify({units})}}],usage:{prompt_tokens:11,completion_tokens:7,total_tokens:18}}),{status:200})};
`;

test("review detour is gone while the 36-case harness remains", async () => {
  for (const path of ["lib/classifierGeneralizationReview.ts", "scripts/runClassifierGeneralizationReview.ts", "tests/classifier-generalization-review.test.mjs"]) await assert.rejects(access(resolve(path)));
  const [pkg, fixture] = await Promise.all([readFile("package.json", "utf8"), readFile("eval-fixtures/classifier-generalization/holdout.v1.json", "utf8")]);
  assert.doesNotMatch(pkg, /classifier-generalization:review/u);
  assert.match(pkg, /classifier:facts-shadow:worker/u);
  assert.equal(JSON.parse(fixture).cases.length, 36);
});

test("user-facing analysis contains enqueue only and never calls shadow inference", async () => {
  const source = await readFile("lib/findingsGeneration.ts", "utf8");
  const body = source.slice(source.indexOf("export async function generateFindingsForWorkspace"));
  assert.match(body, /enqueueClassifierFactsShadowSnapshotsFailOpen/u);
  assert.doesNotMatch(body, /executeClassifierFactsShadow|buildClassifierFactsShadowRequest|validateV41ExtractionResponse|fetch\(/u);
  assert.ok(body.indexOf("storeFinding({") < body.indexOf("completeAnalysisRun({"));
  assert.ok(body.indexOf("completeAnalysisRun({") < body.indexOf("enqueueClassifierFactsShadowSnapshotsFailOpen({"));
});

test("disabled and unsupported requirements enqueue nothing and invoke no provider", async () => {
  const value = await runTs(`${setup}
    let dbCalls=0;const supabase={from(){dbCalls++;return{upsert:async()=>({error:null})}}};
    const disabled=await enqueueClassifierFactsShadowJobsFailOpen({supabase,workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[candidate()],gradedCandidates:[graded(candidate())],workspacePolicy:policy,environment:{...environment,CLASSIFIER_FACTS_SHADOW_ENABLED:"false"}});
    const unsupported=isClassifierFactsShadowEnabled({requirementId:"written_incident_response_program",workspacePolicy:policy,environment});
    const workerWithoutFlag=isClassifierFactsShadowWorkerEnabled(environment),workerEnabled=isClassifierFactsShadowWorkerEnabled({...environment,CLASSIFIER_FACTS_SHADOW_WORKER_ENABLED:"true"});
    console.log(JSON.stringify({disabled,unsupported,dbCalls,workerWithoutFlag,workerEnabled}));
  `);
  assert.deepEqual(value, { disabled: [], unsupported: false, dbCalls: 0, workerWithoutFlag: false, workerEnabled: true });
});

test("enqueue freezes exact candidates, provenance, source units, and current evidence in one DB operation", async () => {
  const value = await runTs(`${setup}
    let calls=0,rows=null;const supabase={from:table=>({upsert:async(value,options)=>{calls++;rows=value;return{error:null,options}}})};
    const source=candidate(),snapshots=await enqueueClassifierFactsShadowJobsFailOpen({supabase,workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[source],gradedCandidates:[graded(source,["assesses_scope"])],workspacePolicy:policy,environment});
    const s=snapshots[0];console.log(JSON.stringify({calls,tableRows:rows.length,ids:s.candidate_ids,text:s.candidates[0].content_preview,filename:s.candidates[0].filename,units:s.candidates[0].units.length,unitText:s.candidates[0].units[0].text,current:s.current_elements,evidence:s.current_evidence.length,hash:s.candidate_set_sha256,model:s.model,version:s.version_identity}));
  `);
  assert.equal(value.calls, 1);
  assert.equal(value.tableRows, 1);
  assert.deepEqual(value.ids, ["chunk-1"]);
  assert.equal(value.filename, "policy.pdf");
  assert.equal(value.unitText, value.text);
  assert.deepEqual(value.current, ["assesses_scope"]);
  assert.equal(value.evidence, 1);
  assert.match(value.hash, /^[a-f0-9]{64}$/u);
  assert.equal(value.model, "gpt-4o-mini-2024-07-18");
  assert.equal(value.version, "classifier-facts-prototype-results/v4.1");
});

test("enqueue failure is fail-open and leaves production completion independent", async () => {
  const value = await runTs(`${setup}
    const supabase={from:()=>({upsert:async()=>({error:{code:"db_down"}})})};const started=performance.now();
    const result=await enqueueClassifierFactsShadowJobsFailOpen({supabase,workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[candidate()],gradedCandidates:[graded(candidate())],workspacePolicy:policy,environment});
    console.log(JSON.stringify({result,providerCalls:0,elapsed:performance.now()-started}));
  `);
  assert.deepEqual(value.result, []);
  assert.equal(value.providerCalls, 0);
  assert.ok(value.elapsed < 1_000);
});

test("a hanging enqueue is bounded and cannot wait for worker or provider completion", async () => {
  const value = await runTs(`${setup}
    const source=candidate(),snapshot=buildClassifierFactsShadowJobSnapshots({workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[source],gradedCandidates:[graded(source)]})[0],supabase={from:()=>({upsert:()=>new Promise(()=>{})})},started=performance.now();
    const result=await enqueueClassifierFactsShadowSnapshotsFailOpen({supabase,snapshots:[snapshot],timeoutMs:5});console.log(JSON.stringify({result,elapsed:performance.now()-started,providerCalls:0}));
  `);
  assert.deepEqual(value.result, []);
  assert.equal(value.providerCalls, 0);
  assert.ok(value.elapsed < 500);
});

test("worker validates and uses queued snapshot without retrieval or mutable source lookup", async () => {
  const value = await runTs(`${setup}
    const source=candidate(),snapshot=buildClassifierFactsShadowJobSnapshots({workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[source],gradedCandidates:[graded(source)]})[0],job=makeJob(snapshot),db=workerDb();
    validateClassifierFactsShadowJobSnapshot(job);const result=await processClassifierFactsShadowJob({supabase:db.supabase,job,apiKey:"mock",fetchImpl:noFactFetch});
    console.log(JSON.stringify({valid:result.valid,status:result.shadow_status,candidates:result.candidate_ids,results:db.results.length,jobStatus:db.updates[0].status}));
  `);
  assert.deepEqual(value, { valid: true, status: "missing", candidates: ["chunk-1"], results: 1, jobStatus: "completed" });
  const shadowSource = await readFile("lib/classifierFactsShadow.ts", "utf8");
  const worker = shadowSource.slice(shadowSource.indexOf("export async function processClassifierFactsShadowJob"));
  assert.doesNotMatch(worker, /retrieveRequirement|document_chunks|embedding/u);
});

test("worker timeout fails only its job and a sibling still completes", async () => {
  const value = await runTs(`${setup}
    const source=candidate(),snapshot=buildClassifierFactsShadowJobSnapshots({workspaceId:"workspace",analysisRunId:"run",requirement,candidates:[source],gradedCandidates:[graded(source)]})[0];
    const first=workerDb(),hanging=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener("abort",()=>reject(new Error("aborted"))));
    const failed=await processClassifierFactsShadowJob({supabase:first.supabase,job:makeJob(snapshot),apiKey:"mock",fetchImpl:hanging,timeoutMs:5});
    const second=workerDb(),success=await processClassifierFactsShadowJob({supabase:second.supabase,job:makeJob(snapshot,"00000000-0000-4000-8000-000000000011"),apiKey:"mock",fetchImpl:noFactFetch});
    console.log(JSON.stringify({failed:failed.outcome,failedStatus:first.updates[0].status,success:success.outcome,successStatus:second.updates[0].status}));
  `);
  assert.deepEqual(value, { failed: "transport_failure", failedStatus: "failed", success: "model_success", successStatus: "completed" });
});

test("queue schema prevents duplicates and claims safely with explicit-only failed retries", async () => {
  const migration = await readFile("supabase/migrations/028_add_classifier_facts_shadow_jobs.sql", "utf8");
  assert.match(migration, /unique \(analysis_run_id, document_id, requirement_id\)/u);
  assert.match(migration, /for update skip locked/u);
  assert.match(migration, /p_retry_failed and \([\s\S]*jobs\.status = 'failed'/u);
  assert.match(migration, /jobs\.status = 'running'.*interval '15 minutes'/u);
  assert.match(migration, /workspaces\.external_ai_processing_enabled = true/u);
  assert.match(migration, /status in \('pending', 'running', 'completed', 'failed'\)/u);
  assert.match(migration, /attempts = jobs\.attempts \+ 1/u);
});

test("fact-local quarantine and exact source reconstruction remain in worker execution", async () => {
  const value = await runTs(`${setup}
    const source=candidate(),request=buildClassifierFactsShadowRequest(requirement,[source]),unit=request.candidates[0].units[0],base={source_candidate_id:source.chunk_id,source_unit_ids:[unit.unit_id],actor:"incident response team",workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null},facts=[{...base,fact_id:"fact-001",action:"assess",object:"incident_nature_and_scope"},{...base,fact_id:"fact-002",action:"validate",object:"security_control"}],units=Object.fromEntries(request.candidates.flatMap(c=>c.units.map(u=>[u.unit_id,{disposition:"no_fact",facts:[],no_fact_reason:"No fact."}])));units[unit.unit_id]={disposition:"facts",facts,no_fact_reason:null};
    const fetchImpl=async()=>new Response(JSON.stringify({id:"mock",choices:[{message:{content:JSON.stringify({units})}}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}}),{status:200});const result=await executeClassifierFactsShadow({workspaceId:"workspace",documentId:"document-1",analysisRunId:"run",requirement,candidates:[source],gradedCandidates:[graded(source)],apiKey:"mock",fetchImpl});
    console.log(JSON.stringify({accepted:result.accepted_facts.length,rejected:result.rejected_facts.length,quote:result.source_unit_citations[0].exact_quote}));
  `);
  assert.deepEqual(value, { accepted: 1, rejected: 1, quote: "The incident response team assesses the nature and scope of the incident." });
});

test("report separates status agreement from recovery evidence disagreement and aggregates latency and usage", async () => {
  const value = await runTs(`${setup}
    const base={workspace_id:"w",document_id:"d",analysis_run_id:"r",requirement_id:recovery.id,outcome:"model_success",valid:true,current_status:"partial",shadow_status:"partial",current_elements:["remediation_tracking","validation_testing"],shadow_elements:["remediation_tracking"],candidate_ids:["c"],candidate_set_sha256:"h",accepted_facts:[],rejected_facts:[],atomic_element_ledger:[],source_unit_citations:[],current_evidence:[],request_body:{},provider_response:{},request_sha256:"q",response_sha256:"s",provider_request_id:"p",model:"gpt-4o-mini-2024-07-18",latency_ms:51879,prompt_tokens:100,completion_tokens:20,total_tokens:120,validation_errors:[]};
    const invalid={...base,document_id:"d2",valid:false,outcome:"transport_failure",shadow_status:null,shadow_elements:[],latency_ms:60006,prompt_tokens:null,completion_tokens:null,total_tokens:null};const summary=summarizeClassifierFactsShadowRows([base,invalid]);console.log(JSON.stringify(summary));
  `);
  assert.equal(value.status_agreement, 1);
  assert.equal(value.exact_agreement, 0);
  assert.equal(value.same_status_evidence_disagreement, 1);
  assert.equal(value.disagreement_counts["same status, different evidence"], 1);
  assert.equal(value.invalid_outcomes, 1);
  assert.deepEqual(value.latency_ms, { total: 111885, average: 55942.5, maximum: 60006 });
  assert.deepEqual(value.token_usage, { prompt: 100, completion: 20, total: 120 });
  assert.equal(value.by_requirement.response_recovery_remediation_validation.same_status_evidence_disagreement, 1);
});

test("shadow persistence is service-role-only and production findings remain separate", async () => {
  const [shadowSource, resultMigration, jobMigration, generator] = await Promise.all([
    readFile("lib/classifierFactsShadow.ts", "utf8"), readFile("supabase/migrations/027_add_classifier_facts_shadow_results.sql", "utf8"), readFile("supabase/migrations/028_add_classifier_facts_shadow_jobs.sql", "utf8"), readFile("lib/findingsGeneration.ts", "utf8"),
  ]);
  assert.doesNotMatch(shadowSource, /from\("(?:findings|finding_evidence)"\)/u);
  assert.match(resultMigration, /revoke all .* authenticated/u);
  assert.match(jobMigration, /revoke all .* authenticated/u);
  assert.match(generator, /enqueueClassifierFactsShadowSnapshotsFailOpen/u);
  assert.doesNotMatch(generator, /runClassifierFactsShadowFailOpen/u);
});

test("frozen V4.1 implementation and prior artifacts remain unchanged", async () => {
  const baselines = JSON.parse(await readFile("eval-fixtures/classifier-generalization/artifact-baselines.v1.json", "utf8"));
  for (const artifact of baselines.artifacts) assert.equal(createHash("sha256").update(await readFile(artifact.path)).digest("hex"), artifact.sha256, artifact.path);
  assert.equal(createHash("sha256").update(await readFile("lib/classifierFactsPrototypeV41.ts")).digest("hex"), "d2507a9840b61b4826c1391e6aacb249fff643ccc0f0067a89f4386c84d34b84");
});
