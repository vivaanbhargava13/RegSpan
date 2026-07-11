# n8n production hardening runbook

This runbook prepares a single-instance, PostgreSQL-backed n8n deployment for
RegSpan private beta. It does not prescribe a provider or hostname and does not
enable Redis, queue mode, Kubernetes, or multiple workers.

## Architecture and trust boundary

RegSpan authenticates users and authorizes workspaces before creating a durable
processing job. It sends n8n only `jobId`, `documentId`, `workspaceId`, and
`correlationId`. The exact JSON body is signed with HMAC-SHA256 over
`<timestamp>.<rawJsonBody>`. n8n validates a five-minute timestamp window,
signature, payload shape, and best-effort replay state before acknowledging.

n8n then calls RegSpan's worker with the same four IDs and an encrypted Bearer
Auth credential. The worker reloads authoritative database rows, matches job,
document, and workspace, and atomically claims the job. n8n never receives PDF
bytes, extracted text, chunks, embeddings, signed URLs, Storage paths, Supabase
credentials, user tokens, or AI credentials.

The production target uses an encrypted n8n Crypto credential for HMAC and an
encrypted Bearer Auth credential for the worker. This permits
`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`. The Code node can use only the built-in
`crypto` module for constant-time comparison and cannot read container secrets.

## A. Before deployment

1. Choose a host that supports persistent volumes, PostgreSQL backups, HTTPS,
   restricted editor ingress, and a secret manager.
2. Choose an HTTPS webhook hostname and a separate restricted editor hostname
   when possible. Do not finalize RegSpan configuration until both resolve.
3. Generate three distinct values with `openssl rand -hex 32`:
   `N8N_ENCRYPTION_KEY`, webhook HMAC secret, and worker Bearer secret. Generate
   a separate PostgreSQL password.
4. Store secrets only in the deployment secret manager. Back up the encryption
   key in a second protected location. Losing it makes n8n credentials
   unreadable.
5. Provision PostgreSQL with no public ingress. Schedule encrypted daily
   backups and define an acceptable retention period.
6. Configure the reverse proxy using
   `../../infra/n8n/reverse-proxy-security.md`.
7. Keep the editor behind VPN, identity-aware proxy, or equivalent additional
   access control. n8n login alone is not sufficient for a public editor.

## B. Deploy n8n

1. Copy `infra/n8n/.env.production.example` to an untracked file or map each
   value into the provider secret manager.
2. Set explicit HTTPS `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL`, the editor
   hostname in `N8N_HOST`, and the exact trusted proxy count in
   `N8N_PROXY_HOPS`.
3. Validate compose configuration before startup:

   ```sh
   docker compose \
     -f infra/n8n/docker-compose.production.example.yml \
     --env-file <untracked-production-env-file> \
     config
   ```

4. Start PostgreSQL and n8n. Confirm both health checks pass.
5. Confirm port 5678 listens only on localhost and PostgreSQL has no host port.
6. Confirm HTTPS and editor access restriction from an external network.
7. Confirm `N8N_PUBLIC_API_DISABLED=true` and the API playground is disabled.
8. Restart both containers and confirm workflows and credentials remain present.
9. Confirm success, failure, progress, and manual execution payloads are not
   stored. Execution-row metadata is pruned after 168 hours or 1,000 rows by
   default.

The example uses persistent named volumes for n8n configuration and PostgreSQL.
Volumes do not replace backups. Resource limits of one CPU, 1 GiB memory, and
256 processes are initial guardrails; monitor and adjust without removing
limits silently.

## C. Manually migrate the workflow

Follow `../../infra/n8n/manual-production-migration-checklist.md` exactly.

Create two new production credentials; do not copy local values:

- Crypto credential `RegSpan webhook HMAC - production`, **Hmac Secret** set to
  the production HMAC secret.
- Bearer Auth credential `RegSpan worker bearer - production`, token set to the
  production worker secret.

Build and test the inactive six-node target workflow. The first Code node builds
the deterministic signing input, the Crypto node calculates HMAC using the
encrypted credential, and the second Code node performs constant-time compare
and replay suppression without secret access. Publish only after all negative
tests prove the worker is unreachable on validation failure.

Do not commit a workflow export from the live instance. Exports can contain
workflow paths, node parameters, and credential identifiers even when secret
values are omitted. Use the repository's sanitized outline instead.

## D. Configure RegSpan

Store these only in the RegSpan production secret manager:

- `N8N_INGEST_WEBHOOK_URL`: exact n8n production webhook URL, HTTPS only.
- `N8N_INGEST_WEBHOOK_SECRET`: matches the n8n Crypto credential.
- `INGESTION_WORKER_SECRET`: matches the n8n Bearer Auth credential and differs
  from the HMAC secret.

