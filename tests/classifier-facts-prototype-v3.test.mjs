import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const fixturePath = resolve("eval-fixtures/classifier-capability/fixtures.v2.json");
const loaderArgs = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];

async function runTsEval(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loaderArgs, "--input-type=module", "--eval", source], { cwd: root });
  return JSON.parse(stdout);
}

const setup = `
  import { readFile } from "node:fs/promises";
  import { buildV3ExtractionRequests, validateV3ExtractionResponse, mapV3Fact, deriveV3Case, buildV3OmissionDiagnostics, scoreV3Prototype } from "./lib/classifierFactsPrototypeV3.ts";
  import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
  const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturePath)},"utf8")));
  const requests=buildV3ExtractionRequests(fixtures);
  const find=(requirement,caseId)=>{const request=requests.find(x=>x.requirement_id===requirement);return {request,candidate:request.candidates.find(x=>x.case_id===caseId)}};
  const unit=(candidate,needle)=>candidate.units.find(x=>x.text.includes(needle));
  const base=(candidate,sourceUnit,id="fact-001")=>({fact_id:id,source_candidate_id:candidate.candidate_id,source_unit_ids:[sourceUnit.unit_id],actor:null,action:null,object:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null});
`;

test("V3 grounds normalized semantics case-insensitively while preserving the exact source quote", async () => {
  const result = await runTsEval(`${setup}
    const {request,candidate}=find("response_recovery_remediation_validation","recovery-full-operative-procedure");
    const source=unit(candidate,"Remediation items");
    const raw={...base(candidate,source),action:"assign",object:"remediation_item",tracking_details:{owner_assigned:true,due_date_assigned:true,status_monitored:true,open_until_evidence_review:true},action_text:"ASSIGNED",object_text:"remediation items"};
    const v=validateV3ExtractionResponse(request,{facts:[raw]});
    console.log(JSON.stringify({accepted:v.facts.length,quote:v.facts[0].reconstructed_quote,diagnosticText:v.facts[0].object_text,mapped:mapV3Fact(request.requirement_id,v.facts[0]).mapped}));
  `);
  assert.equal(result.accepted, 1);
  assert.match(result.quote, /^Remediation items/);
  assert.equal(result.diagnosticText, "remediation items");
  assert.deepEqual(result.mapped, ["remediation_tracking"]);
});

test("V3 does not require ontology values verbatim but rejects unsupported source semantics", async () => {
  const result = await runTsEval(`${setup}
    const {request,candidate}=find("response_recovery_remediation_validation","recovery-full-operative-procedure");
    const restoration=unit(candidate,"restore services");
    const valid={...base(candidate,restoration,"fact-001"),action:"restore",object:"service"};
    const invalid={...base(candidate,restoration,"fact-002"),action:"validate",object:"remediation_item"};
    const v=validateV3ExtractionResponse(request,{facts:[valid,invalid]});
    console.log(JSON.stringify({accepted:v.facts.map(x=>x.fact_id),rejected:v.rejectedFacts.map(x=>x.rejection_codes)}));
  `);
  assert.deepEqual(result.accepted, ["fact-001"]);
  assert.match(result.rejected.flat().join(" "), /action_not_grounded:validate/);
  assert.match(result.rejected.flat().join(" "), /object_not_grounded:remediation_item/);
});

test("V3 derives validation and tracking from source text when optional detail fields are null", async () => {
  const result = await runTsEval(`${setup}
    const {request,candidate}=find("response_recovery_remediation_validation","recovery-full-operative-procedure");
    const validation=unit(candidate,"validates security logging"); const tracking=unit(candidate,"Remediation items");
    const facts=[
      {...base(candidate,validation,"fact-001"),action:"validate",object:"system",modality:"conditional_operative"},
      {...base(candidate,tracking,"fact-002"),action:"assign",object:"remediation_item"},
    ];
    const v=validateV3ExtractionResponse(request,{facts});
    console.log(JSON.stringify(v.facts.map(x=>mapV3Fact(request.requirement_id,x).mapped)));
  `);
  assert.deepEqual(result, [["validation_testing"], ["remediation_tracking"]]);
});

test("V3 fixed incident-record retention maps only incident materials", async () => {
  const result = await runTsEval(`${setup}
    const {request,candidate}=find("incident_evidence_log_preservation","preservation-records-inventory-partial");
    const source=unit(candidate,"preserved for five years");
    const raw={...base(candidate,source),action:"preserve",object:"incident_materials",record_or_material:"notification_records",preservation_method:"fixed_retention_period",modality:"required"};
    const v=validateV3ExtractionResponse(request,{facts:[raw]});
    console.log(JSON.stringify(mapV3Fact(request.requirement_id,v.facts[0])));
  `);
  assert.deepEqual(result.mapped, ["incident_materials"]);
});

