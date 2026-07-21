# Classifier capability reviewer worksheet

Fixture suite hash: `0b03dee820b0be45a74fa87171e3b1700390551eef425f5c97d4647a70713a7a`

## Unresolved blocker

Aggregation case recovery-remediation-validation-cross-candidate-aggregation-review is source-complete but unresolved. Paid mode remains blocked until a reviewer manually adjudicates the final status, case-supported elements, and every candidate relationship, element, direct-support, and hard-negative field.

Artifacts inspected:

- `eval-results/requirement-eval-latest.json`
- `eval-results/retrieval-eval-latest.json`
- `eval-results/classifier-capability/dry-run.json`
- `eval-results/corpus-regspan-v1-isolated-*/results.{json,csv}`
- `eval-results/corpus-regspan-v2-realistic-company-policies-isolated-*/results.{json,csv}`
- `eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json`
- `eval-fixtures/classifier-capability/frozen-aggregation-pack.response-recovery-remediation-validation.json`

The historical reports could not be reconstructed because their stored chunks no longer exist. The multi-candidate section below preserves a newly captured, document-scoped retrieval order and remains entirely unresolved.

## assessment-full-operative-procedure

Role: `scored`
Requirement: **Incident assessment, containment, and control** (`incident_assessment_containment_control`)
The reviewed documents appear to define how the firm assesses the nature and scope of unauthorized access or use of customer information and takes steps to contain and control the incident.

Proposed final status: `covered`
Proposed supported elements: `assesses_scope, customer_information_systems, containment_control`


Reviewer final status: ____________________
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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
Reviewer case-supported elements: ____________________
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

## recovery-remediation-validation-multi-candidate-review

Role: `diagnostic_only`
Requirement: **Response recovery and remediation validation** (`response_recovery_remediation_validation`)
The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.

Proposed final status: `covered`
Proposed supported elements: `recovery_steps, remediation_tracking, validation_testing`


Reviewer final status: ____________________
Reviewer case-supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: 5e7de7c7-f2b1-4550-a35f-aabdf8289972

```text
14. Recovery, Remediation, and Validation

Recovery begins after the response lead confirms that immediate containment is stable. System owners restore services
from approved configurations and backups, reset or reissue credentials, apply patches or configuration changes, and
verify that unauthorized access paths have been removed.
Before returning a material customer information system to normal operation, the owner validates security logging,
access permissions, data integrity, critical transactions, and required business functions. Remediation items are
assigned owners and due dates and remain open until evidence of completion is reviewed.

• document restored systems and data sources;
• perform targeted monitoring for recurrence;
• confirm customer-service and notice obligations remain on track;
• complete a lessons-learned review and update procedures, safeguards, or service-provider requirements;
• obtain closure approval from the incident lead and Compliance.
```

Proposed: relationship `supports`; elements `recovery_steps, remediation_tracking, validation_testing`; direct-support `true`; hard-negative `false`.

Provenance: `manual_adjudication`, eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json, candidates[0].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `5e7de7c7-f2b1-4550-a35f-aabdf8289972`; index `13`; original position `1`.
Citation: northline_regulation_sp_policy.pdf, pages 6-6; section `14. Recovery, Remediation, and Validation`; parent `Document`; path `14. Recovery, Remediation, and Validation`.
Hashes: stored source `22613ed6414b147e970c986979c32578ff1deffd8146f7e5f5949e144d1942fc`; recomputed `22613ed6414b147e970c986979c32578ff1deffd8146f7e5f5949e144d1942fc`; stored embedding input `70eebb19c4f136173d33ed1ceb6d3c3bce2a3fd230556a95c0ac4ca646d54302`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `1`. Retrieval selection: `{"similarity":1,"evidence_reason":"meaningful_policy_context","rerank_score":158,"rerank_reason":"semantic 100.0; action signals: recover, remediation, confirm; topic signals: recovery, remediation, validation; section/path signals: recover, remediation; role organization_evidence; source client_policy; classifier meaningful policy context"}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

### Candidate 2: 8c104761-0821-4330-9cfc-5b843b4d5175

```text
17. Appendix A - Incident File Minimum Contents

