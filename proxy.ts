import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSupabaseSession(request);
}

export const config = {
  matcher: [
    "/auth",
    "/dashboard/:path*",
    "/documents/:path*",
    "/controls/:path*",
    "/findings/:path*",
    "/reports/:path*",
    "/requirement-debug/:path*",
    "/retrieval-debug/:path*",
    "/settings/:path*",
  ],
};
