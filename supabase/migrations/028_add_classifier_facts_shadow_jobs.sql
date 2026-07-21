-- Query name: 028_add_classifier_facts_shadow_jobs
-- Atomic service-role-only queue for frozen facts-classifier shadow snapshots.

create table if not exists public.classifier_facts_shadow_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  requirement_id text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  snapshot jsonb not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_run_id, document_id, requirement_id),
  constraint classifier_facts_shadow_jobs_status_check
    check (status in ('pending', 'running', 'completed', 'failed')),
  constraint classifier_facts_shadow_jobs_attempts_check
    check (attempts >= 0)
);

alter table public.classifier_facts_shadow_jobs enable row level security;
revoke all on public.classifier_facts_shadow_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.classifier_facts_shadow_jobs to service_role;

create index if not exists idx_classifier_facts_shadow_jobs_claim
  on public.classifier_facts_shadow_jobs (status, created_at, id);
create index if not exists idx_classifier_facts_shadow_jobs_workspace_run
  on public.classifier_facts_shadow_jobs (workspace_id, analysis_run_id);

create or replace function private.enforce_classifier_facts_shadow_job_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.analysis_runs ar
    where ar.id = new.analysis_run_id and ar.workspace_id = new.workspace_id
  ) then
    raise exception using message = 'classifier_facts_shadow_job_run_workspace_mismatch', errcode = '23514';
  end if;
  if not exists (
    select 1 from public.documents d
    where d.id = new.document_id and d.workspace_id = new.workspace_id
  ) then
    raise exception using message = 'classifier_facts_shadow_job_document_workspace_mismatch', errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_classifier_facts_shadow_job_scope()
  from public, anon, authenticated;

drop trigger if exists classifier_facts_shadow_job_scope
  on public.classifier_facts_shadow_jobs;
create trigger classifier_facts_shadow_job_scope
  before insert or update of workspace_id, document_id, analysis_run_id
  on public.classifier_facts_shadow_jobs
  for each row execute function private.enforce_classifier_facts_shadow_job_scope();

create or replace function public.claim_classifier_facts_shadow_jobs_v1(
  p_limit integer,
  p_retry_failed boolean default false
)
returns setof public.classifier_facts_shadow_jobs
language sql
security definer
set search_path = ''
as $$
  with claimable as (
    select jobs.id
    from public.classifier_facts_shadow_jobs jobs
    where (jobs.status = 'pending'
      or (p_retry_failed and (
        jobs.status = 'failed'
        or (jobs.status = 'running' and jobs.claimed_at < now() - interval '15 minutes')
      )))
    and exists (
      select 1 from public.workspaces workspaces
      where workspaces.id = jobs.workspace_id
        and workspaces.external_ai_processing_enabled = true
    )
    order by jobs.created_at, jobs.id
    for update skip locked
    limit least(greatest(p_limit, 1), 100)
  )
  update public.classifier_facts_shadow_jobs jobs
  set
    status = 'running',
    attempts = jobs.attempts + 1,
    claimed_at = now(),
    completed_at = null,
    last_error = null,
    updated_at = now()
  from claimable
  where jobs.id = claimable.id
  returning jobs.*;
$$;

revoke all on function public.claim_classifier_facts_shadow_jobs_v1(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_classifier_facts_shadow_jobs_v1(integer, boolean)
  to service_role;

alter table public.classifier_facts_shadow_results
  add column if not exists shadow_job_id uuid references public.classifier_facts_shadow_jobs(id) on delete set null;

create unique index if not exists idx_classifier_facts_shadow_results_job
  on public.classifier_facts_shadow_results (shadow_job_id)
  where shadow_job_id is not null;
