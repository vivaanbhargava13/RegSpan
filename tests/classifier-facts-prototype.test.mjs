import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const fixturePath = resolve("eval-fixtures/classifier-capability/fixtures.v2.json");
const loaderArgs = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];
const harnessArgs = [...loaderArgs, "scripts/runClassifierFactsPrototype.ts"];

async function runTsEval(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loaderArgs, "--input-type=module", "--eval", source], { cwd: root });
  return JSON.parse(stdout);
}

test("segmentation is stable, lossless, sentence-aware, and bullet-aware", async () => {
  const evaluated = await runTsEval(`
    import { segmentCandidate } from "./lib/classifierFactsPrototype.ts";
    const text=${JSON.stringify("First required action. Second action follows.\n• preserve logs;\n• store exports.")};
    const first=segmentCandidate("candidate-a",text);
    const second=segmentCandidate("candidate-a",text);
    console.log(JSON.stringify({same:JSON.stringify(first)===JSON.stringify(second),texts:first.map(x=>x.text),offsets:first.map(x=>text.slice(x.start_offset,x.end_offset)===x.text),ids:first.map(x=>x.unit_id)}));
  `);
  assert.equal(evaluated.same, true);
  assert.deepEqual(evaluated.texts, ["First required action.", "Second action follows.", "• preserve logs;", "• store exports."]);
  assert.equal(evaluated.offsets.every(Boolean), true);
  assert.equal(new Set(evaluated.ids).size, 4);
});

test("dry request builder emits one facts-only request per requirement with all nine scored candidates", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const requests=buildFactsExtractionRequests(fixtures);
    const serialized=JSON.stringify(requests.map(x=>x.body.response_format.json_schema.schema));
    console.log(JSON.stringify({count:requests.length,candidates:requests.map(x=>x.candidates.length),model:requests[0].model,conclusionFields:["final_status","relationship","requirement_supported","direct_support","covered_elements","missing_elements"].filter(x=>serialized.includes('"'+x+'"'))}));
  `);
  assert.deepEqual(evaluated, {
    count: 3,
    candidates: [2, 3, 4],
    model: "gpt-4o-mini-2024-07-18",
    conclusionFields: [],
  });
});

test("response validation rejects invented, repeated, noncontiguous, and conclusion-bearing source selections", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests, validateFactsExtractionResponse } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const request=buildFactsExtractionRequests(fixtures)[0];
    const candidate=request.candidates[0];
    const base={fact_id:"fact-001",source_candidate_id:candidate.candidate_id,source_unit_ids:[candidate.units[0].unit_id],actor:"response team",action:"assess",action_text:"assesses",object:"incident_nature_and_scope",object_text:"nature and scope",workflow_scope:"incident_response",condition_or_trigger:"suspected incident",modality:"conditional_operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null};
    const valid=validateFactsExtractionResponse(request,{facts:[base]}).facts[0];
    const rejected={};
    for(const [name,fact] of Object.entries({invented:{...base,source_unit_ids:["invented-unit"]},repeated:{...base,source_unit_ids:[candidate.units[0].unit_id,candidate.units[0].unit_id]},noncontiguous:{...base,source_unit_ids:[candidate.units[0].unit_id,candidate.units[2].unit_id]},conclusion:{...base,covered_elements:["assesses_scope"]},unsupportedAction:{...base,action:"approve_as_validation"}})){
      try{validateFactsExtractionResponse(request,{facts:[fact]});rejected[name]=false;}catch{rejected[name]=true;}
    }
    console.log(JSON.stringify({quote:valid.reconstructed_quote,hashes:valid.source_unit_sha256.length,rejected}));
  `);
  assert.match(evaluated.quote, /assesses the nature and scope/);
  assert.equal(evaluated.hashes, 1);
  assert.deepEqual(evaluated.rejected, { invented: true, repeated: true, noncontiguous: true, conclusion: true, unsupportedAction: true });
});