test("V3 accepts multiple atomic recovery facts from one compound source unit", async () => {
  const result = await runTsEval(`${setup}
    const {request,candidate}=find("response_recovery_remediation_validation","recovery-full-operative-procedure");
    const source=unit(candidate,"restore services");
    const facts=[
      {...base(candidate,source,"fact-001"),action:"restore",object:"service"},
      {...base(candidate,source,"fact-002"),action:"reset",object:"credentials"},
      {...base(candidate,source,"fact-003"),action:"patch",object:"patch"},
      {...base(candidate,source,"fact-004"),action:"remove",object:"unauthorized_access_path"},
    ];
    const v=validateV3ExtractionResponse(request,{facts});
    console.log(JSON.stringify({accepted:v.facts.length,quotes:new Set(v.facts.map(x=>x.reconstructed_quote)).size,mapped:v.facts.map(x=>mapV3Fact(request.requirement_id,x).mapped)}));
  `);
  assert.equal(result.accepted, 4);
  assert.equal(result.quotes, 1);
  assert.equal(result.mapped.every((elements) => elements.includes("recovery_steps")), true);
});

test("V3 omission diagnostics expose unextracted high-signal units without creating evidence", async () => {
  const result = await runTsEval(`${setup}
    const outcomes=requests.map(request=>({requirement_id:request.requirement_id,outcome:"model_success",raw_provider_exchange:{},raw_model_content:"{\\"facts\\":[]}",facts:[],rejected_facts:[],facts_returned:0,validation_errors:[],selected_unit_reference_count:0,invalid_unit_reference_count:0}));
    const diagnostics=buildV3OmissionDiagnostics(requests,outcomes);
    const scored=scoreV3Prototype(fixtures,requests,outcomes,"2026-07-21T00:00:00.000Z");
    console.log(JSON.stringify({count:diagnostics.length,allDiagnostic:diagnostics.every(x=>x.creates_evidence===false&&x.accepted_fact_ids.length===0),mapped:scored.cases.flatMap(x=>x.supported_elements).length}));
  `);
  assert.equal(result.count > 0, true);
  assert.equal(result.allDiagnostic, true);
  assert.equal(result.mapped, 0);
});

test("V3 rejected facts never map and prior hard-negative scopes remain rejected", async () => {
  const result = await runTsEval(`${setup}
    const specs=[
      ["incident_assessment_containment_control","assessment-incident-history-negative","entered","record","incident_materials","general_governance"],
      ["incident_evidence_log_preservation","preservation-optional-language-negative","retain a log source","retain","logs","incident_response","optional"],
      ["response_recovery_remediation_validation","recovery-corrective-ownership-negative","corrective action","remediate","remediation_item","contract_management"],
      ["response_recovery_remediation_validation","recovery-appendix-inventory-negative","Incident File Minimum Contents","inventory","record_contents","records_inventory"],
    ];
    const output=[];
    let id=1;
    for(const [requirement,caseId,needle,action,object,scope,modality] of specs){const {request,candidate}=find(requirement,caseId);const raw={...base(candidate,unit(candidate,needle),'fact-'+String(id++).padStart(3,'0')),action,object,workflow_scope:scope,modality:modality??"operative"};const v=validateV3ExtractionResponse(request,{facts:[raw]});const derived=deriveV3Case(fixtures,fixtures.cases.find(x=>x.id===caseId),v.facts,v.rejectedFacts,[]);output.push({caseId,accepted:v.facts.length,rejected:v.rejectedFacts.length,elements:derived.supported_elements});}
    console.log(JSON.stringify(output));
  `);
  assert.equal(result.every((item) => item.accepted === 0 && item.rejected === 1 && item.elements.length === 0), true);
});

