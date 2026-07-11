# n8n reverse-proxy security boundary

The production n8n container listens on localhost only. A provider-managed or
host reverse proxy terminates HTTPS and exposes the minimum required routes.

## Public and restricted surfaces

Publicly route only the exact production RegSpan webhook path under
`/webhook/`. Do not expose the test webhook path.

Restrict the editor hostname and its REST, API, administration, metrics, and
health paths with a VPN, identity-aware proxy, private network, or a known
administrator IP policy. n8n login is not the only required access boundary.
Do not expose container port `5678` directly to the internet.

Separate editor and webhook hostnames when the platform supports it:

```text
hooks.example.invalid   -> exact /webhook/<random-path> only
editor.example.invalid  -> all editor traffic, identity-restricted
```

Do not create an IP allowlist for RegSpan until its production egress addresses
are known and stable.

## Proxy requirements

- Terminate TLS with a valid certificate and redirect HTTP to HTTPS.
- Set `WEBHOOK_URL` and `N8N_EDITOR_BASE_URL` to their explicit HTTPS origins.
- Set `N8N_PROXY_HOPS` to the exact number of trusted proxies (usually `1`).
- Overwrite, rather than append untrusted, `X-Forwarded-For`,
  `X-Forwarded-Host`, and `X-Forwarded-Proto` at the trusted edge.
- Limit the public webhook body to 16 KiB. The normal payload is much smaller.
- Rate-limit the webhook path by source and globally, with a small burst.
- Allow only `POST` on the webhook path.
- Apply `nosniff`, restrictive referrer policy, and frame protection to the
  editor. Do not add permissive CORS.
- Keep health and metrics private unless the monitoring system has a private
  route and authentication.
- Set upstream timeouts so the HMAC path can acknowledge within RegSpan's
  10-second dispatch timeout. The worker call happens after acknowledgement.

HMAC authenticates valid webhook requests but does not prevent unauthenticated
traffic from consuming network and proxy resources before validation. Edge body
limits and rate limits are therefore required.

## Data and logging

Disable request/response body logging on the webhook and worker routes. Redact
`Authorization`, `x-regspan-webhook-signature`, cookies, and query strings.
Access logs may retain timestamp, method, status, duration, route template, and
a proxy-generated request ID. They must not retain PDFs, document text, Storage
paths, secrets, or full request headers.

The target n8n configuration saves no successful, failed, progress, or manual
execution payloads. Keep proxy and container log retention bounded as well.

## Provider-controlled alternative

If the provider does not use host port bindings, omit `ports` and attach n8n to
the provider's private ingress network. Preserve the same route restrictions:
only the exact webhook is public, the editor has an additional identity
boundary, PostgreSQL has no public ingress, and health checks remain private.
