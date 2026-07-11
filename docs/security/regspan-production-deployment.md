# RegSpan production deployment

This provider-neutral runbook covers a containerized staging deployment and
later production promotion. It does not create infrastructure or select a host.

## Confirmed deployment risks and controls

- The PDF parser constructs its PDF.js import dynamically inside a worker
  thread. Next.js tracing cannot infer that import, so `next.config.ts` includes
  `pdfjs-dist` explicitly and the Docker build verifies the runtime files.
- Public Supabase configuration previously used build-time `NEXT_PUBLIC_*`
  expressions. It is now read by the server at runtime and rendered as escaped
  HTML data attributes. Only the public project URL and anon key are exposed.
- A parser may run for 180 seconds, after which chunking and embedding still
  need time. Reverse proxies and n8n must permit the complete worker request;
  begin with at least 360 seconds and measure real workloads.
- The container entrypoint uses `exec`, and App Router instrumentation handles
  `SIGTERM`/`SIGINT`. It rejects new authenticated worker calls, waits up to 330
  seconds for active ingestion, and exits before the 360-second container grace
  period. Production preflight requires at least 60 seconds between the PDF
  parser deadline and application shutdown deadline for cleanup and response
  completion. A forced kill can still leave a processing job claimed; retry is
  idempotent, but there is no automatic stale processing-job reaper.
- V8 worker heap ceilings do not cover PDF.js native allocations, transferred
  buffers, the main Next process, or outbound request buffers. Container memory
  must exceed the worker's configured heap limits.

## A. Architecture boundaries

**Browser:** connects only to the RegSpan HTTPS origin and Supabase's public Auth
and data endpoints. It receives the Supabase URL and anon key, never service-role,
n8n, worker, or AI credentials.

**RegSpan application:** authenticates sessions, derives workspace authority,
mediates private Storage, performs PDF parsing/chunking/analysis, owns provider
API calls, and uses the Supabase service role only on the server.

**Supabase:** provides Auth, workspace-scoped PostgreSQL/RLS, private document
Storage, and pgvector. Service-role operations still carry explicit workspace
filters because service role bypasses RLS.

**n8n webhook:** public HTTPS endpoint receiving only signed `jobId`,
`documentId`, `workspaceId`, and `correlationId`. PDFs, text, paths, signed URLs,
tokens, embeddings, and provider credentials never pass through n8n.

**n8n editor:** separate restricted administrative boundary protected by VPN,
identity-aware access, or equivalent control. It must not share unrestricted
public access with the webhook.

**n8n PostgreSQL:** private persistent state for workflows and encrypted
credentials; it is separate from Supabase and the RegSpan container.

**External AI provider:** server-to-provider boundary used only when both server
flags and explicit workspace consent permit it. n8n is not in this path.

## B. Required domains

- Application hostname: canonical HTTPS RegSpan origin.
- Authentication redirect hostname: normally the application hostname and
  explicitly allowed in RegSpan and Supabase Auth redirect settings.
- n8n webhook hostname: public HTTPS route limited to the exact webhook path.
- n8n editor hostname: restricted administrative hostname.

Do not use localhost, loopback, `0.0.0.0`, `host.docker.internal`, URL
credentials, or test webhook URLs outside local development.

## C. Secret inventory

| Value | Owner / consumer | Storage | Browser | Generation | Rotation and rollback |
| --- | --- | --- | --- | --- | --- |
| Supabase anon key | Supabase / browser and server Auth client | Runtime environment | **Yes, intentionally public** | Supabase-managed | Coordinate project key change; old client sessions may need refresh |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase / RegSpan server | Application secret manager | Never | Supabase-managed | Deploy new key, verify server APIs, retain rollback window securely |
| `N8N_INGEST_WEBHOOK_SECRET` | RegSpan signer / n8n Crypto credential | Both secret managers | Never | `openssl rand -hex 32` | Change n8n credential and RegSpan atomically; rollback both |
| `INGESTION_WORKER_SECRET` | n8n HTTP credential / RegSpan worker | Both secret managers | Never | Separate `openssl rand -hex 32` | Coordinate both sides; do not accept old and new indefinitely |
| `EMBEDDING_API_KEY` | AI provider / RegSpan | Application secret manager | Never | Provider-issued | Rotate application value; verify consent-gated ingestion |
| `OPENAI_API_KEY` | AI provider fallback / RegSpan | Application secret manager | Never | Provider-issued | Audit all fallback consumers before removal |
| `CHUNK_SYNOPSIS_API_KEY` | AI provider / RegSpan | Application secret manager | Never | Provider-issued | Rotate with synopsis validation |
| `REQUIREMENT_CLASSIFIER_API_KEY` | AI provider / RegSpan | Application secret manager | Never | Provider-issued | Rotate with classifier fallback validation |
| `N8N_ENCRYPTION_KEY` | n8n | n8n secret manager plus offline backup | Never | `openssl rand -hex 32` | Follow supported n8n rotation; database and key rollback are a matched pair |
| n8n PostgreSQL password | n8n database | n8n/database secret manager | Never | High-entropy generated value | Coordinate database and n8n; preserve tested backup |

See `regspan-environment-matrix.md` for every non-secret and secret variable.

## Provisional resource guidance

Start private-beta staging with **2 vCPU, 2 GiB memory, and one active ingestion
job per workspace**. Treat this as a conservative starting point, not a proven
safe minimum.

One parser worker may use up to 192 MiB old-generation heap, 32 MiB
young-generation heap, and a 4 MiB stack. Additional memory is consumed by the
main Next.js process, PDF.js/native allocations, a 10 MiB uploaded buffer and
copies, extracted pages/chunks, TLS, Supabase clients, and embedding responses.
V8 heap settings do not cap every native allocation.

