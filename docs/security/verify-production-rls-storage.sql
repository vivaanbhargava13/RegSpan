-- RegSpan production RLS, grants, RPC, and Storage verification.
-- Read-only: run in the Supabase SQL editor after migration 021.

-- Query name: rls_and_force_rls_status
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any (array[
    'profiles', 'workspaces', 'workspace_members', 'documents',
    'processing_jobs', 'document_chunks', 'document_hierarchy',
    'chunk_embeddings', 'analysis_runs', 'analysis_run_documents',
    'findings', 'finding_evidence', 'security_audit_events',
    'rate_limit_counters', 'controls', 'regulatory_sources',
    'regulatory_source_chunks', 'control_elements', 'control_citations'
  ])
order by c.relname;

-- Query name: sensitive_table_grants
select
  table_schema,
  table_name,
  grantee,
  string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = any (array[
    'profiles', 'workspaces', 'workspace_members', 'documents',
    'processing_jobs', 'document_chunks', 'document_hierarchy',
    'chunk_embeddings', 'analysis_runs', 'analysis_run_documents',
    'findings', 'finding_evidence', 'security_audit_events',
    'rate_limit_counters', 'controls', 'regulatory_sources',
    'regulatory_source_chunks', 'control_elements', 'control_citations'
  ])
  and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
group by table_schema, table_name, grantee
order by table_name, grantee;

-- Query name: public_rls_policy_definitions
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = any (array[
    'profiles', 'workspaces', 'workspace_members', 'documents',
    'processing_jobs', 'document_chunks', 'document_hierarchy',
    'chunk_embeddings', 'analysis_runs', 'analysis_run_documents',
    'findings', 'finding_evidence', 'security_audit_events',
    'rate_limit_counters', 'controls', 'regulatory_sources',
    'regulatory_source_chunks', 'control_elements', 'control_citations'
  ])
order by tablename, policyname;

-- Query name: unexpected_anon_table_privileges_expected_zero_rows
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee in ('PUBLIC', 'anon')
  and table_schema = 'public'
  and table_name = any (array[
    'profiles', 'workspaces', 'workspace_members', 'documents',
    'processing_jobs', 'document_chunks', 'document_hierarchy',
    'chunk_embeddings', 'analysis_runs', 'analysis_run_documents',
    'findings', 'finding_evidence', 'security_audit_events',
    'rate_limit_counters', 'controls', 'regulatory_sources',
    'regulatory_source_chunks', 'control_elements', 'control_citations'
  ])
order by table_name, privilege_type;

-- Query name: unexpected_authenticated_server_only_privileges_expected_zero_rows
select table_schema, table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name in ('chunk_embeddings', 'rate_limit_counters', 'security_audit_events')
order by table_name, privilege_type;

-- Query name: authenticated_write_privileges_expected_profiles_update_only
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
order by table_name, privilege_type;

-- Query name: authenticated_profile_column_grants
select table_name, column_name, privilege_type
from information_schema.role_column_grants
where grantee = 'authenticated'
  and table_schema = 'public'
  and table_name = 'profiles'
order by column_name, privilege_type;

-- Query name: security_definer_search_path
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_configuration
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prosecdef
order by n.nspname, p.proname, arguments;

-- Query name: internal_rpc_execute_grants
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type
from information_schema.role_routine_grants
where routine_schema = 'public'
  and routine_name = any (array[
    'start_processing_job', 'complete_mock_processing',
    'replace_document_and_clear_derived', 'delete_document_and_derived',
    'process_ingestion_job_placeholder', 'fail_ingestion_job_v1',
    'claim_ingestion_job_v1', 'complete_ingestion_job_with_chunks_v1',
    'store_ingestion_chunks_for_embedding_v1',
    'finalize_ingestion_embeddings_v1', 'match_document_chunks_v1',
    'consume_rate_limit_batch_v1', 'start_processing_job_with_quota_v1',
    'start_analysis_run_with_quota_v1',
    'complete_analysis_run_with_evidence_guard_v1',
    'get_analysis_report_state_v1',
    'match_analysis_run_document_chunks_v1'
  ])
