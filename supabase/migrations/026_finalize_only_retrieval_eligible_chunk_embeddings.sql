-- Coverage-only document chunks are retained for source-completeness audit,
-- but are intentionally excluded from retrieval and embedding.

create or replace function public.finalize_ingestion_embeddings_v1(
  p_job_id uuid,
  p_document_id uuid,
  p_workspace_id uuid,
  p_embedding_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.processing_jobs%rowtype;
  current_document public.documents%rowtype;
  chunk_count integer;
  eligible_chunk_count integer;
  embedding_count integer;
  completed_time timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select * into current_job from public.processing_jobs
  where id = p_job_id for update;
  if not found then
    raise exception using message = 'job_not_found', errcode = 'P0002';
  end if;

  select * into current_document from public.documents
  where id = p_document_id for update;
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

  select count(*)::integer into chunk_count
  from public.document_chunks dc
  where dc.document_id = p_document_id
    and dc.workspace_id = p_workspace_id;

  select count(*)::integer into eligible_chunk_count
  from public.document_chunks dc
  where dc.document_id = p_document_id
    and dc.workspace_id = p_workspace_id
    and dc.metadata ->> 'retrieval_included' = 'true'
    and coalesce(dc.metadata ->> 'retrieval_excluded', 'false') <> 'true'
    and dc.metadata ->> 'evidence_class' = 'evidence';

  if current_job.status = 'Processed' then
    return jsonb_build_object(
      'result', 'already_completed',
      'job_status', 'Processed',
      'chunk_count', chunk_count,
      'embedding_count', eligible_chunk_count,
      'replayed', true
    );
  end if;
  if current_job.status <> 'Processing' then
    raise exception using message = 'invalid_job_state', errcode = 'P0001';
  end if;
  if chunk_count = 0 then
    raise exception using message = 'invalid_chunks', errcode = 'P0001';
  end if;

  select count(*)::integer into embedding_count
  from public.document_chunks dc
  where dc.document_id = p_document_id
    and dc.workspace_id = p_workspace_id
    and dc.metadata ->> 'retrieval_included' = 'true'
    and coalesce(dc.metadata ->> 'retrieval_excluded', 'false') <> 'true'
    and dc.metadata ->> 'evidence_class' = 'evidence'
    and exists (
      select 1 from public.chunk_embeddings ce
      where ce.chunk_id = dc.id
        and ce.workspace_id = p_workspace_id
        and ce.document_id = p_document_id
        and ce.embedding_model = p_embedding_model
        and ce.content_hash = dc.content_hash
    );

  if embedding_count <> eligible_chunk_count then
    raise exception using message = 'embeddings_incomplete', errcode = 'P0001';
  end if;

  update public.processing_jobs
  set
    status = 'Processed',
    step = 'PDF extraction, chunk storage, and embeddings complete',
    error_message = null,
    completed_at = completed_time,
    updated_at = completed_time
  where id = p_job_id;

  update public.documents
  set status = 'Processed', chunks_label = chunk_count::text || ' sections'
  where id = p_document_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'result', 'completed',
    'job_status', 'Processed',
    'chunk_count', chunk_count,
    'embedding_count', embedding_count,
    'replayed', false
  );
end;
$$;

revoke all on function public.finalize_ingestion_embeddings_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_ingestion_embeddings_v1(uuid, uuid, uuid, text)
  to service_role;
