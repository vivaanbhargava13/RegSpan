-- Query name: 020_fix_analysis_run_quota_and_lifecycle
-- Analysis runs are immutable document snapshots and cannot complete without primary source evidence.

create table if not exists public.analysis_run_documents (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  filename text not null,
  document_status text not null,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (analysis_run_id, document_id)
);

create index if not exists idx_analysis_run_documents_run
  on public.analysis_run_documents (analysis_run_id, created_at);
create index if not exists idx_analysis_run_documents_workspace_document
  on public.analysis_run_documents (workspace_id, document_id);

alter table public.analysis_run_documents enable row level security;
revoke all on public.analysis_run_documents from public, anon, authenticated;
grant select on public.analysis_run_documents to authenticated;
grant select, insert, update, delete on public.analysis_run_documents to service_role;

drop policy if exists analysis_run_documents_workspace_select on public.analysis_run_documents;
create policy analysis_run_documents_workspace_select
  on public.analysis_run_documents for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

-- Existing duplicate active runs cannot coexist once the partial unique index is enabled.
with ranked_active_runs as (
  select
    id,
    row_number() over (
      partition by workspace_id
      order by started_at desc, created_at desc, id desc
    ) as active_rank
  from public.analysis_runs
  where status = 'running'
)
update public.analysis_runs ar
set
  status = 'failed',
  completed_at = coalesce(ar.completed_at, now()),
  error_message = 'Superseded while enforcing one active analysis run per workspace.'
from ranked_active_runs ranked
where ar.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists idx_analysis_runs_one_active_per_workspace
  on public.analysis_runs (workspace_id)
  where status = 'running';

create or replace function public.start_analysis_run_with_quota_v1(
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_requirement_count integer,
  p_max_active_runs integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_run public.analysis_runs%rowtype;
  new_run public.analysis_runs%rowtype;
  snapshot_count integer;
  stale_cutoff timestamptz := now() - interval '15 minutes';
begin
  if p_max_active_runs < 1 or p_requirement_count < 0 then
    raise exception using message = 'invalid_analysis_quota', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 2));

  update public.analysis_runs
  set
    status = 'failed',
    completed_at = now(),
    error_message = 'Analysis run exceeded the 15-minute active-run timeout.'
  where workspace_id = p_workspace_id
    and status = 'running'
    and started_at < stale_cutoff;

  select * into active_run
  from public.analysis_runs ar
  where ar.workspace_id = p_workspace_id
    and ar.status = 'running'
    and ar.started_at >= stale_cutoff
  order by ar.started_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'result', 'reused_active_run',
      'analysis_run_id', active_run.id,
      'workspace_id', active_run.workspace_id,
      'status', active_run.status,
      'started_at', active_run.started_at,
      'completed_at', active_run.completed_at,
      'generated_by', active_run.generated_by,
      'requirement_count', active_run.requirement_count,
      'finding_count', active_run.finding_count,
      'error_message', active_run.error_message,
      'created_at', active_run.created_at
    );
  end if;

  insert into public.analysis_runs (
    workspace_id,
    status,
    generated_by,
    requirement_count,
    finding_count,
    started_at
  ) values (
    p_workspace_id,
    'running',
    p_actor_user_id,
    p_requirement_count,
    0,
    now()
  )
  returning * into new_run;

  insert into public.analysis_run_documents (
    analysis_run_id,
    workspace_id,
    document_id,
    filename,
    document_status,
    uploaded_at
  )
  select
    new_run.id,
    d.workspace_id,
    d.id,
    d.filename,
    d.status,
    d.uploaded_at
  from public.documents d
  where d.workspace_id = p_workspace_id
    and d.status in ('Processed', 'Ready');

  get diagnostics snapshot_count = row_count;
  if snapshot_count = 0 then
    update public.analysis_runs
    set
      status = 'failed',
      completed_at = now(),
      error_message = 'No eligible processed documents were available when Analysis started.'
    where id = new_run.id;
    raise exception using message = 'no_eligible_analysis_documents', errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'result', 'started_new_run',
    'analysis_run_id', new_run.id,
    'workspace_id', new_run.workspace_id,
    'status', new_run.status,
    'started_at', new_run.started_at,
    'completed_at', new_run.completed_at,
    'generated_by', new_run.generated_by,
    'requirement_count', new_run.requirement_count,
    'finding_count', new_run.finding_count,
    'error_message', new_run.error_message,
    'created_at', new_run.created_at,
    'reviewed_document_count', snapshot_count
  );
