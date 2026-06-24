-- Query name: 010_harden_processing_jobs_and_data_lifecycle
-- Serialize processing starts and make derived-data lifecycle changes transactional.

alter table public.processing_jobs
  add column if not exists idempotency_key text,
  add column if not exists request_id text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.processing_jobs'::regclass
      and conname = 'processing_jobs_status_check'
  ) then
    alter table public.processing_jobs
      add constraint processing_jobs_status_check
      check (status in (
        'Queued',
        'Processing',
        'Needs Review',
        'Processed',
        'Failed',
        'Reprocessing'
      )) not valid;
  end if;
end
$$;

-- Resolve any development-era duplicates before enforcing one active job.
with ranked_active_jobs as (
  select
    id,
    row_number() over (
      partition by document_id
      order by created_at desc nulls last, id desc
    ) as active_rank
  from public.processing_jobs
  where status in ('Queued', 'Processing', 'Reprocessing')
)
update public.processing_jobs pj
set
  status = 'Failed',
  step = 'Superseded while enabling processing safeguards',
  error_message = 'Duplicate active job superseded by migration 010.',
  completed_at = coalesce(pj.completed_at, now()),
  updated_at = now()
from ranked_active_jobs ranked
where pj.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists idx_processing_jobs_one_active_per_document
  on public.processing_jobs (document_id)
  where status in ('Queued', 'Processing', 'Reprocessing');

create unique index if not exists idx_processing_jobs_idempotency
  on public.processing_jobs (workspace_id, document_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_processing_jobs_workspace_document_created
  on public.processing_jobs (workspace_id, document_id, created_at desc);

create or replace function public.start_processing_job(
  p_workspace_id uuid,
  p_document_id uuid,
  p_status text,
  p_step text,
  p_idempotency_key text,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job public.processing_jobs%rowtype;
  new_job public.processing_jobs%rowtype;
  v_now timestamptz := now();
begin
  if p_status not in ('Queued', 'Processing', 'Reprocessing') then
    raise exception using message = 'invalid_processing_status', errcode = '22023';
  end if;

  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 then
    raise exception using message = 'invalid_idempotency_key', errcode = '22023';
  end if;

  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id
      and d.workspace_id = p_workspace_id
  ) then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select * into existing_job
  from public.processing_jobs pj
  where pj.workspace_id = p_workspace_id
    and pj.document_id = p_document_id
    and pj.idempotency_key = btrim(p_idempotency_key)
  order by pj.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'job_id', existing_job.id,
      'status', existing_job.status,
      'replayed', true
    );
  end if;

  if exists (
    select 1 from public.processing_jobs pj
    where pj.document_id = p_document_id
      and pj.status in ('Queued', 'Processing', 'Reprocessing')
  ) then
    raise exception using message = 'processing_in_progress', errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.processing_jobs pj
    where pj.document_id = p_document_id
      and pj.created_at > v_now - interval '10 seconds'
  ) then
    raise exception using message = 'processing_rate_limited', errcode = 'P0001';
  end if;

  insert into public.processing_jobs (
    workspace_id,
    document_id,
    status,
    step,
    started_at,
    idempotency_key,
    request_id,
    updated_at
  ) values (
    p_workspace_id,
    p_document_id,
    p_status,
    p_step,
    case when p_status in ('Processing', 'Reprocessing') then v_now end,
    btrim(p_idempotency_key),
    nullif(btrim(coalesce(p_request_id, '')), ''),
    v_now
  )
  returning * into new_job;

  update public.documents
  set
    status = case when p_status = 'Queued' then 'Queued' else 'Processing' end,
    chunks_label = 'Pending'
  where id = p_document_id
    and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'job_id', new_job.id,
    'status', new_job.status,
    'replayed', false
  );
end;
$$;

