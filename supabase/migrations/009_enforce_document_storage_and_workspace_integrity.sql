-- Query name: 009_enforce_document_storage_and_workspace_integrity
-- Bind document object keys and child rows to the authorized document workspace.

create or replace function private.is_canonical_document_storage_path(
  p_workspace_id uuid,
  p_document_id uuid,
  p_storage_path text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    p_workspace_id is not null
    and p_document_id is not null
    and p_storage_path is not null
    and p_storage_path like p_workspace_id::text || '/' || p_document_id::text || '/%'
    and length(p_storage_path) > length(p_workspace_id::text || '/' || p_document_id::text || '/')
    and position('/' in substring(
      p_storage_path
      from length(p_workspace_id::text || '/' || p_document_id::text || '/') + 1
    )) = 0;
$$;

revoke all on function private.is_canonical_document_storage_path(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.is_canonical_document_storage_path(uuid, uuid, text)
  to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_id_workspace_id_key'
  ) then
    alter table public.documents
      add constraint documents_id_workspace_id_key unique (id, workspace_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_canonical_storage_path_check'
  ) then
    alter table public.documents
      add constraint documents_canonical_storage_path_check
      check (private.is_canonical_document_storage_path(workspace_id, id, storage_path))
      not valid;
  end if;
end
$$;

do $$
declare
  child_table text;
  constraint_name text;
begin
  foreach child_table in array array[
    'processing_jobs',
    'document_chunks',
    'document_hierarchy'
  ]
  loop
    constraint_name := child_table || '_document_workspace_fkey';

    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', child_table)::regclass
        and conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (document_id, workspace_id) references public.documents(id, workspace_id) on delete cascade not valid',
        child_table,
        constraint_name
      );
    end if;
  end loop;
end
$$;

alter table public.finding_evidence
  add column if not exists workspace_id uuid;

update public.finding_evidence fe
set workspace_id = coalesce(
  (select f.workspace_id from public.findings f where f.id = fe.finding_id),
  (select d.workspace_id from public.documents d where d.id = fe.document_id),
  (select dc.workspace_id from public.document_chunks dc where dc.id = fe.chunk_id)
)
where fe.workspace_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finding_evidence'::regclass
      and conname = 'finding_evidence_workspace_id_fkey'
  ) then
    alter table public.finding_evidence
      add constraint finding_evidence_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id) on delete cascade
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finding_evidence'::regclass
      and conname = 'finding_evidence_workspace_id_required'
  ) then
    alter table public.finding_evidence
      add constraint finding_evidence_workspace_id_required
      check (workspace_id is not null) not valid;
  end if;
end
$$;

create index if not exists idx_finding_evidence_workspace_id
  on public.finding_evidence (workspace_id);

create or replace function private.enforce_document_workspace_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.document_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.documents d
    where d.id = new.document_id
      and d.workspace_id = new.workspace_id
  ) then
    raise exception 'document_workspace_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_document_workspace_match()
  from public, anon, authenticated;

drop trigger if exists findings_document_workspace_match on public.findings;
create trigger findings_document_workspace_match
  before insert or update of document_id, workspace_id on public.findings
  for each row execute function private.enforce_document_workspace_match();

create or replace function private.enforce_finding_evidence_workspace_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.findings f
    where f.id = new.finding_id
      and f.workspace_id = new.workspace_id
  ) then
    raise exception 'finding_workspace_mismatch' using errcode = '23514';
  end if;

  if new.document_id is not null and not exists (
    select 1 from public.documents d
    where d.id = new.document_id
      and d.workspace_id = new.workspace_id
  ) then
    raise exception 'evidence_document_workspace_mismatch' using errcode = '23514';
  end if;

  if new.chunk_id is not null and not exists (
    select 1 from public.document_chunks dc
    where dc.id = new.chunk_id
      and dc.workspace_id = new.workspace_id
  ) then
    raise exception 'evidence_chunk_workspace_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_finding_evidence_workspace_match()
  from public, anon, authenticated;

drop trigger if exists finding_evidence_workspace_match on public.finding_evidence;
create trigger finding_evidence_workspace_match
  before insert or update of finding_id, document_id, chunk_id, workspace_id
  on public.finding_evidence
  for each row execute function private.enforce_finding_evidence_workspace_match();

-- Browser clients now read document rows only. Upload, replace, and delete are
-- authorized server operations so trusted fields cannot be forged directly.
revoke insert, update, delete on public.documents from authenticated;
drop policy if exists documents_workspace_access on public.documents;
drop policy if exists documents_workspace_select on public.documents;
create policy documents_workspace_select
  on public.documents for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

-- Require a matching document row as well as workspace membership for Storage.
create or replace function private.can_access_document_storage(
  p_object_name text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  folders text[];
  parsed_workspace_id uuid;
  parsed_document_id uuid;
begin
  folders := storage.foldername(p_object_name);

  if array_length(folders, 1) <> 2 then
    return false;
  end if;

  begin
    parsed_workspace_id := folders[1]::uuid;
    parsed_document_id := folders[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return private.is_workspace_member(parsed_workspace_id, p_user_id)
    and exists (
      select 1
      from public.documents d
      where d.id = parsed_document_id
        and d.workspace_id = parsed_workspace_id
        and d.storage_path = p_object_name
    );
end;
$$;

revoke all on function private.can_access_document_storage(text, uuid)
  from public, anon;
grant execute on function private.can_access_document_storage(text, uuid)
  to anon, authenticated, service_role;
