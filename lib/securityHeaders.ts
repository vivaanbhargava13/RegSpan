type SecurityHeaderEnvironment = Record<string, string | undefined>;

const NONCE_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

export function createCspNonce() {
  return crypto.randomUUID().replaceAll("-", "");
}

function browserSupabaseConnectOrigins(environment: SecurityHeaderEnvironment) {
  const configured = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) return [];

  try {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol)) return [];
    const websocketUrl = new URL(url.origin);
    websocketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [url.origin, websocketUrl.origin];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(
  nonce: string,
  environment: SecurityHeaderEnvironment = process.env,
) {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("CSP nonce contains invalid characters.");
  }

  const isProduction = environment.NODE_ENV === "production";
  const connectSources = new Set([
    "'self'",
    ...browserSupabaseConnectOrigins(environment),
    ...(isProduction ? [] : ["ws:", "wss:"]),
  ]);
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSources).join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "manifest-src 'self'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}

export function securityHeaders(
  contentSecurityPolicy: string,
  environment: SecurityHeaderEnvironment = process.env,
) {
  return {
    "Content-Security-Policy": contentSecurityPolicy,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": [
      "accelerometer=()",
      "camera=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "payment=()",
      "usb=()",
    ].join(", "),
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...(environment.NODE_ENV === "production"
      ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" }
      : {}),
  };
}

export function applySecurityHeaders(
  headers: Headers,
  contentSecurityPolicy: string,
  environment: SecurityHeaderEnvironment = process.env,
) {
  for (const [name, value] of Object.entries(
    securityHeaders(contentSecurityPolicy, environment),
  )) {
    headers.set(name, value);
  }
}

export function appendVaryOrigin(headers: Headers) {
  const existing = headers.get("Vary");
  const values = existing
    ? existing.split(",").map((value) => value.trim().toLowerCase())
    : [];
  if (!values.includes("origin")) {
    headers.set("Vary", existing ? `${existing}, Origin` : "Origin");
  }
}
