# RegSpan staging container example

This directory contains a provider-neutral staging example. It does not deploy
Supabase or n8n and contains no usable credentials.

## Prepare configuration

Copy the sanitized matrix to an ignored file:

```sh
cp infra/app/.env.staging.example infra/app/.env.staging
```

Replace every placeholder using the staging secret manager. The example values
intentionally fail the production startup preflight. Do not weaken the
preflight to make placeholders start.

Validate Compose from the repository root:

```sh
REGSPAN_ENV_FILE=.env.staging docker compose \
  --env-file infra/app/.env.staging \
  -f infra/app/docker-compose.staging.example.yml config
```

Build and start only after the staging environment is populated:

```sh
docker build -t regspan-app:staging .
REGSPAN_ENV_FILE=.env.staging docker compose \
  --env-file infra/app/.env.staging \
  -f infra/app/docker-compose.staging.example.yml up -d
```

The application binds to `127.0.0.1:3000` by default. Place a TLS-terminating
reverse proxy in front of it and expose only the application hostname. The
Compose example does not bundle Supabase, n8n, PostgreSQL, source mounts, or a
queue.

## Operational constraints

- Allocate an upstream request timeout that covers the complete ingestion call,
  not only the 180-second parser deadline. Start with at least 360 seconds and
  measure real documents.
- Preserve the 360-second container termination grace period so Next.js can
  drain in-flight ingestion requests. Keep `REGSPAN_SHUTDOWN_GRACE_MS` at least
  60000 milliseconds above `PDF_PROCESSING_TIMEOUT_MS` and below 360 seconds.
- Begin private-beta ingestion concurrency at one active job per workspace.
- Health checks call `GET /api/health`; this is liveness, not dependency
  readiness.
- The image root filesystem is read-only in Compose. `/tmp` and
  `/app/.next/cache` are bounded tmpfs mounts.

See `../../docs/security/regspan-production-deployment.md` for the complete
staging, promotion, rollback, and resource plan.
