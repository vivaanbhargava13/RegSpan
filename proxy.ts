import { NextResponse, type NextRequest } from "next/server";
import {
  logRejectedBrowserMutation,
  validateBrowserMutationOrigin,
} from "@/lib/requestOrigin";
import {
  appendVaryOrigin,
  applySecurityHeaders,
  buildContentSecurityPolicy,
  createCspNonce,
} from "@/lib/securityHeaders";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

const INTERNAL_SERVER_ROUTES = new Set(["/api/internal/ingest/process-job"]);
const SAFE_API_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_PATH_PREFIXES = [
  "/auth",
  "/dashboard",
  "/documents",
  "/controls",
  "/findings",
  "/reports",
  "/requirement-debug",
  "/retrieval-debug",
  "/settings",
];

function usesSupabaseSession(pathname: string) {
  return SESSION_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function proxy(request: NextRequest) {
  const nonce = createCspNonce();
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const pathname = request.nextUrl.pathname;
  const isBrowserApiMutation = pathname.startsWith("/api/")
    && !INTERNAL_SERVER_ROUTES.has(pathname)
    && !SAFE_API_METHODS.has(request.method.toUpperCase());
  if (isBrowserApiMutation) {
    const originDecision = validateBrowserMutationOrigin(request);
    if (!originDecision.allowed) {
      const correlationId = crypto.randomUUID();
      logRejectedBrowserMutation(request, correlationId, originDecision);
      const rejection = NextResponse.json(originDecision.body, {
        status: originDecision.status,
        headers: { "x-request-id": correlationId },
      });
      appendVaryOrigin(rejection.headers);
      applySecurityHeaders(rejection.headers, contentSecurityPolicy);
      return rejection;
    }
  }

  const response = usesSupabaseSession(pathname)
    ? await updateSupabaseSession(request, requestHeaders)
    : NextResponse.next({ request: { headers: requestHeaders } });
  if (isBrowserApiMutation) appendVaryOrigin(response.headers);
  applySecurityHeaders(response.headers, contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)",
  ],
};
