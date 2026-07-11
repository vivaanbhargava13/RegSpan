# Manual production n8n migration checklist

This checklist is for a future deployment. This repository pass did not change
the live n8n instance, workflow, credentials, or secrets.

## Repo work completed

- [x] Pinned production compose example for n8n `2.27.3` and PostgreSQL `16.14`.
- [x] Credential-backed target workflow documented without an export.
- [x] RegSpan production webhook and secret validation added.
- [x] Local `$env` workflow preserved.

## Deployment-provider steps

| Step | Where | Value format | Secret | Verify | Rollback |
| --- | --- | --- | --- | --- | --- |
| 1 | Provider secret manager | `N8N_ENCRYPTION_KEY`: random 64 hex characters | Yes | Compare length only; back it up offline | Restore the previous key and database backup together |
| 2 | Provider secret manager | PostgreSQL password: generated high-entropy value | Yes | Database health check succeeds | Restore previous database credentials |
| 3 | Provider environment | `WEBHOOK_URL=https://<webhook-host>/` | No | URL is HTTPS and resolves through the proxy | Restore previous webhook URL |
| 4 | Provider environment | `N8N_EDITOR_BASE_URL=https://<restricted-editor-host>/` and `N8N_HOST=<restricted-editor-host>` | No | Editor links use the restricted hostname | Restore previous editor values |
| 5 | Reverse proxy | Public route: exact `/webhook/<random-path>` only | Path is sensitive operational metadata | POST reaches n8n; editor paths do not | Disable the route |
| 6 | Reverse proxy | Editor hostname behind VPN or identity-aware access | Access policy | Unauthenticated browser cannot load editor | Restore previous restricted policy |
| 7 | Container host | Validate then start `docker-compose.production.example.yml` | No | n8n and PostgreSQL healthy; port 5678 listens on localhost only | Stop new compose stack and restart previous stack |

Do not start production until database backup, `N8N_ENCRYPTION_KEY` backup, TLS,
and editor restriction are in place.

## Live n8n editor steps

First duplicate the local workflow in the production editor. Keep the duplicate
inactive until every test below passes. Do not copy local credential values.

### Credential 1: webhook HMAC

- [ ] Click **Credentials** in the left navigation, then **Create credential**.
- [ ] Search for and select **Crypto**.
- [ ] Name it `RegSpan webhook HMAC - production`.
- [ ] Set **Hmac Secret** to the fresh production HMAC secret. **Secret: yes.**
- [ ] Leave private-key fields empty and click **Save**.
- [ ] Verify the credential displays as saved without revealing its value.
- [ ] Rollback: detach it from the Crypto node, deactivate the workflow, then
  delete the credential after confirming no active workflow uses it.

### Credential 2: worker bearer token

- [ ] Click **Credentials**, then **Create credential**.
- [ ] Select **Bearer Auth** (generic credential type).
- [ ] Name it `RegSpan worker bearer - production`.
- [ ] Set **Bearer Token** to the fresh production
  `INGESTION_WORKER_SECRET`. **Secret: yes.**
- [ ] Click **Save**.
- [ ] Verify it is saved; never add `Bearer ` manually when using Bearer Auth.
- [ ] Rollback: detach it from the worker node, deactivate the workflow, then
  delete it after confirming no active workflow uses it.

### Node 1: Webhook

- [ ] Open the inactive production workflow and select **Webhook**.
- [ ] Set **HTTP Method** to `POST`.
- [ ] Set **Path** to a new high-entropy opaque path. **Secret: no, but do not
  publish it outside deployment configuration.**
- [ ] Set **Respond** / **Response Mode** to **Using Respond to Webhook Node**.
- [ ] Do not configure Basic/Header authentication; HMAC validates the body and
  timestamp in later nodes.
- [ ] Use only the **Production URL** shown by n8n after publication. Never put
  the test URL in RegSpan production.
- [ ] Verify a request is not acknowledged until it passes the validation path.
- [ ] Rollback: deactivate the workflow and remove the proxy route.

### Node 2: Validate timestamp and envelope

- [ ] Insert a **Code** node immediately after Webhook.
- [ ] Name it `Validate timestamp and envelope`.
- [ ] Set **Language** to JavaScript and **Mode** to **Run Once for All Items**.
- [ ] Paste this code. It contains no secret:

