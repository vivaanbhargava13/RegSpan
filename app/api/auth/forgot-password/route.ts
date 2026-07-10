import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  authRedirectUrl,
  isAllowedAuthRequestOrigin,
} from "@/lib/authRedirects";
import { getCorrelationId } from "@/lib/documentSecurity";
import {
  checkRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rateLimit";

export const runtime = "nodejs";

const PASSWORD_RESET_MESSAGE =
  "If an account exists for that email, we sent password reset instructions.";

function getSupabaseAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase Auth server environment variables are missing.");
  }

  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function emailFromBody(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "";
  const email = (body as Record<string, unknown>).email;
  return typeof email === "string" ? email.trim() : "";
}

export async function POST(request: Request) {
  const correlationId = getCorrelationId(request);

  try {
    if (!isAllowedAuthRequestOrigin(request)) {
      return NextResponse.json(
        { ok: false, error: "The password reset request is not allowed.", code: "origin_not_allowed" },
        { status: 403 },
      );
    }

    const email = emailFromBody(await request.json().catch(() => null));
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Email is required.", code: "email_required" },
        { status: 400 },
      );
    }

    checkRateLimit({
      request,
      category: "password_reset",
      identifier: email,
    });

    const supabase = getSupabaseAuthClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectUrl("/auth/update-password"),
    });

    if (error) {
      console.warn("[RegSpan auth] Password reset request was not accepted by Supabase", {
        correlationId,
        code: "password_reset_request_failed",
      });
    }

    return NextResponse.json({ ok: true, message: PASSWORD_RESET_MESSAGE });
  } catch (error) {
    const rateLimited = rateLimitErrorResponse(error);
    if (rateLimited) {
      return NextResponse.json(rateLimited.body, {
        status: rateLimited.status,
        headers: rateLimited.headers,
      });
    }

    console.error("[RegSpan auth] Password reset request failed", {
      correlationId,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { ok: true, message: PASSWORD_RESET_MESSAGE },
      { status: 200 },
    );
  }
}