test("deterministic mapper rejects adjacent workflows, inventories, optional language, and incident-history registration", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests, deriveCase, validateFactsExtractionResponse } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const requests=buildFactsExtractionRequests(fixtures);
    const facts=[];
    let id=1;
    const add=(request,caseId,overrides)=>{const candidate=request.candidates.find(x=>x.case_id===caseId);const unit=candidate.units[overrides.unit??0];const raw={fact_id:'fact-'+String(id++).padStart(3,'0'),source_candidate_id:candidate.candidate_id,source_unit_ids:[unit.unit_id],actor:null,action:null,action_text:null,object:null,object_text:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null,...overrides};delete raw.unit;facts.push(...validateFactsExtractionResponse(request,{facts:[raw]}).facts);};
    add(requests[0],"assessment-incident-history-negative",{unit:1,action:"record",action_text:"entered",object:"incident_materials",object_text:"incident history",workflow_scope:"general_governance"});
    add(requests[1],"preservation-optional-language-negative",{unit:1,action:"retain",action_text:"retain",object:"logs",object_text:"log source",workflow_scope:"incident_response",modality:"optional",record_or_material:"logs",preservation_method:"retention_hold"});
    add(requests[2],"recovery-corrective-ownership-negative",{unit:2,action:"remediate",action_text:"corrective action",object:"remediation_item",object_text:"corrective action",workflow_scope:"contract_management",tracking_details:{owner_assigned:true,due_date_assigned:null,status_monitored:true,open_until_evidence_review:null}});
    add(requests[2],"recovery-appendix-inventory-negative",{action:"inventory",action_text:"Contents",object:"record_contents",object_text:"Incident File Minimum Contents",workflow_scope:"records_inventory",validation_activity:"generic_validation"});
    const ids=["assessment-incident-history-negative","preservation-optional-language-negative","recovery-corrective-ownership-negative","recovery-appendix-inventory-negative"];
    const results=ids.map(caseId=>deriveCase(fixtures,fixtures.cases.find(x=>x.id===caseId),facts));
    console.log(JSON.stringify(results.map(x=>({id:x.case_id,status:x.status,elements:x.supported_elements,reasons:x.deterministic_rejection_reasons}))));
  `);
  assert.equal(evaluated.every((item) => item.status === "missing" && item.elements.length === 0), true);
  assert.match(evaluated.find((item) => item.id === "recovery-corrective-ownership-negative").reasons.join(" "), /workflow_scope_mismatch:contract_management/);
  assert.match(evaluated.find((item) => item.id === "recovery-appendix-inventory-negative").reasons.join(" "), /workflow_scope_mismatch:records_inventory/);
  assert.match(evaluated.find((item) => item.id === "preservation-optional-language-negative").reasons.join(" "), /optional_modality/);
});

test("v2 modalities accept required and operative policy actions but reject explicit discretion", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests, deriveCase, validateFactsExtractionResponse } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const request=buildFactsExtractionRequests(fixtures)[0];
    const c=request.candidates.find(x=>x.case_id==="assessment-full-operative-procedure");
    const fact=(id,unit,modality,action,actionText,object,objectText)=>({fact_id:id,source_candidate_id:c.candidate_id,source_unit_ids:[c.units[unit-1].unit_id],actor:"response team",action,action_text:actionText,object,object_text:objectText,workflow_scope:"incident_response",condition_or_trigger:modality==="conditional_operative"?"suspected incident":null,modality,tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null});
    const raw=[
      fact("fact-001",1,"conditional_operative","assess","assesses","incident_nature_and_scope","nature and scope"),
      fact("fact-002",3,"required","identify","identify","customer_information_system","customer information system"),
      fact("fact-003",5,"operative","isolate","isolate","compromised_asset","compromised hosts"),
      fact("fact-004",8,"optional","other","search","compromised_asset","affected systems"),
    ];
    const facts=validateFactsExtractionResponse(request,{facts:raw}).facts;
    const derived=deriveCase(fixtures,fixtures.cases.find(x=>x.id==="assessment-full-operative-procedure"),facts);
    console.log(JSON.stringify({status:derived.status,elements:derived.supported_elements,optional:derived.fact_ledger.find(x=>x.fact_id==="fact-004").deterministic_rejections}));
  `);
  assert.equal(evaluated.status, "covered");
  assert.deepEqual(evaluated.elements, ["assesses_scope", "customer_information_systems", "containment_control"]);
  assert.match(evaluated.optional.join(" "), /optional_modality/);
});