```js
const MAX_SKEW_MS = 5 * 60 * 1000;
const input = $input.first().json;
const headers = input.headers || {};
const body = input.body || {};

function header(name) {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

const timestamp = header("x-regspan-webhook-timestamp");
const suppliedSignature = header("x-regspan-webhook-signature");
if (typeof timestamp !== "string" || typeof suppliedSignature !== "string") {
  throw new Error("regspan_webhook_rejected");
}

const timestampMs = Date.parse(timestamp);
if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_SKEW_MS) {
  throw new Error("regspan_webhook_rejected");
}

const allowedFields = ["jobId", "documentId", "workspaceId", "correlationId"];
if (Object.keys(body).length !== allowedFields.length ||
    !allowedFields.every((field) => typeof body[field] === "string" && body[field].length > 0)) {
  throw new Error("regspan_webhook_rejected");
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!uuid.test(body.jobId) || !uuid.test(body.documentId) || !uuid.test(body.workspaceId) ||
    body.correlationId.length > 128) {
  throw new Error("regspan_webhook_rejected");
}

const rawJsonBody = JSON.stringify({
  jobId: body.jobId,
  documentId: body.documentId,
  workspaceId: body.workspaceId,
  correlationId: body.correlationId,
});

return [{ json: {
  body,
  timestamp,
  suppliedSignature,
  rawJsonBody,
  signingInput: `${timestamp}.${rawJsonBody}`,
} }];
```

- [ ] Verify stale, future-skewed, missing-header, extra-field, and invalid-ID
  requests stop here and never reach the worker.
- [ ] Rollback: reconnect Webhook to the previous local validator only on the
  inactive workflow; do not publish a mixed validation path.

### Node 3: Crypto HMAC-SHA256

- [ ] Insert a **Crypto** node after the validation Code node.
- [ ] Name it `Calculate RegSpan HMAC`.
- [ ] Select action/operation **Hmac**.
- [ ] Select credential `RegSpan webhook HMAC - production`.
- [ ] Set **Value** to expression `={{ $json.signingInput }}`.
- [ ] Set **Type** to `SHA256`.
- [ ] Set **Encoding** to `HEX`.
- [ ] Set **Property Name** to `calculatedHmac`.
- [ ] Verify the node adds a 64-character hex `calculatedHmac` without exposing
  the Hmac Secret.
- [ ] Rollback: detach the credential and deactivate the workflow.

### Node 4: Verify signature and replay

- [ ] Insert a **Code** node after the Crypto node.
- [ ] Name it `Verify signature and replay`.
- [ ] Set **Language** to JavaScript and **Mode** to **Run Once for All Items**.
- [ ] Paste this code. It can use `crypto` but has no secret access:

```js
const crypto = require("crypto");
const MAX_SKEW_MS = 5 * 60 * 1000;
const item = $input.first().json;
const suppliedText = String(item.suppliedSignature || "");
const expectedText = `sha256=${String(item.calculatedHmac || "").toLowerCase()}`;

if (!/^sha256=[0-9a-f]{64}$/.test(suppliedText) ||
    !/^sha256=[0-9a-f]{64}$/.test(expectedText)) {
  throw new Error("regspan_webhook_rejected");
}

const supplied = Buffer.from(suppliedText, "utf8");
const expected = Buffer.from(expectedText, "utf8");
if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
  throw new Error("regspan_webhook_rejected");
}

const staticData = $getWorkflowStaticData("global");
staticData.regspanSeen ??= {};
const now = Date.now();
for (const [key, seenAt] of Object.entries(staticData.regspanSeen)) {
  if (now - Number(seenAt) > MAX_SKEW_MS) delete staticData.regspanSeen[key];
}
const replayKey = `${item.body.jobId}:${item.body.correlationId}`;
if (staticData.regspanSeen[replayKey]) throw new Error("regspan_webhook_replayed");
staticData.regspanSeen[replayKey] = now;

return [{ json: { body: item.body } }];
```

- [ ] Verify the node uses `timingSafeEqual`, never `$env`, and returns only
  `body` to downstream nodes.
- [ ] Verify replaying the same `jobId` and `correlationId` within five minutes
  does not reach the worker. Static data may not persist during manual tests;
  perform replay validation with an inactive test workflow execution and again
  after publication.
