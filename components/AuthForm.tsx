"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";

type AuthMode = "login" | "signup";
type FormValues = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

const initialValues: FormValues = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  confirmPassword: "",
};

async function loadSignupRedirectUrl() {
  const response = await fetch("/api/auth/redirect?target=signup", {
    cache: "no-store",
  });
  const body = (await response.json()) as {
    ok?: boolean;
    redirectTo?: string;
    error?: string;
  };

  if (!response.ok || !body.ok || !body.redirectTo) {
    throw new Error(body.error || "Authentication redirects are not configured.");
  }

  return body.redirectTo;
}

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [values, setValues] = useState<FormValues>(initialValues);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isSignup = mode === "signup";
  const title = useMemo(
    () => (isSignup ? "Create your RegSpan account" : "Log in to RegSpan"),
    [isSignup],
  );

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    if (!supabase) {
      setError(
        "Supabase Auth is not configured. Add the public Supabase URL and anon key to your local environment.",
      );
      setIsCheckingSession(false);
      return;
    }

    let isMounted = true;
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (isMounted && session) {
          window.location.replace("/dashboard");
        }
      },
    );

    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!isMounted) {
        return;
      }

      if (sessionError) {
        setError(`Unable to load your session: ${sessionError.message}`);
      } else if (data.session) {
        window.location.replace("/dashboard");
      }

      setIsCheckingSession(false);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  function updateField(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setError("");
    setMessage("");
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setValues(initialValues);
    setError("");
    setMessage("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!values.email.trim() || !values.password.trim()) {
      setError("Email and password are required.");
      setMessage("");
      return;
    }

    if (isSignup) {
      if (!values.firstName.trim() || !values.lastName.trim()) {
        setError("First name and last name are required.");
        setMessage("");
        return;
      }

      if (!values.confirmPassword.trim()) {
        setError("Confirm your password to create an account.");
        setMessage("");
        return;
      }

      if (values.password !== values.confirmPassword) {
        setError("Passwords do not match.");
        setMessage("");
        return;
      }
    }

    const supabase = getBrowserSupabaseClient();

    if (!supabase) {
      setError(
        "Supabase Auth is not configured. Add the public Supabase URL and anon key to your local environment.",
      );
      return;
    }

    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      if (isSignup) {
        const firstName = values.firstName.trim();
        const lastName = values.lastName.trim();
        const emailRedirectTo = await loadSignupRedirectUrl();
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: values.email.trim(),
          password: values.password,
          options: {
            emailRedirectTo,
            data: {
              first_name: firstName,
              last_name: lastName,
              full_name: `${firstName} ${lastName}`.trim(),
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        if (data.session) {
          setMessage("Account created. Opening your workspace...");
          window.location.replace("/dashboard");
        } else {
          setMessage("Account created. Check your email to confirm your address, then log in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: values.email.trim(),
          password: values.password,
        });

        if (signInError) {
          throw signInError;
        }

        setMessage("Opening your workspace...");
        window.location.replace("/dashboard");
      }
    } catch (authError) {
      setError(
        authError instanceof Error
          ? authError.message
          : "Authentication failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isCheckingSession) {
    return (
      <section className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-line bg-white p-6 text-center text-sm font-semibold text-muted shadow-soft sm:p-8">
          Checking your session...
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-md">
      <div className="mb-8 text-center">
        <Logo />
      </div>

      <div className="rounded-2xl border border-line bg-white p-6 shadow-soft sm:p-8">
        <div className="grid grid-cols-2 rounded-xl border border-line bg-canvas p-1">
          {(["login", "signup"] as AuthMode[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => switchMode(tab)}
              className={`h-10 rounded-lg text-sm font-semibold transition-colors ${
                mode === tab ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              {tab === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <div className="mt-8">
          <h1 className="text-2xl font-semibold tracking-normal text-ink">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            Access your RegSpan workspace for evidence review, findings, and reports.
          </p>
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
          {isSignup ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-ink">First name</span>
                <input
                  value={values.firstName}
                  onChange={(event) => updateField("firstName", event.target.value)}
                  type="text"
                  autoComplete="given-name"
                  placeholder="First"
                  className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-ink">Last name</span>
                <input
                  value={values.lastName}
                  onChange={(event) => updateField("lastName", event.target.value)}
                  type="text"
                  autoComplete="family-name"
                  placeholder="Last"
                  className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
                />
              </label>
            </div>
          ) : null}

          <label className="block">
            <span className="text-sm font-semibold text-ink">Email</span>
            <input
              value={values.email}
              onChange={(event) => updateField("email", event.target.value)}
              type="email"
              autoComplete="email"
              placeholder="you@firm.com"
              className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </label>

          <label className="block">
            <span className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-ink">Password</span>
              {!isSignup ? (
                <Link href="/auth/forgot-password" className="text-xs font-semibold text-accent hover:text-[#115441]">
                  Forgot password?
                </Link>
              ) : null}
            </span>
            <input
              value={values.password}
              onChange={(event) => updateField("password", event.target.value)}
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              placeholder="Enter password"
              className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
            />
          </label>

          {isSignup ? (
            <label className="block">
              <span className="text-sm font-semibold text-ink">Confirm password</span>
              <input
                value={values.confirmPassword}
                onChange={(event) => updateField("confirmPassword", event.target.value)}
                type="password"
                autoComplete="new-password"
                placeholder="Confirm password"
                className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
              />
            </label>
          ) : null}

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
            {isSubmitting
              ? isSignup
                ? "Creating account..."
                : "Logging in..."
              : isSignup
                ? "Create account"
                : "Log in"}
          </Button>
        </form>

        <div className="mt-6 text-center">
          <Link href="/" className="text-sm font-semibold text-accent hover:text-[#115441]">
            Back to home
          </Link>
        </div>
      </div>
    </section>
  );
}
