-- Query name: 021_harden_production_rls_and_storage
-- Production authorization baseline for workspace data, internal tables, RPCs, and private files.

-- Fail the migration instead of preserving cross-workspace relationships that
-- could become reachable through a correctly scoped parent row.
do $$
begin
  if exists (
    select 1
    from public.analysis_run_documents ard
    join public.analysis_runs ar on ar.id = ard.analysis_run_id
    where ar.workspace_id <> ard.workspace_id
  ) then
    raise exception using message = 'analysis_run_document_workspace_mismatch';
  end if;

  if exists (
    select 1
    from public.analysis_run_documents ard
    join public.documents d on d.id = ard.document_id
    where d.workspace_id <> ard.workspace_id
  ) then
    raise exception using message = 'analysis_run_document_document_workspace_mismatch';
  end if;

  if exists (
    select 1
    from public.findings f
    join public.analysis_runs ar on ar.id = f.analysis_run_id
    where ar.workspace_id <> f.workspace_id
  ) then
    raise exception using message = 'finding_analysis_run_workspace_mismatch';
  end if;
end
$$;

create or replace function private.enforce_analysis_run_document_workspace_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.analysis_runs ar
    where ar.id = new.analysis_run_id
      and ar.workspace_id = new.workspace_id
  ) then
    raise exception using message = 'analysis_run_document_run_workspace_mismatch', errcode = '23514';
  end if;

  if new.document_id is not null and not exists (
    select 1
    from public.documents d
    where d.id = new.document_id
      and d.workspace_id = new.workspace_id
  ) then
    raise exception using message = 'analysis_run_document_workspace_mismatch', errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_finding_analysis_run_workspace_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.analysis_run_id is not null and not exists (
    select 1
    from public.analysis_runs ar
    where ar.id = new.analysis_run_id
      and ar.workspace_id = new.workspace_id
  ) then
    raise exception using message = 'finding_analysis_run_workspace_mismatch', errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_analysis_run_document_workspace_match()
  from public, anon, authenticated;
revoke all on function private.enforce_finding_analysis_run_workspace_match()
  from public, anon, authenticated;

drop trigger if exists analysis_run_documents_workspace_match
  on public.analysis_run_documents;
create trigger analysis_run_documents_workspace_match
  before insert or update of analysis_run_id, document_id, workspace_id
  on public.analysis_run_documents
  for each row execute function private.enforce_analysis_run_document_workspace_match();

drop trigger if exists findings_analysis_run_workspace_match on public.findings;
create trigger findings_analysis_run_workspace_match
  before insert or update of analysis_run_id, workspace_id
  on public.findings
  for each row execute function private.enforce_finding_analysis_run_workspace_match();

-- Validate deferred integrity constraints before production access is enabled.
do $$
declare
  pending_constraint record;
begin
  for pending_constraint in
    select
      n.nspname as schema_name,
      c.relname as table_name,
      con.conname as constraint_name
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any (array[
        'documents',
        'processing_jobs',
        'document_chunks',
        'document_hierarchy',
        'chunk_embeddings',
        'analysis_runs',
        'analysis_run_documents',
        'findings',
        'finding_evidence'
      ])
      and con.contype in ('c', 'f')
      and not con.convalidated
  loop
    execute format(
      'alter table %I.%I validate constraint %I',
      pending_constraint.schema_name,
      pending_constraint.table_name,
      pending_constraint.constraint_name
    );
  end loop;
end
$$;

-- RLS is both enabled and forced so accidental owner-level application roles
-- do not silently bypass policies. Supabase service_role remains BYPASSRLS.
do $$
declare
  protected_table text;
begin
  foreach protected_table in array array[
    'profiles',
    'workspaces',
    'workspace_members',
    'documents',
    'processing_jobs',
    'document_chunks',
    'document_hierarchy',
    'chunk_embeddings',
    'analysis_runs',
    'analysis_run_documents',
    'findings',
    'finding_evidence',
    'security_audit_events',
    'rate_limit_counters',
    'controls',
    'regulatory_sources',
    'regulatory_source_chunks',
    'control_elements',
    'control_citations'
  ]
  loop
    execute format('alter table public.%I enable row level security', protected_table);
    execute format('alter table public.%I force row level security', protected_table);
  end loop;
end
$$;

-- Remove policy drift, then recreate only the intended browser-readable surface.
do $$
declare
  protected_table text;
  existing_policy record;
begin
  foreach protected_table in array array[
    'profiles',
    'workspaces',
    'workspace_members',
    'documents',
    'processing_jobs',
    'document_chunks',
    'document_hierarchy',
    'chunk_embeddings',
    'analysis_runs',
    'analysis_run_documents',
    'findings',
    'finding_evidence',
    'security_audit_events',
    'rate_limit_counters',
    'controls',
    'regulatory_sources',
    'regulatory_source_chunks',
    'control_elements',
    'control_citations'
  ]
  loop
    for existing_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = protected_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        existing_policy.policyname,
        protected_table
      );
    end loop;
  end loop;
end
$$;

revoke all on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.documents,
  public.processing_jobs,
  public.document_chunks,
  public.document_hierarchy,
  public.chunk_embeddings,
  public.analysis_runs,
  public.analysis_run_documents,
  public.findings,
  public.finding_evidence,
  public.security_audit_events,
  public.rate_limit_counters,
  public.controls,
  public.regulatory_sources,
  public.regulatory_source_chunks,
  public.control_elements,
  public.control_citations
