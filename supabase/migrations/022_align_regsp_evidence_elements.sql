-- 022_align_regsp_evidence_elements
-- Keep persisted canonical control elements aligned with the source-backed
-- requirement model used for final evidence curation.

update public.controls
set
  metadata = metadata || jsonb_build_object(
    'retrievalQuery', 'service provider vendor supplier breach security customer information system 72 hours notify covered institution due diligence monitoring incident handling',
    'directSignals', jsonb_build_array(
      'service provider notification',
      'service providers must notify',
      'service provider breach',
      'service provider responsibilities',
      'service provider oversight',
      'due diligence and monitoring',
      'ongoing monitoring of service providers',
      'protect against unauthorized access or use of customer information',
      'protect customer information',
      'notify the firm',
      'notify the institution',
      'no later than 72 hours',
      '72 hours',
      'vendor notification',
      'vendor incident',
      'vendor breach',
      'vendor reporting',
      'supplier shall notify',
      'supplier must notify',
      'supplier incident reporting',
      'supplier reporting',
      'supplier notification',
      'supplier notification obligations',
      'prompt notice',
      'customer information system',
      'contract must require notice',
      'contract must require reporting'
    ),
    'evidenceCriteria', jsonb_build_object(
      'lookFor', 'Service-provider due diligence, monitoring, contractual controls, customer-information protection, and breach notice to the firm no later than 72 hours after awareness.',
      'strongEvidence', 'Vendor or service-provider policies or contracts require due diligence and monitoring, protection of customer information, and prompt breach notice to the firm.',
      'partialEvidence', 'Vendor oversight or cybersecurity requirements exist, but provider safeguards, customer-information scope, or 72-hour notice to the firm is missing.',
      'missingOrNegativeEvidence', 'The documents say supplier incident reporting is not required or do not define vendor breach reporting obligations.'
    )
  ),
  updated_at = now()
where control_key = 'service_provider_incident_oversight_notice';

with provider_control as (
  select id
  from public.controls
  where control_key = 'service_provider_incident_oversight_notice'
)
update public.control_elements element
set
  label = 'Requires due diligence and monitoring for service providers handling customer information',
  description = 'Requires due diligence and ongoing monitoring for service providers that handle customer information.',
  required = true,
  missing_if_absent = true,
  display_order = 1,
  metadata = element.metadata || jsonb_build_object('signals', jsonb_build_array(
    'service providers handling customer information',
    'due diligence and monitoring',
    'vendor due diligence',
    'service provider due diligence',
    'ongoing monitoring of service providers',
    'service provider oversight'
  )),
  updated_at = now()
from provider_control
where element.control_id = provider_control.id
  and element.element_key = 'service_provider_scope';

with provider_control as (
  select id
  from public.controls
  where control_key = 'service_provider_incident_oversight_notice'
)
insert into public.control_elements (
  control_id,
  element_key,
  label,
  description,
  required,
  evidence_question,
  missing_if_absent,
  display_order,
  metadata
)
select
  provider_control.id,
  'provider_safeguards',
  'Requires service providers to protect customer information',
  'Requires providers to protect customer information against unauthorized access to or use of customer information.',
  true,
  'Service-provider due diligence, monitoring, customer-information protection, and prompt breach notice to the firm.',
  true,
  2,
  jsonb_build_object('signals', jsonb_build_array(
    'protect customer information',
    'protect against unauthorized access',
    'provider safeguards',
    'service provider safeguards',
    'appropriate measures to protect'
  ))
from provider_control
on conflict (control_id, element_key) do update
set
  label = excluded.label,
  description = excluded.description,
  required = excluded.required,
  evidence_question = excluded.evidence_question,
  missing_if_absent = excluded.missing_if_absent,
  display_order = excluded.display_order,
  metadata = excluded.metadata,
  updated_at = now();

with provider_control as (
  select id
  from public.controls
  where control_key = 'service_provider_incident_oversight_notice'
)
update public.control_elements element
set
  label = 'Requires service-provider notice to the firm',
  description = 'Requires providers to notify the firm promptly, including no later than 72 hours where specified.',
  required = true,
  missing_if_absent = true,
  display_order = 3,
  metadata = element.metadata || jsonb_build_object('signals', jsonb_build_array(
    'notify the firm',
    'notify the institution',
    'notify the organization',
    'report to the firm',
    'notice to the firm',
    'no later than 72 hours',
    '72 hours'
  )),
  updated_at = now()
from provider_control
where element.control_id = provider_control.id
  and element.element_key = 'notice_to_firm';

with provider_control as (
  select id
  from public.controls
  where control_key = 'service_provider_incident_oversight_notice'
)
update public.control_elements element
set
  required = false,
  missing_if_absent = false,
  display_order = 4,
  updated_at = now()
from provider_control
where element.control_id = provider_control.id
  and element.element_key = 'cooperation_remediation';

with records_control as (
  select id
  from public.controls
  where control_key = 'written_compliance_records'
)
update public.control_elements element
set
  metadata = element.metadata || jsonb_build_object('signals', jsonb_build_array(
    'written records documenting compliance',
    'records documenting compliance',
    'records demonstrating implementation',
    'records documenting implementation',
    'maintain written records',
    'make and maintain written records'
  )),
  updated_at = now()
from records_control
where element.control_id = records_control.id
  and element.element_key = 'compliance_record_scope';

with evidence_control as (
  select id
  from public.controls
  where control_key = 'incident_evidence_log_preservation'
)
update public.control_elements element
set
  metadata = element.metadata || jsonb_build_object('signals', jsonb_build_array(
    'preserve logs',
    'logs are preserved',
    'retain incident logs',
    'incident materials retained',
    'preserve evidence',
    'incident records',
    'investigation records',
    'investigation notes',
    'forensic evidence',
    'security console exports',
    'volatile information',
    'log retention'
  )),
  updated_at = now()
from evidence_control
where element.control_id = evidence_control.id
  and element.element_key = 'incident_materials';