order by routine_name, grantee;

-- Query name: browser_executable_internal_rpcs_expected_zero_rows
select routine_schema, routine_name, grantee
from information_schema.role_routine_grants
where routine_schema = 'public'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
  and routine_name = any (array[
    'start_processing_job', 'complete_mock_processing',
    'replace_document_and_clear_derived', 'delete_document_and_derived',
    'process_ingestion_job_placeholder', 'fail_ingestion_job_v1',
    'claim_ingestion_job_v1', 'complete_ingestion_job_with_chunks_v1',
    'store_ingestion_chunks_for_embedding_v1',
    'finalize_ingestion_embeddings_v1', 'match_document_chunks_v1',
    'consume_rate_limit_batch_v1', 'start_processing_job_with_quota_v1',
    'start_analysis_run_with_quota_v1',
    'complete_analysis_run_with_evidence_guard_v1',
    'get_analysis_report_state_v1',
    'match_analysis_run_document_chunks_v1'
  ]);

-- Query name: documents_bucket_privacy
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'documents';

-- Query name: storage_object_policy_definitions
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

-- Query name: storage_objects_browser_grants_expected_zero_rows
select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'storage'
  and table_name = 'objects'
  and grantee in ('PUBLIC', 'anon', 'authenticated')
order by grantee, privilege_type;

-- Query name: direct_documents_bucket_browser_policies_expected_zero_rows
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    coalesce(qual, '') ilike '%documents%'
    or coalesce(with_check, '') ilike '%documents%'
    or policyname ilike '%document%'
  );

-- Query name: unvalidated_sensitive_constraints_expected_zero_rows
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = any (array[
    'documents', 'processing_jobs', 'document_chunks', 'document_hierarchy',
    'chunk_embeddings', 'analysis_runs', 'analysis_run_documents',
    'findings', 'finding_evidence'
  ])
  and con.contype in ('c', 'f')
  and not con.convalidated
order by c.relname, con.conname;

-- Query name: cross_workspace_relationships_expected_zero_rows
select 'processing_jobs' as relationship, pj.id as row_id
from public.processing_jobs pj
join public.documents d on d.id = pj.document_id
where pj.workspace_id <> d.workspace_id
union all
select 'document_chunks', dc.id
from public.document_chunks dc
join public.documents d on d.id = dc.document_id
where dc.workspace_id <> d.workspace_id
union all
select 'document_hierarchy', dh.id
from public.document_hierarchy dh
join public.documents d on d.id = dh.document_id
where dh.workspace_id <> d.workspace_id
union all
select 'analysis_run_documents:run', ard.id
from public.analysis_run_documents ard
join public.analysis_runs ar on ar.id = ard.analysis_run_id
where ard.workspace_id <> ar.workspace_id
union all
select 'analysis_run_documents:document', ard.id
from public.analysis_run_documents ard
join public.documents d on d.id = ard.document_id
where ard.workspace_id <> d.workspace_id
union all
select 'findings:analysis_run', f.id
from public.findings f
join public.analysis_runs ar on ar.id = f.analysis_run_id
where f.workspace_id <> ar.workspace_id
union all
select 'finding_evidence:finding', fe.id
from public.finding_evidence fe
join public.findings f on f.id = fe.finding_id
where fe.workspace_id <> f.workspace_id
union all
select 'finding_evidence:document', fe.id
from public.finding_evidence fe
join public.documents d on d.id = fe.document_id
where fe.workspace_id <> d.workspace_id
union all
select 'finding_evidence:chunk', fe.id
from public.finding_evidence fe
join public.document_chunks dc on dc.id = fe.chunk_id
where fe.workspace_id <> dc.workspace_id;