test("V1, V2 paid, V2 replay, and V3 output paths and schemas remain separated", async () => {
  const baseline = JSON.parse(await readFile(resolve("eval-fixtures/classifier-facts-prototype/artifact-baselines.v3.json"), "utf8"));
  assert.equal(baseline.artifacts.length, 6);
  for (const artifact of baseline.artifacts) {
    const bytes = await readFile(resolve(artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
    assert.equal(artifact.path.includes("/v3/"), false);
  }
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v3/dry-run.json"), "utf8"));
  assert.equal(dry.schema_version, "classifier-facts-prototype-dry-run/v3");
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  const factSchema = dry.requests[0].request_body.response_format.json_schema.schema.properties.facts.items;
  assert.equal(factSchema.required.includes("action_text"), false);
  assert.equal(factSchema.required.includes("object_text"), false);
  assert.equal(Object.hasOwn(factSchema.properties, "action_text"), false);
  assert.equal(Object.hasOwn(factSchema.properties, "object_text"), false);
});

test("V3 constructed facts produce a valid high-recall offline score", async () => {
  const result = await runTsEval(`${setup}
    const rawByRequirement=new Map(requests.map(x=>[x.requirement_id,[]])); let id=1;
    const add=(requirement,caseId,needle,fields)=>{const {candidate}=find(requirement,caseId);rawByRequirement.get(requirement).push({...base(candidate,unit(candidate,needle),'fact-'+String(id++).padStart(3,'0')),...fields});};
    const a="incident_assessment_containment_control",p="incident_evidence_log_preservation",r="response_recovery_remediation_validation";
    add(a,"assessment-full-operative-procedure","assesses the nature",{action:"assess",object:"incident_nature_and_scope",modality:"conditional_operative"});
    add(a,"assessment-full-operative-procedure","identify each customer",{action:"identify",object:"customer_information_system",modality:"required"});
    add(a,"assessment-full-operative-procedure","isolate compromised",{action:"isolate",object:"compromised_asset",modality:"required"});
    add(a,"assessment-incident-history-negative","entered",{action:"record",object:"incident_materials",workflow_scope:"general_governance"});
    add(p,"preservation-full-operative-procedure","maintains a contemporaneous",{action:"maintain",object:"incident_materials",record_or_material:"incident_file"});
    add(p,"preservation-full-operative-procedure","Relevant logs and volatile",{action:"preserve",object:"volatile_information",record_or_material:"logs"});
    add(p,"preservation-full-operative-procedure","access-controlled",{action:"store",object:"other",record_or_material:"exports"});
    add(p,"preservation-records-inventory-partial","preserved for five years",{action:"preserve",object:"incident_materials",record_or_material:"notification_records",preservation_method:"fixed_retention_period",modality:"required"});
    add(p,"preservation-optional-language-negative","retain a log source",{action:"retain",object:"logs",modality:"optional"});
    const compound=find(r,"recovery-full-operative-procedure").candidate;
    for(const [action,object] of [["restore","service"],["reset","credentials"],["patch","patch"],["remove","unauthorized_access_path"]]) add(r,"recovery-full-operative-procedure","restore services",{action,object});
    add(r,"recovery-full-operative-procedure","validates security logging",{action:"validate",object:"system",modality:"conditional_operative"});
    add(r,"recovery-full-operative-procedure","Remediation items",{action:"assign",object:"remediation_item"});
    add(r,"recovery-corrective-ownership-negative","corrective action",{action:"remediate",object:"remediation_item",workflow_scope:"contract_management"});
    add(r,"recovery-appendix-inventory-negative","Incident File Minimum Contents",{action:"inventory",object:"record_contents",workflow_scope:"records_inventory"});
    add(r,"recovery-restoration-monitoring-partial","returns systems to service",{action:"restore",object:"system",modality:"conditional_operative"});
    const outcomes=requests.map(request=>{const raw=rawByRequirement.get(request.requirement_id);const v=validateV3ExtractionResponse(request,{facts:raw});return {requirement_id:request.requirement_id,outcome:"model_success",raw_provider_exchange:{constructed:true},raw_model_content:JSON.stringify({facts:raw}),facts:v.facts,rejected_facts:v.rejectedFacts,facts_returned:v.factsReturned,validation_errors:[],selected_unit_reference_count:v.selectedUnitReferenceCount,invalid_unit_reference_count:0};});
    const scored=scoreV3Prototype(fixtures,requests,outcomes,"2026-07-21T00:00:00.000Z");
    console.log(JSON.stringify({valid:scored.valid,metrics:scored.metrics,cases:scored.cases.map(x=>({id:x.case_id,status:x.status,elements:x.supported_elements}))}));
  `);
  assert.equal(result.valid, true);
  assert.equal(result.metrics.element_precision.rate, 1);
  assert.equal(result.metrics.element_recall.rate, 1);
  assert.equal(result.metrics.requirement_status_accuracy.rate, 1);
  assert.equal(result.metrics.false_assurance.count, 0);
  assert.equal(result.metrics.hard_negative_rejection.rate, 1);
  assert.equal(result.metrics.exact_source_unit_validity.rate, 1);
});
