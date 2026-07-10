# Secure n8n ingestion handoff v1

RegSpan is the authorization boundary. Browsers never call n8n and n8n must not
decide whether a user is allowed to process a document. Next.js authenticates
the user, verifies workspace membership, creates the durable processing job,
and then sends n8n an opaque signed handoff.

## Webhook contract

- Method: `POST`
- URL: the server-only `N8N_INGEST_WEBHOOK_URL`
- Required headers:
  - `x-regspan-webhook-timestamp`: ISO 8601 UTC timestamp
  - `x-regspan-webhook-signature`: `sha256=<hex digest>`
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

No user JWT, Supabase service-role key, OpenAI key, PDF bytes, signed URL,
storage path, extracted text, chunks, or embeddings is sent. The webhook must
return a 2xx response within 10 seconds to acknowledge the handoff. RegSpan does
not follow webhook redirects.

## HMAC verification

RegSpan signs the exact JSON request body bytes it sends. The signature message
format is:

```text
<x-regspan-webhook-timestamp>.<raw JSON body>
```

The digest is:

```text
HMAC-SHA256(message, N8N_INGEST_WEBHOOK_SECRET)
```

The header value is lowercase hex with an algorithm prefix:

```text
x-regspan-webhook-signature: sha256=<hex digest>
```

n8n must reject:

- missing timestamp
- invalid timestamp
- timestamp older or newer than 5 minutes from n8n's clock
- missing signature
- malformed signature
- signature mismatch
- altered request body
- replayed `jobId` + `correlationId` where workflow state can track it

The old `x-regspan-webhook-secret` static-secret header is no longer sent by
RegSpan. Migrate n8n from static-secret comparison to HMAC verification before
deploying this app change.

## Required n8n configuration

Store these only in n8n encrypted credentials/environment configuration:

- `REGSPAN_WEBHOOK_SECRET`: the same high-entropy, 32-character-or-longer value
  used by RegSpan's `N8N_INGEST_WEBHOOK_SECRET`.
- `INGESTION_WORKER_SECRET`: a separate high-entropy, 32-character-or-longer
  bearer secret matching RegSpan's server-only value.

The ingestion worker does not require Supabase credentials in n8n. n8n calls
the authenticated RegSpan endpoint instead; the Supabase service role remains in
the RegSpan server environment.

Use HTTPS outside local development. Do not expose the n8n webhook publicly
without HMAC verification and network controls such as an IP allowlist, private
ingress, or a gateway where available.

## n8n validation Code node

Place a Code node immediately after the Webhook node. It should validate the
signature before any worker call. The example assumes the Webhook node retains
the raw body as an object and that n8n provides the original headers in
`$json.headers`.

```js
const crypto = require("crypto");

const MAX_SKEW_MS = 5 * 60 * 1000;
const secret = process.env.REGSPAN_WEBHOOK_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("regspan_webhook_secret_not_configured");
}

const headers = $json.headers || {};
function header(name) {
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
}

const timestamp = header("x-regspan-webhook-timestamp");
const suppliedSignature = header("x-regspan-webhook-signature");
if (!timestamp || !suppliedSignature) {
  throw new Error("missing_regspan_signature_headers");
}

const timestampMs = Date.parse(timestamp);
if (!Number.isFinite(timestampMs)) {
  throw new Error("invalid_regspan_webhook_timestamp");
}
if (Math.abs(Date.now() - timestampMs) > MAX_SKEW_MS) {
  throw new Error("stale_regspan_webhook_timestamp");
}

const body = $json.body || {};
const rawBody = JSON.stringify({
  jobId: body.jobId,
  documentId: body.documentId,
  workspaceId: body.workspaceId,
  correlationId: body.correlationId,
});

const expectedSignature =
  "sha256=" +
  crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

const supplied = Buffer.from(String(suppliedSignature), "utf8");
const expected = Buffer.from(expectedSignature, "utf8");
if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
  throw new Error("invalid_regspan_webhook_signature");
}

for (const field of ["jobId", "documentId", "workspaceId", "correlationId"]) {
  if (typeof body[field] !== "string" || body[field].length === 0) {
    throw new Error(`invalid_${field}`);
  }
}

const staticData = $getWorkflowStaticData("global");
staticData.regspanSeen ??= {};
const replayKey = `${body.jobId}:${body.correlationId}`;
const seenAt = staticData.regspanSeen[replayKey];
if (seenAt && Date.now() - seenAt < MAX_SKEW_MS) {
  throw new Error("replayed_regspan_webhook");
}
staticData.regspanSeen[replayKey] = Date.now();
for (const [key, value] of Object.entries(staticData.regspanSeen)) {
  if (Date.now() - value > MAX_SKEW_MS) delete staticData.regspanSeen[key];
}

return [{ json: { body } }];
```