test("one source unit can ground multiple separately validated atomic operations", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests, validateFactsExtractionResponse } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const request=buildFactsExtractionRequests(fixtures)[2];
    const c=request.candidates.find(x=>x.case_id==="recovery-full-operative-procedure");
    const unit=c.units[1];
    const base={source_candidate_id:c.candidate_id,source_unit_ids:[unit.unit_id],actor:"system owners",workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null};
    const facts=[
      {...base,fact_id:"fact-001",action:"restore",action_text:"restore",object:"service",object_text:"services"},
      {...base,fact_id:"fact-002",action:"reset",action_text:"reset",object:"credentials",object_text:"credentials"},
      {...base,fact_id:"fact-003",action:"patch",action_text:"apply patches",object:"patch",object_text:"patches"},
      {...base,fact_id:"fact-004",action:"remove",action_text:"removed",object:"unauthorized_access_path",object_text:"unauthorized access paths"},
    ];
    const validated=validateFactsExtractionResponse(request,{facts}).facts;
    console.log(JSON.stringify({count:validated.length,unitIds:new Set(validated.flatMap(x=>x.source_unit_ids)).size,actions:validated.map(x=>x.action),quotes:new Set(validated.map(x=>x.reconstructed_quote)).size}));
  `);
  assert.deepEqual(evaluated, { count: 4, unitIds: 1, actions: ["restore", "reset", "patch", "remove"], quotes: 1 });
});

test("semantic grounding rejects unsupported action families and closure approval as validation", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests, deriveCase, validateFactsExtractionResponse } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const request=buildFactsExtractionRequests(fixtures)[2];
    const c=request.candidates.find(x=>x.case_id==="recovery-full-operative-procedure");
    const closure=c.units[8];
    const raw={fact_id:"fact-001",source_candidate_id:c.candidate_id,source_unit_ids:[closure.unit_id],actor:"incident lead",action:"validate",action_text:"approval",object:"incident_materials",object_text:"closure",workflow_scope:"incident_response",condition_or_trigger:null,modality:"required",tracking_details:null,validation_activity:"generic_validation",record_or_material:null,preservation_method:null};
    const fact=validateFactsExtractionResponse(request,{facts:[raw]}).facts[0];
    const derived=deriveCase(fixtures,fixtures.cases.find(x=>x.id==="recovery-full-operative-procedure"),[fact]);
    console.log(JSON.stringify({grounding:fact.semantic_grounding_rejections,status:derived.status,elements:derived.supported_elements,rejections:derived.deterministic_rejection_reasons}));
  `);
  assert.match(evaluated.grounding.join(" "), /action_family_mismatch:validate/);
  assert.equal(evaluated.status, "missing");
  assert.deepEqual(evaluated.elements, []);
  assert.match(evaluated.rejections.join(" "), /action_family_mismatch:validate/);
});

