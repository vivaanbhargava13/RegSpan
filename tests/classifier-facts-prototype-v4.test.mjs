import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(".");
const fixturesPath = resolve("eval-fixtures/classifier-capability/fixtures.v2.json");
const loader = ["--conditions=react-server", "--import", "./scripts/registerServerTsLoader.mjs"];

async function runTs(source) {
  const { stdout } = await execFileAsync(process.execPath, [...loader, "--input-type=module", "--eval", source], { cwd: root });
  return JSON.parse(stdout);
}

const setup = `
  import { readFile } from "node:fs/promises";
  import { buildV4ExtractionRequests, validateV4ExtractionResponse, scoreV4Prototype, mapV3Fact } from "./lib/classifierFactsPrototypeV4.ts";
  import { validateClassifierCapabilityFixtures } from "./lib/classifierCapabilityEval.ts";
  const fixtures=validateClassifierCapabilityFixtures(JSON.parse(await readFile(${JSON.stringify(fixturesPath)},"utf8")));
  const requests=buildV4ExtractionRequests(fixtures);
  const find=(requirement,caseId)=>{const request=requests.find(x=>x.requirement_id===requirement);return {request,candidate:request.candidates.find(x=>x.case_id===caseId)}};
  const unit=(candidate,needle)=>candidate.units.find(x=>x.text.includes(needle));
  const base=(candidate,source,id="fact-001")=>({fact_id:id,source_candidate_id:candidate.candidate_id,source_unit_ids:[source.unit_id],actor:null,action:null,object:null,workflow_scope:"incident_response",condition_or_trigger:null,modality:"operative",tracking_details:null,validation_activity:null,record_or_material:null,preservation_method:null});
  const response=(request,factsByUnit=new Map())=>({units:request.candidates.flatMap(candidate=>candidate.units.map(source=>{const facts=factsByUnit.get(source.unit_id)??[];return {unit_id:source.unit_id,disposition:facts.length?"facts":"no_fact",facts,no_fact_reason:facts.length?null:"No relevant operative fact."};}))});
`;

test("V4 returns exactly one accountable entry for every supplied unit", async () => {
  const value = await runTs(`${setup}
    const request=requests[0];const raw=response(request);const validated=validateV4ExtractionResponse(request,raw);
    console.log(JSON.stringify({supplied:validated.unitsSupplied,returned:validated.unitsReturned,unique:new Set(validated.unitResults.map(x=>x.unit_id)).size,noFacts:validated.unitResults.every(x=>x.disposition==="no_fact")}));
  `);
  assert.equal(value.supplied, value.returned);
  assert.equal(value.unique, value.supplied);
  assert.equal(value.noFacts, true);
});

