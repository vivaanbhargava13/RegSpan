# RegSpan n8n infrastructure examples

This directory contains sanitized examples only. It does not contain a workflow
export, credential ID, secret, production hostname, or live deployment action.

## Current local workflow

The existing local Docker setup remains supported:

```sh
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
docker compose --env-file .env -f docker-compose.example.yml up -d
```

Set the generated values as follows:

- Local n8n `N8N_INGEST_WEBHOOK_SECRET` must match RegSpan `.env.local`.
- Local n8n `INGESTION_WORKER_SECRET` must match RegSpan `.env.local`.
- Those two secrets must be different.
- `N8N_ENCRYPTION_KEY` must be a third value and must persist with n8n data.

The local workflow is:

```text
Webhook -> Code HMAC validation -> Respond to Webhook -> HTTP Request worker
```

It intentionally uses `$env.REGSPAN_WEBHOOK_SECRET`, so the local compose file
sets `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` and
`NODE_FUNCTION_ALLOW_BUILTIN=crypto`. The Docker Desktop worker URL is:

```text
http://host.docker.internal:3000/api/internal/ingest/process-job
```

Verify secret lengths without printing values:

```sh
docker compose --env-file .env -f docker-compose.example.yml exec regspan-n8n \
  node -e 'for (const k of ["N8N_INGEST_WEBHOOK_SECRET","REGSPAN_WEBHOOK_SECRET","INGESTION_WORKER_SECRET"]) console.log(k, (process.env[k] || "").length)'
```

Never commit a real `.env` file.

## Target production workflow

Production uses the stronger credential-backed design documented in
`workflow-outline.md`:

```text
Webhook
  -> Validate timestamp and envelope
  -> Crypto HMAC-SHA256
  -> Verify signature and replay
  -> Respond to Webhook
  -> Call RegSpan ingestion worker
```

The HMAC secret is an encrypted n8n **Crypto credential** and the worker token is
an encrypted **Bearer Auth credential**. Production therefore sets
`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`; only `crypto.timingSafeEqual` remains
available to the comparison Code node.

## Production example

1. Copy `.env.production.example` to an untracked deployment environment file or
   enter the values directly in the provider secret manager.
2. Replace every placeholder. Generate database and encryption values with
   `openssl rand -hex 32`.
3. Set explicit HTTPS `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` values. Set
   `N8N_HOST` to the editor hostname without a scheme.
4. Validate without starting services:

```sh
docker compose \
  -f docker-compose.production.example.yml \
  --env-file .env.production.example \
  config
```

5. For a real deployment, point `--env-file` at the untracked populated file and
   run `docker compose ... up -d` only after the reverse proxy is configured.

The example pins n8n `2.27.3` and PostgreSQL `16.14`, stores both n8n data and
PostgreSQL data in named volumes, binds n8n only to `127.0.0.1`, disables the
public API, saves no execution payloads, and prunes execution rows after seven
days or 1,000 rows. It does not enable Redis, queue mode, Docker socket access,
privileged mode, or host filesystem mounts.

Named volumes are persistence, not backup. Back up PostgreSQL and the exact
`N8N_ENCRYPTION_KEY` separately. Test restoration before private beta.

## Required reading

- `workflow-outline.md`: current and target workflow contracts.
- `manual-production-migration-checklist.md`: exact future n8n editor actions.
- `reverse-proxy-security.md`: public webhook and restricted editor boundary.
- `../../docs/security/n8n-production-hardening.md`: deployment, rotation,
  recovery, and validation runbook.
- `../../docs/n8n-ingestion-v1.md`: application HMAC and worker contract.

n8n must receive only `jobId`, `documentId`, `workspaceId`, and
`correlationId`. Never add JWTs, Supabase keys, OpenAI keys, PDFs, signed URLs,
Storage paths, extracted text, chunks, embeddings, or worker responses to the
webhook payload or execution logs.
