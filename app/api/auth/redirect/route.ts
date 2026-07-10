import { NextResponse } from "next/server";
import {
  authRedirectUrl,
  isAllowedAuthRequestOrigin,
} from "@/lib/authRedirects";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isAllowedAuthRequestOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "The auth redirect request is not allowed.", code: "origin_not_allowed" },
      { status: 403 },
    );
  }

  const target = new URL(request.url).searchParams.get("target");
  const path = target === "signup" ? "/auth" : "/auth/update-password";

  return NextResponse.json({
    ok: true,
    redirectTo: authRedirectUrl(path),
  });
}