test("V4 request validation rejects omitted, duplicated, and unknown units", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],valid=response(request);const results={};
    for(const [name,raw] of Object.entries({omitted:{units:valid.units.slice(1)},duplicated:{units:[...valid.units,valid.units[0]]},unknown:{units:valid.units.map((x,i)=>i?x:{...x,unit_id:"foreign:u001:deadbeef"})}})){try{validateV4ExtractionResponse(request,raw);results[name]=false;}catch(error){results[name]=String(error);}}
    console.log(JSON.stringify(results));
  `);
  assert.match(value.omitted, /omitted units/);
  assert.match(value.duplicated, /duplicated units/);
  assert.match(value.unknown, /unknown or cross-requirement unit/);
});

test("V4 enforces facts and no_fact exclusivity", async () => {
  const value = await runTs(`${setup}
    const request=requests[0],valid=response(request),first=valid.units[0];const errors=[];
    for(const entry of [{...first,disposition:"facts",facts:[],no_fact_reason:null},{...first,disposition:"facts",facts:[{}],no_fact_reason:"reason"},{...first,disposition:"no_fact",facts:[{}],no_fact_reason:"reason"},{...first,disposition:"no_fact",facts:[],no_fact_reason:null}]){try{validateV4ExtractionResponse(request,{units:[entry,...valid.units.slice(1)]});errors.push(false);}catch(error){errors.push(/exclusivity/.test(String(error)));}}
    console.log(JSON.stringify(errors));
  `);
  assert.deepEqual(value, [true, true, true, true]);
});

test("V4 no_fact entries and suspicious no_fact diagnostics never create evidence", async () => {
  const value = await runTs(`${setup}
    const outcomes=requests.map(request=>{const raw=response(request);const v=validateV4ExtractionResponse(request,raw);return {requirement_id:request.requirement_id,outcome:"model_success",raw_provider_exchange:{constructed:true},raw_model_content:JSON.stringify(raw),facts:v.facts,rejected_facts:v.rejectedFacts,facts_returned:v.factsReturned,validation_errors:[],selected_unit_reference_count:v.selectedUnitReferenceCount,invalid_unit_reference_count:0,unit_results:v.unitResults,units_supplied:v.unitsSupplied,units_returned:v.unitsReturned,units_missing:[],units_duplicated:[],request_sha256:"a".repeat(64),response_sha256:"b".repeat(64),raw_provider_exchange_id:"constructed"};});
    const result=scoreV4Prototype(fixtures,requests,outcomes,"2026-07-21T00:00:00.000Z");
    console.log(JSON.stringify({elements:result.cases.flatMap(x=>x.supported_elements).length,suspicious:result.requirement_diagnostics.reduce((sum,x)=>sum+x.high_signal_units_marked_no_fact.length,0),safe:result.requirement_diagnostics.every(x=>x.high_signal_units_marked_no_fact.every(y=>y.creates_evidence===false))}));
  `);
  assert.equal(value.elements, 0);
  assert.equal(value.suspicious > 0, true);
  assert.equal(value.safe, true);
});

test("V4 supports compound atomic recovery, return-to-service, and monitoring facts", async () => {
  const value = await runTs(`${setup}
    const {request,candidate}=find("response_recovery_remediation_validation","recovery-full-operative-procedure");const compound=unit(candidate,"restore services");
    const facts=[["restore","service"],["reset","credentials"],["patch","patch"],["remove","unauthorized_access_path"]].map(([action,object],i)=>({...base(candidate,compound,'fact-'+String(i+1).padStart(3,'0')),action,object}));
    const partial=find("response_recovery_remediation_validation","recovery-restoration-monitoring-partial").candidate;const returnUnit=unit(partial,"returns systems to service");
    facts.push({...base(partial,returnUnit,"fact-005"),action:"restore",object:"system",modality:"conditional_operative"},{...base(partial,returnUnit,"fact-006"),action:"monitor",object:"other",modality:"conditional_operative"});
    const byUnit=new Map([[compound.unit_id,facts.slice(0,4)],[returnUnit.unit_id,facts.slice(4)]]);const v=validateV4ExtractionResponse(request,response(request,byUnit));
    console.log(JSON.stringify({accepted:v.facts.length,multi:v.unitResults.filter(x=>x.accepted_fact_ids.length>1).map(x=>x.accepted_fact_ids.length),mapped:v.facts.map(x=>({action:x.action,elements:mapV3Fact(request.requirement_id,x).mapped,quote:x.reconstructed_quote}))}));
  `);
  assert.equal(value.accepted, 6);
  assert.deepEqual(value.multi.sort(), [2, 4]);
  assert.equal(value.mapped.filter((item) => item.action === "restore").every((item) => item.elements.includes("recovery_steps")), true);
  assert.deepEqual(value.mapped.find((item) => item.action === "monitor").elements, []);
  assert.match(value.mapped.find((item) => item.action === "restore" && item.quote.includes("returns systems")).quote, /^After containment/);
});

test("V4 maps fixed retention and controlled custody storage with exact reconstructed quotes", async () => {
  const value = await runTs(`${setup}
    const {request,candidate}=find("incident_evidence_log_preservation","preservation-full-operative-procedure");const storage=unit(candidate,"access-controlled");
    const partial=find("incident_evidence_log_preservation","preservation-records-inventory-partial").candidate,retention=unit(partial,"preserved for five years");
    const facts=new Map([
      [storage.unit_id,[{...base(candidate,storage,"fact-001"),action:"store",object:"other",record_or_material:"exports",preservation_method:"custody_metadata"}]],
      [retention.unit_id,[{...base(partial,retention,"fact-002"),action:"preserve",object:"incident_materials",record_or_material:"notification_records",preservation_method:"fixed_retention_period",modality:"required"}]],
    ]);const v=validateV4ExtractionResponse(request,response(request,facts));
    console.log(JSON.stringify(v.facts.map(x=>({id:x.fact_id,quote:x.reconstructed_quote,mapped:mapV3Fact(request.requirement_id,x).mapped}))));
  `);
  assert.deepEqual(value.find((item) => item.id === "fact-001").mapped, ["incident_materials", "preservation_process", "integrity_or_chain_of_custody"]);
  assert.deepEqual(value.find((item) => item.id === "fact-002").mapped, ["incident_materials"]);
  assert.match(value.find((item) => item.id === "fact-001").quote, /source, collection time, custodian, and integrity/);
});

test("V4 preserves optional, inventory, procurement, and provider-oversight safeguards", async () => {
  const value = await runTs(`${setup}
    const specs=[
      ["incident_evidence_log_preservation","preservation-optional-language-negative","retain a log source","retain","logs","incident_response","optional"],
      ["response_recovery_remediation_validation","recovery-appendix-inventory-negative","Incident File Minimum Contents","inventory","record_contents","records_inventory","descriptive"],
      ["response_recovery_remediation_validation","recovery-corrective-ownership-negative","corrective action","remediate","remediation_item","contract_management","operative"],
      ["incident_assessment_containment_control","assessment-incident-history-negative","Continuing service-company review","review","other","service_provider_oversight","descriptive"],
    ];const output=[];let id=1;
    for(const [requirement,caseId,needle,action,object,scope,modality] of specs){const {request,candidate}=find(requirement,caseId),source=unit(candidate,needle),raw={...base(candidate,source,'fact-'+String(id++).padStart(3,'0')),action,object,workflow_scope:scope,modality};const v=validateV4ExtractionResponse(request,response(request,new Map([[source.unit_id,[raw]]])));output.push({accepted:v.facts.length,rejected:v.rejectedFacts.flatMap(x=>x.rejection_codes)});}
    console.log(JSON.stringify(output));
  `);
  assert.equal(value.every((item) => item.accepted === 0 && item.rejected.length), true);
  assert.match(value.flatMap((item) => item.rejected).join(" "), /optional_modality/);
  assert.match(value.flatMap((item) => item.rejected).join(" "), /workflow_scope_mismatch:contract_management/);
  assert.match(value.flatMap((item) => item.rejected).join(" "), /workflow_scope_mismatch:service_provider_oversight/);
});

test("V4 quarantines a bad fact without erasing its valid sibling", async () => {
  const value = await runTs(`${setup}
    const {request,candidate}=find("response_recovery_remediation_validation","recovery-full-operative-procedure"),source=unit(candidate,"restore services");
    const valid={...base(candidate,source,"fact-001"),action:"restore",object:"service"};const invalid={...base(candidate,source,"fact-002"),action:"validate",object:"remediation_item"};
    const v=validateV4ExtractionResponse(request,response(request,new Map([[source.unit_id,[valid,invalid]]])));console.log(JSON.stringify({accepted:v.facts.map(x=>x.fact_id),rejected:v.rejectedFacts.map(x=>({id:x.fact_id,codes:x.rejection_codes})),quote:v.facts[0].reconstructed_quote}));
  `);
  assert.deepEqual(value.accepted, ["fact-001"]);
  assert.equal(value.rejected[0].id, "fact-002");
  assert.match(value.rejected[0].codes.join(" "), /action_not_grounded:validate/);
  assert.match(value.quote, /System owners restore services/);
});

test("V4 dry plan contains exactly three requests and the normalized fact contract", async () => {
  const dry = JSON.parse(await readFile(resolve("eval-results/classifier-facts-prototype/v4/dry-run.json"), "utf8"));
  assert.equal(dry.schema_version, "classifier-facts-prototype-dry-run/v4");
  assert.equal(dry.network_calls, 0);
  assert.equal(dry.request_count, 3);
  assert.equal(dry.scored_case_count, 9);
  assert.equal(dry.request_hashes.length, 3);
  const schema = dry.requests[0].request_body.response_format.json_schema.schema;
  assert.deepEqual(schema.required, ["units"]);
  assert.deepEqual(schema.properties.units.items.required.sort(), ["disposition", "facts", "no_fact_reason", "unit_id"]);
});

test("V1 through V3 paid artifacts remain byte-for-byte immutable", async () => {
  const registry = JSON.parse(await readFile(resolve("eval-fixtures/classifier-facts-prototype/artifact-baselines.v4.json"), "utf8"));
  assert.equal(registry.artifacts.length, 8);
  for (const artifact of registry.artifacts) {
    const bytes = await readFile(resolve(artifact.path));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), artifact.sha256);
  }
});

test("V4 changes remain outside production application paths", async () => {
  const { stdout } = await execFileAsync("git", ["status", "--short"], { cwd: root });
  const paths = stdout.trim().split("\n").filter(Boolean).map((line) => line.slice(3));
  assert.equal(paths.some((path) => /^(app|components|supabase\/migrations)\//u.test(path)), false);
  assert.equal(paths.some((path) => path.includes("classifierFactsPrototypeV3.ts")), false);
});

test("V4 constructed unit-accountable responses score all nine cases offline", async () => {
  const value = await runTs(`${setup}
    const maps=new Map(requests.map(x=>[x.requirement_id,new Map()]));let id=1;
    const add=(requirement,caseId,needle,fields)=>{const {candidate}=find(requirement,caseId),source=unit(candidate,needle),map=maps.get(requirement),facts=map.get(source.unit_id)??[];facts.push({...base(candidate,source,'fact-'+String(id++).padStart(3,'0')),...fields});map.set(source.unit_id,facts);};
    const a="incident_assessment_containment_control",p="incident_evidence_log_preservation",r="response_recovery_remediation_validation";
    add(a,"assessment-full-operative-procedure","assesses the nature",{action:"assess",object:"incident_nature_and_scope",modality:"conditional_operative"});
    add(a,"assessment-full-operative-procedure","identify each customer",{action:"identify",object:"customer_information_system",modality:"required"});
    add(a,"assessment-full-operative-procedure","isolate compromised",{action:"isolate",object:"compromised_asset",modality:"required"});
    add(a,"assessment-incident-history-negative","entered",{action:"record",object:"incident_materials",workflow_scope:"general_governance"});
    add(p,"preservation-full-operative-procedure","maintains a contemporaneous",{action:"maintain",object:"incident_materials",record_or_material:"incident_file"});
    add(p,"preservation-full-operative-procedure","Relevant logs and volatile",{action:"preserve",object:"volatile_information",record_or_material:"logs"});
    add(p,"preservation-full-operative-procedure","access-controlled",{action:"store",object:"other",record_or_material:"exports",preservation_method:"custody_metadata"});
    add(p,"preservation-records-inventory-partial","preserved for five years",{action:"preserve",object:"incident_materials",record_or_material:"notification_records",preservation_method:"fixed_retention_period",modality:"required"});
    add(p,"preservation-optional-language-negative","retain a log source",{action:"retain",object:"logs",modality:"optional"});
    for(const [action,object] of [["restore","service"],["reset","credentials"],["patch","patch"],["remove","unauthorized_access_path"]]) add(r,"recovery-full-operative-procedure","restore services",{action,object});
    add(r,"recovery-full-operative-procedure","validates security logging",{action:"validate",object:"system",modality:"conditional_operative"});
    add(r,"recovery-full-operative-procedure","Remediation items",{action:"assign",object:"remediation_item"});
    add(r,"recovery-corrective-ownership-negative","corrective action",{action:"remediate",object:"remediation_item",workflow_scope:"contract_management"});
    add(r,"recovery-appendix-inventory-negative","Incident File Minimum Contents",{action:"inventory",object:"record_contents",workflow_scope:"records_inventory",modality:"descriptive"});
    add(r,"recovery-restoration-monitoring-partial","returns systems to service",{action:"restore",object:"system",modality:"conditional_operative"});
    add(r,"recovery-restoration-monitoring-partial","returns systems to service",{action:"monitor",object:"other",modality:"conditional_operative"});
    const outcomes=requests.map(request=>{const raw=response(request,maps.get(request.requirement_id)),v=validateV4ExtractionResponse(request,raw);return {requirement_id:request.requirement_id,outcome:"model_success",raw_provider_exchange:{id:"constructed"},raw_model_content:JSON.stringify(raw),facts:v.facts,rejected_facts:v.rejectedFacts,facts_returned:v.factsReturned,validation_errors:[],selected_unit_reference_count:v.selectedUnitReferenceCount,invalid_unit_reference_count:0,unit_results:v.unitResults,units_supplied:v.unitsSupplied,units_returned:v.unitsReturned,units_missing:[],units_duplicated:[],request_sha256:"a".repeat(64),response_sha256:"b".repeat(64),raw_provider_exchange_id:"constructed"};});
    const result=scoreV4Prototype(fixtures,requests,outcomes,"2026-07-21T00:00:00.000Z");console.log(JSON.stringify({valid:result.valid,accountable:result.unit_accountability_complete,metrics:result.metrics,diagnostics:result.requirement_diagnostics}));
  `);
  assert.equal(value.valid, true);
  assert.equal(value.accountable, true);
  assert.equal(value.metrics.element_precision.rate, 1);
  assert.equal(value.metrics.element_recall.rate, 1);
  assert.equal(value.metrics.requirement_status_accuracy.rate, 1);
  assert.equal(value.metrics.false_assurance.count, 0);
  assert.equal(value.metrics.hard_negative_rejection.rate, 1);
  assert.equal(value.metrics.exact_source_unit_validity.rate, 1);
  assert.equal(value.diagnostics.every((item) => item.units_supplied === item.units_returned), true);
});
