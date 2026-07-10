"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setError("Email is required.");
      setMessage("");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.status === 429) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error || "Too many password reset requests. Please wait before trying again.");
      }
      setMessage("If an account exists for that email, we sent password reset instructions.");
    } catch (resetError) {
      if (resetError instanceof Error && /too many password reset/i.test(resetError.message)) {
        setError(resetError.message);
      } else {
        setMessage("If an account exists for that email, we sent password reset instructions.");
      }
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
        <h1 className="text-2xl font-semibold tracking-normal text-ink">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          Enter your account email and RegSpan will send reset instructions when an account exists.
        </p>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
          <label className="block">
            <span className="text-sm font-semibold text-ink">Email</span>
            <input
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError("");
                setMessage("");
              }}
              type="email"
              autoComplete="email"
              placeholder="you@firm.com"
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

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Sending reset link..." : "Send reset link"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/auth" className="text-sm font-semibold text-accent hover:text-[#115441]">
            Back to login
          </Link>
        </div>
      </div>
    </section>
  );
}