• incident identifier, discovery date, and awareness date;
• affected systems, business processes, customer information types, and individuals;
• investigation timeline, containment actions, and recovery steps;
• notification analysis, decision, approvals, and copies of notices;
• service-provider notices, contracts, communications, and remediation;
• logs, exports, screenshots, evidence sources, and preservation details;
• corrective actions, validation results, post-incident findings, and closure approval.
```

Proposed: relationship `background_context`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json, candidates[1].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `8c104761-0821-4330-9cfc-5b843b4d5175`; index `16`; original position `2`.
Citation: northline_regulation_sp_policy.pdf, pages 7-7; section `17. Appendix A - Incident File Minimum Contents`; parent `Document`; path `17. Appendix A - Incident File Minimum Contents`.
Hashes: stored source `7dce6f4d89abb84465546fae07568a2fc3d218b6390d15f6aa9606237cd78322`; recomputed `7dce6f4d89abb84465546fae07568a2fc3d218b6390d15f6aa9606237cd78322`; stored embedding input `6a44d45ae586bf804bbd0f1e3ef7098790d3219e198a5ce2daf345f834e3420f`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `2`. Retrieval selection: `{"similarity":0.795002243099655,"evidence_reason":"meaningful_policy_context","rerank_score":139.5,"rerank_reason":"semantic 79.5; direct signals: corrective action, corrective actions; action signals: recover, remediation, corrective action; topic signals: recovery, remediation, validation; section/path signals: incident; role organization_evidence; source client_policy; classifier meaningful policy context"}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

### Candidate 3: f67e4e3d-d73a-4cc8-a331-04bb9f2c1b6e

```text
4. Cyber Incident Response Governance

Northline Brokerage Services, Inc. maintains this written incident response program as part of its customer information
safeguards framework. The program is reasonably designed to detect, respond to, and recover from unauthorized
access to or use of customer information. It applies to customer information in paper, electronic, and other forms,
including information maintained by service providers on the firm's behalf.
The program begins when monitoring, employee reporting, a service-provider notice, or another reliable source indicates
that unauthorized access or use has occurred or is reasonably likely to have occurred. The Incident Response Lead
opens a case, assigns severity, preserves relevant records, and coordinates assessment, containment, customer-notice
analysis, recovery, and closure.

• Detect: monitor security alerts, access anomalies, customer complaints, lost devices, vendor notices, and misuse
reports.
• Respond: investigate, contain, control, communicate, and document decisions.
• Recover: restore approved services, remediate root causes, validate controls and access, and complete a
post-incident review.
```

Proposed: relationship `partially_supports`; elements `recovery_steps, validation_testing`; direct-support `false`; hard-negative `false`.

Provenance: `manual_adjudication`, eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json, candidates[2].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `f67e4e3d-d73a-4cc8-a331-04bb9f2c1b6e`; index `3`; original position `3`.
Citation: northline_regulation_sp_policy.pdf, pages 3-3; section `4. Cyber Incident Response Governance`; parent `Document`; path `4. Cyber Incident Response Governance`.
Hashes: stored source `ad8d9652a9012326951de4e989cfc0b4c04765b63ca80b5fc50268247ec3156b`; recomputed `ad8d9652a9012326951de4e989cfc0b4c04765b63ca80b5fc50268247ec3156b`; stored embedding input `4942e75572bf3038dac556b87c6924105cba6694a4c45902dc90b43e1653024b`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `3`. Retrieval selection: `{"similarity":0.80532111990042,"evidence_reason":"meaningful_policy_context","rerank_score":126.53,"rerank_reason":"semantic 80.5; direct signals: recover from unauthorized access; action signals: recover, remediate, validate; topic signals: recovery, closure, incident; section/path signals: incident, response; preferred sections: written incident response program; less relevant sections: vendor, service provider; role organization_evidence; source client_policy; classifier meaningful policy context"}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

### Candidate 4: 88ca5971-6e57-4aa1-998b-658eb2482105

```text
12. Logging and Investigation Records

The incident manager maintains a contemporaneous incident file containing alerts, system and identity logs, relevant
exports, screenshots, investigation notes, affected-system and data inventories, decisions, approvals, containment
steps, customer-notice analysis, provider communications, recovery tests, and closure documentation.
Relevant logs and volatile information are preserved promptly. Exports are stored in access-controlled case folders with
source, collection time, custodian, and integrity information when material to the investigation. Routine log retention is not
shortened while an incident, investigation, examination, or legal hold is open.
```

Proposed: relationship `background_context`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json, candidates[3].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `88ca5971-6e57-4aa1-998b-658eb2482105`; index `11`; original position `4`.
Citation: northline_regulation_sp_policy.pdf, pages 6-6; section `12. Logging and Investigation Records`; parent `Document`; path `12. Logging and Investigation Records`.
Hashes: stored source `bcee3ecee0a117407c150a303e6a1e85fbdb6321af473644f97bd37337af037a`; recomputed `bcee3ecee0a117407c150a303e6a1e85fbdb6321af473644f97bd37337af037a`; stored embedding input `1783c179d965521c4407a379b2c6c51eb6011a2f8e597a7b7733346b785925f5`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `4`. Retrieval selection: `{"similarity":0.801800376110184,"evidence_reason":"meaningful_policy_context","rerank_score":111.18,"rerank_reason":"semantic 80.2; action signals: recover, test; topic signals: recovery, closure, incident; role organization_evidence; source client_policy; classifier meaningful policy context"}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

