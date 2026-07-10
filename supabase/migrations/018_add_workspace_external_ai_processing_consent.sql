-- Query name: 018_add_workspace_external_ai_processing_consent
-- External AI processing requires explicit workspace opt-in. Existing workspaces remain opted out.

alter table public.workspaces
  add column if not exists external_ai_processing_enabled boolean not null default false;

update public.workspaces
set external_ai_processing_enabled = false
where external_ai_processing_enabled is null;

alter table public.workspaces
  alter column external_ai_processing_enabled set default false,
  alter column external_ai_processing_enabled set not null;

comment on column public.workspaces.external_ai_processing_enabled is
  'Explicit workspace consent to send client document text to configured external AI providers.';
