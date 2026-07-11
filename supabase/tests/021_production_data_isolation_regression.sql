-- Regression tests for 021_harden_production_rls_and_storage.
-- Run against a disposable/local database after migrations. All rows roll back.

begin;

create temporary table regspan_isolation_fixture (
  user_a uuid not null,
  user_b uuid not null,
  workspace_a uuid not null,
  workspace_b uuid not null,
  document_a uuid not null,
  document_b uuid not null,
  chunk_a uuid not null,
  chunk_b uuid not null,
  analysis_run_a uuid not null,
  analysis_run_b uuid not null,
  finding_a uuid not null,
  finding_b uuid not null
);

do $$
declare
  fixture regspan_isolation_fixture%rowtype;
begin
  select id into fixture.user_a from auth.users order by created_at, id limit 1;
  select id into fixture.user_b
  from auth.users
  where id <> fixture.user_a
  order by created_at, id
  limit 1;

  if fixture.user_a is null or fixture.user_b is null then
    raise exception 'Isolation regression requires two disposable auth users';
  end if;

  fixture.workspace_a := gen_random_uuid();
  fixture.workspace_b := gen_random_uuid();
  fixture.document_a := gen_random_uuid();
  fixture.document_b := gen_random_uuid();
  fixture.chunk_a := gen_random_uuid();
  fixture.chunk_b := gen_random_uuid();
  fixture.analysis_run_a := gen_random_uuid();
  fixture.analysis_run_b := gen_random_uuid();
  fixture.finding_a := gen_random_uuid();
  fixture.finding_b := gen_random_uuid();

  insert into public.workspaces (id, name, owner_user_id)
  values
    (fixture.workspace_a, 'RLS fixture workspace A', fixture.user_a),
    (fixture.workspace_b, 'RLS fixture workspace B', fixture.user_b);

  insert into public.workspace_members (workspace_id, user_id, role)
  values
    (fixture.workspace_a, fixture.user_a, 'owner'),
    (fixture.workspace_b, fixture.user_b, 'owner');

  insert into public.documents (
    id, workspace_id, filename, document_type, status, chunks_label,
    storage_path, file_size, mime_type, uploaded_at
  ) values
  (
    fixture.document_a, fixture.workspace_a, 'workspace-a.pdf', 'Other',
    'Processed', '1 section',
    fixture.workspace_a::text || '/' || fixture.document_a::text || '/workspace-a.pdf',
    100, 'application/pdf', now()
  ),
  (
    fixture.document_b, fixture.workspace_b, 'workspace-b.pdf', 'Other',
    'Processed', '1 section',
    fixture.workspace_b::text || '/' || fixture.document_b::text || '/workspace-b.pdf',
    100, 'application/pdf', now()
  );

  insert into public.document_chunks (
    id, workspace_id, document_id, chunk_index, content, metadata,
    filename, content_hash
  ) values
  (
    fixture.chunk_a, fixture.workspace_a, fixture.document_a, 0,
    'Workspace A private source text.', '{}'::jsonb, 'workspace-a.pdf', repeat('a', 64)
  ),
  (
    fixture.chunk_b, fixture.workspace_b, fixture.document_b, 0,
    'Workspace B private source text.', '{}'::jsonb, 'workspace-b.pdf', repeat('b', 64)
  );

  insert into public.analysis_runs (
    id, workspace_id, status, generated_by, requirement_count, finding_count
  ) values
  (
    fixture.analysis_run_a, fixture.workspace_a, 'completed', fixture.user_a, 1, 1
  ),
  (
    fixture.analysis_run_b, fixture.workspace_b, 'completed', fixture.user_b, 1, 1
  );

  insert into public.analysis_run_documents (
    analysis_run_id, workspace_id, document_id, filename, document_status, uploaded_at
  ) values
  (
    fixture.analysis_run_a, fixture.workspace_a, fixture.document_a,
    'workspace-a.pdf', 'Processed', now()
  ),
  (
    fixture.analysis_run_b, fixture.workspace_b, fixture.document_b,
    'workspace-b.pdf', 'Processed', now()
  );

  insert into public.findings (
    id, workspace_id, analysis_run_id, document_id, status, finding_text,
    requirement_id, requirement_name
  ) values
  (
    fixture.finding_a, fixture.workspace_a, fixture.analysis_run_a,
    fixture.document_a, 'covered', 'Workspace A finding', 'fixture-a', 'Fixture A'
  ),
  (
    fixture.finding_b, fixture.workspace_b, fixture.analysis_run_b,
    fixture.document_b, 'partial', 'Workspace B finding', 'fixture-b', 'Fixture B'
  );

  insert into public.finding_evidence (
    finding_id, workspace_id, document_id, chunk_id, relationship,
    quote, evidence_quote, filename
  ) values
  (
    fixture.finding_a, fixture.workspace_a, fixture.document_a, fixture.chunk_a,
    'supports', 'Workspace A exact source quote.', 'Workspace A exact source quote.',
    'workspace-a.pdf'
  ),
  (
    fixture.finding_b, fixture.workspace_b, fixture.document_b, fixture.chunk_b,
    'partially_supports', 'Workspace B exact source quote.', 'Workspace B exact source quote.',
    'workspace-b.pdf'
  );

  insert into storage.objects (bucket_id, name)
  values
    ('documents', fixture.workspace_a::text || '/' || fixture.document_a::text || '/workspace-a.pdf'),
    ('documents', fixture.workspace_b::text || '/' || fixture.document_b::text || '/workspace-b.pdf');

  insert into regspan_isolation_fixture values (
    fixture.user_a,
    fixture.user_b,
    fixture.workspace_a,
    fixture.workspace_b,
    fixture.document_a,
    fixture.document_b,
    fixture.chunk_a,
    fixture.chunk_b,
    fixture.analysis_run_a,
    fixture.analysis_run_b,
    fixture.finding_a,
    fixture.finding_b
  );
