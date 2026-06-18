"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

type AuthMode = "login" | "signup";
type FormValues = {
  email: string;
  password: string;
  confirmPassword: string;
};

const initialValues: FormValues = {
  email: "",
  password: "",
  confirmPassword: "",
};

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [values, setValues] = useState<FormValues>(initialValues);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isSignup = mode === "signup";
  const title = useMemo(
    () => (isSignup ? "Create your RegSpan account" : "Log in to RegSpan"),
    [isSignup],
  );

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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!values.email.trim() || !values.password.trim()) {
      setError("Email and password are required.");
      setMessage("");
      return;
    }

    if (isSignup) {
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

    setError("");
    setMessage("Backend auth will be connected next.");
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
            Use your work email to continue. Authentication is a UI placeholder for now.
          </p>
        </div>

        <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
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
            <span className="text-sm font-semibold text-ink">Password</span>
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

          <Button type="submit" className="w-full">
            {isSignup ? "Create account" : "Log in"}
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
