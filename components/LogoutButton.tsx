"use client";

import { useState } from "react";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";

export function LogoutButton() {
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    const supabase = getBrowserSupabaseClient();

    if (!supabase) {
      setError("Supabase Auth is not configured.");
      return;
    }

    setError("");
    setIsLoggingOut(true);
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
      setIsLoggingOut(false);
      return;
    }

    window.location.replace("/auth");
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={isLoggingOut}
        onClick={handleLogout}
        className="h-9 rounded-xl border border-app-border bg-app-surface px-3.5 text-sm font-medium text-app-muted shadow-sm transition hover:border-app-border-strong hover:bg-app-elevated hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoggingOut ? "Logging out..." : "Log out"}
      </button>
      {error ? <p className="text-xs font-medium text-app-danger">{error}</p> : null}
    </div>
  );
}