test("validated atomic facts reproduce all nine reviewed case derivations without using fixture labels as model output", async () => {
  const evaluated = await runTsEval(`
    import { readFile } from "node:fs/promises";
    import { buildFactsExtractionRequests, formatFactsPrototypeMarkdown, scoreFactsPrototype, validateFactsExtractionResponse } from "./lib/classifierFactsPrototype.ts";
    import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
    const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
    const requests=buildFactsExtractionRequests(fixtures);
    let id=1;
    const rawByRequirement=new Map(requests.map(x=>[x.requirement_id,[]]));
    const add=(requirementId,caseId,unit,fields)=>{const request=requests.find(x=>x.requirement_id===requirementId);const candidate=request.candidates.find(x=>x.case_id===caseId);rawByRequirement.get(requirementId).push({fact_id:'fact-'+String(id++).padStart(3,'0'),source_candidate_id:candidate.candidate_id,source_unit_ids:[candidate.units[unit-1].unit_id],actor:null,action:null,action_text:null,object:null,object_text:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null,...fields});};
    const assess="incident_assessment_containment_control",preserve="incident_evidence_log_preservation",recover="response_recovery_remediation_validation";
    add(assess,"assessment-full-operative-procedure",1,{actor:"response team",action:"assess",action_text:"assesses",object:"incident_nature_and_scope",object_text:"nature and scope",modality:"conditional_operative"});
    add(assess,"assessment-full-operative-procedure",3,{actor:"response team",action:"identify",action_text:"identify",object:"customer_information_system",object_text:"customer information system",modality:"required"});
    add(assess,"assessment-full-operative-procedure",5,{actor:"response team",action:"isolate",action_text:"isolate",object:"compromised_asset",object_text:"compromised hosts",modality:"required"});
    add(assess,"assessment-incident-history-negative",2,{action:"record",action_text:"entered",object:"incident_materials",object_text:"incident history",workflow_scope:"general_governance"});
    add(preserve,"preservation-full-operative-procedure",1,{action:"maintain",action_text:"maintains",object:"incident_materials",object_text:"incident file",record_or_material:"incident_file"});
    add(preserve,"preservation-full-operative-procedure",2,{action:"preserve",action_text:"preserved",object:"volatile_information",object_text:"volatile information",record_or_material:"logs"});
    add(preserve,"preservation-full-operative-procedure",3,{action:"store",action_text:"stored",object:"evidence",object_text:"Exports",record_or_material:"exports",preservation_method:"custody_metadata"});
    add(preserve,"preservation-records-inventory-partial",3,{action:"preserve",action_text:"preserved",object:"investigation_records",object_text:"records",record_or_material:"notification_records",preservation_method:"fixed_retention_period"});
    add(preserve,"preservation-optional-language-negative",2,{action:"retain",action_text:"retain",object:"logs",object_text:"log source",modality:"optional",record_or_material:"logs",preservation_method:"retention_hold"});
    add(recover,"recovery-full-operative-procedure",2,{actor:"system owners",action:"restore",action_text:"restore",object:"service",object_text:"services"});
    add(recover,"recovery-full-operative-procedure",2,{actor:"system owners",action:"reset",action_text:"reset",object:"credentials",object_text:"credentials"});
    add(recover,"recovery-full-operative-procedure",2,{actor:"system owners",action:"patch",action_text:"apply patches",object:"patch",object_text:"patches"});
    add(recover,"recovery-full-operative-procedure",2,{actor:"system owners",action:"remove",action_text:"removed",object:"unauthorized_access_path",object_text:"unauthorized access paths"});
    add(recover,"recovery-full-operative-procedure",3,{actor:"owner",action:"validate",action_text:"validates",object:"system",object_text:"customer information system",validation_activity:"security_logging_check",modality:"conditional_operative"});
    add(recover,"recovery-full-operative-procedure",4,{action:"assign",action_text:"assigned",object:"remediation_item",object_text:"Remediation items",tracking_details:{owner_assigned:true,due_date_assigned:true,status_monitored:true,open_until_evidence_review:true}});
    add(recover,"recovery-corrective-ownership-negative",3,{action:"remediate",action_text:"corrective action",object:"remediation_item",object_text:"corrective action",workflow_scope:"contract_management",tracking_details:{owner_assigned:true,due_date_assigned:null,status_monitored:true,open_until_evidence_review:null}});
    add(recover,"recovery-appendix-inventory-negative",1,{action:"inventory",action_text:"Contents",object:"record_contents",object_text:"Incident File Minimum Contents",workflow_scope:"records_inventory",validation_activity:"generic_validation"});
    add(recover,"recovery-restoration-monitoring-partial",1,{action:"restore",action_text:"returns systems to service",object:"system",object_text:"systems",modality:"conditional_operative"});
    const outcomes=requests.map(request=>{const validated=validateFactsExtractionResponse(request,{facts:rawByRequirement.get(request.requirement_id)});return {requirement_id:request.requirement_id,outcome:"model_success",raw_provider_exchange:{test:true},raw_model_content:JSON.stringify({facts:rawByRequirement.get(request.requirement_id)}),facts:validated.facts,validation_errors:[],selected_unit_reference_count:validated.selectedUnitReferenceCount,invalid_unit_reference_count:0};});
    const result=scoreFactsPrototype(fixtures,outcomes,"2026-07-21T00:00:00.000Z");
    const report=formatFactsPrototypeMarkdown(result);
    console.log(JSON.stringify({valid:result.valid,metrics:result.metrics,cases:result.cases.map(x=>({id:x.case_id,status:x.status,elements:x.supported_elements})),reportHasLedger:report.includes("## Per-case fact ledger and derivation"),reportHasRejections:report.includes("workflow_scope_mismatch:contract_management")}));
  `);
  assert.equal(evaluated.valid, true);
  assert.equal(evaluated.metrics.element_precision.rate, 1);
  assert.equal(evaluated.metrics.element_recall.rate, 1);
  assert.equal(evaluated.metrics.element_f1, 1);
  assert.equal(evaluated.metrics.requirement_status_accuracy.rate, 1);
  assert.equal(evaluated.metrics.false_assurance.count, 0);
  assert.equal(evaluated.metrics.hard_negative_rejection.rate, 1);
  assert.equal(evaluated.metrics.exact_source_unit_validity.rate, 1);
  assert.equal(evaluated.cases.length, 9);
  assert.equal(evaluated.reportHasLedger, true);
  assert.equal(evaluated.reportHasRejections, true);
});

