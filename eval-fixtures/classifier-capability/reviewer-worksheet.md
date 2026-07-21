# Classifier capability reviewer worksheet

Fixture suite hash: `9870600f6a6a01d586f3da0de52a5c97a830c3e81a5f5fc4b6879b63a292c8a9`

## Unresolved blocker

No suitable frozen local artifact was found. The requirement and retrieval reports preserve ordered candidate text, document IDs, and chunk indexes, but omit original candidate chunk IDs and exact candidate-text hashes; the isolated corpus results contain case summaries rather than ordered candidates. A review case cannot be created without fabricating identity or provenance.

Artifacts inspected:

- `eval-results/requirement-eval-latest.json`
- `eval-results/retrieval-eval-latest.json`
- `eval-results/classifier-capability/dry-run.json`
- `eval-results/corpus-regspan-v1-isolated-*/results.{json,csv}`
- `eval-results/corpus-regspan-v2-realistic-company-policies-isolated-*/results.{json,csv}`

No multi-candidate review section was added because doing so would require fabricating missing candidate IDs or hashes.

## assessment-full-operative-procedure

Role: `scored`
Requirement: **Incident assessment, containment, and control** (`incident_assessment_containment_control`)
The reviewed documents appear to define how the firm assesses the nature and scope of unauthorized access or use of customer information and takes steps to contain and control the incident.

Proposed final status: `covered`
Proposed supported elements: `assesses_scope, customer_information_systems, containment_control`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: assessment-full-1

```text
For every suspected incident involving unauthorized access to or use of customer information, the response team assesses the nature and scope of the incident. The assessment identifies the date and method of access, affected accounts and users, duration, privileges obtained, systems involved, and whether data was viewed, copied, altered, transmitted, or destroyed.
The assessment must identify each customer information system that may have been affected and the types of customer information stored or processed in those systems. The team records whether sensitive customer information may be involved and identifies affected individuals when reasonably possible.
• isolate compromised hosts, accounts, applications, or network segments;
• disable or reset credentials and rotate keys or tokens;
• block malicious infrastructure and preserve monitoring;
• search for additional affected systems and unauthorized persistence;
• coordinate controlled shutdowns when needed to prevent further unauthorized access or use.
```

Proposed: relationship `supports`; elements `assesses_scope, customer_information_systems, containment_control`; direct-support `true`; hard-negative `false`.

Provenance: `manual_adjudication`, eval/corpora/regspan-v2-realistic-corpus/documents/northline_regulation_sp_policy.pdf, PDF page 3, section 5.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## assessment-incident-history-negative

Role: `scored`
Requirement: **Incident assessment, containment, and control** (`incident_assessment_containment_control`)
The reviewed documents appear to define how the firm assesses the nature and scope of unauthorized access or use of customer information and takes steps to contain and control the incident.

Proposed final status: `missing`
Proposed supported elements: `none`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: assessment-history-1

```text
Rule 121 - Continuing service-company review. Assurance reports, material changes, remediation, and incident history are entered in OakMeridia Evidence Register.
```

Proposed: relationship `irrelevant`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, tests/requirement-debug.test.mjs, negative fixture near line 349.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## assessment-monitoring-escalation-partial

Role: `diagnostic_only`
Requirement: **Incident assessment, containment, and control** (`incident_assessment_containment_control`)
The reviewed documents appear to define how the firm assesses the nature and scope of unauthorized access or use of customer information and takes steps to contain and control the incident.

Proposed final status: `partial`
Proposed supported elements: `customer_information_systems`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: assessment-partial-1

```text
Security alerts from endpoint, firewall, authentication, and cloud systems are reviewed by IT Operations. Potential unauthorized access is escalated internally to the IT Manager and Compliance mailbox when customer information may be involved. The IT Manager may open an incident ticket and request help from Legal or Compliance when the event appears material. Incident tickets should include affected systems, dates, owner, and current status.
```

Proposed: relationship `partially_supports`; elements `customer_information_systems`; direct-support `false`; hard-negative `false`.

Provenance: `diagnostic_artifact`, eval-results/requirement-eval-latest.json, unauthorized_access_detection_escalation candidate chunk 1.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## preservation-full-operative-procedure

Role: `scored`
Requirement: **Incident evidence and log preservation** (`incident_evidence_log_preservation`)
The reviewed documents appear to preserve logs, records, forensic evidence, and other incident materials that support investigation and later compliance documentation.

Proposed final status: `covered`
Proposed supported elements: `incident_materials, integrity_or_chain_of_custody, preservation_process`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: preservation-full-1

```text
The incident manager maintains a contemporaneous incident file containing alerts, system and identity logs, relevant exports, screenshots, investigation notes, affected-system and data inventories, decisions, approvals, containment steps, customer-notice analysis, provider communications, recovery tests, and closure documentation.
Relevant logs and volatile information are preserved promptly. Exports are stored in access-controlled case folders with source, collection time, custodian, and integrity information when material to the investigation. Routine log retention is not shortened while an incident, investigation, examination, or legal hold is open.
```

Proposed: relationship `supports`; elements `incident_materials, integrity_or_chain_of_custody, preservation_process`; direct-support `true`; hard-negative `false`.

Provenance: `manual_adjudication`, eval/corpora/regspan-v2-realistic-corpus/documents/northline_regulation_sp_policy.pdf, PDF page 6, section 12.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## preservation-log-procedure

