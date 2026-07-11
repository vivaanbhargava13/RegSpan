import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseRuntimeEnvironment } from "@/lib/supabase/runtimeEnvironment";

const protectedPrefixes = [
  "/dashboard",
  "/documents",
  "/controls",
  "/findings",
  "/reports",
  "/requirement-debug",
  "/retrieval-debug",
  "/settings",
];

export async function updateSupabaseSession(
  request: NextRequest,
  requestHeaders: Headers = new Headers(request.headers),
) {
  const { url: supabaseUrl, anonKey } = getSupabaseRuntimeEnvironment();

  if (!supabaseUrl || !anonKey) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: requestHeaders } });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const isProtectedRoute = protectedPrefixes.some(
    (prefix) =>
      request.nextUrl.pathname === prefix ||
      request.nextUrl.pathname.startsWith(`${prefix}/`),
  );

  if (isProtectedRoute && !data.user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/auth";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (request.nextUrl.pathname === "/auth" && data.user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
