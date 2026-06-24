# RegSpan security hardening verification

Apply these Supabase SQL migrations in order:

1. `009_enforce_document_storage_and_workspace_integrity`
2. `010_harden_processing_jobs_and_data_lifecycle`
3. `011_create_security_audit_events`

Then run the named, read-only checks in
`supabase/verification/verify_security_hardening.sql`.

## Storage dashboard settings

In **Storage > documents > Configuration**, verify:

- the bucket remains **Private**;
- the maximum file size is **10 MB** (or lower);
- allowed MIME types contains only **`application/pdf`**.

The server also rejects empty files, files over 10 MB, non-PDF MIME types,
non-`.pdf` names, and files without the `%PDF-` signature. These are upload
screening controls, not proof that a PDF is safe. Before real parsing is added,
run untrusted documents in an isolated parser with decompression limits,
timeouts, malware scanning, and no outbound network access.

## Manual security checks

- Request `/dashboard` in a private browser window and confirm the HTTP response
  redirects to `/auth` before app content renders.
- Sign in as User A and exercise upload, replace, Reprocess, and delete.
- Confirm the object key is `{workspace_id}/{document_id}/{filename}` and five
  chunks plus one hierarchy row appear after Reprocess.
- As User B, request User A's document and processing endpoints. Confirm no data
  is visible, the processing call returns 404, and User A's document is unchanged.
- Call each processing endpoint without a bearer token and confirm it returns 401.
- Submit two rapid processing calls and confirm there is at most one active job.
- Using an authenticated browser client, attempt an insert into
  `document_chunks`; confirm Postgres denies it.
- Inspect `security_audit_events` with a trusted server/SQL session and confirm
  upload, replace, delete, and processing outcomes include correlation IDs.

