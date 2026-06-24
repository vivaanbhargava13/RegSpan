-- Regression tests for 012_allow_delete_with_active_processing_jobs.
-- Run against a disposable/local database after migrations. The transaction
-- always rolls back test rows.

begin;

do $$
declare
  test_workspace_id uuid;
  test_document_id uuid;
  test_chunk_id uuid;
  test_finding_id uuid;
  test_job_status text;
begin
  select w.id into test_workspace_id
  from public.workspaces w
  order by w.created_at
  limit 1;

  if test_workspace_id is null then
    raise exception 'Deletion regression tests require one provisioned workspace';
  end if;

  foreach test_job_status in array array[null, 'Queued', 'Processing']
  loop
    test_document_id := gen_random_uuid();
    test_chunk_id := gen_random_uuid();
    test_finding_id := gen_random_uuid();

    insert into public.documents (
      id,
      workspace_id,
      filename,
      document_type,
      status,
      chunks_label,
      storage_path,
      file_size,
      mime_type,
      uploaded_at
    ) values (
      test_document_id,
      test_workspace_id,
      'deletion-test.pdf',
      'Other',
      'Uploaded',
      'Pending',
      test_workspace_id::text || '/' || test_document_id::text || '/deletion-test.pdf',
      5,
      'application/pdf',
      now()
    );

    if test_job_status is not null then
      insert into public.processing_jobs (
        workspace_id,
        document_id,
        status,
        step,
        started_at,
        updated_at
      ) values (
        test_workspace_id,
        test_document_id,
        test_job_status,
        'Deletion regression test',
        case when test_job_status = 'Processing' then now() end,
        now()
      );
    end if;

    insert into public.document_chunks (
      id, workspace_id, document_id, chunk_index, content, metadata
    ) values (
      test_chunk_id,
      test_workspace_id,
      test_document_id,
      0,
      'Temporary deletion regression test content.',
      '{}'::jsonb
    );

    insert into public.document_hierarchy (
      workspace_id, document_id, hierarchy_json
    ) values (
      test_workspace_id,
      test_document_id,
      '{"headings": []}'::jsonb
    );

    insert into public.findings (
      id, workspace_id, document_id, status, finding_text
    ) values (
      test_finding_id,
      test_workspace_id,
      test_document_id,
      'Needs Review',
      'Temporary deletion regression finding.'
    );

    insert into public.finding_evidence (
      workspace_id, finding_id, document_id, chunk_id, evidence_quote
    ) values (
      test_workspace_id,
      test_finding_id,
      test_document_id,
      test_chunk_id,
      'Temporary evidence.'
    );

    perform public.delete_document_and_derived(test_workspace_id, test_document_id);

    if exists (select 1 from public.documents where id = test_document_id)
      or exists (select 1 from public.processing_jobs where document_id = test_document_id)
      or exists (select 1 from public.document_chunks where document_id = test_document_id)
      or exists (select 1 from public.document_hierarchy where document_id = test_document_id)
      or exists (select 1 from public.findings where document_id = test_document_id)
      or exists (select 1 from public.finding_evidence where document_id = test_document_id)
    then
      raise exception 'Deletion regression failed for job status %',
        coalesce(test_job_status, 'none');
    end if;

    if public.delete_document_and_derived(test_workspace_id, test_document_id) is not null then
      raise exception 'Repeated deletion did not converge for job status %',
        coalesce(test_job_status, 'none');
    end if;
  end loop;

  -- A mismatched workspace must not authorize deletion of an existing document.
  test_document_id := gen_random_uuid();
  insert into public.documents (
    id, workspace_id, filename, document_type, status, chunks_label,
    storage_path, file_size, mime_type, uploaded_at
  ) values (
    test_document_id,
    test_workspace_id,
    'workspace-mismatch-test.pdf',
    'Other',
    'Uploaded',
    'Pending',
    test_workspace_id::text || '/' || test_document_id::text || '/workspace-mismatch-test.pdf',
    5,
    'application/pdf',
    now()
  );

  begin
    perform public.delete_document_and_derived(gen_random_uuid(), test_document_id);
    raise exception 'Workspace mismatch deletion unexpectedly succeeded';
  exception
    when sqlstate 'P0002' then null;
  end;

  if not exists (select 1 from public.documents where id = test_document_id) then
    raise exception 'Workspace mismatch test altered the document';
  end if;
end
$$;

rollback;
