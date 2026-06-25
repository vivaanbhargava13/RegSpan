-- Query name: 014_create_pdf_chunk_ingestion
-- Service-role-only claim and atomic PDF chunk replacement for ingestion v1.

create or replace function public.claim_ingestion_job_v1(
  p_job_id uuid,
  p_document_id uuid,
  p_workspace_id uuid,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.processing_jobs%rowtype;
  current_document public.documents%rowtype;
  existing_chunk_count integer;
  claim_time timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select * into current_job
  from public.processing_jobs pj
  where pj.id = p_job_id
  for update;

  if not found then
    raise exception using message = 'job_not_found', errcode = 'P0002';
  end if;

  select * into current_document
  from public.documents d
  where d.id = p_document_id
  for update;

  if not found then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  if current_job.document_id <> p_document_id then
    raise exception using message = 'job_document_mismatch', errcode = '23514';
  end if;
  if current_job.workspace_id <> p_workspace_id then
    raise exception using message = 'job_workspace_mismatch', errcode = '23514';
  end if;
  if current_document.workspace_id <> p_workspace_id then
    raise exception using message = 'document_workspace_mismatch', errcode = '23514';
  end if;

  if current_job.status = 'Processed' then
    select count(*)::integer into existing_chunk_count
    from public.document_chunks dc
    where dc.document_id = p_document_id and dc.workspace_id = p_workspace_id;

    return jsonb_build_object(
      'result', 'already_completed',
      'job_status', 'Processed',
      'chunk_count', existing_chunk_count,
      'replayed', true
    );
  end if;

  if current_job.status not in ('Queued', 'Processing', 'Reprocessing') then
    raise exception using message = 'invalid_job_state', errcode = 'P0001';
  end if;

  update public.processing_jobs
  set
    status = 'Processing',
    step = 'Extracting PDF text',
    error_message = null,
    started_at = coalesce(started_at, claim_time),
    completed_at = null,
    request_id = coalesce(nullif(btrim(p_correlation_id), ''), request_id),
    updated_at = claim_time
  where id = p_job_id;

  update public.documents
  set status = 'Processing', chunks_label = 'Pending'
  where id = p_document_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'result', case when current_job.status = 'Processing' then 'resumed' else 'claimed' end,
    'job_status', 'Processing',
    'replayed', current_job.status = 'Processing'
  );
end;
$$;

revoke all on function public.claim_ingestion_job_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_ingestion_job_v1(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.complete_ingestion_job_with_chunks_v1(
  p_job_id uuid,
  p_document_id uuid,
  p_workspace_id uuid,
  p_chunks jsonb,
  p_hierarchy jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.processing_jobs%rowtype;
  current_document public.documents%rowtype;
  inserted_count integer;
  completed_time timestamptz := now();
begin
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception using message = 'invalid_chunks', errcode = '22023';
  end if;
  if jsonb_typeof(p_hierarchy) <> 'object' then
    raise exception using message = 'invalid_hierarchy', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select * into current_job
  from public.processing_jobs pj
  where pj.id = p_job_id
  for update;

  if not found then
    raise exception using message = 'job_not_found', errcode = 'P0002';
  end if;

  select * into current_document
  from public.documents d
  where d.id = p_document_id
  for update;

  if not found then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  if current_job.document_id <> p_document_id then
    raise exception using message = 'job_document_mismatch', errcode = '23514';
  end if;
  if current_job.workspace_id <> p_workspace_id then
    raise exception using message = 'job_workspace_mismatch', errcode = '23514';
  end if;
  if current_document.workspace_id <> p_workspace_id then
    raise exception using message = 'document_workspace_mismatch', errcode = '23514';
  end if;

  if current_job.status = 'Processed' then
    select count(*)::integer into inserted_count
    from public.document_chunks dc
    where dc.document_id = p_document_id and dc.workspace_id = p_workspace_id;

    return jsonb_build_object(
      'result', 'already_completed',
      'job_status', 'Processed',
      'chunk_count', inserted_count,
      'replayed', true
    );
  end if;

  if current_job.status <> 'Processing' then
    raise exception using message = 'invalid_job_state', errcode = 'P0001';
  end if;

  delete from public.document_hierarchy
  where document_id = p_document_id and workspace_id = p_workspace_id;

  delete from public.document_chunks
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

  if inserted_count <> jsonb_array_length(p_chunks) then
    raise exception using message = 'chunk_count_mismatch', errcode = 'P0001';
  end if;

  insert into public.document_hierarchy (
    workspace_id, document_id, hierarchy_json, updated_at
  ) values (
    p_workspace_id, p_document_id, p_hierarchy, completed_time
  )
  on conflict (document_id) do update set
    workspace_id = excluded.workspace_id,
    hierarchy_json = excluded.hierarchy_json,
    updated_at = excluded.updated_at;

  update public.processing_jobs
  set
    status = 'Processed',
    step = 'PDF extraction and chunk storage complete',
    error_message = null,
    completed_at = completed_time,
    updated_at = completed_time
  where id = p_job_id;

  update public.documents
  set status = 'Processed', chunks_label = inserted_count::text || ' sections'
  where id = p_document_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'result', 'completed',
    'job_status', 'Processed',
    'chunk_count', inserted_count,
    'replayed', false
  );
end;
$$;

revoke all on function public.complete_ingestion_job_with_chunks_v1(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_ingestion_job_with_chunks_v1(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