### Candidate 5: db0f84c9-17e5-4a41-a6e9-a79f444859fd

```text
9. Customer Information Security Controls

The safeguards program applies to customer information in the firm's possession and customer information handled or
maintained on its behalf. It also applies to nonpublic personal information received from another financial institution about
that institution's customers. Controls are selected to ensure confidentiality, protect against anticipated threats or hazards,
and prevent unauthorized access or use that could result in substantial harm or inconvenience.

• Administrative safeguards: risk assessment, assigned ownership, workforce training, access approval, change
management, service-provider oversight, and periodic control review.
• Technical safeguards: multi-factor authentication, least privilege, encryption in transit and at rest where appropriate,
endpoint protection, vulnerability management, secure configuration, logging, monitoring, and tested backups.
• Physical safeguards: controlled office and records-room access, visitor management, locked storage, secure
transport, clean-desk expectations, and destruction controls for paper and media.
```

Proposed: relationship `background_context`; elements `none`; direct-support `false`; hard-negative `true`.

Provenance: `manual_adjudication`, eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json, candidates[4].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `db0f84c9-17e5-4a41-a6e9-a79f444859fd`; index `8`; original position `5`.
Citation: northline_regulation_sp_policy.pdf, pages 5-5; section `9. Customer Information Security Controls`; parent `Document`; path `9. Customer Information Security Controls`.
Hashes: stored source `05ccf1538fcfc6bce219215dddce251b2063b8d405e1291573347b1f1b5fd917`; recomputed `05ccf1538fcfc6bce219215dddce251b2063b8d405e1291573347b1f1b5fd917`; stored embedding input `21ffefee1018e949a82c46c46afa53d816ecd4c55ebe5e7e7d9f34b0434b881f`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `5`. Retrieval selection: `{"similarity":0.756843237649262,"evidence_reason":"substantive_requirement_or_procedure","rerank_score":109.68,"rerank_reason":"semantic 75.7; action signals: test; topic signals: vulnerability, appear, unauthorized; section/path signals: customer; role organization_evidence; source client_policy; classifier substantive requirement or procedure"}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

## Multi-candidate review: recovery-remediation-validation-cross-candidate-aggregation-review

Role: `unresolved`
Requirement: **Response recovery and remediation validation** (`response_recovery_remediation_validation`)
The reviewed documents appear to define how the firm recovers from unauthorized access or use of customer information and validates remediation or corrective action.

Unconfirmed review aid only: Candidates 1 and 2 appear capable of complementary operative detail; Candidate 3 appears to be a high-signal incident-file inventory distractor.


Reviewer final status: ____________________
Reviewer case-supported elements: ____________________
Reviewer ID: ____________________
Reviewed at: ____________________

### Candidate 1: f67e4e3d-d73a-4cc8-a331-04bb9f2c1b6e

```text
4. Cyber Incident Response Governance

Northline Brokerage Services, Inc. maintains this written incident response program as part of its customer information
safeguards framework. The program is reasonably designed to detect, respond to, and recover from unauthorized
access to or use of customer information. It applies to customer information in paper, electronic, and other forms,
including information maintained by service providers on the firm's behalf.
The program begins when monitoring, employee reporting, a service-provider notice, or another reliable source indicates
that unauthorized access or use has occurred or is reasonably likely to have occurred. The Incident Response Lead
opens a case, assigns severity, preserves relevant records, and coordinates assessment, containment, customer-notice
analysis, recovery, and closure.

• Detect: monitor security alerts, access anomalies, customer complaints, lost devices, vendor notices, and misuse
reports.
• Respond: investigate, contain, control, communicate, and document decisions.
• Recover: restore approved services, remediate root causes, validate controls and access, and complete a
post-incident review.
```

Provenance: `implementation_inference`, eval-fixtures/classifier-capability/frozen-aggregation-pack.response-recovery-remediation-validation.json, candidates[0].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `f67e4e3d-d73a-4cc8-a331-04bb9f2c1b6e`; index `3`; original position `1`.
Citation: northline_regulation_sp_policy.pdf, pages 3-3; section `4. Cyber Incident Response Governance`; parent `Document`; path `4. Cyber Incident Response Governance`.
Hashes: stored source `ad8d9652a9012326951de4e989cfc0b4c04765b63ca80b5fc50268247ec3156b`; recomputed `ad8d9652a9012326951de4e989cfc0b4c04765b63ca80b5fc50268247ec3156b`; stored embedding input `4942e75572bf3038dac556b87c6924105cba6694a4c45902dc90b43e1653024b`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `unavailable`. Retrieval selection: `{"selection_method":"frozen_evaluation_pack","order_key":"chunk_index","order_value":3}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