The worker URL in n8n may be the deployed public HTTPS RegSpan URL or a
provider-private HTTPS service URL. It must target
`/api/internal/ingest/process-job`; never use localhost or
`host.docker.internal` in production. The Bearer secret remains required in
either topology.

RegSpan production validation rejects missing/weak secrets, identical HMAC and
worker secrets, non-HTTPS webhook URLs, URL credentials, localhost, loopback,
and `host.docker.internal`. Failure is closed and reported as a safe processing
configuration error without logging secret values.

## E. Validate

1. Send the deterministic safe four-field body with a current timestamp and
   valid signature. Expect HTTP 202 from n8n and one worker call.
2. Alter one body byte after signing. Expect non-2xx and no worker call.
3. Change the timestamp without recalculating the signature. Expect rejection.
4. Use a timestamp over five minutes old or future-skewed. Expect rejection.
5. Send a malformed signature and a signature from the wrong secret. Expect
   rejection without a detailed cryptographic error response.
6. Replay the same job and correlation ID within five minutes. Expect n8n replay
   rejection. Independently invoke the worker twice and confirm its durable
   idempotency returns `already_completed` rather than duplicating chunks.
7. Call the worker without the Bearer token and with an incorrect token. Expect
   HTTP 401. Call with the valid token and authoritative IDs. Expect processing
   or a safe idempotent response.
8. Upload a small non-sensitive PDF through RegSpan. Confirm the durable job
   moves Queued -> Processing -> Processed and no document data appears in n8n.
9. Restart n8n and PostgreSQL. Repeat a signed request and confirm credentials
   still decrypt.
10. Inspect execution storage, reverse-proxy logs, and container logs. Confirm
    they contain no headers, request bodies, IDs beyond approved operational
    metadata, worker responses, or secrets.
11. From an unauthenticated network, confirm the webhook is reachable but the
    editor, REST API, metrics, and health endpoints are not.

## F. Rotate and recover

### HMAC secret

Create a new Crypto credential, update the inactive workflow copy, test it, then
atomically publish the workflow and update RegSpan. A mismatch causes dispatch
failure, so retain the old credential until the end-to-end test passes. Roll
back both workflow and RegSpan value together.

### Worker secret

Create a new Bearer Auth credential and set the matching RegSpan worker secret.
Coordinate deployment to minimize mismatch. Test missing, old, and new tokens;
then delete the old credential. Never accept two worker secrets indefinitely.

### Encryption key

Do not replace `N8N_ENCRYPTION_KEY` directly. Take a full PostgreSQL backup and
key backup, verify the n8n version's supported encryption-key rotation feature,
enable it consistently, and follow the official procedure. Rotation is a
one-way feature change in current n8n documentation. If validation fails,
restore the database and old key as a matched pair.

### Database and workflow recovery

- Back up PostgreSQL and the encryption key on independent schedules.
- Export the workflow to protected backup storage only; do not commit it.
- Test restore on an isolated host with no public webhook route.
- Verify credentials decrypt, the workflow remains inactive after restore until
  tested, and execution payload retention remains disabled.
- Roll back application and workflow configuration atomically. Never point
  RegSpan at a test webhook or a workflow with plaintext secrets.

## Residual risks and decisions

- Workflow static data is best-effort replay protection, not a transactional
  replay store. Durable worker idempotency is authoritative. Revisit durable
  replay storage before multi-instance n8n.
- The Webhook node parses JSON, so production reconstructs RegSpan's exact
  deterministic four-field serialization before HMAC. This is valid for this
  single producer but not a general arbitrary-JSON raw-byte scheme.
- HMAC validation consumes proxy and n8n resources before rejection. Enforce
  edge body and rate limits.
- User input is still visible transiently to workflow nodes. Saving all
  execution payloads is disabled to prevent persistence.
- Host/provider, webhook and editor hostnames, editor access system, backup
  retention, and stable RegSpan egress addresses remain deployment decisions.

## Official n8n references

- [Crypto node and encrypted Crypto credential](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.crypto/)
- [HTTP Request Bearer credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
- [Security environment variables](https://docs.n8n.io/hosting/configuration/environment-variables/security/)
- [Execution retention variables](https://docs.n8n.io/hosting/configuration/environment-variables/executions/)
- [Reverse-proxy webhook URL configuration](https://docs.n8n.io/hosting/configuration/configuration-examples/webhook-url/)
- [Encryption-key rotation](https://docs.n8n.io/hosting/securing/encryption-key-rotation/)
