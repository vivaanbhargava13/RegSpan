-- Query name: 011_create_security_audit_events
-- Append-only security event trail for authenticated server operations.

create table if not exists public.security_audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  result text not null,
  ip_address inet,
  user_agent text,
  correlation_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.security_audit_events
  add column if not exists workspace_id uuid,
  add column if not exists actor_user_id uuid,
  add column if not exists action text,
  add column if not exists target_type text,
  add column if not exists target_id uuid,
  add column if not exists result text,
  add column if not exists ip_address inet,
  add column if not exists user_agent text,
  add column if not exists correlation_id text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

create index if not exists idx_security_audit_events_workspace_created
  on public.security_audit_events (workspace_id, created_at desc);
create index if not exists idx_security_audit_events_actor_created
  on public.security_audit_events (actor_user_id, created_at desc);
create index if not exists idx_security_audit_events_action_created
  on public.security_audit_events (action, created_at desc);
create index if not exists idx_security_audit_events_correlation_id
  on public.security_audit_events (correlation_id)
  where correlation_id is not null;

alter table public.security_audit_events enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'security_audit_events'
  loop
    execute format(
      'drop policy if exists %I on public.security_audit_events',
      existing_policy.policyname
    );
  end loop;
end
$$;

revoke all on public.security_audit_events from public, anon, authenticated;
revoke all on public.security_audit_events from service_role;
grant select, insert on public.security_audit_events to service_role;