from public, anon, authenticated;

grant select on public.profiles to authenticated;
grant update (first_name, last_name, full_name, updated_at)
  on public.profiles to authenticated;
grant select on table
  public.workspaces,
  public.workspace_members,
  public.documents,
  public.processing_jobs,
  public.document_chunks,
  public.document_hierarchy,
  public.analysis_runs,
  public.analysis_run_documents,
  public.findings,
  public.finding_evidence,
  public.controls,
  public.regulatory_sources,
  public.regulatory_source_chunks,
  public.control_elements,
  public.control_citations
to authenticated;

revoke all on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.documents,
  public.processing_jobs,
  public.document_chunks,
  public.document_hierarchy,
  public.chunk_embeddings,
  public.analysis_runs,
  public.analysis_run_documents,
  public.findings,
  public.finding_evidence,
  public.security_audit_events,
  public.rate_limit_counters,
  public.controls,
  public.regulatory_sources,
  public.regulatory_source_chunks,
  public.control_elements,
  public.control_citations
from service_role;

grant select, insert, update, delete on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.documents,
  public.processing_jobs,
  public.document_chunks,
  public.document_hierarchy,
  public.chunk_embeddings,
  public.analysis_runs,
  public.analysis_run_documents,
  public.findings,
  public.finding_evidence,
  public.rate_limit_counters,
  public.controls,
  public.regulatory_sources,
  public.regulatory_source_chunks,
  public.control_elements,
  public.control_citations
to service_role;
grant select, insert on public.security_audit_events to service_role;

create policy profiles_select_own
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy workspaces_select_member
  on public.workspaces for select
  to authenticated
  using (private.is_workspace_member(id, (select auth.uid())));

create policy workspace_members_select_member_workspaces
  on public.workspace_members for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy documents_workspace_select
  on public.documents for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy processing_jobs_workspace_select
  on public.processing_jobs for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy document_chunks_workspace_select
  on public.document_chunks for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy document_hierarchy_workspace_select
  on public.document_hierarchy for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy analysis_runs_workspace_select
  on public.analysis_runs for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy analysis_run_documents_workspace_select
  on public.analysis_run_documents for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy findings_workspace_select
  on public.findings for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy finding_evidence_workspace_select
  on public.finding_evidence for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy controls_authenticated_read
  on public.controls for select
  to authenticated
  using (true);

create policy regulatory_sources_authenticated_read
  on public.regulatory_sources for select
  to authenticated
  using (true);

create policy regulatory_source_chunks_authenticated_read
  on public.regulatory_source_chunks for select
  to authenticated
  using (true);

create policy control_elements_authenticated_read
  on public.control_elements for select
  to authenticated
  using (true);

create policy control_citations_authenticated_read
  on public.control_citations for select
  to authenticated
  using (true);

-- SECURITY DEFINER functions are server-only by default and all use a fixed,
-- empty search_path. The one RLS helper needed by browser SELECT policies is
-- granted back explicitly below.
do $$
declare
  secured_function record;
begin
  for secured_function in
    select p.oid::regprocedure as function_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
  loop
    execute format('alter function %s set search_path = ''''', secured_function.function_signature);
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      secured_function.function_signature
    );
  end loop;
end
$$;

grant usage on schema private to authenticated, service_role;
revoke usage on schema private from public, anon;
revoke create on schema public from public, anon, authenticated;
grant execute on function private.is_workspace_member(uuid, uuid)
  to authenticated, service_role;
grant execute on function private.provision_user_workspace(uuid, text, jsonb)
  to service_role;
grant execute on function private.is_canonical_document_storage_path(uuid, uuid, text)
  to service_role;

-- All public RPCs below are trusted-server operations. Resolve overloads from
-- the catalog so future signature changes cannot accidentally restore PUBLIC.
do $$
declare
  internal_function record;
begin
  for internal_function in
    select p.oid::regprocedure as function_signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'start_processing_job',
        'complete_mock_processing',
        'replace_document_and_clear_derived',
        'delete_document_and_derived',
        'process_ingestion_job_placeholder',
        'fail_ingestion_job_v1',
        'claim_ingestion_job_v1',
        'complete_ingestion_job_with_chunks_v1',
        'store_ingestion_chunks_for_embedding_v1',
        'finalize_ingestion_embeddings_v1',
        'match_document_chunks_v1',
        'consume_rate_limit_batch_v1',
        'start_processing_job_with_quota_v1',
        'start_analysis_run_with_quota_v1',
        'complete_analysis_run_with_evidence_guard_v1',
        'get_analysis_report_state_v1',
        'match_analysis_run_document_chunks_v1'
      ])
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      internal_function.function_signature
    );
    execute format(
      'grant execute on function %s to service_role',
      internal_function.function_signature
    );
  end loop;
end
$$;

-- The application performs all document object operations with the server-only
-- service role. The bucket remains private and enforces the same PDF/size limits
-- as the upload route.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 10485760, array['application/pdf']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%documents%'
        or coalesce(with_check, '') ilike '%documents%'
        or policyname ilike '%document%'
      )
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      existing_policy.policyname
    );
  end loop;
end
$$;

revoke select, insert, update, delete on storage.objects from anon, authenticated;
grant select, insert, update, delete on storage.objects to service_role;

revoke all on function private.can_access_document_storage(text, uuid)
  from public, anon, authenticated;
revoke all on function private.can_access_finding_evidence(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