end;
$$;

create or replace function public.complete_analysis_run_with_evidence_guard_v1(
  p_analysis_run_id uuid,
  p_workspace_id uuid,
  p_finding_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_run public.analysis_runs%rowtype;
  missing_requirement_ids text[];
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 2));

  select * into current_run
  from public.analysis_runs ar
  where ar.id = p_analysis_run_id
    and ar.workspace_id = p_workspace_id
  for update;

  if not found or current_run.status <> 'running' then
    raise exception using message = 'analysis_run_not_active', errcode = 'P0001';
  end if;

  select array_agg(f.requirement_id order by f.requirement_id)
  into missing_requirement_ids
  from public.findings f
  where f.analysis_run_id = p_analysis_run_id
    and f.workspace_id = p_workspace_id
    and f.status in ('covered', 'partial')
    and not exists (
      select 1
      from public.finding_evidence fe
      where fe.finding_id = f.id
        and fe.workspace_id = p_workspace_id
        and fe.relationship in ('supports', 'partially_supports', 'negative_evidence')
        and nullif(btrim(coalesce(fe.quote, fe.evidence_quote, '')), '') is not null
    );

  if coalesce(array_length(missing_requirement_ids, 1), 0) > 0 then
    update public.analysis_runs
    set
      status = 'failed',
      completed_at = now(),
      error_message = 'Analysis failed the required primary-evidence persistence check.'
    where id = p_analysis_run_id;

    return jsonb_build_object(
      'result', 'failed',
      'code', 'analysis_primary_evidence_invariant_failed',
      'missing_requirement_ids', missing_requirement_ids
    );
  end if;

  update public.analysis_runs
  set
    status = 'completed',
    completed_at = now(),
    finding_count = p_finding_count,
    error_message = null
  where id = p_analysis_run_id;

  return jsonb_build_object('result', 'completed');
end;
$$;

create or replace function public.get_analysis_report_state_v1(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_run public.analysis_runs%rowtype;
  latest_valid_run public.analysis_runs%rowtype;
  latest_invalid_run public.analysis_runs%rowtype;
  stale_cutoff timestamptz := now() - interval '15 minutes';
begin
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 2));

  update public.analysis_runs
  set
    status = 'failed',
    completed_at = now(),
    error_message = 'Analysis run exceeded the 15-minute active-run timeout.'
  where workspace_id = p_workspace_id
    and status = 'running'
    and started_at < stale_cutoff;

  select * into active_run
  from public.analysis_runs ar
  where ar.workspace_id = p_workspace_id
    and ar.status = 'running'
    and ar.started_at >= stale_cutoff
  order by ar.started_at asc
  limit 1;

  select * into latest_valid_run
  from public.analysis_runs ar
  where ar.workspace_id = p_workspace_id
    and ar.status = 'completed'
    and not exists (
      select 1
      from public.findings f
      where f.analysis_run_id = ar.id
        and f.workspace_id = p_workspace_id
        and f.status in ('covered', 'partial')
        and not exists (
          select 1
          from public.finding_evidence fe
          where fe.finding_id = f.id
            and fe.workspace_id = p_workspace_id
            and fe.relationship in ('supports', 'partially_supports', 'negative_evidence')
            and nullif(btrim(coalesce(fe.quote, fe.evidence_quote, '')), '') is not null
        )
    )
  order by ar.completed_at desc nulls last, ar.created_at desc
  limit 1;

  select * into latest_invalid_run
  from public.analysis_runs ar
  where ar.workspace_id = p_workspace_id
    and ar.status = 'completed'
    and exists (
      select 1
      from public.findings f
      where f.analysis_run_id = ar.id
        and f.workspace_id = p_workspace_id
        and f.status in ('covered', 'partial')
        and not exists (
          select 1
          from public.finding_evidence fe
          where fe.finding_id = f.id
            and fe.workspace_id = p_workspace_id
            and fe.relationship in ('supports', 'partially_supports', 'negative_evidence')
            and nullif(btrim(coalesce(fe.quote, fe.evidence_quote, '')), '') is not null
        )
    )
  order by ar.completed_at desc nulls last, ar.created_at desc
  limit 1;

  return jsonb_build_object(
    'active_run', case when active_run.id is null then null else jsonb_build_object(
      'id', active_run.id,
      'workspace_id', active_run.workspace_id,
      'status', active_run.status,
      'started_at', active_run.started_at,
      'completed_at', active_run.completed_at,
      'generated_by', active_run.generated_by,
      'requirement_count', active_run.requirement_count,
      'finding_count', active_run.finding_count,
      'error_message', active_run.error_message,
      'created_at', active_run.created_at
    ) end,
    'latest_run', case when latest_valid_run.id is null then null else jsonb_build_object(
      'id', latest_valid_run.id,
      'workspace_id', latest_valid_run.workspace_id,
      'status', latest_valid_run.status,
      'started_at', latest_valid_run.started_at,
      'completed_at', latest_valid_run.completed_at,
      'generated_by', latest_valid_run.generated_by,
      'requirement_count', latest_valid_run.requirement_count,
      'finding_count', latest_valid_run.finding_count,
      'error_message', latest_valid_run.error_message,
      'created_at', latest_valid_run.created_at
    ) end,
    'invalid_latest_run', case when latest_invalid_run.id is null then null else jsonb_build_object(
      'id', latest_invalid_run.id,
      'completed_at', latest_invalid_run.completed_at,
      'error_message', 'A newer analysis could not be used because primary client source evidence was not persisted.'
    ) end
  );
