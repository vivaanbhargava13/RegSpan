import "server-only";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const BROWSER_ROUTES_PREFIX = "/api/";

type RequestOriginEnvironment = Record<string, string | undefined>;

export type RequestOriginDecision =
  | { allowed: true; reason: "safe_method" | "trusted_origin" | "not_api_route" }
  | {
      allowed: false;
      reason:
        | "configuration_missing"
        | "configuration_invalid"
        | "origin_missing"
        | "origin_null"
        | "origin_invalid"
        | "origin_not_allowed"
        | "cross_site_request";
      status: 403 | 503;
      body: { ok: false; error: string; code: string };
    };

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "[::1]"
    || normalized === "::1";
}

function parseConfiguredOrigin(value: string, isProduction: boolean) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("configured_origin_protocol_invalid");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("configured_origin_shape_invalid");
  }
  if (isProduction && (url.protocol !== "https:" || isLoopbackHostname(url.hostname))) {
    throw new Error("configured_origin_not_production_https");
  }
  return url.origin;
}

export function allowedAppOrigins(
  environment: RequestOriginEnvironment = process.env,
) {
  const isProduction = environment.NODE_ENV === "production";
  const configuredValues = [
    environment.APP_BASE_URL?.trim(),
    ...(environment.ALLOWED_APP_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim()),
  ].filter((value): value is string => Boolean(value));

  if (configuredValues.length === 0) {
    throw new Error("allowed_app_origins_missing");
  }

  const origins = new Set<string>();
  for (const value of configuredValues) {
    origins.add(parseConfiguredOrigin(value, isProduction));
  }
  return origins;
}

function rejection(
  reason: Exclude<RequestOriginDecision, { allowed: true }>["reason"],
  status: 403 | 503,
): RequestOriginDecision {
  return {
    allowed: false,
    reason,
    status,
    body: status === 503
      ? {
          ok: false,
          error: "Request origin validation is not configured.",
          code: "origin_configuration_error",
        }
      : {
          ok: false,
          error: "The request origin is not allowed.",
          code: "origin_not_allowed",
        },
  };
}

export function validateBrowserMutationOrigin(
  request: Request,
  environment: RequestOriginEnvironment = process.env,
): RequestOriginDecision {
  const method = request.method.toUpperCase();
  if (SAFE_METHODS.has(method)) {
    return { allowed: true, reason: "safe_method" };
  }

  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(BROWSER_ROUTES_PREFIX)) {
    return { allowed: true, reason: "not_api_route" };
  }

  let origins: Set<string>;
  try {
    origins = allowedAppOrigins(environment);
  } catch (error) {
    return rejection(
      error instanceof Error && error.message === "allowed_app_origins_missing"
        ? "configuration_missing"
        : "configuration_invalid",
      503,
    );
  }

  const rawOrigin = request.headers.get("origin")?.trim();
  if (!rawOrigin) return rejection("origin_missing", 403);
  if (rawOrigin === "null") return rejection("origin_null", 403);

  let origin: string;
  try {
    const url = new URL(rawOrigin);
    if (url.origin !== rawOrigin || url.username || url.password) {
      return rejection("origin_invalid", 403);
    }
    origin = url.origin;
  } catch {
    return rejection("origin_invalid", 403);
  }

  if (!origins.has(origin)) return rejection("origin_not_allowed", 403);
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return rejection("cross_site_request", 403);
  }

  return { allowed: true, reason: "trusted_origin" };
}

export function logRejectedBrowserMutation(
  request: Request,
  correlationId: string,
  decision: Exclude<RequestOriginDecision, { allowed: true }>,
) {
  console.warn("[RegSpan security] Browser mutation origin rejected", {
    route: new URL(request.url).pathname,
    method: request.method.toUpperCase(),
    correlationId,
    reason: decision.reason,
  });
}
