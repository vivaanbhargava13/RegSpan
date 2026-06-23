-- Query name: 008_create_workspace_auth_rls
-- Auth/Workspace v1: per-user workspace provisioning, UUID workspace ownership, and RLS.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to anon, authenticated, service_role;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  first_name text,
  last_name text,
  full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles
  add column if not exists email text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists full_name text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.workspaces
  add column if not exists name text,
  add column if not exists owner_user_id uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz default now(),
  constraint workspace_members_workspace_id_user_id_key unique (workspace_id, user_id)
);

alter table public.workspace_members
  add column if not exists workspace_id uuid,
  add column if not exists user_id uuid,
  add column if not exists role text not null default 'owner',
  add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.workspace_members'::regclass
      and conname = 'workspace_members_workspace_id_user_id_key'
  ) then
    alter table public.workspace_members
      add constraint workspace_members_workspace_id_user_id_key unique (workspace_id, user_id);
  end if;
end
$$;

create index if not exists idx_workspaces_owner_user_id
  on public.workspaces (owner_user_id);
create index if not exists idx_workspace_members_user_id
  on public.workspace_members (user_id);
create index if not exists idx_workspace_members_workspace_id
  on public.workspace_members (workspace_id);

-- Preserve legacy text values without assigning shared demo data to an arbitrary user.
-- New rows use the UUID workspace_id; legacy rows remain stored under legacy_workspace_id.
do $$
declare
  scoped_table text;
  workspace_type text;
begin
  foreach scoped_table in array array[
    'documents',
    'processing_jobs',
    'document_chunks',
    'document_hierarchy',
    'findings'
  ]
  loop
    select data_type
      into workspace_type
      from information_schema.columns
      where table_schema = 'public'
        and table_name = scoped_table
        and column_name = 'workspace_id';

    if workspace_type = 'text' and not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = scoped_table
        and column_name = 'legacy_workspace_id'
    ) then
      execute format(
        'alter table public.%I rename column workspace_id to legacy_workspace_id',
        scoped_table
      );
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = scoped_table
        and column_name = 'legacy_workspace_id'
    ) then
      execute format(
        'alter table public.%I alter column legacy_workspace_id drop not null',
        scoped_table
      );
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = scoped_table
        and column_name = 'workspace_id'
    ) then
      execute format(
        'alter table public.%I add column workspace_id uuid',
        scoped_table
      );
    end if;
  end loop;
end
$$;

do $$
declare
  scoped_table text;
  fk_name text;
  required_name text;
begin
  foreach scoped_table in array array[
    'documents',
    'processing_jobs',
    'document_chunks',
    'document_hierarchy',
    'findings'
  ]
  loop
    fk_name := scoped_table || '_workspace_id_fkey';
    required_name := scoped_table || '_workspace_id_required';

    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', scoped_table)::regclass
        and conname = fk_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (workspace_id) references public.workspaces(id) on delete cascade',
        scoped_table,
        fk_name
      );
    end if;

    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', scoped_table)::regclass
        and conname = required_name
    ) then
      execute format(
        'alter table public.%I add constraint %I check (workspace_id is not null) not valid',
        scoped_table,
        required_name
      );
    end if;
  end loop;
end
$$;

create index if not exists idx_documents_workspace_uuid
  on public.documents (workspace_id);
create index if not exists idx_processing_jobs_workspace_uuid
  on public.processing_jobs (workspace_id);
create index if not exists idx_document_chunks_workspace_uuid
  on public.document_chunks (workspace_id);
create index if not exists idx_document_hierarchy_workspace_uuid
  on public.document_hierarchy (workspace_id);
create index if not exists idx_findings_workspace_uuid
  on public.findings (workspace_id);

