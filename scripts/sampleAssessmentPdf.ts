import { mkdir, writeFile } from "node:fs/promises";
import { createAssessmentReport, type AssessmentInput, type AssessmentFinding } from "../lib/assessmentReport";
import { REG_SP_REQUIREMENTS } from "../lib/regSpRequirements";
import { renderAssessmentPdf } from "../lib/assessmentPdf";

// Deliberately synthetic: never use these findings as a real assessment.
export function syntheticAssessment(): AssessmentInput {
  const statuses = ["covered", "partial", "missing", "conflicting", "needs_review"] as const;
  const names = ["Written incident response program", "Customer notice content", "Compliance records", "Service provider incident handling", "Customer information safeguards"];
  const ids = ["written_incident_response_program", "customer_notification_content", "written_compliance_records", "vendor_incident_handling", "customer_information_safeguards"];
  const longQuote = Array.from({length: 26}, (_, i) => `Synthetic clause ${i+1}: The exercise coordinator records the incident assessment and preserves the review notes in the training register. This quotation is fabricated solely to demonstrate report pagination.`).join("\n");
  const findings: AssessmentFinding[] = statuses.map((status,i)=>({
    id: `synthetic-finding-${i+1}`, workspace_id: "synthetic-workspace", analysis_run_id: "SYNTHETIC-DEMO-RUN-001",
    requirement_id: ids[i], requirement_name: names[i], status, severity: (["high", "high", "medium", "critical", "low"] as const)[i],
    summary: ["Synthetic assessment: the training policy records a written incident program.", "Synthetic assessment: notice content is documented in part; the contact channel is unresolved.", "Synthetic assessment: no supporting records-retention procedure was identified.", "Synthetic assessment: two training documents record inconsistent provider notification steps.", "Synthetic assessment: a reviewer must confirm the scope of the safeguards procedure."][i],
    rationale: "Synthetic assessment rationale: this illustrative conclusion is based only on the fabricated training excerpts shown in this sample. It is not an evaluation of any organization.",
    remediation: i === 2 ? null : "Synthetic recommendation: review the cited training material and document the missing or inconsistent procedure, then confirm the assessment with a qualified reviewer.",
    evidence: i === 2 ? [] : [{ id: `synthetic-evidence-${i+1}-a`, document_id: i === 4 ? "synthetic-document-long" : "synthetic-document-a", chunk_id: `synthetic-chunk-${i+1}`, relationship: status === "covered" ? "supports" : status === "conflicting" ? "contradicts" : "partially_supports", quote: i === 4 ? longQuote : "SYNTHETIC SOURCE: The training coordinator shall document the incident assessment and notify the exercise response team.", evidence_quote: i === 1 ? "SYNTHETIC ALTERNATE SOURCE: The example notice describes the affected information; no contact channel is specified." : null, reason: "Synthetic evidence assessment for layout testing only.", filename: i === 4 ? `SYNTHETIC_${"LongUnbrokenFilename".repeat(12)}.pdf` : "SYNTHETIC-training-policy.pdf", section_path: "Synthetic training / Incident response / Exercise procedure", page_start: 7, page_end: 9 }, ...(i===3 ? [{ id: "synthetic-evidence-4-b", document_id: "synthetic-document-b", chunk_id: "synthetic-chunk-b", relationship: "contradicts", quote: "SYNTHETIC SOURCE: The example provider procedure assigns the notification step to the vendor coordinator instead of the exercise response team.", evidence_quote: null, reason: null, filename: "SYNTHETIC-provider-playbook.pdf", section_path: null, page_start: null, page_end: null }] : [])],
  }));
  return { workspaceName: "SYNTHETIC DEMONSTRATION / Example Advisory", workspaceId: "synthetic-workspace", run: { id: "SYNTHETIC-DEMO-RUN-001", workspace_id: "synthetic-workspace", status: "completed", completed_at: "2026-11-14T15:30:00Z", requirement_count: 5, finding_count: 5 }, findings, documents: [{ document_id: "synthetic-document-a", filename: "SYNTHETIC-training-policy.pdf" }, { document_id: "synthetic-document-b", filename: "SYNTHETIC-provider-playbook.pdf" }, { document_id: "synthetic-document-long", filename: `SYNTHETIC_${"LongUnbrokenFilename".repeat(12)}.pdf` }] };
}
// Illustrative policy language only; every field is synthetic.
export function typicalSyntheticAssessment(): AssessmentInput {
  const input = syntheticAssessment();
  input.workspaceName = "SYNTHETIC / Example Advisory Partners";
  input.run = { ...input.run, id: "SYNTHETIC-TYPICAL-RUN-011", requirement_count: 11, finding_count: 11 };
  input.documents = [
    { document_id: "synthetic-ir", filename: "SYNTHETIC-Incident-Response-Policy.pdf" },
    { document_id: "synthetic-privacy", filename: "SYNTHETIC-Customer-Privacy-Standard.pdf" },
    { document_id: "synthetic-vendor", filename: "SYNTHETIC-Provider-Oversight-Procedure.pdf" },
  ];
  const cases = [
    ["covered", "high", "The policy establishes a written customer-information incident response program.", "Detection, response, recovery and annual program review are documented in the incident response policy.", "Maintain the documented program and confirm changes during the next policy review.", "The firm maintains a written incident response program for customer information. The program describes detection, assessment, containment and recovery activities and is reviewed annually."],
    ["partial", "high", "Assessment and containment are defined, but customer-information impact analysis is not documented.", "The response team assesses system scope and isolates affected assets. The policy does not specify how the team evaluates customer-information exposure.", "Document the customer-information impact assessment within the existing incident triage procedure.", "The incident coordinator shall assess affected systems, record the incident scope and direct containment of affected assets. The response team shall preserve its assessment notes."],
    ["partial", "high", "The customer-notification decision is documented, but the timing standard is unresolved.", "The privacy standard requires a notification assessment after unauthorized access. A notification timing standard was not identified in the reviewed text.", "Add the applicable notification timing standard and document the decision process in the privacy standard.", "The privacy lead shall evaluate whether affected customers require notification following unauthorized access to customer information. The decision and supporting analysis shall be recorded in the incident file."],
    // F-04 deliberately contradicts its Covered conclusion with its recorded recommendation.
    // This is a manually authored integrity test, not a classifier result or an automated flag.
    ["covered", "medium", "The customer-notice template includes the documented notice content.", "The template describes the incident, affected information, protective measures and a contact channel for customer questions.", "No notice content is documented. Draft a complete customer-notice template.", "Customer notices shall describe the incident and affected information, explain available protective measures and provide the privacy team's contact details for additional assistance."],
    ["conflicting", "critical", "Provider notification instructions differ between the policy and the oversight procedure.", "The policy assigns provider escalation to the incident coordinator; the oversight procedure assigns the same decision to the vendor manager without a reconciliation step.", "Reconcile the conflicting provider escalation instructions and approve a single documented decision path.", "The incident coordinator shall determine the escalation of service-provider incidents and document the notification decision in the incident register."],
    ["covered", "high", "The privacy standard documents safeguards for customer information.", "Access restrictions, periodic access review and encryption requirements apply to customer-information repositories.", "Maintain safeguards documentation and retain evidence of periodic access reviews.", "Access to customer-information repositories is restricted to approved personnel. The access register is reviewed quarterly, and customer information shall be encrypted in storage and during transmission."],
    ["covered", "medium", "The privacy standard defines secure disposal of customer information.", "The procedure applies to paper and electronic records and requires disposal records from approved providers.", "Retain disposal records and confirm the documented procedure remains current.", "Paper customer records shall be shredded using approved disposal services. Electronic customer records shall be securely erased, and disposal confirmations shall be retained with the disposal register."],
    ["missing", "medium", "No written compliance-record retention procedure was identified in the reviewed scope.", "The reviewed policies refer to incident files, but they do not state a retention schedule or record-access procedure.", "Document the applicable retention and accessibility requirements for compliance records.", null],
    ["needs_review", "medium", "Evidence preservation is mentioned; the reviewer must confirm chain-of-custody requirements.", "Incident notes must be preserved in the case file. The reviewed excerpt does not establish the complete handling and transfer process.", "Confirm whether another procedure records evidence custody and transfer requirements; update the reference if available.", "The incident coordinator shall preserve relevant logs and assessment notes in the incident file and restrict access to authorized response personnel."],
    ["covered", "medium", "Recovery procedures include documented validation before closure.", "The playbook requires verification of corrective actions and a documented recovery review before an incident is closed.", "Maintain the recovery checklist and retain completed validation records.", "Before closing an incident, the response team shall verify corrective actions, record the recovery review and retain the completed validation checklist with the incident record."],
    ["needs_review", "low", "External notification coordination requires reviewer confirmation.", "The incident policy calls for consultation with legal advisers, but the reviewed excerpt does not identify a complete external coordination procedure.", "Confirm the documented process for coordinating applicable regulator and law-enforcement notifications.", "The incident coordinator shall consult legal advisers when considering external incident notifications and record advice received in the incident file."],
  ] as const;
  input.findings = REG_SP_REQUIREMENTS.slice(0,11).map((requirement, i) => {
    const [status, severity, summary, rationale, remediation, quote] = cases[i];
    const doc = input.documents[i === 4 ? 2 : [2,3,5,6].includes(i) ? 1 : 0];
    return { id: `synthetic-typical-finding-${i+1}`, workspace_id: input.workspaceId, analysis_run_id: input.run.id,
      requirement_id: requirement.id, requirement_name: requirement.title, status, severity, summary, rationale, remediation,
      evidence: quote ? [{ id: `synthetic-typical-evidence-${i+1}`, document_id: doc.document_id, chunk_id: `synthetic-typical-chunk-${i+1}`,
        relationship: status === "covered" ? "supports" : status === "conflicting" ? "contradicts" : "partially_supports",
        quote: `SYNTHETIC SOURCE: ${quote}`, evidence_quote: null, reason: null, filename: doc.filename,
        section_path: `Training example / ${requirement.title}`, page_start: i+2, page_end: i+2 }] : [] };
  });
  // Exercise preserved contradictory recommendations and duplicate narrative fields.
  input.findings[0].rationale = input.findings[0].summary;
  input.findings[4].evidence.push({ ...input.findings[4].evidence[0], id: "synthetic-typical-evidence-5-b", chunk_id: "synthetic-typical-conflict", quote: "SYNTHETIC SOURCE: The vendor manager shall determine the escalation of provider incidents. The procedure does not require referral to the incident coordinator." });
  return input;
}
if (process.argv[1]?.endsWith("sampleAssessmentPdf.ts")) {
  await mkdir("output/pdf", { recursive: true });
  for (const [name, input] of [
    ["regspan-synthetic-assessment.pdf", syntheticAssessment()],
    ["regspan-typical-assessment.pdf", typicalSyntheticAssessment()],
  ] as const) {
    const pdf = await renderAssessmentPdf(createAssessmentReport(input));
    await writeFile(`output/pdf/${name}`, pdf);
    console.log(`${name}: ${pdf.length} bytes (synthetic demonstration)`);
  }
}
