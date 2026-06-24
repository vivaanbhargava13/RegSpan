# Secure n8n ingestion handoff v1

RegSpan is the authorization boundary. Browsers never call n8n and n8n must not
decide whether a user is allowed to process a document. Next.js authenticates
the user, verifies workspace membership, and creates the durable processing job
before it sends an opaque handoff to n8n.

## Webhook contract

- Method: `POST`
- URL: the server-only `N8N_INGEST_WEBHOOK_URL`
- Required header: `x-regspan-webhook-secret`
- Timestamp header: `x-regspan-webhook-timestamp` (ISO 8601 UTC)
- Content type: `application/json`

Payload:

```json
{
  "jobId": "uuid",
  "documentId": "uuid",
  "workspaceId": "uuid",
  "correlationId": "opaque-request-id"
}
```

No user JWT, Supabase service-role key, PDF bytes, signed URL, storage path, or
document text is sent. The webhook must return a 2xx response within 10 seconds
to acknowledge the handoff. RegSpan does not follow webhook redirects.

## Required n8n configuration

Store these only in n8n's encrypted credentials/environment configuration:

- `REGSPAN_WEBHOOK_SECRET`: the same high-entropy, 32-character-or-longer value
  used by RegSpan's `N8N_INGEST_WEBHOOK_SECRET`.
- `INGESTION_WORKER_SECRET`: a separate high-entropy, 32-character-or-longer
  bearer secret matching RegSpan's server-only value.

The placeholder worker does not require Supabase credentials in n8n. n8n calls
the authenticated RegSpan endpoint instead; the Supabase service role remains in
the RegSpan server environment.

Use HTTPS outside local development. Reject requests when the secret is absent
or does not match. Compare secrets using a timing-safe mechanism where the n8n
runtime permits it. Consider also rejecting stale timestamp headers once clock
skew and retry behavior are defined.

## Current placeholder worker node

After the valid branch of the existing IF node, add an **HTTP Request** node:

- Method: `POST`
- URL, native local n8n: `http://localhost:3000/api/internal/ingest/process-job`
- URL, Docker Desktop n8n: `http://host.docker.internal:3000/api/internal/ingest/process-job`
- Production URL: `https://YOUR_REGSPAN_HOST/api/internal/ingest/process-job`
- Authentication: use an n8n Header Auth credential
- Header name: `Authorization`
- Header value: `Bearer YOUR_INGESTION_WORKER_SECRET`
- Send Body: enabled
- Body Content Type: JSON
- Response Format: JSON

Use these JSON body fields when the HTTP Request node directly follows the IF
node and retains the original Webhook node output:

```json
{
  "jobId": "={{ $json.body.jobId }}",
  "documentId": "={{ $json.body.documentId }}",
  "workspaceId": "={{ $json.body.workspaceId }}",
  "correlationId": "={{ $json.body.correlationId }}"
}
```

Do not place the worker secret in the JSON body or a normal workflow Set node.
Keep it in n8n's encrypted Header Auth credential store. A successful new job
returns `status: "completed"`; a completed retry returns
`status: "already_completed"`. Both are HTTP 200 and safe to treat as success.

The placeholder endpoint validates the authoritative job/document/workspace
relationship, records audit events, and moves the job and document to the
database status `Processed`. It does not read the PDF or create chunks.

## Future real ingestion workflow

1. Receive the webhook and verify the secret before doing any work.
2. Validate all four payload fields and treat them only as identifiers.
3. Fetch the job and document using server-side credentials.
4. Verify job, document, and workspace IDs match exactly and the job is active.
5. Mark the verified job and document `Processing` when work begins.
6. Read the canonical storage path from the authorized document row.
7. Download the PDF from the private `documents` bucket.
8. Extract text and chunk it in an isolated worker with size, decompression,
   memory, and execution-time limits.
9. Transactionally replace chunks and hierarchy for that document.
10. Mark the job and document `Processed` on success.
11. Mark both `Failed` with a non-sensitive error on failure.

RegSpan currently implements only the authenticated handoff and placeholder
status transition. Before real extraction is enabled, add a purpose-built
transactional worker or callback rather than issuing a fragile sequence of
unrelated table writes from n8n.

## Security and operations

- Do not trust the webhook payload as authorization evidence.
- Never accept workspace or storage paths without reloading and matching the
  authoritative database rows.
- Do not expose the n8n webhook publicly without secret verification and network
  controls such as an IP allowlist, private ingress, or gateway where available.
- Disable saving successful execution data where practical. Redact headers,
  credentials, PDF content, extracted text, and Supabase responses from logs.
- Configure failed-execution retention to the shortest useful period.
- Make workflow handling idempotent by `jobId`; retries must not create duplicate
  chunks or competing active jobs.
- A timeout is ambiguous: n8n may have received the request even if RegSpan did
  not receive the response. n8n must safely deduplicate a later retry.
- Never send results to an unauthenticated callback. Any future callback must use
  a separate scoped secret/signature, timestamp/replay protection, job matching,
  and transactional database validation.

For local development without n8n, call the authenticated
`POST /api/documents/[id]/mock-process` endpoint directly. The normal Process UI
intentionally returns a clean configuration error when n8n is not configured.
