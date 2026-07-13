-- Query name: 025_align_strict_covered_thresholds
-- Align only the controls whose covered thresholds require more granular,
-- grounded evidence. Partial evidence remains available when one or more
-- required elements are absent.

do $$
declare
  control_key_value text;
  control_count integer;
begin
  foreach control_key_value in array array[
    'customer_notification_content',
    'incident_assessment_containment_control',
    'written_incident_response_program',
    'safeguards_customer_information',
    'incident_evidence_log_preservation',
    'response_recovery_remediation_validation'
  ] loop
    select count(*) into control_count
    from public.controls
    where control_key = control_key_value;

    if control_count <> 1 then
      raise exception 'Expected exactly one % control, found %', control_key_value, control_count;
    end if;
  end loop;
end $$;

with target as (
  select id from public.controls where control_key = 'customer_notification_content'
)
update public.controls
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evidenceCriteria', jsonb_build_object(
    'lookFor', 'Notice templates or procedures covering incident description, type of sensitive information, incident date/range when known, contact information, account review, fraud alerts, credit reports, identity-theft resources, and written delivery requirements.',
    'strongEvidence', 'A notice template or procedure defines the material notice-content categories, identity-protection resources, and written delivery requirements for affected individuals.',
    'partialEvidence', 'The documents define some substantive notice contents but omit material content categories or written delivery requirements.',
    'missingOrNegativeEvidence', 'The documents say notice content is not defined or leave notice details entirely to ad hoc legal review.'
  )
), updated_at = now()
where id = (select id from target);

with target as (
  select id from public.controls where control_key = 'customer_notification_content'
)
update public.control_elements element
set required = true,
    display_order = case element.element_key
      when 'incident_description' then 1
      when 'information_involved' then 2
      when 'protective_steps' then 3
      when 'contact_information' then 4
      else element.display_order
    end,
    updated_at = now()
from target
where element.control_id = target.id
  and element.element_key in ('incident_description', 'information_involved', 'protective_steps', 'contact_information');

with target as (
  select id from public.controls where control_key = 'customer_notification_content'
)
insert into public.control_elements (
  control_id, element_key, label, description, required, evidence_question,
  missing_if_absent, display_order, metadata
)
select target.id, 'fraud_credit_identity_resources',
  'Provides fraud, credit-report, and identity-theft resources',
  'Requires material fraud-alert, credit-report, and identity-theft resources for affected individuals.',
  true, 'Does the notice provide fraud, credit-report, and identity-theft resources?', true, 5,
  jsonb_build_object('signals', jsonb_build_array('fraud alert', 'nationwide credit reporting', 'credit report', 'free credit report', 'identity theft', 'Federal Trade Commission', 'FTC'))
from target
on conflict (control_id, element_key) do update
set label = excluded.label, description = excluded.description, required = excluded.required,
    evidence_question = excluded.evidence_question, missing_if_absent = excluded.missing_if_absent,
    display_order = excluded.display_order,
    metadata = coalesce(control_elements.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with target as (
  select id from public.controls where control_key = 'customer_notification_content'
)
insert into public.control_elements (
  control_id, element_key, label, description, required, evidence_question,
  missing_if_absent, display_order, metadata
)
select target.id, 'written_delivery_requirements',
  'Defines clear written notice and delivery requirements',
  'Requires clear written notice and an identified delivery method.',
  true, 'Does the notice define clear written delivery requirements?', true, 6,
  jsonb_build_object('signals', jsonb_build_array('clear and conspicuous', 'written notice', 'in writing', 'notice delivery', 'deliver the notice'))
from target
on conflict (control_id, element_key) do update
set label = excluded.label, description = excluded.description, required = excluded.required,
    evidence_question = excluded.evidence_question, missing_if_absent = excluded.missing_if_absent,
    display_order = excluded.display_order,
    metadata = coalesce(control_elements.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with target as (
  select id from public.controls where control_key = 'incident_assessment_containment_control'
)
update public.controls
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evidenceCriteria', jsonb_build_object(
    'lookFor', 'Assessment of unauthorized access or use, affected customer-information systems and data types, and concrete containment/control actions.',
    'strongEvidence', 'Procedures require direct nature-and-scope assessment, affected-system or information-type identification, and concrete containment/control actions.',
    'partialEvidence', 'A direct assessment or containment action exists, but the full assessment, affected-information, or control process is incomplete.',
    'missingOrNegativeEvidence', 'Generic coordination, management, or oversight language is not assessment or containment evidence.'
  )
), updated_at = now()
where id = (select id from target);

with target as (
  select id from public.controls where control_key = 'written_incident_response_program'
)
update public.controls
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evidenceCriteria', jsonb_build_object(
    'lookFor', 'A maintained written customer-information incident response program, plan, policy, standard, or procedure that addresses detection, response, and recovery.',
    'strongEvidence', 'A maintained written program expressly applies to customer information and directly covers detection, response, and recovery responsibilities.',
    'partialEvidence', 'A narrower incident workflow or procedure is linked to customer information but does not establish the complete program.',
    'missingOrNegativeEvidence', 'Provider-notice text or generic incident workflow language alone is not a written customer-information incident response program.'
  )
), updated_at = now()
where id = (select id from target);

