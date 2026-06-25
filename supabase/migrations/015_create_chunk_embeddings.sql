-- Query name: 015_create_chunk_embeddings
-- Retrieval-grade chunk metadata, idempotent embeddings, and workspace-scoped search.

create extension if not exists vector;

alter table public.document_chunks
  add column if not exists filename text,
  add column if not exists char_start integer,
  add column if not exists char_end integer,
  add column if not exists token_estimate integer,
  add column if not exists processing_job_id uuid,
  add column if not exists content_hash text;

update public.document_chunks dc
set
  filename = coalesce(dc.filename, dc.metadata ->> 'filename', d.filename),
  token_estimate = coalesce(
    dc.token_estimate,
    case
      when dc.metadata ->> 'token_estimate' ~ '^[0-9]+$'
        then (dc.metadata ->> 'token_estimate')::integer
      else greatest(1, ceil(length(dc.content)::numeric / 4)::integer)
    end
  ),
  char_start = coalesce(
    dc.char_start,
    case when dc.metadata ->> 'char_start' ~ '^[0-9]+$'
      then (dc.metadata ->> 'char_start')::integer end
  ),
  char_end = coalesce(
    dc.char_end,
    case when dc.metadata ->> 'char_end' ~ '^[0-9]+$'
      then (dc.metadata ->> 'char_end')::integer end
  )
from public.documents d
where d.id = dc.document_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_chunks'::regclass
      and conname = 'document_chunks_processing_job_id_fkey'
  ) then
    alter table public.document_chunks
      add constraint document_chunks_processing_job_id_fkey
      foreign key (processing_job_id) references public.processing_jobs(id)
      on delete set null not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_chunks'::regclass
      and conname = 'document_chunks_id_workspace_id_key'
  ) then
    alter table public.document_chunks
      add constraint document_chunks_id_workspace_id_key unique (id, workspace_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.document_chunks'::regclass
      and conname = 'document_chunks_retrieval_metadata_check'
  ) then
    alter table public.document_chunks
      add constraint document_chunks_retrieval_metadata_check check (
        (char_start is null or char_start >= 0)
        and (char_end is null or char_end >= char_start)
        and (token_estimate is null or token_estimate > 0)
        and (content_hash is null or content_hash ~ '^[0-9a-f]{64}$')
      ) not valid;
  end if;
end
$$;

create table if not exists public.chunk_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null,
  embedding vector(1536) not null,
  embedding_model text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chunk_embeddings_chunk_model_key unique (chunk_id, embedding_model),
  constraint chunk_embeddings_content_hash_check check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint chunk_embeddings_chunk_workspace_fkey
    foreign key (chunk_id, workspace_id)
    references public.document_chunks(id, workspace_id) on delete cascade,
  constraint chunk_embeddings_document_workspace_fkey
    foreign key (document_id, workspace_id)
    references public.documents(id, workspace_id) on delete cascade
);

alter table public.chunk_embeddings
  add column if not exists chunk_id uuid,
  add column if not exists workspace_id uuid,
  add column if not exists document_id uuid,
  add column if not exists embedding vector(1536),
  add column if not exists embedding_model text,
  add column if not exists content_hash text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_document_chunks_content_hash
  on public.document_chunks (workspace_id, document_id, content_hash);
create index if not exists idx_document_chunks_processing_job_id
  on public.document_chunks (processing_job_id);
create index if not exists idx_chunk_embeddings_workspace_id
  on public.chunk_embeddings (workspace_id);
create index if not exists idx_chunk_embeddings_document_id
  on public.chunk_embeddings (document_id);
create index if not exists idx_chunk_embeddings_chunk_id
  on public.chunk_embeddings (chunk_id);
create index if not exists idx_chunk_embeddings_content_hash
  on public.chunk_embeddings (workspace_id, content_hash);
create index if not exists idx_chunk_embeddings_embedding_cosine
  on public.chunk_embeddings using hnsw (embedding vector_cosine_ops);