n8n workflow static data is best-effort replay protection. The RegSpan worker
still performs authoritative idempotency and job/document/workspace validation,
so a replayed valid handoff must not create duplicate chunks or cross-workspace
processing. Use an external durable store for replay keys if the n8n deployment
runs multiple workers or needs stronger replay guarantees.

## Current PDF ingestion worker node

After the validation Code node, add an **HTTP Request** node:

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

Use only these JSON body fields from the validation node:

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
returns `status: "completed"` with `chunkCount`, `embeddingCount`, and
`pageCount`; a completed retry returns `status: "already_completed"`. Both are
HTTP 200 and safe to treat as success.

The endpoint validates the authoritative job/document/workspace relationship,
claims the job, downloads the PDF directly from private Supabase Storage with
the server-only admin client, extracts page text in RegSpan code, stores
deterministic page-aware chunks plus hierarchy, and creates idempotent retrieval
embeddings in RegSpan server code. n8n remains the orchestrator and never
receives the PDF, Storage path, extracted text, Supabase service-role key, or
chunks.

## Migration steps from the old static secret

1. Deploy the n8n validation Code node above.
2. Configure `REGSPAN_WEBHOOK_SECRET` in n8n to match RegSpan's
   `N8N_INGEST_WEBHOOK_SECRET`.
3. Remove any IF node that checks `x-regspan-webhook-secret`.
4. Confirm the workflow rejects a missing or invalid
   `x-regspan-webhook-signature`.
5. Deploy the RegSpan app change that stops sending `x-regspan-webhook-secret`.

## Local testing

Use the same deterministic body shape that RegSpan sends:

```sh
BODY='{"jobId":"00000000-0000-4000-8000-000000000001","documentId":"00000000-0000-4000-8000-000000000002","workspaceId":"00000000-0000-4000-8000-000000000003","correlationId":"local-test"}'
TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
SIG="$(node -e 'const crypto=require("crypto"); const ts=process.argv[1]; const body=process.argv[2]; const secret=process.env.REGSPAN_WEBHOOK_SECRET; process.stdout.write("sha256="+crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex"));' "$TS" "$BODY")"
curl -i "$N8N_INGEST_WEBHOOK_URL" \
  -H "content-type: application/json" \
  -H "x-regspan-webhook-timestamp: $TS" \
  -H "x-regspan-webhook-signature: $SIG" \
  --data "$BODY"
```

Expected failure tests:

- Delete `x-regspan-webhook-timestamp`: n8n rejects.
- Change one character in the body after signing: n8n rejects.
- Reuse a timestamp older than 5 minutes: n8n rejects.
- Reuse the same `jobId` + `correlationId` immediately: n8n rejects if replay
  state is enabled.

## Current workflow sequence

1. Receive the webhook and validate HMAC signature, timestamp freshness, payload
   shape, and replay/idempotency state before doing any worker call.
2. Treat all payload fields only as opaque identifiers.
3. Call the authenticated RegSpan worker endpoint with the four opaque IDs.
4. RegSpan reloads and matches the job, document, and workspace.
5. RegSpan marks the job/document `Processing`, extracts PDF text, upserts
   chunks/hierarchy, and generates only missing or changed chunk embeddings.
6. RegSpan marks the job/document `Processed`, or `Failed` with safe metadata.
7. n8n treats `completed` and `already_completed` as successful terminal results.

PDF extraction v1 is text-only. Scanned/image-only PDFs fail as low-text; OCR is
not implemented. Retrieval infrastructure is documented in `docs/retrieval-v1.md`.
Controls matching, findings, LLM judgments, and reports remain out of scope.

The worker route is pinned to the Next.js Node runtime. `pdf-parse` and
`pdfjs-dist` are loaded as external native Node modules rather than transformed
into the Next server bundle; deploy on Node.js 20.16 or newer.

## Security and operations

- Do not trust the webhook payload as authorization evidence.
- Never accept workspace or storage paths without reloading and matching the
  authoritative database rows.
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
