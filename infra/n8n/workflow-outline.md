# Sanitized RegSpan n8n workflow outline

This is not a workflow export. It contains no credential IDs, secrets, or live
URLs. n8n `2.27.3` is the version validated for the production example.

## Current local workflow

```text
Webhook
  -> Code in JavaScript HMAC validation ($env secret)
  -> Respond to Webhook
  -> HTTP Request worker
```

The local Code node is documented in `../../docs/n8n-ingestion-v1.md`. Local
Docker keeps `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and permits the built-in
`crypto` module. This remains a development-only compatibility path.

## Target production workflow

```text
Webhook
  -> Validate timestamp and envelope (Code; no secret)
  -> Crypto HMAC-SHA256 (encrypted Crypto credential)
  -> Verify signature and replay (Code; no secret)
  -> Respond to Webhook
  -> Call RegSpan ingestion worker (HTTP Request; encrypted Bearer credential)
```

Production sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`. The verification Code node
uses Node's `crypto.timingSafeEqual`, so `NODE_FUNCTION_ALLOW_BUILTIN=crypto`
remains narrowly enabled. Neither Code node can read container environment
variables.

### Credentials

- `RegSpan webhook HMAC - production`: **Crypto** credential. Set only **Hmac
  Secret** to the production `N8N_INGEST_WEBHOOK_SECRET` value.
- `RegSpan worker bearer - production`: **Bearer Auth** credential. Set only
  **Bearer Token** to the production `INGESTION_WORKER_SECRET` value.

The credentials are encrypted with the persistent `N8N_ENCRYPTION_KEY`. Never
put either value in a Code node, expression, workflow field, export, or log.

### Exact signed representation

RegSpan sends and signs this deterministic JSON serialization, in this property
order and with no additional properties:

```json
{"jobId":"uuid","documentId":"uuid","workspaceId":"uuid","correlationId":"opaque-id"}
```

The signed message is:

```text
<ISO-8601 timestamp>.<that exact JSON string>
```

The Webhook node parses JSON, so the first Code node reconstructs the same
deterministic four-field string. This is equivalent for RegSpan requests, but it
is not a general raw-byte webhook verifier for arbitrary JSON producers.

### Node behavior

1. **Webhook** accepts only `POST`, uses the production `/webhook/...` URL, and
   responds through the connected Respond to Webhook node.
2. **Validate timestamp and envelope** rejects missing/invalid headers, payloads
   other than the four allowed string fields, and timestamps outside a five
   minute past-or-future window. It builds `signingInput`.
3. **Crypto HMAC-SHA256** uses action **Hmac**, type **SHA256**, encoding **HEX**,
   value `={{ $json.signingInput }}`, property `calculatedHmac`, and the encrypted
   Crypto credential.
4. **Verify signature and replay** requires
   `sha256=<64 lowercase hex characters>`, compares equal-length buffers with
   `crypto.timingSafeEqual`, and records `jobId:correlationId` for five minutes
   in workflow static data. Invalid input throws before acknowledgement or the
   worker request.
5. **Respond to Webhook** returns HTTP `202` and
   `{"ok":true,"accepted":true}`. It contains no IDs or secret material.
6. **Call RegSpan ingestion worker** posts only `jobId`, `documentId`,
   `workspaceId`, and `correlationId`, using the encrypted Bearer credential.

Workflow static data is best-effort replay suppression for this single-instance
private-beta design. The worker remains the authoritative idempotency boundary:
it reloads and matches the job, document, and workspace, atomically claims the
job, and treats an already completed invocation as a successful replay.

The exact click-by-click procedure and Code node source are in
`manual-production-migration-checklist.md`.
