import { NextResponse } from "next/server";
import { authRedirectUrl } from "@/lib/authRedirects";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const target = new URL(request.url).searchParams.get("target");
  const path = target === "signup" ? "/auth" : "/auth/update-password";

  return NextResponse.json({
    ok: true,
    redirectTo: authRedirectUrl(path),
  });
}