Use a container memory limit rather than unlimited memory, but leave enough
headroom to avoid routine OOM termination. If active processing concurrency is
raised to two, begin testing at 3-4 GiB rather than assuming linear V8 limits are
the complete requirement.

Under-sizing symptoms include OOM-killed containers, long event-loop delays,
health-check failures, PDF timeouts on otherwise valid files, stalled worker
responses, repeated n8n retries, or processing jobs left active after forced
termination. Capture container RSS/CPU, event-loop delay, parser duration, PDF
page/text size, chunk count, and embedding latency using synthetic non-sensitive
documents. Test one job, then controlled concurrent jobs, then failure and
shutdown cases before changing quotas.

## D. Staging deployment

1. Create isolated staging application, Supabase, n8n credentials, DNS, and TLS
   boundaries. Do not reuse production secrets.
2. Copy `infra/app/.env.staging.example` to ignored `.env.staging` and replace
   every placeholder through the staging secret manager.
3. Apply required Supabase migrations to staging only and verify RLS/Storage with
   the production verification SQL.
4. Configure Supabase Site URL and allowed redirects for the staging application
   hostname.
5. Configure the active staging n8n webhook/Crypto credential and worker Bearer
   credential using the n8n migration checklist.
6. Run `docker compose ... config`, then build the image. The build requires no
   live environment values.
7. Start the container behind the TLS reverse proxy. Confirm it runs as UID
   10001, the root filesystem is read-only, and only localhost port 3000 is
   published.
8. Confirm `GET /api/health` returns only `{"ok":true,"status":"live"}`.
9. Test signup/login/logout, confirmation and reset redirects, token refresh,
   and protected-route redirects.
10. Confirm workspace-scoped Supabase reads and private Storage upload/download.
11. Upload a safe PDF. Confirm n8n receives only four IDs, worker processing
    completes, chunks/embeddings persist, and source text never appears in n8n.
12. Run Analysis and verify findings plus exact evidence persistence.
13. Delete the test document and verify Storage, chunks, embeddings, findings,
    and evidence follow existing deletion semantics.
14. Send `SIGTERM` during a controlled long ingestion. Confirm the platform
    honors the drain period. If it forces termination, verify reprocess safely
    resumes or replaces the durable job without duplicate chunks.

No separate readiness endpoint is provided. A readiness probe that repeatedly
calls Supabase, Storage, n8n, or AI providers would add external load and could
turn a dependency incident into container churn. Monitor dependencies through
separate bounded checks.

## E. Production promotion

1. Approve a production Supabase project or a documented isolation model with
   production-only Auth redirects, RLS verification, private Storage, backups,
   and retention.
2. Generate fresh production application, n8n, worker, database, and AI secrets.
3. Deploy production n8n PostgreSQL and restricted editor access; migrate the
   workflow manually with encrypted credentials.
4. Configure production DNS, TLS, exact origins, CSP-compatible Supabase origin,
   webhook URL, and reverse-proxy request/drain timeouts.
5. Build the same source revision without production secrets. Promote by image
   digest after staging validation.
6. Configure encrypted database backups, n8n encryption-key backup, workflow
   backup, restore tests, log retention, and document retention.
7. Monitor health, restart count, memory/RSS, CPU, latency, rate-limit failures,
   processing failures, stale jobs, analysis failures, and n8n delivery errors.
8. Alert on repeated worker 401s, HMAC failures at n8n, OOM kills, unhealthy
   containers, sustained 5xx responses, and processing jobs exceeding expected
   duration.
9. Preserve the previous image digest and matched secret configuration until the
   production smoke test passes.

## F. Failure and rollback

**Bad application release:** stop new ingress, restore the prior immutable image
with the same runtime configuration, verify health/auth, then resume traffic.

**Unavailable n8n:** uploads may create jobs that fail webhook dispatch. Do not
bypass HMAC. Restore n8n, then use the existing authenticated reprocess path.

**Unavailable Supabase:** keep the application fail-closed. Do not switch to mock
data or disable workspace checks. Restore service, then verify Auth, RLS,
Storage, counters, and durable jobs.

**Failed credential rotation:** roll back both consumers together. Never leave
RegSpan and n8n on mismatched HMAC or worker values.

**Parser memory exhaustion:** reduce ingestion concurrency, restore the prior
image if regression-related, retain the file under existing private Storage
semantics, and reprocess only after sizing or parser analysis. Do not raise PDF
safety limits blindly.

**Stale processing job:** inspect safe IDs/status metadata, confirm no worker is
active, then use the idempotent reprocess path. Do not edit chunks or job status
manually without an approved recovery procedure.

**Database restore:** restore Supabase or n8n PostgreSQL only into the matching
environment. For n8n, restore `N8N_ENCRYPTION_KEY` with the database. Re-run
isolation and workflow tests before reopening ingress.

**Previous image rollback:** select the prior digest, preserve compatible schema
and secrets, allow in-flight requests to drain, then replace containers. Confirm
the PDF worker and health endpoint before resuming uploads.

## Image and filesystem guarantees

The Dockerfile uses exact `node:24.17.0-bookworm-slim`. Node 24 is an LTS
release supported by the repository's Next.js 16 runtime, and the Debian slim
variant avoids introducing Alpine/musl compatibility uncertainty around PDF.js
and optional native packages. The build uses deterministic `npm ci`,
multi-stage standalone output, UID/GID 10001, direct signal forwarding, no
secret build arguments, and no development dependencies in the final runtime
tree. The final image copies public/static assets, traced standalone files, the
runtime preflight, entrypoint, and the explicit PDF worker only.

The application does not require local persistent storage. Evaluation scripts
write reports only in development and are not copied into the runtime image.
Temporary process data uses bounded `/tmp`; Next image cache uses a bounded
tmpfs in the staging Compose example.
