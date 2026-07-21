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
    const base={fact_id:"fact-001",source_candidate_id:candidate.candidate_id,source_unit_ids:[candidate.units[0].unit_id],actor:"response team",action:"assess",object:"incident_nature_and_scope",workflow_scope:"incident_response",condition_or_trigger:"suspected incident",modality:"mandatory",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null};
    const valid=validateFactsExtractionResponse(request,{facts:[base]}).facts[0];
    const rejected={};
    for(const [name,fact] of Object.entries({invented:{...base,source_unit_ids:["invented-unit"]},repeated:{...base,source_unit_ids:[candidate.units[0].unit_id,candidate.units[0].unit_id]},noncontiguous:{...base,source_unit_ids:[candidate.units[0].unit_id,candidate.units[2].unit_id]},conclusion:{...base,covered_elements:["assesses_scope"]}})){
      try{validateFactsExtractionResponse(request,{facts:[fact]});rejected[name]=false;}catch{rejected[name]=true;}
    }
    console.log(JSON.stringify({quote:valid.reconstructed_quote,hashes:valid.source_unit_sha256.length,rejected}));
  `);
  assert.match(evaluated.quote, /assesses the nature and scope/);
  assert.equal(evaluated.hashes, 1);
  assert.deepEqual(evaluated.rejected, { invented: true, repeated: true, noncontiguous: true, conclusion: true });
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
    const add=(request,caseId,overrides)=>{const candidate=request.candidates.find(x=>x.case_id===caseId);const unit=candidate.units[overrides.unit??0];const raw={fact_id:'fact-'+String(id++).padStart(3,'0'),source_candidate_id:candidate.candidate_id,source_unit_ids:[unit.unit_id],actor:null,action:"record",object:"other",workflow_scope:"incident_response",condition_or_trigger:null,modality:"mandatory",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null,...overrides};delete raw.unit;facts.push(...validateFactsExtractionResponse(request,{facts:[raw]}).facts);};
    add(requests[0],"assessment-incident-history-negative",{unit:1,action:"record",object:"incident_materials",workflow_scope:"general_governance"});
    add(requests[1],"preservation-optional-language-negative",{unit:1,action:"retain",object:"logs",workflow_scope:"incident_response",modality:"optional",record_or_material:"logs",preservation_method:"retention_hold"});
    add(requests[2],"recovery-corrective-ownership-negative",{unit:2,action:"track",object:"remediation_item",workflow_scope:"contract_management",tracking_details:{owner_assigned:true,due_date_assigned:null,status_monitored:true,open_until_evidence_review:null}});
    add(requests[2],"recovery-appendix-inventory-negative",{action:"inventory",object:"record_contents",workflow_scope:"records_inventory",validation_activity:"generic_validation"});
    const ids=["assessment-incident-history-negative","preservation-optional-language-negative","recovery-corrective-ownership-negative","recovery-appendix-inventory-negative"];
    const results=ids.map(caseId=>deriveCase(fixtures,fixtures.cases.find(x=>x.id===caseId),facts));
    console.log(JSON.stringify(results.map(x=>({id:x.case_id,status:x.status,elements:x.supported_elements,reasons:x.deterministic_rejection_reasons}))));
  `);
  assert.equal(evaluated.every((item) => item.status === "missing" && item.elements.length === 0), true);
  assert.match(evaluated.find((item) => item.id === "recovery-corrective-ownership-negative").reasons.join(" "), /workflow_scope_mismatch:contract_management/);
  assert.match(evaluated.find((item) => item.id === "recovery-appendix-inventory-negative").reasons.join(" "), /workflow_scope_mismatch:records_inventory/);
  assert.match(evaluated.find((item) => item.id === "preservation-optional-language-negative").reasons.join(" "), /optional_modality/);
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
    const add=(requirementId,caseId,unit,fields)=>{const request=requests.find(x=>x.requirement_id===requirementId);const candidate=request.candidates.find(x=>x.case_id===caseId);rawByRequirement.get(requirementId).push({fact_id:'fact-'+String(id++).padStart(3,'0'),source_candidate_id:candidate.candidate_id,source_unit_ids:[candidate.units[unit-1].unit_id],actor:null,action:"other",object:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"mandatory",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null,...fields});};
    const assess="incident_assessment_containment_control",preserve="incident_evidence_log_preservation",recover="response_recovery_remediation_validation";
    add(assess,"assessment-full-operative-procedure",1,{actor:"response team",action:"assess",object:"incident_nature_and_scope"});
    add(assess,"assessment-full-operative-procedure",3,{actor:"response team",action:"identify",object:"customer_information_system"});
    add(assess,"assessment-full-operative-procedure",5,{actor:"response team",action:"contain",object:"compromised_asset"});
    add(assess,"assessment-incident-history-negative",2,{action:"record",object:"incident_materials",workflow_scope:"general_governance"});
    add(preserve,"preservation-full-operative-procedure",2,{action:"preserve",object:"logs",record_or_material:"logs"});
    add(preserve,"preservation-full-operative-procedure",3,{action:"store",object:"evidence",record_or_material:"exports",preservation_method:"custody_metadata"});
    add(preserve,"preservation-records-inventory-partial",3,{action:"retain",object:"investigation_records",record_or_material:"notification_records",preservation_method:"fixed_retention_period"});
    add(preserve,"preservation-optional-language-negative",2,{action:"retain",object:"logs",modality:"optional",record_or_material:"logs",preservation_method:"retention_hold"});
    add(recover,"recovery-full-operative-procedure",2,{actor:"system owners",action:"restore",object:"service"});
    add(recover,"recovery-full-operative-procedure",3,{actor:"owner",action:"validate",object:"system",validation_activity:"security_logging_check"});
    add(recover,"recovery-full-operative-procedure",4,{action:"assign",object:"remediation_item",tracking_details:{owner_assigned:true,due_date_assigned:true,status_monitored:true,open_until_evidence_review:true}});
    add(recover,"recovery-corrective-ownership-negative",3,{action:"track",object:"remediation_item",workflow_scope:"contract_management",tracking_details:{owner_assigned:true,due_date_assigned:null,status_monitored:true,open_until_evidence_review:null}});
    add(recover,"recovery-appendix-inventory-negative",1,{action:"inventory",object:"record_contents",workflow_scope:"records_inventory",validation_activity:"generic_validation"});
    add(recover,"recovery-restoration-monitoring-partial",1,{action:"restore",object:"system"});
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
    execFileAsync(process.execPath, [...harnessArgs, "run", "--confirm-paid", "CLASSIFIER_FACTS_PROTOTYPE"], {
      cwd: root,
      env: {
        ...process.env,
        CLASSIFIER_FACTS_PROTOTYPE_ENABLED: "false",
        ENABLE_EXTERNAL_AI_PROCESSING: "true",
        ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
        REQUIREMENT_CLASSIFIER_API_KEY: "not-used",
        OPENAI_API_KEY: "",
      },
    }),
    /CLASSIFIER_FACTS_PROTOTYPE_ENABLED=true/,
  );
});

test("prototype dry CLI records zero network calls and the frozen suite and model", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/dry-run.json"), "utf8"));
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  assert.equal(dry.scored_case_count, 9);
  assert.equal(dry.fixture_suite_hash, "2d867460a314063bef3aeec81d95952922476b4d8bbfa1b9bbe7a4ff8bffc73a");
  assert.equal(dry.model, "gpt-4o-mini-2024-07-18");
});
