-- Query name: 012_allow_delete_with_active_processing_jobs
-- Deleting an authorized document cancels all jobs and removes derived data.

create or replace function public.delete_document_and_derived(
  p_workspace_id uuid,
  p_document_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_storage_path text;
begin
  -- Uses the same lock key as job start/mock completion. A concurrent worker
  -- either finishes first or observes that its job/document no longer exists.
  perform pg_advisory_xact_lock(hashtextextended(p_document_id::text, 0));

  select d.storage_path into previous_storage_path
  from public.documents d
  where d.id = p_document_id
    and d.workspace_id = p_workspace_id
  for update;

  if not found then
    -- Preserve workspace mismatch protection while allowing two already-
    -- authorized concurrent delete requests to converge safely.
    if exists (
      select 1 from public.documents d where d.id = p_document_id
    ) then
      raise exception using message = 'document_not_found', errcode = 'P0002';
    end if;
    return null;
  end if;

  -- Cancel active work and remove historical jobs before deleting the parent.
  -- This also ensures a queued n8n handoff can no longer pass its required
  -- job/document/workspace verification after the delete commits.
  update public.processing_jobs
  set
    status = 'Failed',
    step = 'Cancelled because document was deleted',
    error_message = 'Document deleted by an authorized workspace member.',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where document_id = p_document_id
    and workspace_id = p_workspace_id
    and status in ('Queued', 'Processing', 'Reprocessing');

  delete from public.finding_evidence fe
  where fe.workspace_id = p_workspace_id
    and (
      fe.document_id = p_document_id
      or fe.chunk_id in (
        select dc.id
        from public.document_chunks dc
        where dc.document_id = p_document_id
          and dc.workspace_id = p_workspace_id
      )
      or fe.finding_id in (
        select f.id
        from public.findings f
        where f.document_id = p_document_id
          and f.workspace_id = p_workspace_id
      )
    );

  delete from public.findings
  where document_id = p_document_id
    and workspace_id = p_workspace_id;

  delete from public.processing_jobs
  where document_id = p_document_id
    and workspace_id = p_workspace_id;

  -- Chunks and hierarchy are removed by their document ON DELETE CASCADE FKs.
  delete from public.documents
  where id = p_document_id
    and workspace_id = p_workspace_id;

  return previous_storage_path;
end;
$$;

revoke all on function public.delete_document_and_derived(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_document_and_derived(uuid, uuid)
  to service_role;