create or replace function private.provision_user_workspace(
  p_user_id uuid,
  p_email text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  provisioned_workspace_id uuid;
  profile_first_name text;
  profile_last_name text;
  profile_full_name text;
  default_workspace_name text;
begin
  profile_first_name := nullif(btrim(coalesce(p_metadata ->> 'first_name', '')), '');
  profile_last_name := nullif(btrim(coalesce(p_metadata ->> 'last_name', '')), '');
  profile_full_name := nullif(btrim(coalesce(
    p_metadata ->> 'full_name',
    concat_ws(' ', profile_first_name, profile_last_name)
  )), '');

  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    full_name,
    updated_at
  ) values (
    p_user_id,
    p_email,
    profile_first_name,
    profile_last_name,
    profile_full_name,
    now()
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = coalesce(excluded.first_name, public.profiles.first_name),
    last_name = coalesce(excluded.last_name, public.profiles.last_name),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    updated_at = now();

  select wm.workspace_id
    into provisioned_workspace_id
    from public.workspace_members wm
    where wm.user_id = p_user_id
    order by wm.created_at asc
    limit 1;

  if provisioned_workspace_id is not null then
    return provisioned_workspace_id;
  end if;

  default_workspace_name := case
    when profile_first_name is not null then profile_first_name || '''s Workspace'
    else 'Personal Workspace'
  end;

  insert into public.workspaces (name, owner_user_id)
  values (default_workspace_name, p_user_id)
  returning id into provisioned_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (provisioned_workspace_id, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return provisioned_workspace_id;
end;
$$;

revoke all on function private.provision_user_workspace(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function private.provision_user_workspace(uuid, text, jsonb) to service_role;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform private.provision_user_workspace(
      new.id,
      new.email,
      coalesce(new.raw_user_meta_data, '{}'::jsonb)
    );
  exception when others then
    raise warning 'RegSpan workspace provisioning failed for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_regspan on auth.users;
create trigger on_auth_user_created_regspan
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Provision profiles and default workspaces for users who signed up before this migration.
do $$
declare
  existing_user record;
begin
  for existing_user in
    select id, email, raw_user_meta_data
    from auth.users
  loop
    begin
      perform private.provision_user_workspace(
        existing_user.id,
        existing_user.email,
        coalesce(existing_user.raw_user_meta_data, '{}'::jsonb)
      );
    exception when others then
      raise warning 'RegSpan backfill failed for user %: %', existing_user.id, sqlerrm;
    end;
  end loop;
end
$$;

create or replace function private.is_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = p_user_id
    );
$$;

revoke all on function private.is_workspace_member(uuid, uuid) from public, anon;
grant execute on function private.is_workspace_member(uuid, uuid) to authenticated, service_role;

create or replace function private.can_access_finding_evidence(
  p_finding_id uuid,
  p_document_id uuid,
  p_chunk_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.findings f
      where f.id = p_finding_id
        and private.is_workspace_member(f.workspace_id, p_user_id)
    )
    and (
      p_document_id is null
      or exists (
        select 1
        from public.documents d
        where d.id = p_document_id
          and private.is_workspace_member(d.workspace_id, p_user_id)
      )
    )
    and (
      p_chunk_id is null
      or exists (
        select 1
        from public.document_chunks dc
        where dc.id = p_chunk_id
          and private.is_workspace_member(dc.workspace_id, p_user_id)
      )
    );
$$;

revoke all on function private.can_access_finding_evidence(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.can_access_finding_evidence(uuid, uuid, uuid, uuid) to authenticated, service_role;

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
  workspace_segment text;
  parsed_workspace_id uuid;
begin
  workspace_segment := (storage.foldername(p_object_name))[1];

  if workspace_segment is null then
    return false;
  end if;

  begin
    parsed_workspace_id := workspace_segment::uuid;
  exception when invalid_text_representation then
    return false;
  end;

  return private.is_workspace_member(parsed_workspace_id, p_user_id);
end;
$$;

revoke all on function private.can_access_document_storage(text, uuid) from public, anon;
grant execute on function private.can_access_document_storage(text, uuid) to anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.documents enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_hierarchy enable row level security;
alter table public.findings enable row level security;
alter table public.finding_evidence enable row level security;
alter table public.controls enable row level security;

-- Remove existing public-table policies, including temporary shared-demo policies.
do $$
declare
  scoped_table text;
  existing_policy record;
begin
  foreach scoped_table in array array[
    'profiles',
    'workspaces',
    'workspace_members',
    'documents',
    'processing_jobs',
    'document_chunks',
    'document_hierarchy',
    'findings',
    'finding_evidence',
    'controls'
  ]
  loop
    for existing_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = scoped_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        existing_policy.policyname,
        scoped_table
      );
    end loop;
  end loop;
end
$$;

revoke all on public.profiles from anon;
revoke all on public.workspaces from anon;
revoke all on public.workspace_members from anon;
revoke all on public.documents from anon;
revoke all on public.processing_jobs from anon;
revoke all on public.document_chunks from anon;
revoke all on public.document_hierarchy from anon;
revoke all on public.findings from anon;
revoke all on public.finding_evidence from anon;
revoke all on public.controls from anon;

-- Reset authenticated privileges so rerunning this migration also removes any
-- backend-table write grants from an earlier development version.
revoke all on public.profiles from authenticated;
revoke all on public.workspaces from authenticated;
revoke all on public.workspace_members from authenticated;
revoke all on public.documents from authenticated;
revoke all on public.processing_jobs from authenticated;
revoke all on public.document_chunks from authenticated;
revoke all on public.document_hierarchy from authenticated;
revoke all on public.findings from authenticated;
revoke all on public.finding_evidence from authenticated;
revoke all on public.controls from authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select, insert, update, delete on public.documents to authenticated;
grant select on public.processing_jobs to authenticated;
grant select on public.document_chunks to authenticated;
grant select on public.document_hierarchy to authenticated;
grant select on public.findings to authenticated;
grant select on public.finding_evidence to authenticated;
grant select on public.controls to authenticated;

-- Server-side ingestion and future backend generation use the service role only
-- after request authorization. Grant its required table operations explicitly.
grant select, insert, update, delete on table
  public.profiles,
  public.workspaces,
  public.workspace_members,
  public.documents,
  public.processing_jobs,
  public.document_chunks,
  public.document_hierarchy,
  public.findings,
  public.finding_evidence,
  public.controls
to service_role;

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

create policy documents_workspace_access
  on public.documents for all
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())))
  with check (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy processing_jobs_workspace_access
  on public.processing_jobs for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy document_chunks_workspace_access
  on public.document_chunks for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy document_hierarchy_workspace_access
  on public.document_hierarchy for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy findings_workspace_access
  on public.findings for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

create policy finding_evidence_workspace_access
  on public.finding_evidence for select
  to authenticated
  using (private.can_access_finding_evidence(
    finding_id,
    document_id,
    chunk_id,
    (select auth.uid())
  ));

create policy controls_authenticated_read
  on public.controls for select
  to authenticated
  using (true);

-- Replace policies tied to the former demo/documents path convention.
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
        policyname ilike '%document%'
        or coalesce(qual, '') ilike '%documents%'
        or coalesce(with_check, '') ilike '%documents%'
        or coalesce(qual, '') ilike '%demo%'
        or coalesce(with_check, '') ilike '%demo%'
      )
  loop
    execute format(
      'drop policy if exists %I on storage.objects',
      existing_policy.policyname
    );
  end loop;
end
$$;

create policy documents_storage_select_member
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and private.can_access_document_storage(name, (select auth.uid()))
  );

create policy documents_storage_insert_member
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and private.can_access_document_storage(name, (select auth.uid()))
  );

create policy documents_storage_update_member
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'documents'
    and private.can_access_document_storage(name, (select auth.uid()))
  )
  with check (
    bucket_id = 'documents'
    and private.can_access_document_storage(name, (select auth.uid()))
  );

create policy documents_storage_delete_member
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and private.can_access_document_storage(name, (select auth.uid()))
  );

-- Restrictive guards prevent any unrelated broad permissive policy from bypassing
-- workspace checks for the documents bucket while leaving other buckets untouched.
create policy documents_storage_select_guard
  on storage.objects as restrictive for select
  to anon, authenticated
  using (
    bucket_id <> 'documents'
    or private.can_access_document_storage(name, (select auth.uid()))
  );

create policy documents_storage_insert_guard
  on storage.objects as restrictive for insert
  to anon, authenticated
  with check (
    bucket_id <> 'documents'
    or private.can_access_document_storage(name, (select auth.uid()))
  );

create policy documents_storage_update_guard
  on storage.objects as restrictive for update
  to anon, authenticated
  using (
    bucket_id <> 'documents'
    or private.can_access_document_storage(name, (select auth.uid()))
  )
  with check (
    bucket_id <> 'documents'
    or private.can_access_document_storage(name, (select auth.uid()))
  );

create policy documents_storage_delete_guard
  on storage.objects as restrictive for delete
  to anon, authenticated
  using (
    bucket_id <> 'documents'
    or private.can_access_document_storage(name, (select auth.uid()))
  );
