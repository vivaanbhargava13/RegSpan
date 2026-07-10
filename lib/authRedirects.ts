import "server-only";

const DEFAULT_LOCAL_APP_BASE_URL = "http://localhost:3000";
const AUTH_REDIRECT_PATHS = new Set(["/auth", "/auth/update-password"]);

type AuthRedirectEnvironment = Record<string, string | undefined>;

function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Auth redirect origins must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Auth redirect origins cannot include credentials.");
  }
  return url.origin;
}

export function appBaseOrigin(environment: AuthRedirectEnvironment = process.env) {
  const configured = environment.APP_BASE_URL?.trim()
    || (environment.NODE_ENV === "production" ? "" : DEFAULT_LOCAL_APP_BASE_URL);

  if (!configured) {
    throw new Error("APP_BASE_URL is required for auth redirects.");
  }

  const origin = normalizeOrigin(configured);
  if (environment.NODE_ENV === "production" && !origin.startsWith("https://")) {
    throw new Error("APP_BASE_URL must use https in production.");
  }

  return origin;
}

export function allowedAuthRedirectOrigins(
  environment: AuthRedirectEnvironment = process.env,
) {
  const origins = new Set<string>([appBaseOrigin(environment)]);
  for (const rawOrigin of (environment.ALLOWED_AUTH_REDIRECT_ORIGINS ?? "").split(",")) {
    const trimmed = rawOrigin.trim();
    if (trimmed) origins.add(normalizeOrigin(trimmed));
  }
  return origins;
}

export function isAllowedAuthRequestOrigin(
  request: Request,
  environment: AuthRedirectEnvironment = process.env,
) {
  const origin = request.headers.get("origin")?.trim();
  if (!origin) return true;

  try {
    return allowedAuthRedirectOrigins(environment).has(normalizeOrigin(origin));
  } catch {
    return false;
  }
}

export function authRedirectUrl(
  path: "/auth" | "/auth/update-password",
  environment: AuthRedirectEnvironment = process.env,
) {
  if (!AUTH_REDIRECT_PATHS.has(path)) {
    throw new Error("Unsupported auth redirect path.");
  }
  return new URL(path, appBaseOrigin(environment)).toString();
}