end;
$$;

create or replace function public.match_analysis_run_document_chunks_v1(
  p_analysis_run_id uuid,
  p_workspace_id uuid,
  p_query_embedding vector(1536),
  p_top_k integer,
  p_embedding_model text
)
returns table (
  chunk_id uuid,
  document_id uuid,
  filename text,
  page_start integer,
  page_end integer,
  chunk_index integer,
  section_path text,
  content_preview text,
  similarity double precision
)
language sql
stable
set search_path = ''
as $$
  select
    dc.id as chunk_id,
    dc.document_id,
    coalesce(dc.filename, ard.filename, d.filename) as filename,
    dc.page_start,
    dc.page_end,
    dc.chunk_index,
    dc.section_path,
    left(dc.content, 1200) as content_preview,
    1 - (ce.embedding OPERATOR(public.<=>) p_query_embedding) as similarity
  from public.analysis_run_documents ard
  join public.analysis_runs ar
    on ar.id = ard.analysis_run_id
    and ar.workspace_id = ard.workspace_id
  join public.document_chunks dc
    on dc.document_id = ard.document_id
    and dc.workspace_id = ard.workspace_id
  join public.chunk_embeddings ce
    on ce.chunk_id = dc.id
    and ce.workspace_id = dc.workspace_id
    and ce.document_id = dc.document_id
  join public.documents d
    on d.id = dc.document_id
    and d.workspace_id = dc.workspace_id
  where ard.analysis_run_id = p_analysis_run_id
    and ard.workspace_id = p_workspace_id
    and ar.workspace_id = p_workspace_id
    and ce.embedding_model = p_embedding_model
    and ce.content_hash = dc.content_hash
  order by ce.embedding OPERATOR(public.<=>) p_query_embedding
  limit greatest(1, least(coalesce(p_top_k, 10), 50));
$$;

revoke all on function public.start_analysis_run_with_quota_v1(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_analysis_run_with_quota_v1(uuid, uuid, integer, integer)
  to service_role;
revoke all on function public.complete_analysis_run_with_evidence_guard_v1(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.complete_analysis_run_with_evidence_guard_v1(uuid, uuid, integer)
  to service_role;
revoke all on function public.get_analysis_report_state_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_analysis_report_state_v1(uuid)
  to service_role;
revoke all on function public.match_analysis_run_document_chunks_v1(uuid, uuid, vector, integer, text)
  from public, anon, authenticated;
grant execute on function public.match_analysis_run_document_chunks_v1(uuid, uuid, vector, integer, text)
  to service_role;
