# Document deletion test plan

Apply `012_allow_delete_with_active_processing_jobs` before running these tests.
Use two authenticated accounts with different workspaces. Inspect server logs by
correlation ID and confirm logs contain no tokens, secrets, signed URLs, PDF
bytes, or extracted text.

## Normal uploaded document

1. As User A, upload a PDF but do not process it.
2. Delete it from `/documents/[id]`.
3. Expect the UI to return to `/documents`.
4. Confirm the document row, storage object, chunks, hierarchy, findings,
   finding evidence, and processing jobs are absent.

## Queued job

1. Configure a webhook that acknowledges but does not start work, then Process a
   User A document so its job remains `Queued`.
2. Delete the document.
3. Expect success. Confirm the queued job and document are gone and the storage
   object cannot be retrieved.
4. If the delayed n8n execution starts, it must fail its job/document/workspace
   verification and stop without inserting chunks.

## Processing job

1. Put a User A document and job into `Processing` using the trusted test setup.
2. Delete the document.
3. Expect success. Confirm the processing job and all derived rows are gone.
4. Confirm the worker cannot recreate rows because the parent document/job no
   longer exists.

## Authentication rejection

Call without a bearer token:

```bash
curl -i -X DELETE http://localhost:3000/api/documents/DOCUMENT_UUID
```

Expect `401`, with no document, job, or storage changes.

## Workspace mismatch rejection

1. Authenticate as User B.
2. Send `DELETE /api/documents/USER_A_DOCUMENT_UUID` with User B's bearer token.
3. Expect `404` and no changes to User A's rows or storage object.

## Repeat and failure behavior

- Repeating Storage removal for a missing object must not recreate data.
- Two already-authorized concurrent deletes converge safely. A new API delete
  after the first completes returns `404`; this avoids revealing whether another
  workspace owns an arbitrary document UUID.
- If Storage cleanup fails after the database transaction, expect HTTP success
  with `cleanupWarning: true` and an audit event marked `partial`. The orphaned
  private object is inaccessible through workspace policies and should be
  removed by an operational cleanup retry.
