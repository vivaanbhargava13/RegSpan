-- 024_tighten_operative_evidence_elements
-- Keep the supporting regulator/law-enforcement control aligned with the
-- canonical evidence model: incident-specific decisioning plus legal or
-- compliance coordination. Contact authority by itself is not evidence.

do $$
declare
  coordination_control_id uuid;
  coordination_control_count integer;
begin
  select count(*)
  into coordination_control_count
  from public.controls
  where control_key = 'regulator_law_enforcement_notification_coordination';

  if coordination_control_count <> 1 then
    raise exception 'Expected exactly one regulator_law_enforcement_notification_coordination control, found %', coordination_control_count;
  end if;

  select id
  into coordination_control_id
  from public.controls
  where control_key = 'regulator_law_enforcement_notification_coordination';

  update public.controls
  set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'evidenceCriteria', jsonb_build_object(
        'lookFor', 'Procedures for legal/compliance review of regulator, law-enforcement, contractual, supervisory, or Attorney General delay issues.',
        'strongEvidence', 'Policies define incident-specific external reporting decisioning plus legal/compliance coordination with customer-notice timing.',
        'partialEvidence', 'An incident-specific external reporting decision is mentioned, but legal/compliance coordination, triggers, timing, or relationship to customer notice is unclear.',
        'missingOrNegativeEvidence', 'The documents say regulator or law-enforcement reporting is not defined, or contain no external notification decision process.'
      )
    ),
    updated_at = now()
  where id = coordination_control_id;

  -- If a prior control already has the new element, remove only the obsolete
  -- owner-only duplicate. Otherwise rename it without affecting other elements.
  delete from public.control_elements
  where control_id = coordination_control_id
    and element_key = 'legal_compliance_owner'
    and exists (
      select 1
      from public.control_elements current_element
      where current_element.control_id = coordination_control_id
        and current_element.element_key = 'legal_compliance_coordination'
    );

  update public.control_elements
  set
    element_key = 'legal_compliance_coordination',
    label = 'Coordinates external notifications through legal or compliance',
    description = 'Requires legal or compliance coordination of incident-specific external notification decisions.',
    required = true,
    missing_if_absent = true,
    display_order = 2,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('signals', jsonb_build_array(
      'legal coordinates regulatory notification',
      'compliance coordinates external notification',
      'legal reviews the regulator notification decision',
      'general counsel coordinates required reporting'
    )),
    updated_at = now()
  where control_id = coordination_control_id
    and element_key = 'legal_compliance_owner';

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
  values (
    coordination_control_id,
    'external_notification_decisioning',
    'Defines incident-specific external notification decisioning',
    'Requires a decision about whether regulator, law-enforcement, or other external notification is required after an incident.',
    true,
    'Does the organization define incident-specific external notification decisioning?',
    true,
    1,
    jsonb_build_object('signals', jsonb_build_array(
      'determines whether regulatory notification is required',
      'regulator notification decision',
      'evaluates required external reporting after an incident',
      'assesses whether law enforcement notification is required'
    ))
  )
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
  values (
    coordination_control_id,
    'legal_compliance_coordination',
    'Coordinates external notifications through legal or compliance',
    'Requires legal or compliance coordination of incident-specific external notification decisions.',
    true,
    'Does legal or compliance coordinate the incident-specific external notification decision?',
    true,
    2,
    jsonb_build_object('signals', jsonb_build_array(
      'legal coordinates regulatory notification',
      'compliance coordinates external notification',
      'legal reviews the regulator notification decision',
      'general counsel coordinates required reporting'
    ))
  )
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
end $$;