with target as (
  select id from public.controls where control_key = 'safeguards_customer_information'
)
update public.controls
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evidenceCriteria', jsonb_build_object(
    'lookFor', 'Written administrative, technical, and physical safeguards for customer records and information.',
    'strongEvidence', 'Policies define administrative, technical, and physical safeguards for the required scope of customer information.',
    'partialEvidence', 'Some operative safeguards are defined, but one or more safeguard categories or the correct information scope is incomplete.',
    'missingOrNegativeEvidence', 'Generic security principles without customer-information safeguards are not sufficient.'
  )
), updated_at = now()
where id = (select id from target);

with target as (
  select id from public.controls where control_key = 'safeguards_customer_information'
)
update public.control_elements element
set required = case when element.element_key = 'safeguards_controls' then false else element.required end,
    updated_at = now()
from target
where element.control_id = target.id
  and element.element_key in ('customer_information_scope', 'safeguards_controls');

with target as (
  select id from public.controls where control_key = 'safeguards_customer_information'
)
insert into public.control_elements (
  control_id, element_key, label, description, required, evidence_question,
  missing_if_absent, display_order, metadata
)
select target.id, source.element_key, source.label, source.description, true, source.evidence_question,
  true, source.display_order, source.metadata
from target
cross join (
  values
    ('administrative_safeguards', 'Defines administrative safeguards', 'Defines administrative safeguards such as training, confidentiality obligations, access approval, or review.', 'Does the policy define administrative safeguards?', 3, jsonb_build_object('signals', jsonb_build_array('administrative safeguards', 'security training', 'confidentiality obligations', 'access approval', 'access review'))),
    ('technical_safeguards', 'Defines technical safeguards', 'Defines technical safeguards such as encryption, authentication, passwords, or access restrictions.', 'Does the policy define technical safeguards?', 4, jsonb_build_object('signals', jsonb_build_array('technical safeguards', 'encryption', 'authentication', 'passwords', 'access restrictions', 'multifactor authentication'))),
    ('physical_safeguards', 'Defines physical safeguards', 'Defines physical safeguards for facilities, workspaces, visitors, or device storage.', 'Does the policy define physical safeguards?', 5, jsonb_build_object('signals', jsonb_build_array('physical safeguards', 'physical access', 'locked facility', 'secure workspace', 'visitor access', 'device storage')))
) as source(element_key, label, description, evidence_question, display_order, metadata)
on conflict (control_id, element_key) do update
set label = excluded.label, description = excluded.description, required = excluded.required,
    evidence_question = excluded.evidence_question, missing_if_absent = excluded.missing_if_absent,
    display_order = excluded.display_order,
    metadata = coalesce(control_elements.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with target as (
  select id from public.controls where control_key = 'incident_evidence_log_preservation'
)
update public.controls
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evidenceCriteria', jsonb_build_object(
    'lookFor', 'A defined process for preserving relevant incident logs, evidence, or investigation materials.',
    'strongEvidence', 'Policies define a preservation process for relevant incident logs and evidence with sufficient investigation, retention, or integrity scope.',
    'partialEvidence', 'Incident emails, notes, tickets, screenshots, or other materials are actually retained, but the defined preservation process is incomplete.',
    'missingOrNegativeEvidence', 'Generic documentation or monitoring without retained incident materials is not evidence preservation.'
  )
), updated_at = now()
where id = (select id from target);

with target as (
  select id from public.controls where control_key = 'incident_evidence_log_preservation'
)
update public.control_elements element
set required = true,
    updated_at = now()
from target
where element.control_id = target.id
  and element.element_key = 'incident_materials';

with target as (
  select id from public.controls where control_key = 'incident_evidence_log_preservation'
)
insert into public.control_elements (
  control_id, element_key, label, description, required, evidence_question,
  missing_if_absent, display_order, metadata
)
select target.id, 'preservation_process',
  'Defines a process for preserving relevant logs or evidence',
  'Defines an operative process for preserving relevant logs, evidence, or investigation materials.',
  true, 'Does the organization define a process for preserving relevant logs or evidence?', true, 2,
  jsonb_build_object('signals', jsonb_build_array('procedure requires preserving', 'preservation process', 'preserve relevant logs', 'retain logs for investigation', 'evidence retention requirements', 'chain of custody'))
from target
on conflict (control_id, element_key) do update
set label = excluded.label, description = excluded.description, required = excluded.required,
    evidence_question = excluded.evidence_question, missing_if_absent = excluded.missing_if_absent,
    display_order = excluded.display_order,
    metadata = coalesce(control_elements.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

with target as (
  select id from public.controls where control_key = 'response_recovery_remediation_validation'
)
update public.controls
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'evidenceCriteria', jsonb_build_object(
    'lookFor', 'Operative recovery steps, remediation tracking, validation or testing, and closure procedures.',
    'strongEvidence', 'Policies require recovery actions, remediation tracking, and validation or closure after incidents.',
    'partialEvidence', 'One or more direct recovery, remediation, or validation steps are defined, but the full procedure is incomplete.',
    'missingOrNegativeEvidence', 'Appendix, index, or record-category lists alone are not an operative recovery procedure.'
  )
), updated_at = now()
where id = (select id from target);
