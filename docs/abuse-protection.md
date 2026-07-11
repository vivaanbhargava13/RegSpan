# Durable Abuse Protection

RegSpan uses Supabase/Postgres for production rate limits and workspace quotas. The database RPC `consume_rate_limit_batch_v1` acquires deterministic advisory locks for every scope before checking or incrementing counters, so IP, user, workspace, and hashed-identifier limits are consumed atomically across app instances.

## Production configuration

Apply migration `019_add_durable_abuse_protection` before deploying the application. Set the following server-only environment values in production:

```bash
REGSPAN_RATE_LIMIT_BACKEND=supabase
REGSPAN_REQUIRE_DURABLE_RATE_LIMITING=true
```

Production refuses to use the in-memory limiter. A missing or failed durable limiter returns a safe `503` instead of silently allowing unbounded requests. Development and tests may omit both values and use the process-local fallback.

## Defaults

| Control | Default |
| --- | --- |
| Upload attempts | 12 per hour per available IP, user, workspace, and request scope |
| Replacement attempts | 12 per hour |
| Reprocess requests | 30 per hour |
| Bulk document actions | 20 per hour |
| Analysis requests | 8 per hour |
| Password reset sends | 5 per 15 minutes per IP and hashed normalized email |
| Workspace document uploads | 100 per day |
| Workspace uploaded bytes | 100 MiB per day |
| Workspace processing requests | 60 per hour |
| Active processing jobs | 2 per workspace |
| Active Analysis runs | 1 per workspace |

Every default can be changed with the corresponding `REGSPAN_RATE_LIMIT_*` or `REGSPAN_QUOTA_*` variable in `.env.example`. Password reset counters never store plaintext email addresses. Counter keys are hashed before they reach Postgres.

## Expected responses

- A rate or rolling quota limit returns `429` with `Retry-After` and a safe message.
- A second Analysis request while one is active returns `409` with `analysis_already_running`.
- A processing request that exceeds the active workspace limit returns `429` with `workspace_processing_limit_reached`.
- A duplicate document-processing request reuses the existing idempotent job where applicable.

## Operations

Counters are stored in `public.rate_limit_counters` and are service-role-only. Inspect or clear them only through a restricted database-admin session; do not expose counter keys in user-facing tooling. Counters naturally reset when `window_ends_at` passes. To remove expired rows during normal maintenance:

```sql
delete from public.rate_limit_counters
where window_ends_at < now() - interval '7 days';
```

To reset all counters during an incident response or controlled test, use an administrator-only SQL session:

```sql
truncate public.rate_limit_counters;
```

Security events record limit or quota category, result, workspace/actor context when available, and correlation IDs. They do not record source excerpts, passwords, tokens, provider keys, or plaintext reset emails.
