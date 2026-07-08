-- Query name: 017_create_regulatory_source_controls_framework
-- Global regulatory source-of-truth tables for SEC Release No. 34-100155.

create table if not exists public.regulatory_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  title text not null,
  regulator text not null,
  release_number text not null,
  regulation text not null,
  source_type text not null,
  effective_date date,
  compliance_date text,
  version text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.regulatory_sources
  add column if not exists source_key text,
  add column if not exists title text,
  add column if not exists regulator text,
  add column if not exists release_number text,
  add column if not exists regulation text,
  add column if not exists source_type text,
  add column if not exists effective_date date,
  add column if not exists compliance_date text,
  add column if not exists version text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.regulatory_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.regulatory_sources(id) on delete cascade,
  chunk_index integer not null,
  page_start integer not null,
  page_end integer not null,
  heading text,
  parent_heading text,
  section_path text,
  chunk_kind text not null,
  content text not null,
  synopsis text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regulatory_source_chunks_source_index_key unique (source_id, chunk_index)
);

alter table public.regulatory_source_chunks
  add column if not exists source_id uuid references public.regulatory_sources(id) on delete cascade,
  add column if not exists chunk_index integer,
  add column if not exists page_start integer,
  add column if not exists page_end integer,
  add column if not exists heading text,
  add column if not exists parent_heading text,
  add column if not exists section_path text,
  add column if not exists chunk_kind text,
  add column if not exists content text,
  add column if not exists synopsis text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.controls
  add column if not exists control_key text,
  add column if not exists name text,
  add column if not exists source_key text,
  add column if not exists summary text,
  add column if not exists regulatory_role text,
  add column if not exists severity text,
  add column if not exists status text not null default 'active',
  add column if not exists display_order integer not null default 0,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.control_elements (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.controls(id) on delete cascade,
  element_key text not null,
  label text not null,
  description text not null,
  required boolean not null default true,
  evidence_question text,
  missing_if_absent boolean not null default true,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_elements_control_element_key unique (control_id, element_key)
);

create table if not exists public.control_citations (
  id uuid primary key default gen_random_uuid(),
  control_id uuid not null references public.controls(id) on delete cascade,
  control_element_id uuid references public.control_elements(id) on delete cascade,
  source_chunk_id uuid not null references public.regulatory_source_chunks(id) on delete restrict,
  citation_type text not null,
  citation_note text,
  display_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.regulatory_sources'::regclass
      and conname = 'regulatory_sources_source_type_check'
  ) then
    alter table public.regulatory_sources
      add constraint regulatory_sources_source_type_check
      check (source_type in ('sec_final_rule', 'sec_release', 'agency_guidance', 'control_framework')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.regulatory_source_chunks'::regclass
      and conname = 'regulatory_source_chunks_kind_check'
  ) then
    alter table public.regulatory_source_chunks
      add constraint regulatory_source_chunks_kind_check
      check (chunk_kind in (
        'direct_rule_requirement',
        'sec_explanation',
        'definition',
        'exception',
        'commenter_position',
        'rejected_alternative',
        'economic_analysis',
        'compliance_date',
        'background_context'
      )) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.controls'::regclass
      and conname = 'controls_control_key_unique'
  ) then
    alter table public.controls
      add constraint controls_control_key_unique unique (control_key);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.controls'::regclass
      and conname = 'controls_regulatory_role_check'
  ) then
    alter table public.controls
      add constraint controls_regulatory_role_check
      check (regulatory_role is null or regulatory_role in (
        'direct_reg_s_p',
        'supporting_control',
        'applicability',
        'definition',
        'future_scope'
      )) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.controls'::regclass
      and conname = 'controls_severity_check'
  ) then
    alter table public.controls
      add constraint controls_severity_check
      check (severity is null or severity in ('low', 'medium', 'high', 'critical')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.controls'::regclass
      and conname = 'controls_status_check'
  ) then
    alter table public.controls
      add constraint controls_status_check
      check (status in ('active', 'inactive', 'draft', 'superseded')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.control_citations'::regclass
      and conname = 'control_citations_type_check'
  ) then
    alter table public.control_citations
      add constraint control_citations_type_check
      check (citation_type in ('primary', 'supporting', 'definition', 'exception')) not valid;
  end if;
end
$$;

create index if not exists idx_regulatory_sources_active
  on public.regulatory_sources (source_key, is_active);
create index if not exists idx_regulatory_source_chunks_source_order
  on public.regulatory_source_chunks (source_id, chunk_index);
create index if not exists idx_regulatory_source_chunks_kind
  on public.regulatory_source_chunks (chunk_kind);
create index if not exists idx_controls_regulation_order
  on public.controls (regulation, status, display_order);
create index if not exists idx_control_elements_control_order
  on public.control_elements (control_id, display_order);
create index if not exists idx_control_citations_control_order
  on public.control_citations (control_id, display_order);
create index if not exists idx_control_citations_source_chunk
  on public.control_citations (source_chunk_id);

alter table public.regulatory_sources enable row level security;
alter table public.regulatory_source_chunks enable row level security;
alter table public.control_elements enable row level security;
alter table public.control_citations enable row level security;

drop policy if exists regulatory_sources_authenticated_read on public.regulatory_sources;
create policy regulatory_sources_authenticated_read
  on public.regulatory_sources for select
  to authenticated
  using (true);

drop policy if exists regulatory_source_chunks_authenticated_read on public.regulatory_source_chunks;
create policy regulatory_source_chunks_authenticated_read
  on public.regulatory_source_chunks for select
  to authenticated
  using (true);

drop policy if exists control_elements_authenticated_read on public.control_elements;
create policy control_elements_authenticated_read
  on public.control_elements for select
  to authenticated
  using (true);

drop policy if exists control_citations_authenticated_read on public.control_citations;
create policy control_citations_authenticated_read
  on public.control_citations for select
  to authenticated
  using (true);

grant select on public.regulatory_sources to authenticated;
grant select on public.regulatory_source_chunks to authenticated;
grant select on public.control_elements to authenticated;
grant select on public.control_citations to authenticated;

grant select, insert, update, delete on table
  public.regulatory_sources,
  public.regulatory_source_chunks,
  public.controls,
  public.control_elements,
  public.control_citations
to service_role;

comment on table public.regulatory_sources is
  'Global regulatory source documents, such as SEC Release No. 34-100155. Not workspace evidence.';
comment on table public.regulatory_source_chunks is
  'Global regulatory reference chunks used only to cite controls. Never joined into client document evidence retrieval.';
comment on table public.control_elements is
  'Curated required elements for canonical controls.';
comment on table public.control_citations is
  'Links curated controls and control elements to regulatory source chunks.';
