# Production data isolation

RegSpan uses Supabase Auth for user identity, workspace membership for tenancy,
RLS for browser reads, and explicitly workspace-scoped service-role operations
for trusted server work. Migration `021_harden_production_rls_and_storage`
defines the production authorization baseline.

## Trust boundaries

- The browser receives the Supabase URL and anon key. It may authenticate and
  perform the limited reads listed below. The anon key is not an authorization
  boundary; RLS and grants are.
- Next.js API routes authenticate the actor, resolve the actor's authoritative
  workspace membership, and use the server-only service role for trusted work.
- The ingestion worker authenticates with its server secret and validates the
  supplied job, document, and workspace relationship before processing.
- The Supabase service-role key, worker secret, provider keys, document object
  paths used for processing, chunks, embeddings, and source excerpts are never
  sent to n8n.
- Regulatory source tables are global authenticated reference data. They are
  not client documents and are not joined into `finding_evidence`.

## Authorization inventory

All listed public tables have RLS enabled and forced. `anon` and `PUBLIC` have
no table grants. The service role has the server permissions shown by
`docs/security/verify-production-rls-storage.sql`.

| Table | Browser access | RLS condition | Writes | Internal RPCs |
| --- | --- | --- | --- | --- |
| `profiles` | Own row only | `auth.uid() = id` | Own profile update | Workspace provisioning trigger/helper |
| `workspaces` | Member workspaces | `private.is_workspace_member(id, auth.uid())` | Server only | Workspace provisioning |
| `workspace_members` | Memberships in member workspaces | Membership helper on `workspace_id` | Server only | Workspace provisioning |
| `documents` | Workspace read | Membership helper on `workspace_id` | Server only | Processing, replace, delete RPCs |
| `processing_jobs` | Workspace read | Membership helper on `workspace_id` | Server only | Processing lifecycle RPCs |
| `document_chunks` | Workspace read | Membership helper on `workspace_id` | Server only | Ingestion and retrieval RPCs |
| `document_hierarchy` | Workspace read | Membership helper on `workspace_id` | Server only | Ingestion RPCs |
| `chunk_embeddings` | None | No browser policy or grant | Server only | Embedding/retrieval RPCs |
| `analysis_runs` | Workspace read | Membership helper on `workspace_id` | Server only | Analysis lifecycle RPCs |
| `analysis_run_documents` | Workspace read | Membership helper on `workspace_id` | Server only | Analysis lifecycle RPCs |
| `findings` | Workspace read | Membership helper on `workspace_id` | Server only | Analysis lifecycle RPCs |
| `finding_evidence` | Workspace read | Membership helper on `workspace_id` | Server only | Analysis completion guard |
| `security_audit_events` | None | No browser policy or grant | Service role insert/select only | None |
| `rate_limit_counters` | None | No browser policy or grant | Server only | Atomic limiter RPC |
| `controls` | Authenticated global read | `true` for authenticated | Server only | Regulatory loaders |
| `regulatory_sources` | Authenticated global read | `true` for authenticated | Server only | Regulatory loaders |
| `regulatory_source_chunks` | Authenticated global read | `true` for authenticated | Server only | Regulatory loaders |
| `control_elements` | Authenticated global read | `true` for authenticated | Server only | Regulatory loaders |
| `control_citations` | Authenticated global read | `true` for authenticated | Server only | Regulatory loaders |

The browser does not have direct write access to document or analysis tables.
Upload, replace, reprocess, delete, analysis, and evidence persistence use
authenticated API routes and server-only RPCs.

## Relational integrity

Workspace checks are enforced at both query and data-model boundaries:

- Processing jobs, chunks, hierarchy rows, and embeddings have document plus
  workspace foreign-key relationships.
- Finding evidence has a trigger that requires its finding, optional document,
  and optional chunk to belong to the same workspace.
- Findings have triggers that require their optional document and analysis run
  to belong to the same workspace.
- Analysis snapshots require both the analysis run and optional document to
  belong to the snapshot workspace.
- Deferred workspace and canonical Storage-path constraints are validated by
  migration 021. The migration stops if incompatible legacy data exists.

These controls prevent a service-role bug from creating a cross-workspace join
that later appears valid through a correctly scoped parent row.

## Private document Storage

The `documents` bucket is private, accepts PDFs only, and has a 10 MiB bucket
limit matching the application upload validation. Canonical object names are:

```text
<workspace UUID>/<document UUID>/<sanitized filename>.pdf
```

Supabase manages grants on `storage.objects` and `storage.buckets`. Grants from
`supabase_storage_admin` to `anon` or `authenticated` are expected: they allow a
request to reach the Storage RLS boundary, but they do not authorize access to
an object. Effective access is determined by bucket privacy and RLS policies.