end
$$;

select set_config('regspan.test.workspace_a', workspace_a::text, true)
from regspan_isolation_fixture;
select set_config('regspan.test.workspace_b', workspace_b::text, true)
from regspan_isolation_fixture;
select set_config('regspan.test.document_a', document_a::text, true)
from regspan_isolation_fixture;
select set_config('regspan.test.document_b', document_b::text, true)
from regspan_isolation_fixture;
select set_config('request.jwt.claim.sub', user_a::text, true)
from regspan_isolation_fixture;

set local role authenticated;

do $$
declare
  workspace_a uuid := current_setting('regspan.test.workspace_a')::uuid;
  workspace_b uuid := current_setting('regspan.test.workspace_b')::uuid;
  document_a uuid := current_setting('regspan.test.document_a')::uuid;
  document_b uuid := current_setting('regspan.test.document_b')::uuid;
begin
  if (select count(*) from public.documents where id = document_a) <> 1 then
    raise exception 'User A cannot read its own document';
  end if;
  if exists (select 1 from public.documents where workspace_id = workspace_b) then
    raise exception 'User A can read workspace B documents';
  end if;
  if exists (select 1 from public.document_chunks where workspace_id = workspace_b) then
    raise exception 'User A can read workspace B chunks';
  end if;
  if exists (select 1 from public.findings where workspace_id = workspace_b) then
    raise exception 'User A can read workspace B findings';
  end if;
  if exists (select 1 from public.finding_evidence where workspace_id = workspace_b) then
    raise exception 'User A can read workspace B finding evidence';
  end if;
  if exists (select 1 from public.analysis_runs where workspace_id = workspace_b) then
    raise exception 'User A can read workspace B analysis runs';
  end if;
  if exists (select 1 from public.analysis_run_documents where workspace_id = workspace_b) then
    raise exception 'User A can read workspace B analysis snapshots';
  end if;

  begin
    delete from public.documents where id = document_b;
    raise exception 'Authenticated browser unexpectedly received document delete access';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.chunk_embeddings limit 1;
    raise exception 'Authenticated browser can read chunk embeddings';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.rate_limit_counters limit 1;
    raise exception 'Authenticated browser can read rate limit counters';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.get_analysis_report_state_v1(workspace_a);
    raise exception 'Authenticated browser can execute an internal analysis RPC';
  exception when insufficient_privilege then
    null;
  end;

  begin
    if exists (
      select 1
      from storage.objects
      where bucket_id = 'documents'
        and name like workspace_b::text || '/%'
    ) then
      raise exception 'User A can read workspace B Storage objects';
    end if;
  exception when insufficient_privilege then
    null;
  end;

  begin
    if exists (
      select 1
      from storage.objects
      where bucket_id = 'documents'
        and name like workspace_a::text || '/%'
    ) then
      raise exception 'Authenticated browser can directly read private document Storage';
    end if;
  exception when insufficient_privilege then
    null;
  end;
end
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.documents d
    join regspan_isolation_fixture fixture on fixture.document_b = d.id
  ) then
    raise exception 'Cross-workspace delete changed the target document';
  end if;

  begin
    insert into public.analysis_run_documents (
      analysis_run_id, workspace_id, document_id, filename, document_status
    )
    select analysis_run_a, workspace_a, document_b, 'cross-workspace.pdf', 'Processed'
    from regspan_isolation_fixture;
    raise exception 'Cross-workspace analysis snapshot was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update public.findings f
    set analysis_run_id = fixture.analysis_run_a
    from regspan_isolation_fixture fixture
    where f.id = fixture.finding_b;
    raise exception 'Cross-workspace finding analysis run was accepted';
  exception when check_violation then
    null;
  end;
end
$$;

rollback;
