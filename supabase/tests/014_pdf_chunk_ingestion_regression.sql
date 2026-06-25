-- Regression tests for 014_create_pdf_chunk_ingestion.
-- Run against a disposable/local database after migrations. All rows roll back.

begin;

do $$
declare
  test_workspace_id uuid;
  test_document_id uuid := gen_random_uuid();
  first_job_id uuid := gen_random_uuid();
  reprocess_job_id uuid := gen_random_uuid();
  failed_document_id uuid := gen_random_uuid();
  failed_job_id uuid := gen_random_uuid();
  rpc_result jsonb;
  first_chunks jsonb;
  replacement_chunks jsonb;
  hierarchy jsonb;
begin
  select w.id into test_workspace_id
  from public.workspaces w
  order by w.created_at
  limit 1;

  if test_workspace_id is null then
    raise exception 'PDF ingestion tests require one provisioned workspace';
  end if;

  insert into public.documents (
    id, workspace_id, filename, document_type, status, chunks_label,
    storage_path, file_size, mime_type, uploaded_at
  ) values
  (
    test_document_id, test_workspace_id, 'pdf-ingestion-test.pdf', 'Other',
    'Queued', 'Pending',
    test_workspace_id::text || '/' || test_document_id::text || '/pdf-ingestion-test.pdf',
    100, 'application/pdf', now()
  ),
  (
    failed_document_id, test_workspace_id, 'pdf-failure-test.pdf', 'Other',
    'Queued', 'Pending',
    test_workspace_id::text || '/' || failed_document_id::text || '/pdf-failure-test.pdf',
    100, 'application/pdf', now()
  );

  insert into public.processing_jobs (
    id, workspace_id, document_id, status, step, updated_at
  ) values
  (first_job_id, test_workspace_id, test_document_id, 'Queued', 'PDF test', now()),
  (failed_job_id, test_workspace_id, failed_document_id, 'Queued', 'Failure test', now());

  rpc_result := public.claim_ingestion_job_v1(
    first_job_id, test_document_id, test_workspace_id, 'pdf-ingestion-test'
  );
  if rpc_result ->> 'result' <> 'claimed' then
    raise exception 'Queued PDF job was not claimed';
  end if;

  first_chunks := jsonb_build_array(jsonb_build_object(
    'chunk_index', 0,
    'content', 'First extracted PDF chunk.',
    'metadata', jsonb_build_object('extraction_version', 'pdf-parse-v1'),
    'page_start', 1,
    'page_end', 1,
    'section_heading', 'Page 1',
    'parent_heading', 'Extracted PDF',
    'section_path', 'Extracted PDF > Page 1',
    'section_chunk_start', 0,
    'section_chunk_end', 0,
    'parent_chunk_start', 0,
    'parent_chunk_end', 0
  ));
  hierarchy := jsonb_build_object(
    'document_id', test_document_id,
    'headings', jsonb_build_array(jsonb_build_object(
      'heading', 'Extracted PDF', 'chunk_start', 0, 'chunk_end', 0
    ))
  );

  rpc_result := public.complete_ingestion_job_with_chunks_v1(
    first_job_id, test_document_id, test_workspace_id, first_chunks, hierarchy
  );

  if rpc_result ->> 'result' <> 'completed'
    or (rpc_result ->> 'chunk_count')::integer <> 1
    or not exists (
      select 1 from public.processing_jobs
      where id = first_job_id and status = 'Processed'
    )
    or not exists (
      select 1 from public.documents
      where id = test_document_id and status = 'Processed' and chunks_label = '1 sections'
    )
    or (select count(*) from public.document_chunks where document_id = test_document_id) <> 1
  then
    raise exception 'PDF chunk completion did not persist expected state';
  end if;

  rpc_result := public.claim_ingestion_job_v1(
    first_job_id, test_document_id, test_workspace_id, 'pdf-ingestion-retry'
  );
  if rpc_result ->> 'result' <> 'already_completed'
    or (rpc_result ->> 'chunk_count')::integer <> 1
  then
    raise exception 'Completed PDF ingestion retry was not idempotent';
  end if;

  insert into public.processing_jobs (
    id, workspace_id, document_id, status, step, updated_at
  ) values (
    reprocess_job_id, test_workspace_id, test_document_id,
    'Reprocessing', 'PDF reprocessing test', now()
  );

  perform public.claim_ingestion_job_v1(
    reprocess_job_id, test_document_id, test_workspace_id, 'pdf-reprocess-test'
  );
  replacement_chunks := first_chunks || jsonb_build_array(jsonb_build_object(
    'chunk_index', 1,
    'content', 'Replacement extracted PDF chunk.',
    'metadata', jsonb_build_object('extraction_version', 'pdf-parse-v1'),
    'page_start', 2,
    'page_end', 2,
    'section_heading', 'Page 2',
    'parent_heading', 'Extracted PDF',
    'section_path', 'Extracted PDF > Page 2',
    'section_chunk_start', 1,
    'section_chunk_end', 1,
    'parent_chunk_start', 0,
    'parent_chunk_end', 1
  ));
  perform public.complete_ingestion_job_with_chunks_v1(
    reprocess_job_id,
    test_document_id,
    test_workspace_id,
    replacement_chunks,
    hierarchy
  );

  if (select count(*) from public.document_chunks where document_id = test_document_id) <> 2 then
    raise exception 'Reprocessing did not replace prior chunks idempotently';
  end if;

  perform public.claim_ingestion_job_v1(
    failed_job_id, failed_document_id, test_workspace_id, 'pdf-failure-test'
  );
  if not public.fail_ingestion_job_v1(
    failed_job_id,
    failed_document_id,
    test_workspace_id,
    'PDF text extraction failed.'
  ) then
    raise exception 'Failed PDF job was not marked failed';
  end if;

  if not exists (
    select 1 from public.processing_jobs where id = failed_job_id and status = 'Failed'
  ) or not exists (
    select 1 from public.documents where id = failed_document_id and status = 'Failed'
  ) then
    raise exception 'Failed PDF ingestion did not persist failure state';
  end if;
end
$$;

rollback;

