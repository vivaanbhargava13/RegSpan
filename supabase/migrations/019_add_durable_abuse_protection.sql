-- Query name: 019_add_durable_abuse_protection
-- Shared, atomic counters plus workspace concurrency guards for production abuse controls.

create table if not exists public.rate_limit_counters (
  counter_key text primary key,
  window_started_at timestamptz not null,
  window_ends_at timestamptz not null,
  usage_count bigint not null check (usage_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_rate_limit_counters_window_ends_at
  on public.rate_limit_counters (window_ends_at);

alter table public.rate_limit_counters enable row level security;
revoke all on public.rate_limit_counters from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_counters to service_role;

create or replace function public.consume_rate_limit_batch_v1(
  p_counters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_counter record;
  existing_counter public.rate_limit_counters%rowtype;
  now_time timestamptz := now();
  retry_after_seconds integer := 1;
begin
  if jsonb_typeof(p_counters) <> 'array' or jsonb_array_length(p_counters) = 0 then
    raise exception using message = 'invalid_rate_limit_counters', errcode = '22023';
  end if;

  -- Lock in a deterministic order. The preflight loop performs no writes, so a
  -- failed multi-scope request consumes no capacity from any of its counters.
  for requested_counter in
    select *
    from jsonb_to_recordset(p_counters) as counter(
      counter_key text,
      limit_value integer,
      window_seconds integer,
      increment_by bigint
    )
    order by counter_key
  loop
    if requested_counter.counter_key is null
      or length(requested_counter.counter_key) < 32
      or requested_counter.limit_value < 1
      or requested_counter.window_seconds < 1
      or requested_counter.increment_by < 1
    then
      raise exception using message = 'invalid_rate_limit_counter', errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(requested_counter.counter_key, 0));

    select * into existing_counter
    from public.rate_limit_counters
    where counter_key = requested_counter.counter_key
    for update;

    if found
      and existing_counter.window_ends_at > now_time
      and existing_counter.usage_count + requested_counter.increment_by > requested_counter.limit_value
    then
      retry_after_seconds := greatest(
        1,
        ceil(extract(epoch from existing_counter.window_ends_at - now_time))::integer
      );
      return jsonb_build_object(
        'allowed', false,
        'retry_after_seconds', retry_after_seconds
      );
    end if;
  end loop;

  for requested_counter in
    select *
    from jsonb_to_recordset(p_counters) as counter(
      counter_key text,
      limit_value integer,
      window_seconds integer,
      increment_by bigint
    )
    order by counter_key
  loop
    insert into public.rate_limit_counters (
      counter_key,
      window_started_at,
      window_ends_at,
      usage_count,
      updated_at
    ) values (
      requested_counter.counter_key,
      now_time,
      now_time + make_interval(secs => requested_counter.window_seconds),
      requested_counter.increment_by,
      now_time
    )
    on conflict (counter_key) do update
    set
      window_started_at = case
        when public.rate_limit_counters.window_ends_at <= now_time then now_time
        else public.rate_limit_counters.window_started_at
      end,
      window_ends_at = case
        when public.rate_limit_counters.window_ends_at <= now_time
          then now_time + make_interval(secs => requested_counter.window_seconds)
        else public.rate_limit_counters.window_ends_at
      end,
      usage_count = case
        when public.rate_limit_counters.window_ends_at <= now_time then requested_counter.increment_by
        else public.rate_limit_counters.usage_count + requested_counter.increment_by
      end,
      updated_at = now_time;
  end loop;

  return jsonb_build_object('allowed', true, 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.consume_rate_limit_batch_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit_batch_v1(jsonb)
  to service_role;

create or replace function public.start_processing_job_with_quota_v1(
  p_workspace_id uuid,
  p_document_id uuid,
  p_status text,
  p_step text,
  p_idempotency_key text,
  p_request_id text,
  p_max_active_jobs integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_job public.processing_jobs%rowtype;
  active_job_count integer;
begin
  if p_max_active_jobs < 1 then
    raise exception using message = 'invalid_processing_quota', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 1));

  select * into existing_job
  from public.processing_jobs pj
  where pj.workspace_id = p_workspace_id
    and pj.document_id = p_document_id
    and pj.idempotency_key = btrim(p_idempotency_key)
  order by pj.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'job_id', existing_job.id,
      'status', existing_job.status,
      'replayed', true
    );
  end if;

  if exists (
    select 1
    from public.processing_jobs pj
    where pj.document_id = p_document_id
      and pj.status in ('Queued', 'Processing', 'Reprocessing')
  ) then
    raise exception using message = 'processing_in_progress', errcode = 'P0001';
  end if;

  select count(*)::integer into active_job_count
  from public.processing_jobs pj
  where pj.workspace_id = p_workspace_id
    and pj.status in ('Queued', 'Processing', 'Reprocessing');

  if active_job_count >= p_max_active_jobs then
    raise exception using message = 'workspace_processing_limit_reached', errcode = 'P0001';
  end if;

  return public.start_processing_job(
    p_workspace_id,
    p_document_id,
    p_status,
    p_step,
    p_idempotency_key,
    p_request_id
  );
end;
$$;

revoke all on function public.start_processing_job_with_quota_v1(uuid, uuid, text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.start_processing_job_with_quota_v1(uuid, uuid, text, text, text, text, integer)
  to service_role;

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
begin
  if p_max_active_runs < 1 or p_requirement_count < 0 then
    raise exception using message = 'invalid_analysis_quota', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text, 2));

  select * into active_run
  from public.analysis_runs ar
  where ar.workspace_id = p_workspace_id
    and ar.status = 'running'
  order by ar.started_at asc
  limit 1;

  if found then
    return jsonb_build_object(
      'result', 'already_running',
      'analysis_run_id', active_run.id
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

  return jsonb_build_object(
    'result', 'created',
    'analysis_run_id', new_run.id,
    'workspace_id', new_run.workspace_id,
    'status', new_run.status,
    'started_at', new_run.started_at,
    'completed_at', new_run.completed_at,
    'generated_by', new_run.generated_by,
    'requirement_count', new_run.requirement_count,
    'finding_count', new_run.finding_count,
    'error_message', new_run.error_message,
    'created_at', new_run.created_at
  );
end;
$$;

revoke all on function public.start_analysis_run_with_quota_v1(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.start_analysis_run_with_quota_v1(uuid, uuid, integer, integer)
  to service_role;