### Candidate 2: 5479d864-f145-4454-b00f-b8e572a20ac7

```text
8. Service Provider Oversight

The firm maintains and enforces written procedures for due diligence and ongoing monitoring of service providers that
receive, maintain, process, or are permitted access to customer information. Reviews consider security controls,
incident-response capability, subcontractor use, independent assurance reports, material changes, and known control
failures.
Oversight is reasonably designed to ensure that service providers protect against unauthorized access to or use of
customer information and notify the firm as soon as possible, but no later than 72 hours after becoming aware that a
breach in security resulted in unauthorized access to a customer information system maintained by the provider.
Upon receipt of a qualifying provider notice, or upon independent detection of the incident, the firm immediately initiates
its incident response program. A provider may deliver customer notices under a written agreement, but the firm remains
responsible for ensuring that each required notice satisfies the firm's obligations and is timely delivered.

• document initial and periodic due diligence;
• track identified risks and remediation;

• maintain provider breach notices and related communications;
• verify completion and delivery when a provider sends customer notices on the firm's behalf.
```

Provenance: `implementation_inference`, eval-fixtures/classifier-capability/frozen-aggregation-pack.response-recovery-remediation-validation.json, candidates[1].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `5479d864-f145-4454-b00f-b8e572a20ac7`; index `7`; original position `2`.
Citation: northline_regulation_sp_policy.pdf, pages 4-5; section `8. Service Provider Oversight`; parent `Document`; path `8. Service Provider Oversight`.
Hashes: stored source `69f597b46d36a061eb76c3d271de3525907d2671d2f3fc4def76dd67758d99ce`; recomputed `69f597b46d36a061eb76c3d271de3525907d2671d2f3fc4def76dd67758d99ce`; stored embedding input `019a2957594c418f03d53d8a6342360f1ce2e0b9877c81e895f3130cf72b21fc`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `unavailable`. Retrieval selection: `{"selection_method":"frozen_evaluation_pack","order_key":"chunk_index","order_value":7}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

### Candidate 3: 8c104761-0821-4330-9cfc-5b843b4d5175

```text
17. Appendix A - Incident File Minimum Contents

• incident identifier, discovery date, and awareness date;
• affected systems, business processes, customer information types, and individuals;
• investigation timeline, containment actions, and recovery steps;
• notification analysis, decision, approvals, and copies of notices;
• service-provider notices, contracts, communications, and remediation;
• logs, exports, screenshots, evidence sources, and preservation details;
• corrective actions, validation results, post-incident findings, and closure approval.
```

Provenance: `implementation_inference`, eval-fixtures/classifier-capability/frozen-aggregation-pack.response-recovery-remediation-validation.json, candidates[2].
Stored row: workspace `af584c33-42fe-4ce4-b641-c3b381c98214`; document `0cca8649-fd13-42f1-b259-28e54d12fe37`; chunk `8c104761-0821-4330-9cfc-5b843b4d5175`; index `16`; original position `3`.
Citation: northline_regulation_sp_policy.pdf, pages 7-7; section `17. Appendix A - Incident File Minimum Contents`; parent `Document`; path `17. Appendix A - Incident File Minimum Contents`.
Hashes: stored source `7dce6f4d89abb84465546fae07568a2fc3d218b6390d15f6aa9606237cd78322`; recomputed `7dce6f4d89abb84465546fae07568a2fc3d218b6390d15f6aa9606237cd78322`; stored embedding input `6a44d45ae586bf804bbd0f1e3ef7098790d3219e198a5ce2daf345f834e3420f`.
Ranks: semantic `unavailable`; keyword `unavailable`; merged `unavailable`. Retrieval selection: `{"selection_method":"frozen_evaluation_pack","order_key":"chunk_index","order_value":16}`.
Normalization: Convert CRLF and lone CR to LF, then apply Unicode NFC; do not trim or collapse whitespace.


Reviewer relationship: ____________________
Reviewer elements: ____________________
Reviewer direct-support designation: ____________________
Reviewer hard-negative designation: ____________________
Reviewer notes: ____________________

