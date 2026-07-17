-- Regression test for coverage-only chunks retained by PDF completeness checks.
-- Run against a disposable/local database after migration 026. All rows roll back.

begin;

do $$
declare
  test_workspace uuid;
  test_owner uuid;
  test_document uuid := gen_random_uuid();
  test_job uuid := gen_random_uuid();
  evidence_chunk uuid;
  result jsonb;
  test_vector vector(1536) := array_fill(0.01::real, array[1536])::vector;
  chunks jsonb;
  hierarchy jsonb;
begin
  select id, owner_user_id into test_workspace, test_owner
  from public.workspaces
  order by created_at
  limit 1;

  if test_workspace is null or test_owner is null then
    raise exception 'Chunk completeness regression requires one provisioned workspace';
  end if;

  insert into public.documents (
    id, workspace_id, filename, document_type, status, chunks_label,
    storage_path, file_size, mime_type, uploaded_at
  ) values (
    test_document, test_workspace, 'complete-source.pdf', 'Other', 'Queued', 'Pending',
    test_workspace::text || '/' || test_document::text || '/complete-source.pdf',
    100, 'application/pdf', now()
  );
  insert into public.processing_jobs (id, workspace_id, document_id, status, step)
  values (test_job, test_workspace, test_document, 'Processing', 'Completeness test');

  hierarchy := jsonb_build_object('document_id', test_document, 'headings', '[]'::jsonb);
  chunks := jsonb_build_array(
    jsonb_build_object(
      'chunk_index', 0,
      'content', 'The organization must encrypt customer records.',
      'metadata', jsonb_build_object(
        'retrieval_included', true,
        'retrieval_excluded', false,
        'evidence_class', 'evidence'
      ),
      'page_start', 1, 'page_end', 1, 'section_heading', 'Controls',
      'parent_heading', 'Controls', 'section_path', 'Controls',
      'section_chunk_start', 0, 'section_chunk_end', 0,
      'parent_chunk_start', 0, 'parent_chunk_end', 0,
      'filename', 'complete-source.pdf', 'char_start', 0, 'char_end', 45,
      'token_estimate', 12, 'processing_job_id', test_job,
      'content_hash', repeat('a', 64)
    ),
    jsonb_build_object(
      'chunk_index', 1,
      'content', 'For source completeness, the filing contact appears on this page.',
      'metadata', jsonb_build_object(
        'retrieval_included', false,
        'retrieval_excluded', true,
        'evidence_class', 'low_value',
        'coverage_only', true
      ),
      'page_start', 2, 'page_end', 2, 'section_heading', 'Page 2',
      'parent_heading', 'Extracted PDF', 'section_path', 'Extracted PDF > Page 2',
      'section_chunk_start', 0, 'section_chunk_end', 0,
      'parent_chunk_start', 1, 'parent_chunk_end', 1,
      'filename', 'complete-source.pdf', 'char_start', 46, 'char_end', 108,
      'token_estimate', 16, 'processing_job_id', test_job,
      'content_hash', repeat('b', 64)
    )
  );

  perform public.store_ingestion_chunks_for_embedding_v1(
    test_job, test_document, test_workspace, chunks, hierarchy
  );
  select id into evidence_chunk
  from public.document_chunks
  where document_id = test_document and chunk_index = 0;

  insert into public.chunk_embeddings (
    chunk_id, workspace_id, document_id, embedding, embedding_model, content_hash
  ) values (
    evidence_chunk, test_workspace, test_document, test_vector,
    'embedding-test-v1', repeat('a', 64)
  );

  result := public.finalize_ingestion_embeddings_v1(
    test_job, test_document, test_workspace, 'embedding-test-v1'
  );
  if result ->> 'result' <> 'completed'
    or (result ->> 'chunk_count')::integer <> 2
    or (result ->> 'embedding_count')::integer <> 1 then
    raise exception 'Coverage-only chunks must not block embedding finalization: %', result;
  end if;
end
$$;

rollback;