Role: `diagnostic_only`
Requirement: **Incident evidence and log preservation** (`incident_evidence_log_preservation`)
The reviewed documents appear to preserve logs, records, forensic evidence, and other incident materials that support investigation and later compliance documentation.

Proposed final status: `covered`
Proposed supported elements: `incident_materials, preservation_process`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: preservation-log-1

```text
System logs, authentication logs, and cloud audit records are retained for investigation support. IT Operations preserves relevant logs when an incident ticket is opened and may export copies for review by Compliance or outside investigators. The procedure does not define a full forensic chain-of-custody process, but incident owners should document where evidence was collected and who handled it.
```

Proposed: relationship `supports`; elements `incident_materials, preservation_process`; direct-support `false`; hard-negative `false`.

Provenance: `diagnostic_artifact`, eval-results/requirement-eval-latest.json, evidence_log_preservation candidate chunk 3.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## preservation-records-inventory-partial

Role: `scored`
Requirement: **Incident evidence and log preservation** (`incident_evidence_log_preservation`)
The reviewed documents appear to preserve logs, records, forensic evidence, and other incident materials that support investigation and later compliance documentation.

Proposed final status: `partial`
Proposed supported elements: `incident_materials`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: preservation-inventory-1

```text
Books and records include notification investigations, determinations, supporting facts, and the basis for any no-notice decision.
• The file also includes written documentation from the Attorney General concerning any delay in notice.
• These records are preserved for five years.
```

Proposed: relationship `partially_supports`; elements `incident_materials`; direct-support `false`; hard-negative `false`.

Provenance: `manual_adjudication`, tests/findings-generation.test.mjs, records inventory fixture near line 1227.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## preservation-optional-language-negative

Role: `scored`
Requirement: **Incident evidence and log preservation** (`incident_evidence_log_preservation`)
The reviewed documents appear to preserve logs, records, forensic evidence, and other incident materials that support investigation and later compliance documentation.

Proposed final status: `missing`
Proposed supported elements: `none`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: preservation-optional-1

```text
The incident briefing may discuss logs and communications, and a shared folder can be used by personnel. The duty manager controls access to the folder and may ask Technology to retain a log source.
```

Proposed: relationship `background_context`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, tests/requirement-debug.test.mjs, negative fixtures near lines 352-360.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## recovery-full-operative-procedure

Role: `scored`
Requirement: **Response recovery and remediation validation** (`response_recovery_remediation_validation`)
The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.

Proposed final status: `covered`
Proposed supported elements: `recovery_steps, remediation_tracking, validation_testing`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: recovery-full-1

```text
Recovery begins after the response lead confirms that immediate containment is stable. System owners restore services from approved configurations and backups, reset or reissue credentials, apply patches or configuration changes, and verify that unauthorized access paths have been removed.
Before returning a material customer information system to normal operation, the owner validates security logging, access permissions, data integrity, critical transactions, and required business functions. Remediation items are assigned owners and due dates and remain open until evidence of completion is reviewed.
• document restored systems and data sources;
• perform targeted monitoring for recurrence;
• confirm customer-service and notice obligations remain on track;
• complete a lessons-learned review and update procedures, safeguards, or service-provider requirements;
• obtain closure approval from the incident lead and Compliance.
```

Proposed: relationship `supports`; elements `recovery_steps, remediation_tracking, validation_testing`; direct-support `true`; hard-negative `false`.

Provenance: `manual_adjudication`, eval/corpora/regspan-v2-realistic-corpus/documents/northline_regulation_sp_policy.pdf, PDF page 6, section 14.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## recovery-corrective-ownership-negative

Role: `scored`
Requirement: **Response recovery and remediation validation** (`response_recovery_remediation_validation`)
The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.

Proposed final status: `missing`
Proposed supported elements: `none`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: recovery-ownership-1

```text
Vendors are expected to comply with applicable law and the terms of their agreements. Business owners contact Procurement when vendor performance is unsatisfactory. Procurement records contract issues and coordinates corrective action with the business owner.
```

Proposed: relationship `irrelevant`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, eval/corpora/regspan-v2-realistic-corpus/documents/lakeshore_regulation_sp_compliance_program.pdf, PDF page 3, section 8.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## recovery-appendix-inventory-negative

Role: `scored`
Requirement: **Response recovery and remediation validation** (`response_recovery_remediation_validation`)
The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.

Proposed final status: `missing`
Proposed supported elements: `none`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: recovery-inventory-1

```text
Appendix A - Incident File Minimum Contents: investigation timeline, containment actions, recovery steps, corrective actions, validation results, and closure approval.
```

Proposed: relationship `background_context`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, tests/operative-evidence-elements.test.mjs, inventory fixture near line 174.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## recovery-restoration-monitoring-partial

Role: `scored`
Requirement: **Response recovery and remediation validation** (`response_recovery_remediation_validation`)
The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.

Proposed final status: `partial`
Proposed supported elements: `recovery_steps`

Reviewer final status: ____________________
Reviewer supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: recovery-partial-1

```text
After containment, the firm returns systems to service and monitors for recurring issues. Technology monitors the restored environment for recurring problems during the next business cycle.
```

Proposed: relationship `partially_supports`; elements `recovery_steps`; direct-support `false`; hard-negative `false`.

Provenance: `manual_adjudication`, eval/corpora/regspan-v2-realistic-corpus/documents/stonehaven_privacy_cybersecurity_practices.pdf, PDF page 5, section 14.

Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

