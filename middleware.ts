import type { NextRequest } from "next/server";
import { updateSupabaseSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
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
    "/settings/:path*",
  ],
};
