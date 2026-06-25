-- Regression tests for 013_create_internal_ingestion_worker.
-- Run against a disposable/local database after migrations. All rows roll back.

begin;

do $$
declare
  test_workspace_id uuid;
  queued_document_id uuid := gen_random_uuid();
  queued_job_id uuid := gen_random_uuid();
  processing_document_id uuid := gen_random_uuid();
  processing_job_id uuid := gen_random_uuid();
  failed_document_id uuid := gen_random_uuid();
  failed_job_id uuid := gen_random_uuid();
  mismatch_document_id uuid := gen_random_uuid();
  worker_result jsonb;
begin
  select w.id into test_workspace_id
  from public.workspaces w
  order by w.created_at
  limit 1;

  if test_workspace_id is null then
    raise exception 'Worker regression tests require one provisioned workspace';
  end if;

  insert into public.documents (
    id, workspace_id, filename, document_type, status, chunks_label,
    storage_path, file_size, mime_type, uploaded_at
  ) values
  (
    queued_document_id, test_workspace_id, 'queued-worker-test.pdf', 'Other',
    'Queued', 'Pending',
    test_workspace_id::text || '/' || queued_document_id::text || '/queued-worker-test.pdf',
    5, 'application/pdf', now()
  ),
  (
    processing_document_id, test_workspace_id, 'processing-worker-test.pdf', 'Other',
    'Processing', 'Pending',
    test_workspace_id::text || '/' || processing_document_id::text || '/processing-worker-test.pdf',
    5, 'application/pdf', now()
  ),
  (
    failed_document_id, test_workspace_id, 'failed-worker-test.pdf', 'Other',
    'Failed', 'Pending',
    test_workspace_id::text || '/' || failed_document_id::text || '/failed-worker-test.pdf',
    5, 'application/pdf', now()
  ),
  (
    mismatch_document_id, test_workspace_id, 'mismatch-worker-test.pdf', 'Other',
    'Queued', 'Pending',
    test_workspace_id::text || '/' || mismatch_document_id::text || '/mismatch-worker-test.pdf',
    5, 'application/pdf', now()
  );

  insert into public.processing_jobs (
    id, workspace_id, document_id, status, step, started_at, updated_at
  ) values
  (
    queued_job_id, test_workspace_id, queued_document_id,
    'Queued', 'Worker regression test', null, now()
  ),
  (
    processing_job_id, test_workspace_id, processing_document_id,
    'Processing', 'Worker regression test', now(), now()
  ),
  (
    failed_job_id, test_workspace_id, failed_document_id,
    'Failed', 'Worker regression test', now(), now()
  );

  worker_result := public.process_ingestion_job_placeholder(
    queued_job_id,
    queued_document_id,
    test_workspace_id,
    'queued-worker-regression'
  );

  if worker_result ->> 'result' <> 'completed'
    or not exists (
      select 1 from public.processing_jobs
      where id = queued_job_id and status = 'Processed'
    )
    or not exists (
      select 1 from public.documents
      where id = queued_document_id and status = 'Processed'
    )
  then
    raise exception 'Queued worker job did not complete';
  end if;

  worker_result := public.process_ingestion_job_placeholder(
    queued_job_id,
    queued_document_id,
    test_workspace_id,
    'queued-worker-retry'
  );

  if worker_result ->> 'result' <> 'already_completed'
    or (worker_result ->> 'replayed')::boolean is not true
    or exists (
      select 1 from public.document_chunks where document_id = queued_document_id
    )
  then
    raise exception 'Completed worker retry was not idempotent';
  end if;

  worker_result := public.process_ingestion_job_placeholder(
    processing_job_id,
    processing_document_id,
    test_workspace_id,
    'processing-worker-regression'
  );

  if worker_result ->> 'result' <> 'completed' then
    raise exception 'Processing worker job did not complete';
  end if;

  begin
    perform public.process_ingestion_job_placeholder(
      failed_job_id,
      failed_document_id,
      test_workspace_id,
      'failed-worker-regression'
    );
    raise exception 'Failed job was incorrectly accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'invalid_job_state' then raise; end if;
  end;

  begin
    perform public.process_ingestion_job_placeholder(
      queued_job_id,
      mismatch_document_id,
      test_workspace_id,
      'mismatch-worker-regression'
    );
    raise exception 'Job/document mismatch was incorrectly accepted';
  exception
    when sqlstate '23514' then
      if sqlerrm <> 'job_document_mismatch' then raise; end if;
  end;

  begin
    perform public.process_ingestion_job_placeholder(
      queued_job_id,
      queued_document_id,
      gen_random_uuid(),
      'workspace-mismatch-regression'
    );
    raise exception 'Workspace mismatch was incorrectly accepted';
  exception
    when sqlstate '23514' then
      if sqlerrm <> 'job_workspace_mismatch' then raise; end if;
  end;
end
$$;

rollback;

