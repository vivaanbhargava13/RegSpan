# Local n8n infrastructure for RegSpan

This directory contains a sanitized Docker Desktop example for the RegSpan local
n8n ingestion workflow. It is safe to commit because it contains placeholders
only. Never commit a real `.env` file or copied secret values.

## 1. Create local environment files

From this directory:

```sh
cp .env.example .env
```

Generate high-entropy local secrets:

```sh
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Use those generated values as follows:

- `N8N_INGEST_WEBHOOK_SECRET` in `infra/n8n/.env` must match
  `N8N_INGEST_WEBHOOK_SECRET` in RegSpan `.env.local`.
- `INGESTION_WORKER_SECRET` in `infra/n8n/.env` must match
  `INGESTION_WORKER_SECRET` in RegSpan `.env.local`.
- `N8N_INGEST_WEBHOOK_SECRET` and `INGESTION_WORKER_SECRET` must be different
  from each other.
- `N8N_ENCRYPTION_KEY` should be a third distinct value for local n8n data.

The compose example maps `REGSPAN_WEBHOOK_SECRET` to the same value as
`N8N_INGEST_WEBHOOK_SECRET` for temporary workflow compatibility. Do not create
a separate value for `REGSPAN_WEBHOOK_SECRET`.

## 2. Start n8n

```sh
docker compose --env-file .env -f docker-compose.example.yml up -d
```

n8n will be available at `http://localhost:5678` by default.

To stop the container:

```sh
docker compose --env-file .env -f docker-compose.example.yml down
```

## 3. Verify container environment

Verify only lengths, never secret values:

```sh
docker compose --env-file .env -f docker-compose.example.yml exec regspan-n8n \
  node -e 'for (const k of ["N8N_INGEST_WEBHOOK_SECRET","REGSPAN_WEBHOOK_SECRET","INGESTION_WORKER_SECRET"]) console.log(k, (process.env[k] || "").length)'
```

Expected:

- `N8N_INGEST_WEBHOOK_SECRET` length is at least 32 characters.
- `REGSPAN_WEBHOOK_SECRET` has the same length as
  `N8N_INGEST_WEBHOOK_SECRET`.
- `INGESTION_WORKER_SECRET` length is at least 32 characters.

## 4. Update the n8n workflow

The local workflow must use this sequence:

```text
Webhook -> Code in JavaScript HMAC validation -> Respond to Webhook -> HTTP Request worker
```

Use the HMAC validation Code node from `../../docs/n8n-ingestion-v1.md`. The
compose file sets:

- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
- `NODE_FUNCTION_ALLOW_BUILTIN=crypto`

These are required so the Code node can read the local environment secret and
use Node's `crypto` module.

Configure the HTTP Request worker node:

- Method: `POST`
- URL: `http://host.docker.internal:3000/api/internal/ingest/process-job`
- Authentication: bearer/header value from `INGESTION_WORKER_SECRET`
- Body: the safe IDs from the validated webhook payload only:
  `jobId`, `documentId`, `workspaceId`, and `correlationId`

Do not put JWTs, Supabase service-role keys, OpenAI keys, PDF bytes, signed
URLs, storage paths, extracted text, chunks, or embeddings in n8n.

See `workflow-outline.md` for a sanitized node outline.

## 5. Local RegSpan settings

In RegSpan `.env.local`, the n8n webhook URL should point to your local n8n
webhook endpoint, for example:

```text
N8N_INGEST_WEBHOOK_URL=http://localhost:5678/webhook/<your-webhook-path>
```

Keep the RegSpan `.env.local` HMAC and worker secrets synchronized with
`infra/n8n/.env` as described above.