revoke all on function public.start_processing_job(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.start_processing_job(uuid, uuid, text, text, text, text)
  to service_role;

create or replace function public.complete_mock_processing(
  p_workspace_id uuid,
  p_document_id uuid,
  p_job_id uuid,
  p_chunks jsonb,
  p_hierarchy jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
  completed_time timestamptz := now();
begin
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception using message = 'invalid_mock_chunks', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  if exists (
    select 1 from public.processing_jobs pj
    where pj.id = p_job_id
      and pj.document_id = p_document_id
      and pj.workspace_id = p_workspace_id
      and pj.status = 'Processed'
  ) then
    select count(*)::integer into inserted_count
    from public.document_chunks dc
    where dc.document_id = p_document_id
      and dc.workspace_id = p_workspace_id;
    return inserted_count;
  end if;

  if not exists (
    select 1 from public.processing_jobs pj
    where pj.id = p_job_id
      and pj.document_id = p_document_id
      and pj.workspace_id = p_workspace_id
      and pj.status in ('Processing', 'Reprocessing')
  ) then
    raise exception using message = 'active_job_not_found', errcode = 'P0002';
  end if;

  delete from public.document_chunks
  where document_id = p_document_id and workspace_id = p_workspace_id;

  delete from public.document_hierarchy
  where document_id = p_document_id and workspace_id = p_workspace_id;

  insert into public.document_chunks (
    workspace_id,
    document_id,
    chunk_index,
    content,
    metadata,
    page_start,
    page_end,
    section_heading,
    parent_heading,
    section_path,
    section_chunk_start,
    section_chunk_end,
    parent_chunk_start,
    parent_chunk_end
  )
  select
    p_workspace_id,
    p_document_id,
    chunk.chunk_index,
    chunk.content,
    coalesce(chunk.metadata, '{}'::jsonb),
    chunk.page_start,
    chunk.page_end,
    chunk.section_heading,
    chunk.parent_heading,
    chunk.section_path,
    chunk.section_chunk_start,
    chunk.section_chunk_end,
    chunk.parent_chunk_start,
    chunk.parent_chunk_end
  from jsonb_to_recordset(p_chunks) as chunk(
    chunk_index integer,
    content text,
    metadata jsonb,
    page_start integer,
    page_end integer,
    section_heading text,
    parent_heading text,
    section_path text,
    section_chunk_start integer,
    section_chunk_end integer,
    parent_chunk_start integer,
    parent_chunk_end integer
  );

  get diagnostics inserted_count = row_count;

  insert into public.document_hierarchy (
    workspace_id,
    document_id,
    hierarchy_json,
    updated_at
  ) values (
    p_workspace_id,
    p_document_id,
    p_hierarchy,
    completed_time
  )
  on conflict (document_id) do update set
    workspace_id = excluded.workspace_id,
    hierarchy_json = excluded.hierarchy_json,
    updated_at = excluded.updated_at;

  update public.documents
  set status = 'Processed', chunks_label = inserted_count::text || ' sections'
  where id = p_document_id and workspace_id = p_workspace_id;

  update public.processing_jobs
  set
    status = 'Processed',
    step = 'Mock processing complete',
    error_message = null,
    completed_at = completed_time,
    updated_at = completed_time
  where id = p_job_id;

  return inserted_count;
end;
$$;

revoke all on function public.complete_mock_processing(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_mock_processing(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

create or replace function public.replace_document_and_clear_derived(
  p_workspace_id uuid,
  p_document_id uuid,
  p_filename text,
  p_document_type text,
  p_notes text,
  p_storage_path text,
  p_file_size bigint,
  p_mime_type text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_storage_path text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.storage_path into previous_storage_path
  from public.documents d
  where d.id = p_document_id and d.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.processing_jobs pj
    where pj.document_id = p_document_id
      and pj.workspace_id = p_workspace_id
      and pj.status in ('Queued', 'Processing', 'Reprocessing')
  ) then
    raise exception using message = 'processing_in_progress', errcode = 'P0001';
  end if;

  delete from public.finding_evidence fe
  where fe.workspace_id = p_workspace_id
    and (
      fe.document_id = p_document_id
      or fe.chunk_id in (
        select dc.id from public.document_chunks dc
        where dc.document_id = p_document_id and dc.workspace_id = p_workspace_id
      )
      or fe.finding_id in (
        select f.id from public.findings f
        where f.document_id = p_document_id and f.workspace_id = p_workspace_id
      )
    );

  delete from public.findings
  where document_id = p_document_id and workspace_id = p_workspace_id;
  delete from public.processing_jobs
  where document_id = p_document_id and workspace_id = p_workspace_id;
  delete from public.document_chunks
  where document_id = p_document_id and workspace_id = p_workspace_id;
  delete from public.document_hierarchy
  where document_id = p_document_id and workspace_id = p_workspace_id;

  update public.documents
  set
    filename = p_filename,
    document_type = p_document_type,
    notes = p_notes,
    storage_path = p_storage_path,
    file_size = p_file_size,
    mime_type = p_mime_type,
    status = 'Uploaded',
    chunks_label = 'Pending',
    uploaded_at = now()
  where id = p_document_id and workspace_id = p_workspace_id;

  return previous_storage_path;
end;
$$;

revoke all on function public.replace_document_and_clear_derived(uuid, uuid, text, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.replace_document_and_clear_derived(uuid, uuid, text, text, text, text, bigint, text)
  to service_role;

create or replace function public.delete_document_and_derived(
  p_workspace_id uuid,
  p_document_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_storage_path text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.storage_path into previous_storage_path
  from public.documents d
  where d.id = p_document_id and d.workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.processing_jobs pj
    where pj.document_id = p_document_id
      and pj.workspace_id = p_workspace_id
      and pj.status in ('Queued', 'Processing', 'Reprocessing')
  ) then
    raise exception using message = 'processing_in_progress', errcode = 'P0001';
  end if;

  delete from public.finding_evidence fe
  where fe.workspace_id = p_workspace_id
    and (
      fe.document_id = p_document_id
      or fe.chunk_id in (
        select dc.id from public.document_chunks dc
        where dc.document_id = p_document_id and dc.workspace_id = p_workspace_id
      )
      or fe.finding_id in (
        select f.id from public.findings f
        where f.document_id = p_document_id and f.workspace_id = p_workspace_id
      )
    );

  delete from public.findings
  where document_id = p_document_id and workspace_id = p_workspace_id;

  delete from public.documents
  where id = p_document_id and workspace_id = p_workspace_id;

  return previous_storage_path;
end;
$$;

revoke all on function public.delete_document_and_derived(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_document_and_derived(uuid, uuid)
  to service_role;