test("paid prototype refuses access before fetch when the isolated feature flag is absent", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [...harnessArgs, "run", "--confirm-paid", "CLASSIFIER_FACTS_PROTOTYPE_V2"], {
      cwd: root,
      env: {
        ...process.env,
        CLASSIFIER_FACTS_PROTOTYPE_V2_ENABLED: "false",
        ENABLE_EXTERNAL_AI_PROCESSING: "true",
        ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
        REQUIREMENT_CLASSIFIER_API_KEY: "not-used",
        OPENAI_API_KEY: "",
      },
    }),
    /CLASSIFIER_FACTS_PROTOTYPE_V2_ENABLED=true/,
  );
});

test("prototype dry CLI records zero network calls and the frozen suite and model", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v2/dry-run.json"), "utf8"));
  assert.equal(dry.schema_version, "classifier-facts-prototype-dry-run/v2");
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  assert.equal(dry.scored_case_count, 9);
  assert.equal(dry.fixture_suite_hash, "2d867460a314063bef3aeec81d95952922476b4d8bbfa1b9bbe7a4ff8bffc73a");
  assert.equal(dry.model, "gpt-4o-mini-2024-07-18");
  assert.match(dry.request_plan_sha256, /^[a-f0-9]{64}$/);
  assert.equal(dry.requests.every((item) => /^[a-f0-9]{64}$/.test(item.request_sha256)), true);
});

test("v1 paid artifacts remain separate and available for offline comparison", async () => {
  const v1 = JSON.parse(await readFile(resolve("eval-fixtures/classifier-facts-prototype/v1-paid-baseline.json"), "utf8"));
  const v2Dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v2/dry-run.json"), "utf8"));
  assert.equal(v1.result_schema_version, "classifier-facts-prototype-results/v1");
  assert.equal(v1.model, v2Dry.model);
  assert.equal(v1.fixture_suite_hash, v2Dry.fixture_suite_hash);
  assert.equal(v1.metrics.element_recall.rate, 4 / 11);
  assert.equal(v1.metrics.false_assurance.count, 0);
});
