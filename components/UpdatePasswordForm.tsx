"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";

export function UpdatePasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase Auth is not configured for this environment.");
      setIsCheckingSession(false);
      return;
    }

    let isMounted = true;
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasRecoverySession(Boolean(session));
      }
      setIsCheckingSession(false);
    });

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isMounted) return;
      if (sessionError) {
        setError(sessionError.message);
      }
      setHasRecoverySession(Boolean(data.session));
      setIsCheckingSession(false);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      setMessage("");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      setMessage("");
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase Auth is not configured for this environment.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated. You can continue to your workspace.");
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Unable to update password. Request a new reset link if this one expired.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="w-full max-w-md">
      <div className="mb-8 text-center">
        <Logo />
      </div>

      <div className="rounded-2xl border border-line bg-white p-6 shadow-soft sm:p-8">
        <h1 className="text-2xl font-semibold tracking-normal text-ink">Update password</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Choose a new password for your RegSpan account.
        </p>

        {isCheckingSession ? (
          <p className="mt-6 rounded-lg border border-line bg-canvas px-3 py-2 text-sm font-medium text-muted">
            Verifying reset link...
          </p>
        ) : !hasRecoverySession ? (
          <p className="mt-6 rounded-lg border border-[#efd1d1] bg-[#fff0f0] px-3 py-2 text-sm font-medium text-danger">
            This reset link is invalid or expired. Request a new password reset email.
          </p>
        ) : null}

        <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
          <label className="block">
            <span className="text-sm font-semibold text-ink">New password</span>
            <input
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setError("");
                setMessage("");
              }}
              type="password"
              autoComplete="new-password"
              className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-ink">Confirm new password</span>
            <input
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setError("");
                setMessage("");
              }}
              type="password"
              autoComplete="new-password"
              className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-[#efd1d1] bg-[#fff0f0] px-3 py-2 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          {message ? (
            <p className="rounded-lg border border-[#cce5da] bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
              {message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitting || isCheckingSession || !hasRecoverySession}>
            {isSubmitting ? "Updating password..." : "Update password"}
          </Button>
        </form>

        <div className="mt-6 flex justify-center gap-4 text-sm font-semibold">
          <Link href="/auth/forgot-password" className="text-accent hover:text-[#115441]">
            Request new link
          </Link>
          <Link href="/auth" className="text-accent hover:text-[#115441]">
            Back to login
          </Link>
        </div>
      </div>
    </section>
  );
}
