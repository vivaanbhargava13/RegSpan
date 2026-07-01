-- Query name: 016_create_findings_generation_tables
-- Durable first-pass findings generation runs and citation metadata.

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  generated_by uuid references auth.users(id) on delete set null,
  requirement_count integer not null default 0,
  finding_count integer not null default 0,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.analysis_runs
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists status text not null default 'running',
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz,
  add column if not exists generated_by uuid references auth.users(id) on delete set null,
  add column if not exists requirement_count integer not null default 0,
  add column if not exists finding_count integer not null default 0,
  add column if not exists error_message text,
  add column if not exists created_at timestamptz not null default now();

alter table public.findings
  add column if not exists analysis_run_id uuid references public.analysis_runs(id) on delete cascade,
  add column if not exists requirement_id text,
  add column if not exists requirement_name text,
  add column if not exists confidence text,
  add column if not exists summary text,
  add column if not exists rationale text;

alter table public.finding_evidence
  add column if not exists relationship text,
  add column if not exists quote text,
  add column if not exists reason text,
  add column if not exists confidence text,
  add column if not exists filename text,
  add column if not exists section_path text,
  add column if not exists chunk_index integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.analysis_runs'::regclass
      and conname = 'analysis_runs_status_check'
  ) then
    alter table public.analysis_runs
      add constraint analysis_runs_status_check
      check (status in ('running', 'completed', 'failed')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.findings'::regclass
      and conname = 'findings_generation_status_check'
  ) then
    alter table public.findings
      add constraint findings_generation_status_check
      check (status in (
        'covered',
        'partial',
        'missing',
        'conflicting',
        'needs_review',
        'Needs Review'
      )) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.findings'::regclass
      and conname = 'findings_generation_severity_check'
  ) then
    alter table public.findings
      add constraint findings_generation_severity_check
      check (severity is null or severity in ('critical', 'high', 'medium', 'low', 'info')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.finding_evidence'::regclass
      and conname = 'finding_evidence_relationship_check'
  ) then
    alter table public.finding_evidence
      add constraint finding_evidence_relationship_check
      check (relationship is null or relationship in (
        'supports',
        'partially_supports',
        'negative_evidence',
        'background_context',
        'irrelevant'
      )) not valid;
  end if;
end
$$;

create index if not exists idx_analysis_runs_workspace_created
  on public.analysis_runs (workspace_id, created_at desc);
create index if not exists idx_analysis_runs_generated_by_created
  on public.analysis_runs (generated_by, created_at desc)
  where generated_by is not null;
create index if not exists idx_findings_analysis_run_id
  on public.findings (analysis_run_id);
create index if not exists idx_findings_workspace_run_status
  on public.findings (workspace_id, analysis_run_id, status);
create index if not exists idx_finding_evidence_relationship
  on public.finding_evidence (relationship);

alter table public.analysis_runs enable row level security;

drop policy if exists analysis_runs_workspace_select on public.analysis_runs;
create policy analysis_runs_workspace_select
  on public.analysis_runs for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

revoke all on public.analysis_runs from public, anon, authenticated;
grant select on public.analysis_runs to authenticated;
grant select, insert, update, delete on public.analysis_runs to service_role;

grant select, insert, update, delete on public.findings to service_role;
grant select, insert, update, delete on public.finding_evidence to service_role;
