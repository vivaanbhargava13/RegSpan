-- Read-only verification helpers for migrations 008 through 011.
-- Run each named query in the Supabase SQL Editor after applying the migrations.

-- Query name: verify_security_rls_enabled
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles', 'workspaces', 'workspace_members', 'documents',
    'processing_jobs', 'document_chunks', 'document_hierarchy',
    'findings', 'finding_evidence', 'security_audit_events'
  )
order by c.relname;

-- Query name: verify_security_grants
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'documents', 'processing_jobs', 'document_chunks', 'document_hierarchy',
    'findings', 'finding_evidence', 'security_audit_events'
  )
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- Query name: verify_documents_storage_policies
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    policyname ilike '%document%'
    or coalesce(qual, '') ilike '%documents%'
    or coalesce(with_check, '') ilike '%documents%'
  )
order by policyname;

-- Query name: verify_no_demo_policies
select schemaname, tablename, policyname, qual, with_check
from pg_policies
where coalesce(qual, '') ilike '%demo%'
   or coalesce(with_check, '') ilike '%demo%';

-- Query name: verify_backend_tables_not_browser_writable
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'authenticated'
  and table_name in (
    'processing_jobs', 'document_chunks', 'document_hierarchy',
    'findings', 'finding_evidence', 'security_audit_events'
  )
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES');

-- Expected result for verify_backend_tables_not_browser_writable: zero rows.

-- Query name: verify_document_workspace_integrity_constraints
select conrelid::regclass as table_name, conname, contype, convalidated
from pg_constraint
where conname in (
  'documents_id_workspace_id_key',
  'documents_canonical_storage_path_check',
  'processing_jobs_document_workspace_fkey',
  'document_chunks_document_workspace_fkey',
  'document_hierarchy_document_workspace_fkey',
  'finding_evidence_workspace_id_required'
)
order by table_name::text, conname;

-- Query name: verify_processing_job_guards
select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'processing_jobs'
  and indexname in (
    'idx_processing_jobs_one_active_per_document',
    'idx_processing_jobs_idempotency',
    'idx_processing_jobs_workspace_document_created'
  )
order by indexname;

