-- 023_align_written_compliance_record_signals
-- Keep parent-control retrieval signals aligned with the canonical written
-- compliance record element signals used by evidence classification.

do $$
declare
  records_control_id uuid;
  records_control_count integer;
begin
  select count(*)
  into records_control_count
  from public.controls
  where control_key = 'written_compliance_records';

  if records_control_count <> 1 then
    raise exception 'Expected exactly one written_compliance_records control, found %', records_control_count;
  end if;

  select id
  into records_control_id
  from public.controls
  where control_key = 'written_compliance_records';

  update public.controls
  set
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'directSignals', jsonb_build_array(
        'written records documenting compliance',
        'records documenting compliance',
        'records demonstrating implementation',
        'records documenting implementation',
        'maintain written records',
        'make and maintain written records',
        'notice transmitted',
        'copy of any notice',
        'determination made',
        'attorney general',
        'six years',
        'easily accessible place',
        'policies and procedures in effect'
      )
    ),
    updated_at = now()
  where id = records_control_id;
end $$;
