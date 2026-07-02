# RegSpan Reg S-P Requirement Map Audit

This note documents the MVP requirement map used for RegSpan findings. It is not legal advice and should be reviewed by counsel before being used as a compliance conclusion.

Primary source reviewed: SEC final rule, *Regulation S-P: Privacy of Consumer Financial Information and Safeguarding Customer Information*, Release Nos. 34-100155; IA-6604; IC-35193; File No. S7-05-23.

## Current map weaknesses addressed

- The original eight buckets mixed direct Regulation S-P obligations with useful incident-response controls.
- Customer notification was too broad; it did not explicitly model sensitive customer information, substantial harm or inconvenience, timing, or notice contents.
- Service-provider handling was directionally right but needed to be tied to due diligence, monitoring, 72-hour notice to the covered institution, and the covered institution’s continuing notice obligation.
- Evidence/log preservation is useful but is better treated as a supporting control unless tied to the written-records requirement.
- Regulator/law-enforcement notification is useful operationally but is not a broad standalone amended Reg S-P obligation in the incident-response MVP.
- Written compliance records and disposal controls were missing from the operational map.

## MVP requirement model

| Requirement ID | Role | Source basis | Evidence focus |
| --- | --- | --- | --- |
| `written_incident_response_program` | Direct Reg S-P | 17 CFR 248.30(a)(3) | Written incident response program reasonably designed to detect, respond to, and recover from unauthorized access/use of customer information. |
| `unauthorized_access_detection_escalation` | Direct Reg S-P | 17 CFR 248.30(a)(3)(i) and (ii) | Assessment of nature/scope, customer information systems/data types, containment, and control. |
| `customer_notification_unauthorized_access` | Direct Reg S-P | 17 CFR 248.30(a)(4)(i) | Notification trigger and timing for sensitive customer information, including substantial harm/inconvenience and 30-day outside timing. |
| `customer_notification_content` | Direct Reg S-P | 17 CFR 248.30(a)(4)(iv) | Required notice contents and protective steps for affected individuals. |
| `vendor_incident_handling` | Direct Reg S-P | 17 CFR 248.30(a)(5) | Service-provider oversight, protection of customer information, and 72-hour notice to the firm. |
| `customer_information_safeguards` | Direct Reg S-P | 17 CFR 248.30(a)(1), 248.30(d)(5) | Administrative, technical, and physical safeguards for customer records and information. |
| `disposal_consumer_customer_information` | Direct Reg S-P | 17 CFR 248.30(b) | Secure disposal of consumer and customer information. |
| `written_compliance_records` | Direct Reg S-P | 17 CFR 248.30(c) | Written records documenting safeguards/disposal compliance, determinations, notice records, and policies/procedures. |
| `remediation_recovery_validation` | Direct Reg S-P / implementation evidence | 17 CFR 248.30(a)(3) | Recovery and remediation validation as evidence that the response program covers recovery. |
| `evidence_log_preservation` | Supporting control | Supports incident response and recordkeeping | Log/evidence preservation that supports investigation and compliance documentation. |
| `regulator_law_enforcement_notification` | Supporting control | Related to legal/compliance coordination and AG delay mechanics | External notification decisioning, but not treated as a broad standalone amended Reg S-P requirement. |

## Future scope

- `annual_privacy_notice_exception`: deferred because it concerns privacy notice delivery mechanics, not the current safeguards/incident-response findings MVP.
- `transfer_agent_applicability`: deferred until RegSpan supports entity-type applicability questions.
