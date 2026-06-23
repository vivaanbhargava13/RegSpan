-- Query name: 007_create_backend_ingestion_schema
-- Backend foundation for document processing, retrieval, controls, and findings.

create extension if not exists vector;

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  status text not null default 'Queued',
  step text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.processing_jobs
  add column if not exists workspace_id text not null,
  add column if not exists document_id uuid,
  add column if not exists status text not null default 'Queued',
  add column if not exists step text,
  add column if not exists error_message text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  page_start integer,
  page_end integer,
  section_heading text,
  parent_heading text,
  section_path text,
  section_chunk_start integer,
  section_chunk_end integer,
  parent_chunk_start integer,
  parent_chunk_end integer,
  embedding vector(1536),
  created_at timestamptz default now(),
  constraint document_chunks_document_id_chunk_index_key unique (document_id, chunk_index)
);

alter table public.document_chunks
  add column if not exists workspace_id text not null,
  add column if not exists document_id uuid,
  add column if not exists chunk_index integer,
  add column if not exists content text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists page_start integer,
  add column if not exists page_end integer,
  add column if not exists section_heading text,
  add column if not exists parent_heading text,
  add column if not exists section_path text,
  add column if not exists section_chunk_start integer,
  add column if not exists section_chunk_end integer,
  add column if not exists parent_chunk_start integer,
  add column if not exists parent_chunk_end integer,
  add column if not exists embedding vector(1536),
  add column if not exists created_at timestamptz default now();

create table if not exists public.document_hierarchy (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  hierarchy_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint document_hierarchy_document_id_key unique (document_id)
);

alter table public.document_hierarchy
  add column if not exists workspace_id text not null,
  add column if not exists document_id uuid,
  add column if not exists hierarchy_json jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.controls (
  id uuid primary key default gen_random_uuid(),
  regulation text not null default 'Reg S-P',
  control_name text not null,
  requirement_text text not null,
  category text,
  created_at timestamptz default now()
);

alter table public.controls
  add column if not exists regulation text not null default 'Reg S-P',
  add column if not exists control_name text,
  add column if not exists requirement_text text,
  add column if not exists category text,
  add column if not exists created_at timestamptz default now();

create table if not exists public.findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  control_id uuid references public.controls(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  severity text,
  status text not null default 'Needs Review',
  finding_text text not null,
  evidence_text text,
  remediation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.findings
  add column if not exists workspace_id text not null,
  add column if not exists control_id uuid,
  add column if not exists document_id uuid,
  add column if not exists severity text,
  add column if not exists status text not null default 'Needs Review',
  add column if not exists finding_text text,
  add column if not exists evidence_text text,
  add column if not exists remediation text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.finding_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  chunk_id uuid references public.document_chunks(id) on delete set null,
  page_start integer,
  page_end integer,
  evidence_quote text,
  created_at timestamptz default now()
);

alter table public.finding_evidence
  add column if not exists finding_id uuid,
  add column if not exists document_id uuid,
  add column if not exists chunk_id uuid,
  add column if not exists page_start integer,
  add column if not exists page_end integer,
  add column if not exists evidence_quote text,
  add column if not exists created_at timestamptz default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'processing_jobs_document_id_fkey') then
    alter table public.processing_jobs
      add constraint processing_jobs_document_id_fkey foreign key (document_id) references public.documents(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_chunks_document_id_fkey') then
    alter table public.document_chunks
      add constraint document_chunks_document_id_fkey foreign key (document_id) references public.documents(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_chunks_document_id_chunk_index_key') then
    alter table public.document_chunks
      add constraint document_chunks_document_id_chunk_index_key unique (document_id, chunk_index);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_hierarchy_document_id_fkey') then
    alter table public.document_hierarchy
      add constraint document_hierarchy_document_id_fkey foreign key (document_id) references public.documents(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'document_hierarchy_document_id_key') then
    alter table public.document_hierarchy
      add constraint document_hierarchy_document_id_key unique (document_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'findings_control_id_fkey') then
    alter table public.findings
      add constraint findings_control_id_fkey foreign key (control_id) references public.controls(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'findings_document_id_fkey') then
    alter table public.findings
      add constraint findings_document_id_fkey foreign key (document_id) references public.documents(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'finding_evidence_finding_id_fkey') then
    alter table public.finding_evidence
      add constraint finding_evidence_finding_id_fkey foreign key (finding_id) references public.findings(id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'finding_evidence_document_id_fkey') then
    alter table public.finding_evidence
      add constraint finding_evidence_document_id_fkey foreign key (document_id) references public.documents(id) on delete set null;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'finding_evidence_chunk_id_fkey') then
    alter table public.finding_evidence
      add constraint finding_evidence_chunk_id_fkey foreign key (chunk_id) references public.document_chunks(id) on delete set null;
  end if;
end
$$;

create index if not exists idx_document_chunks_document_chunk_index
  on public.document_chunks (document_id, chunk_index);
create index if not exists idx_document_chunks_workspace_id
  on public.document_chunks (workspace_id);
create index if not exists idx_document_chunks_section_heading
  on public.document_chunks (section_heading);
create index if not exists idx_document_chunks_parent_heading
  on public.document_chunks (parent_heading);
create index if not exists idx_processing_jobs_document_id
  on public.processing_jobs (document_id);
create index if not exists idx_findings_workspace_id
  on public.findings (workspace_id);
create index if not exists idx_finding_evidence_finding_id
  on public.finding_evidence (finding_id);