create or replace function private.remove_stale_chunk_embeddings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.content_hash is distinct from new.content_hash then
    delete from public.chunk_embeddings ce
    where ce.chunk_id = new.id
      and ce.content_hash is distinct from new.content_hash;
  end if;
  return new;
end;
$$;

revoke all on function private.remove_stale_chunk_embeddings()
  from public, anon, authenticated;

drop trigger if exists document_chunks_remove_stale_embeddings
  on public.document_chunks;
create trigger document_chunks_remove_stale_embeddings
  after update of content_hash on public.document_chunks
  for each row execute function private.remove_stale_chunk_embeddings();

alter table public.chunk_embeddings enable row level security;

drop policy if exists chunk_embeddings_workspace_select
  on public.chunk_embeddings;
create policy chunk_embeddings_workspace_select
  on public.chunk_embeddings for select
  to authenticated
  using (private.is_workspace_member(workspace_id, (select auth.uid())));

revoke all on public.chunk_embeddings from public, anon, authenticated;
grant select, insert, update, delete on public.chunk_embeddings to service_role;

create or replace function public.store_ingestion_chunks_for_embedding_v1(
  p_job_id uuid,
  p_document_id uuid,
  p_workspace_id uuid,
  p_chunks jsonb,
  p_hierarchy jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.processing_jobs%rowtype;
  current_document public.documents%rowtype;
  stored_count integer;
  stored_time timestamptz := now();
begin
  if jsonb_typeof(p_chunks) <> 'array' or jsonb_array_length(p_chunks) = 0 then
    raise exception using message = 'invalid_chunks', errcode = '22023';
  end if;
  if jsonb_typeof(p_hierarchy) <> 'object' then
    raise exception using message = 'invalid_hierarchy', errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_chunks) as chunk(
      chunk_index integer,
      content text,
      char_start integer,
      char_end integer,
      token_estimate integer,
      content_hash text
    )
    where chunk.chunk_index is null
      or chunk.chunk_index < 0
      or nullif(chunk.content, '') is null
      or chunk.char_start is null
      or chunk.char_start < 0
      or chunk.char_end is null
      or chunk.char_end < chunk.char_start
      or chunk.token_estimate is null
      or chunk.token_estimate <= 0
      or chunk.content_hash is null
      or chunk.content_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception using message = 'invalid_chunk_metadata', errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select * into current_job
  from public.processing_jobs pj
  where pj.id = p_job_id
  for update;
  if not found then
    raise exception using message = 'job_not_found', errcode = 'P0002';
  end if;

  select * into current_document
  from public.documents d
  where d.id = p_document_id
  for update;
  if not found then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  if current_job.document_id <> p_document_id then
    raise exception using message = 'job_document_mismatch', errcode = '23514';
  end if;
  if current_job.workspace_id <> p_workspace_id then
    raise exception using message = 'job_workspace_mismatch', errcode = '23514';
  end if;
  if current_document.workspace_id <> p_workspace_id then
    raise exception using message = 'document_workspace_mismatch', errcode = '23514';
  end if;
  if current_job.status = 'Processed' then
    select count(*)::integer into stored_count
    from public.document_chunks dc
    where dc.document_id = p_document_id
      and dc.workspace_id = p_workspace_id;
    return jsonb_build_object(
      'result', 'already_completed',
      'job_status', 'Processed',
      'chunk_count', stored_count,
      'replayed', true
    );
  end if;
  if current_job.status <> 'Processing' then
    raise exception using message = 'invalid_job_state', errcode = 'P0001';
  end if;

  insert into public.document_chunks (
    workspace_id,
    document_id,
    chunk_index,
    content,
    metadata,
    page_start,
    page_end,
    section_heading,
    parent_heading,
    section_path,
    section_chunk_start,
    section_chunk_end,
    parent_chunk_start,
    parent_chunk_end,
    filename,
    char_start,
    char_end,
    token_estimate,
    processing_job_id,
    content_hash
  )
  select
    p_workspace_id,
    p_document_id,
    chunk.chunk_index,
    chunk.content,
    coalesce(chunk.metadata, '{}'::jsonb) || jsonb_build_object(
      'document_id', p_document_id,
      'workspace_id', p_workspace_id,
      'processing_job_id', p_job_id,
      'filename', current_document.filename,
      'content_hash', chunk.content_hash
    ),
    chunk.page_start,
    chunk.page_end,
    chunk.section_heading,
    chunk.parent_heading,
    chunk.section_path,
    chunk.section_chunk_start,
    chunk.section_chunk_end,
    chunk.parent_chunk_start,
    chunk.parent_chunk_end,
    current_document.filename,
    chunk.char_start,
    chunk.char_end,
    chunk.token_estimate,
    p_job_id,
    chunk.content_hash
  from jsonb_to_recordset(p_chunks) as chunk(
    chunk_index integer,
    content text,
    metadata jsonb,
    page_start integer,
    page_end integer,
    section_heading text,
    parent_heading text,
    section_path text,
    section_chunk_start integer,
    section_chunk_end integer,
    parent_chunk_start integer,
    parent_chunk_end integer,
    filename text,
    char_start integer,
    char_end integer,
    token_estimate integer,
    processing_job_id uuid,
    content_hash text
  )
  on conflict (document_id, chunk_index) do update set
    workspace_id = excluded.workspace_id,
    content = excluded.content,
    metadata = excluded.metadata,
    page_start = excluded.page_start,
    page_end = excluded.page_end,
    section_heading = excluded.section_heading,
    parent_heading = excluded.parent_heading,
    section_path = excluded.section_path,
    section_chunk_start = excluded.section_chunk_start,
    section_chunk_end = excluded.section_chunk_end,
    parent_chunk_start = excluded.parent_chunk_start,
    parent_chunk_end = excluded.parent_chunk_end,
    filename = excluded.filename,
    char_start = excluded.char_start,
    char_end = excluded.char_end,
    token_estimate = excluded.token_estimate,
    processing_job_id = excluded.processing_job_id,
    content_hash = excluded.content_hash;

  get diagnostics stored_count = row_count;
  if stored_count <> jsonb_array_length(p_chunks) then
    raise exception using message = 'chunk_count_mismatch', errcode = 'P0001';
  end if;

  delete from public.document_chunks dc
  where dc.document_id = p_document_id
    and dc.workspace_id = p_workspace_id
    and not exists (
      select 1 from jsonb_array_elements(p_chunks) item
      where (item ->> 'chunk_index')::integer = dc.chunk_index
    );

  insert into public.document_hierarchy (
    workspace_id, document_id, hierarchy_json, updated_at
  ) values (
    p_workspace_id, p_document_id, p_hierarchy, stored_time
  )
  on conflict (document_id) do update set
    workspace_id = excluded.workspace_id,
    hierarchy_json = excluded.hierarchy_json,
    updated_at = excluded.updated_at;

  update public.processing_jobs
  set
    status = 'Processing',
    step = 'Generating chunk embeddings',
    error_message = null,
    completed_at = null,
    updated_at = stored_time
  where id = p_job_id;

  update public.documents
  set status = 'Processing', chunks_label = stored_count::text || ' sections'
  where id = p_document_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'result', 'chunks_stored',
    'job_status', 'Processing',
    'chunk_count', stored_count,
    'replayed', false
  );