The private `documents` bucket has no policy that authorizes `anon` or
`authenticated`, so browser clients cannot list, download, upload, update, or
delete its objects. Do not revoke Supabase-managed Storage grants or force RLS
on Supabase-managed Storage tables. Authorized Next.js routes use the
server-only service role after resolving the actor's workspace and validating
the document relationship. Other Storage buckets retain their own policies; do
not add a broad `storage.objects` policy that can match
`bucket_id = 'documents'`.

## Internal RPCs

Processing, ingestion, embedding, retrieval, rate-limit, and analysis RPCs are
executable only by `service_role`. Migration 021 revokes execution from
`PUBLIC`, `anon`, and `authenticated`, including for functions that are not
`SECURITY DEFINER`. Every `SECURITY DEFINER` function has an empty fixed
`search_path`; only `private.is_workspace_member` is granted to authenticated
users because RLS policies call it.

## Service-role application rules

The service role bypasses RLS, so RLS does not compensate for an unscoped admin
query. Every private-data operation must:

1. Authenticate the user or trusted worker.
2. Resolve `workspace_id` from `workspace_members` or an authoritative job.
3. Filter the target row by both its ID and `workspace_id`.
4. Validate parent relationships such as job/document/workspace or
   finding/run/workspace before acting.
5. Return 404 for guessed cross-workspace UUIDs where object existence should
   be concealed.

Browser-provided workspace IDs are never sufficient authorization. API routes
must derive the workspace from the authenticated actor. Worker payload IDs are
validated against authoritative database rows and transaction RPCs.

## Verification SQL

After applying migrations, run
`docs/security/verify-production-rls-storage.sql` in the Supabase SQL editor.
Review every result, with particular attention to queries whose names end in
`expected_zero_rows`.

Expected results:

- Every inventory table has `rls_enabled = true` and
  `force_rls_enabled = true`.
- `anon` and `PUBLIC` have no sensitive table privileges.
- Authenticated users have no privileges on embeddings, counters, or audit
  events, and no write privilege except `UPDATE` on their own profile row.
- Internal RPCs have no `PUBLIC`, `anon`, or `authenticated` execute grants.
- The `documents` bucket has `public = false`, a 10 MiB limit, and an
  `application/pdf` MIME allow-list.
- `storage.objects` has RLS enabled. Supabase-managed browser grants may exist,
  but no browser-role policy can match the `documents` bucket.
- Authenticated and anonymous role impersonation each see zero document objects.
- No sensitive deferred constraint or cross-workspace relationship remains.

Run `supabase/tests/021_production_data_isolation_regression.sql` only against a
disposable/local database containing at least two disposable auth users. The
script creates isolated fixture rows and rolls back all changes.

## Pre-deployment two-workspace test

1. Create test users A and B through the normal signup flow. Confirm each user
   has one distinct workspace membership.
2. Sign in as A and upload `user-a.pdf`. Sign in as B in a separate browser
   profile and upload `user-b.pdf`. Process and analyze both.
3. Record the two document UUIDs and finding UUIDs from each user's own API
   responses. Do not use production customer data.
4. While signed in as A, request document B through every document detail,
   process, replace, and delete API route. Expect 404 (preferred concealment) or
   403, never row data.
5. While signed in as A, request findings normally and confirm no B finding,
   evidence quote, document ID, filename, page, section, or analysis snapshot is
   present.
6. In browser developer tools as A, use the configured anon client to select B's
   UUID from `documents`, `document_chunks`, `findings`, `finding_evidence`, and
   `analysis_runs`. Expect an empty result.
7. Attempt browser selects from `chunk_embeddings`, `rate_limit_counters`, and
   `security_audit_events`. Expect a permission error and no rows.
8. Attempt to call `get_analysis_report_state_v1` and one processing RPC with
   the authenticated client. Expect a function permission error.
9. Attempt to list and download `documents` Storage objects with the browser
   client, including A's own canonical path and B's guessed path. Expect an
   empty list or 403/404, never object bytes.
10. Confirm the normal server-authorized upload, document review, processing,
    analysis, and findings flows still work for each user's own workspace.

## Supabase dashboard checks

- Storage > Buckets: `documents` is Private, has a 10 MiB limit, and allows only
  `application/pdf`.
- Storage > Policies: no authenticated or anon policy can match the `documents`
  bucket.
- Database > Storage grants: grants owned by `supabase_storage_admin` are
  expected and should not be revoked. Verify effective access through RLS and
  role impersonation instead.
- Database > Tables: RLS is enabled for every inventory table. Confirm forced
  RLS with the verification SQL because the dashboard may show only enabled.
- Database > Functions: internal RPC execution is not granted to anon or
  authenticated users.
- API settings: expose only required schemas. Do not expose `private`.
- Project keys: only `NEXT_PUBLIC_SUPABASE_ANON_KEY` is browser-visible.
  `SUPABASE_SERVICE_ROLE_KEY` must exist only in trusted server environments.
- Auth redirect URLs and Site URL must match the approved RegSpan deployment
  origins.

Repeat this checklist after any migration that changes grants, policies,
Storage, workspace relationships, or RPCs.
