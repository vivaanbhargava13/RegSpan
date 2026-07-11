# Browser request hardening

RegSpan treats browser pages, browser API mutations, external Supabase Auth,
and the internal ingestion worker as separate trust boundaries. The controls in
`proxy.ts`, `lib/requestOrigin.ts`, and `lib/securityHeaders.ts` protect the
browser-facing HTTP boundary without changing workspace authorization or worker
authentication.

## Threat model

The relevant threats are cross-site request forgery against cookie-authenticated
routes, malicious cross-origin JavaScript, script injection, clickjacking,
content-type confusion, and accidental exposure of server-only endpoints or
provider hosts to the browser. RLS and API authorization remain necessary after
a request passes these browser controls.

CORS alone is not CSRF protection. A browser can send some cross-origin requests
without permission to read the response. RegSpan therefore validates `Origin`
before processing unsafe browser API methods and uses `Sec-Fetch-Site` only as
an additional rejection signal.

## Allowed origins

`ALLOWED_APP_ORIGINS` is a server-only, comma-separated allow-list. Each value
must be an exact HTTP or HTTPS origin containing only:

```text
scheme://hostname[:port]
```

Do not include paths, query strings, fragments, credentials, or wildcards.
`APP_BASE_URL` is also included when valid. Production accepts HTTPS,
non-loopback origins only and fails closed if no valid origin is configured.
Localhost origins are accepted only outside production and must be configured
explicitly, which supports arbitrary local ports without trusting `Host` or
`X-Forwarded-Host`.

## Browser mutation protection

The Next.js 16 proxy validates all non-safe methods under `/api/`. Safe methods
are `GET`, `HEAD`, and `OPTIONS`. The guard requires a configured, exact `Origin`,
rejects `Origin: null`, malformed origins, unknown origins, and cross-site fetch
metadata, and never reflects the rejected value.

This protects the current browser mutation routes:

- `POST /api/auth/forgot-password`
- `POST /api/documents`
- `POST /api/documents/bulk`
- `POST /api/documents/[id]/process`
- `POST /api/documents/[id]/replace`
- `DELETE /api/documents/[id]`
- `POST /api/documents/[id]/mock-process` when the development feature is enabled
- `POST /api/findings/generate`
- `PATCH /api/workspace/external-ai-processing`
- `POST /api/retrieval-debug` and `POST /api/requirement-debug` when enabled

Profile, login, logout, signup, recovery-session password updates, and token
refresh use the Supabase browser client directly and remain governed by
Supabase Auth's origin, session, and authorization controls.

Origin rejections receive a generic JSON response. The proxy logs only route,
method, generated correlation ID, and reason category. It does not create an
audit row before authentication, preventing an unauthenticated attacker from
creating unbounded database audit events. Cookies, tokens, request bodies, and
raw header values are not logged.

## Server-to-server exemption

`POST /api/internal/ingest/process-job` is exempt from browser origin checks.
It is called by n8n and continues to require the server-only
`INGESTION_WORKER_SECRET` Bearer credential. The application-to-n8n handoff is
separately protected by HMAC signing and timestamp validation. No other unsafe
API route is exempt.

Safe API GET routes and Supabase redirect/configuration GET routes are not CSRF
checked because they do not mutate server state. Their redirect destinations
remain constructed exclusively from server-controlled configuration.

## CORS behavior

RegSpan APIs are same-origin and emit no wildcard or broadly credentialed CORS
headers. Arbitrary origins are never reflected. No custom `OPTIONS` handler is
present because the product has no required cross-origin browser API flow. If a
future route requires CORS, it must validate against `ALLOWED_APP_ORIGINS`, emit
the exact allowed origin only, and add `Vary: Origin`.

## Content Security Policy

The proxy generates a cryptographically random nonce for every request, places
it in the internal `x-nonce` request header and request CSP, and returns the
matching CSP response header. The root layout is request-rendered so Next.js can
apply the nonce to framework scripts. Static asset routes are excluded from the
proxy matcher.

The production policy uses:

- `default-src 'self'`
- nonce-based `script-src` with `'strict-dynamic'`, without `'unsafe-eval'`
- `style-src 'self' 'unsafe-inline'` for current Next.js/Tailwind runtime styles
- `img-src 'self' data: blob:` and `font-src 'self' data:`
- `connect-src 'self'` plus the exact configured Supabase HTTP and WebSocket origins
- `object-src 'none'`, `frame-ancestors 'none'`, and `frame-src 'none'`
- `base-uri 'self'`, `form-action 'self'`, and `manifest-src 'self'`
- `worker-src 'self' blob:`
- `upgrade-insecure-requests` in production

Development adds only `'unsafe-eval'` for Next.js tooling and `ws:`/`wss:` for
HMR. n8n, internal worker URLs, OpenAI endpoints, service-role credentials, and
server-only secrets are never included in browser CSP.

## HTTP headers

The proxy adds CSP, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, a
restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy:
same-origin-allow-popups`, and `Cross-Origin-Resource-Policy: same-origin`.
Whenever `NODE_ENV=production`, RegSpan emits HSTS for one year with
`includeSubDomains`. This is environment-controlled rather than inferred from
the observed request protocol or proxy headers because production TLS is
commonly terminated upstream. Browsers ignore HSTS received over plain HTTP,
and preload is intentionally omitted. Next.js framework identification is
disabled with `poweredByHeader: false`.

## Deployment checks

1. Set `APP_BASE_URL` to the canonical HTTPS application origin.
2. Set `ALLOWED_APP_ORIGINS` to exact approved application origins.
3. Keep `ALLOWED_AUTH_REDIRECT_ORIGINS` aligned with approved Supabase Auth
   callback origins; it remains a separate allow-list.
4. Confirm the Supabase project URL in `NEXT_PUBLIC_SUPABASE_URL`; only its exact
   HTTP and WebSocket origins should appear in `connect-src`.
5. Verify public, auth, protected, and API responses include the expected headers.
6. Confirm cross-origin mutation requests receive 403 and same-origin requests
   still reach normal authentication and authorization.
7. Confirm the worker succeeds without an `Origin` header only when its Bearer
   secret is valid.

## Diagnosing CSP violations

Use the browser console's CSP violation message to identify the blocked
directive and resource. Confirm the resource is genuinely browser-required and
not already available from `'self'`. Add only the exact minimum source to the
central policy builder and add a regression test. Do not add wildcard sources,
`'unsafe-inline'` to production scripts, a static nonce, internal service URLs,
or server-only provider endpoints to silence a violation.