end;
$$;

revoke all on function public.store_ingestion_chunks_for_embedding_v1(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.store_ingestion_chunks_for_embedding_v1(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;

create or replace function public.finalize_ingestion_embeddings_v1(
  p_job_id uuid,
  p_document_id uuid,
  p_workspace_id uuid,
  p_embedding_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_job public.processing_jobs%rowtype;
  current_document public.documents%rowtype;
  chunk_count integer;
  embedding_count integer;
  completed_time timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select * into current_job from public.processing_jobs
  where id = p_job_id for update;
  if not found then
    raise exception using message = 'job_not_found', errcode = 'P0002';
  end if;

  select * into current_document from public.documents
  where id = p_document_id for update;
  if not found then
    raise exception using message = 'document_not_found', errcode = 'P0002';
  end if;

  if current_job.document_id <> p_document_id then
    raise exception using message = 'job_document_mismatch', errcode = '23514';
  end if;
  if current_job.workspace_id <> p_workspace_id then
    raise exception using message = 'job_workspace_mismatch', errcode = '23514';
  end if;
  if current_document.workspace_id <> p_workspace_id then
    raise exception using message = 'document_workspace_mismatch', errcode = '23514';
  end if;

  select count(*)::integer into chunk_count
  from public.document_chunks dc
  where dc.document_id = p_document_id
    and dc.workspace_id = p_workspace_id;

  if current_job.status = 'Processed' then
    return jsonb_build_object(
      'result', 'already_completed',
      'job_status', 'Processed',
      'chunk_count', chunk_count,
      'embedding_count', chunk_count,
      'replayed', true
    );
  end if;
  if current_job.status <> 'Processing' then
    raise exception using message = 'invalid_job_state', errcode = 'P0001';
  end if;
  if chunk_count = 0 then
    raise exception using message = 'invalid_chunks', errcode = 'P0001';
  end if;

  select count(*)::integer into embedding_count
  from public.document_chunks dc
  where dc.document_id = p_document_id
    and dc.workspace_id = p_workspace_id
    and exists (
      select 1 from public.chunk_embeddings ce
      where ce.chunk_id = dc.id
        and ce.workspace_id = p_workspace_id
        and ce.document_id = p_document_id
        and ce.embedding_model = p_embedding_model
        and ce.content_hash = dc.content_hash
    );

  if embedding_count <> chunk_count then
    raise exception using message = 'embeddings_incomplete', errcode = 'P0001';
  end if;

  update public.processing_jobs
  set
    status = 'Processed',
    step = 'PDF extraction, chunk storage, and embeddings complete',
    error_message = null,
    completed_at = completed_time,
    updated_at = completed_time
  where id = p_job_id;

  update public.documents
  set status = 'Processed', chunks_label = chunk_count::text || ' sections'
  where id = p_document_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'result', 'completed',
    'job_status', 'Processed',
    'chunk_count', chunk_count,
    'embedding_count', embedding_count,
    'replayed', false
  );
end;
$$;

revoke all on function public.finalize_ingestion_embeddings_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.finalize_ingestion_embeddings_v1(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.match_document_chunks_v1(
  p_workspace_id uuid,
  p_query_embedding vector(1536),
  p_top_k integer,
  p_document_id uuid,
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
    coalesce(dc.filename, d.filename) as filename,
    dc.page_start,
    dc.page_end,
    dc.chunk_index,
    dc.section_path,
    left(dc.content, 1200) as content_preview,
    1 - (ce.embedding OPERATOR(public.<=>) p_query_embedding) as similarity
  from public.chunk_embeddings ce
  join public.document_chunks dc
    on dc.id = ce.chunk_id
    and dc.workspace_id = ce.workspace_id
    and dc.document_id = ce.document_id
  join public.documents d
    on d.id = dc.document_id
    and d.workspace_id = dc.workspace_id
  where ce.workspace_id = p_workspace_id
    and dc.workspace_id = p_workspace_id
    and ce.embedding_model = p_embedding_model
    and ce.content_hash = dc.content_hash
    and (p_document_id is null or dc.document_id = p_document_id)
  order by ce.embedding OPERATOR(public.<=>) p_query_embedding
  limit greatest(1, least(coalesce(p_top_k, 10), 50));
$$;

revoke all on function public.match_document_chunks_v1(uuid, vector, integer, uuid, text)
  from public, anon, authenticated;
grant execute on function public.match_document_chunks_v1(uuid, vector, integer, uuid, text)
  to service_role;

comment on column public.document_chunks.embedding is
  'Legacy nullable embedding column. Retrieval v1 stores versioned vectors in public.chunk_embeddings.';
comment on table public.chunk_embeddings is
  'Server-generated, workspace-scoped embeddings keyed by chunk and model.';
