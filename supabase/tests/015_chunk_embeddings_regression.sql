-- Regression tests for 015_create_chunk_embeddings.
-- Run against a disposable/local database after migrations. All rows roll back.

begin;

do $$
declare
  workspace_a uuid;
  workspace_b uuid := gen_random_uuid();
  owner_id uuid;
  document_a uuid := gen_random_uuid();
  document_b uuid := gen_random_uuid();
  first_job uuid := gen_random_uuid();
  unchanged_job uuid := gen_random_uuid();
  changed_job uuid := gen_random_uuid();
  job_b uuid := gen_random_uuid();
  chunk_a uuid;
  original_chunk_a uuid;
  chunk_b uuid;
  hierarchy jsonb;
  unchanged_chunk jsonb;
  changed_chunk jsonb;
  workspace_b_chunk jsonb;
  test_vector vector(1536) := array_fill(0.01::real, array[1536])::vector;
  result jsonb;
begin
  select w.id, w.owner_user_id into workspace_a, owner_id
  from public.workspaces w
  order by w.created_at
  limit 1;

  if workspace_a is null or owner_id is null then
    raise exception 'Embedding regression tests require one provisioned workspace';
  end if;

  insert into public.workspaces (id, name, owner_user_id)
  values (workspace_b, 'Embedding isolation workspace', owner_id);

  insert into public.documents (
    id, workspace_id, filename, document_type, status, chunks_label,
    storage_path, file_size, mime_type, uploaded_at
  ) values
  (
    document_a, workspace_a, 'workspace-a.pdf', 'Other', 'Queued', 'Pending',
    workspace_a::text || '/' || document_a::text || '/workspace-a.pdf',
    100, 'application/pdf', now()
  ),
  (
    document_b, workspace_b, 'workspace-b.pdf', 'Other', 'Queued', 'Pending',
    workspace_b::text || '/' || document_b::text || '/workspace-b.pdf',
    100, 'application/pdf', now()
  );

  insert into public.processing_jobs (id, workspace_id, document_id, status, step)
  values
    (first_job, workspace_a, document_a, 'Processing', 'Embedding test'),
    (job_b, workspace_b, document_b, 'Processing', 'Embedding isolation test');

  hierarchy := jsonb_build_object(
    'document_id', document_a,
    'headings', jsonb_build_array(jsonb_build_object(
      'heading', 'Extracted PDF', 'chunk_start', 0, 'chunk_end', 0
    ))
  );
  unchanged_chunk := jsonb_build_array(jsonb_build_object(
    'chunk_index', 0,
    'content', 'Stable retrieval evidence.',
    'metadata', jsonb_build_object('filename', 'workspace-a.pdf'),
    'page_start', 1,
    'page_end', 1,
    'section_heading', 'Page 1',
    'parent_heading', 'Extracted PDF',
    'section_path', 'Extracted PDF > Page 1',
    'section_chunk_start', 0,
    'section_chunk_end', 0,
    'parent_chunk_start', 0,
    'parent_chunk_end', 0,
    'filename', 'workspace-a.pdf',
    'char_start', 0,
    'char_end', 26,
    'token_estimate', 7,
    'processing_job_id', first_job,
    'content_hash', repeat('a', 64)
  ));
  workspace_b_chunk := jsonb_build_array(jsonb_build_object(
    'chunk_index', 0,
    'content', 'Other workspace evidence.',
    'metadata', jsonb_build_object('filename', 'workspace-b.pdf'),
    'page_start', 1,
    'page_end', 1,
    'section_heading', 'Page 1',
    'parent_heading', 'Extracted PDF',
    'section_path', 'Extracted PDF > Page 1',
    'section_chunk_start', 0,
    'section_chunk_end', 0,
    'parent_chunk_start', 0,
    'parent_chunk_end', 0,
    'filename', 'workspace-b.pdf',
    'char_start', 0,
    'char_end', 25,
    'token_estimate', 7,
    'processing_job_id', job_b,
    'content_hash', repeat('b', 64)
  ));

  perform public.store_ingestion_chunks_for_embedding_v1(
    first_job, document_a, workspace_a, unchanged_chunk, hierarchy
  );
  perform public.store_ingestion_chunks_for_embedding_v1(
    job_b, document_b, workspace_b, workspace_b_chunk, hierarchy
  );

  select id into chunk_a from public.document_chunks where document_id = document_a;
  select id into chunk_b from public.document_chunks where document_id = document_b;
  original_chunk_a := chunk_a;

  insert into public.chunk_embeddings (
    chunk_id, workspace_id, document_id, embedding, embedding_model, content_hash
  ) values
    (chunk_a, workspace_a, document_a, test_vector, 'embedding-test-v1', repeat('a', 64)),
    (chunk_b, workspace_b, document_b, test_vector, 'embedding-test-v1', repeat('b', 64));

  result := public.finalize_ingestion_embeddings_v1(
    first_job, document_a, workspace_a, 'embedding-test-v1'
  );
  if result ->> 'result' <> 'completed' then
    raise exception 'Embedding finalization did not complete';
  end if;

  if exists (
    select 1
    from public.match_document_chunks_v1(
      workspace_a, test_vector, 10, null, 'embedding-test-v1'
    ) match
    join public.document_chunks dc on dc.id = match.chunk_id
    where dc.workspace_id <> workspace_a
  ) then
    raise exception 'Retrieval crossed workspace boundaries';
  end if;

  insert into public.processing_jobs (id, workspace_id, document_id, status, step)
  values (unchanged_job, workspace_a, document_a, 'Processing', 'Unchanged reprocess');
  perform public.store_ingestion_chunks_for_embedding_v1(
    unchanged_job, document_a, workspace_a, unchanged_chunk, hierarchy
  );
  select id into chunk_a from public.document_chunks where document_id = document_a;

  if chunk_a <> original_chunk_a or not exists (
    select 1 from public.chunk_embeddings
    where chunk_id = chunk_a and content_hash = repeat('a', 64)
  ) then
    raise exception 'Unchanged chunk did not preserve its embedding idempotently';
  end if;

  perform public.finalize_ingestion_embeddings_v1(
    unchanged_job, document_a, workspace_a, 'embedding-test-v1'
  );

  changed_chunk := jsonb_set(
    jsonb_set(unchanged_chunk, '{0,content}', '"Changed retrieval evidence."'::jsonb),
    '{0,content_hash}', to_jsonb(repeat('c', 64))
  );
  insert into public.processing_jobs (id, workspace_id, document_id, status, step)
  values (changed_job, workspace_a, document_a, 'Processing', 'Changed reprocess');
  perform public.store_ingestion_chunks_for_embedding_v1(
    changed_job, document_a, workspace_a, changed_chunk, hierarchy
  );

  if exists (select 1 from public.chunk_embeddings where chunk_id = original_chunk_a) then
    raise exception 'Changed chunk left an active stale embedding';
  end if;

  delete from public.documents where id = document_b and workspace_id = workspace_b;
  if exists (select 1 from public.chunk_embeddings where document_id = document_b) then
    raise exception 'Deleted document left stale embeddings';
  end if;
end
$$;

rollback;
