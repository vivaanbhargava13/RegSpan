# Sanitized RegSpan n8n workflow outline

This is not a full n8n export. It is a credentials-free checklist for the local
workflow shape.

```text
Webhook
  -> Code in JavaScript HMAC validation
  -> Respond to Webhook
  -> HTTP Request worker
```

## Webhook node

- Method: `POST`
- Path: choose a local path and set RegSpan `N8N_INGEST_WEBHOOK_URL` to match.
- Response mode: use the connected Respond to Webhook node.

## Code in JavaScript HMAC validation node

- Use the validation code from `../../docs/n8n-ingestion-v1.md`.
- Read `REGSPAN_WEBHOOK_SECRET` from the environment.
- Validate:
  - `x-regspan-webhook-timestamp`
  - `x-regspan-webhook-signature`
  - timestamp freshness
  - payload shape
  - replay/idempotency state when available

## Respond to Webhook node

- Return a quick success response after HMAC validation succeeds.
- Do not include source text, document names, storage paths, or secrets in the
  response body.

## HTTP Request worker node

- Method: `POST`
- URL: `http://host.docker.internal:3000/api/internal/ingest/process-job`
- Authorization: bearer/header value sourced from `INGESTION_WORKER_SECRET`.
- JSON body fields:
  - `jobId`
  - `documentId`
  - `workspaceId`
  - `correlationId`

No credentials or real secrets belong in workflow exports.
