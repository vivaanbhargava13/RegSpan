-- Query name: 013_create_internal_ingestion_worker
-- Atomic, service-role-only placeholder worker transitions for n8n ingestion v1.

create or replace function public.process_ingestion_job_placeholder(
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
  completed_time timestamptz := now();
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
    update public.documents
    set status = 'Processed', chunks_label = coalesce(chunks_label, '0 sections')
    where id = p_document_id and workspace_id = p_workspace_id;

    return jsonb_build_object(
      'result', 'already_completed',
      'job_status', 'Processed',
      'replayed', true
    );
  end if;

  if current_job.status not in ('Queued', 'Processing', 'Reprocessing') then
    raise exception using message = 'invalid_job_state', errcode = 'P0001';
  end if;

  update public.processing_jobs
  set
    status = 'Processing',
    step = 'Running placeholder ingestion worker',
    error_message = null,
    started_at = coalesce(started_at, completed_time),
    completed_at = null,
    request_id = coalesce(nullif(btrim(p_correlation_id), ''), request_id),
    updated_at = completed_time
  where id = p_job_id;

  update public.documents
  set status = 'Processing', chunks_label = 'Pending'
  where id = p_document_id and workspace_id = p_workspace_id;

  -- Placeholder v1 intentionally performs no extraction, chunking, embeddings,
  -- control mapping, findings generation, or document-content access.

  update public.processing_jobs
  set
    status = 'Processed',
    step = 'Placeholder ingestion complete',
    error_message = null,
    completed_at = completed_time,
    updated_at = completed_time
  where id = p_job_id;

  update public.documents
  set status = 'Processed', chunks_label = '0 sections'
  where id = p_document_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'result', 'completed',
    'job_status', 'Processed',
    'replayed', false
  );
end;
$$;

revoke all on function public.process_ingestion_job_placeholder(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.process_ingestion_job_placeholder(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.fail_ingestion_job_v1(
  p_job_id uuid,
  p_document_id uuid,
  p_workspace_id uuid,
  p_error_message text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  failed_time timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  if not exists (
    select 1
    from public.processing_jobs pj
    join public.documents d on d.id = pj.document_id
    where pj.id = p_job_id
      and pj.document_id = p_document_id
      and pj.workspace_id = p_workspace_id
      and d.workspace_id = p_workspace_id
      and pj.status in ('Queued', 'Processing', 'Reprocessing')
  ) then
    return false;
  end if;

  update public.processing_jobs
  set
    status = 'Failed',
    step = 'Internal ingestion worker failed',
    error_message = left(coalesce(p_error_message, 'Worker processing failed.'), 500),
    completed_at = failed_time,
    updated_at = failed_time
  where id = p_job_id;

  update public.documents
  set status = 'Failed', chunks_label = 'Pending'
  where id = p_document_id and workspace_id = p_workspace_id;

  return true;
end;
$$;

revoke all on function public.fail_ingestion_job_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_ingestion_job_v1(uuid, uuid, uuid, text)
  to service_role;