- [ ] Rollback: deactivate the workflow and restore the previous inactive
  version.

### Node 5: Respond to Webhook

- [ ] Connect **Respond to Webhook** after signature verification.
- [ ] Set **Respond With** to JSON.
- [ ] Set **Response Code** to `202`.
- [ ] Set **Response Body** to `{"ok":true,"accepted":true}`.
- [ ] Do not return IDs, calculated HMAC, headers, worker output, or errors.
- [ ] Verify RegSpan receives the response in under 10 seconds.
- [ ] Rollback: deactivate the workflow; never move acknowledgement before HMAC
  verification.

### Node 6: Call RegSpan ingestion worker

- [ ] Connect an **HTTP Request** node after Respond to Webhook.
- [ ] Name it `Call RegSpan ingestion worker`.
- [ ] Set **Method** to `POST`.
- [ ] Set **URL** to
  `https://<deployed-regspan-host>/api/internal/ingest/process-job` or the
  provider-private HTTPS service URL. **Secret: no.** Do not use localhost or
  `host.docker.internal` in production.
- [ ] Set **Authentication** to **Generic Credential Type**, choose **Bearer
  Auth**, and select `RegSpan worker bearer - production`.
- [ ] Enable **Send Body**, choose **JSON**, and configure exactly:

```json
{
  "jobId": "={{ $json.body.jobId }}",
  "documentId": "={{ $json.body.documentId }}",
  "workspaceId": "={{ $json.body.workspaceId }}",
  "correlationId": "={{ $json.body.correlationId }}"
}
```

- [ ] Under **Options**, set **Timeout** to `300000` milliseconds.
- [ ] Under **Settings**, enable **Retry On Fail**, set **Max Tries** to `3`, and
  **Wait Between Tries** to `5000` milliseconds.
- [ ] Do not enable response passthrough to the webhook and do not add headers
  manually.
- [ ] Verify missing/incorrect Bearer credentials receive HTTP 401; valid calls
  return `completed` or idempotent `already_completed`.
- [ ] Rollback: deactivate the workflow, detach the credential, and restore the
  previous worker URL only if it is still valid and secret-authenticated.

### Publish

- [ ] Confirm the canvas order is exactly the six-node target sequence.
- [ ] Confirm no node references `$env`, a local URL, a test webhook URL, or a
  plaintext secret.
- [ ] In workflow **Settings**, keep execution payload saving disabled by the
  instance environment and do not pin production request data.
- [ ] Click **Save**, then **Publish** / **Activate**.
- [ ] Copy the node's **Production URL** into the RegSpan secret manager as
  `N8N_INGEST_WEBHOOK_URL`.
- [ ] Verify the production URL works only while the workflow is active.
- [ ] Rollback: deactivate this workflow, restore the prior RegSpan webhook URL,
  and reactivate the prior known-good workflow only after its authentication is
  confirmed.

## RegSpan hosting environment steps

- [ ] Set `N8N_INGEST_WEBHOOK_URL` to the exact HTTPS production webhook URL.
- [ ] Set `N8N_INGEST_WEBHOOK_SECRET` to the value stored in the n8n Crypto
  credential. **Secret: yes.**
- [ ] Set `INGESTION_WORKER_SECRET` to the value stored in the n8n Bearer Auth
  credential. **Secret: yes.** It must differ from the HMAC secret.
- [ ] Restart/redeploy RegSpan and verify no configuration error is reported.
- [ ] Verify app logs never contain either value.
- [ ] Rollback: restore all three previous values atomically; do not mix old and
  new secrets.

## Final verification

- [ ] Valid signed request returns 202 and calls the worker once.
- [ ] Altered body, altered timestamp, malformed signature, wrong secret, stale
  timestamp, and immediate replay never call the worker.
- [ ] Worker request contains only four IDs.
- [ ] Missing worker Bearer token returns 401.
- [ ] Duplicate worker invocation does not duplicate chunks and can return
  `already_completed`.
- [ ] Upload one non-sensitive test PDF and confirm job transitions from Queued
  to Processing to Processed.
- [ ] Restart n8n and PostgreSQL; confirm workflow and credentials still decrypt.
- [ ] Confirm execution details retain no request headers, payloads, or worker
  responses.
- [ ] Confirm public access cannot reach editor, REST API, metrics, or health.
