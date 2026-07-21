-- Query name: 027_add_classifier_facts_shadow_results
-- Service-role-only facts classifier shadow telemetry. Never a findings source.

create table if not exists public.classifier_facts_shadow_results (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  requirement_id text not null,
  outcome text not null,
  valid boolean not null default false,
  current_status text not null,
  shadow_status text,
  current_elements jsonb not null default '[]'::jsonb,
  shadow_elements jsonb not null default '[]'::jsonb,
  candidate_ids jsonb not null,
  candidate_set_sha256 text not null,
  accepted_facts jsonb not null default '[]'::jsonb,
  rejected_facts jsonb not null default '[]'::jsonb,
  atomic_element_ledger jsonb not null default '[]'::jsonb,
  source_unit_citations jsonb not null default '[]'::jsonb,
  current_evidence jsonb not null default '[]'::jsonb,
  request_body jsonb not null,
  provider_response jsonb,
  request_sha256 text not null,
  response_sha256 text,
  provider_request_id text,
  model text not null,
  latency_ms double precision not null,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  validation_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (analysis_run_id, document_id, requirement_id)
);

alter table public.classifier_facts_shadow_results enable row level security;

revoke all on public.classifier_facts_shadow_results from public, anon, authenticated;
grant select, insert, update, delete on public.classifier_facts_shadow_results to service_role;

create index if not exists idx_classifier_facts_shadow_run
  on public.classifier_facts_shadow_results (analysis_run_id, requirement_id);
create index if not exists idx_classifier_facts_shadow_workspace_created
  on public.classifier_facts_shadow_results (workspace_id, created_at desc);

create or replace function private.enforce_classifier_facts_shadow_scope()
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
    raise exception using message = 'classifier_facts_shadow_run_workspace_mismatch', errcode = '23514';
  end if;
  if not exists (
    select 1 from public.documents d
    where d.id = new.document_id and d.workspace_id = new.workspace_id
  ) then
    raise exception using message = 'classifier_facts_shadow_document_workspace_mismatch', errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_classifier_facts_shadow_scope()
  from public, anon, authenticated;

drop trigger if exists classifier_facts_shadow_scope
  on public.classifier_facts_shadow_results;
create trigger classifier_facts_shadow_scope
  before insert or update of workspace_id, document_id, analysis_run_id
  on public.classifier_facts_shadow_results
  for each row execute function private.enforce_classifier_facts_shadow_scope();
