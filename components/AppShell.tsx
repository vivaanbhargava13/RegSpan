"use client";

import type { Session } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";
import { useThemePreference } from "@/components/themePreference";
import { Topbar } from "@/components/Topbar";
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspaces";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const { theme } = useThemePreference();
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<CurrentWorkspace | null>(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();

    if (!supabase) {
      setIsCheckingSession(false);
      window.location.replace("/auth");
      return;
    }

    let isMounted = true;
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isMounted) {
          return;
        }

        setSession(nextSession);
        setIsCheckingSession(false);

        if (!nextSession) {
          window.location.replace("/auth");
        }
      },
    );

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) {
        return;
      }

      const nextSession = error ? null : data.session;
      setSession(nextSession);
      setIsCheckingSession(false);

      if (!nextSession) {
        window.location.replace("/auth");
      }
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setWorkspace(null);
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      return;
    }

    let isMounted = true;
    setWorkspaceError("");

    void getCurrentWorkspace(supabase, session.user.id)
      .then((currentWorkspace) => {
        if (isMounted) {
          setWorkspace(currentWorkspace);
        }
      })
      .catch((error: unknown) => {
        if (isMounted) {
          setWorkspaceError(
            error instanceof Error ? error.message : "Unable to load your workspace.",
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, [session]);

  if (isCheckingSession || !session) {
    return (
      <main data-theme={theme} className="flex min-h-screen items-center justify-center bg-app-bg px-6">
        <div className="rounded-2xl border border-app-border bg-app-shell px-6 py-5 text-sm font-semibold text-app-muted shadow-app-soft">
          {isCheckingSession ? "Checking your session..." : "Redirecting to login..."}
        </div>
      </main>
    );
  }

  if (workspaceError) {
    return (
      <main data-theme={theme} className="flex min-h-screen items-center justify-center bg-app-bg px-6">
        <div className="max-w-lg rounded-2xl border border-app-danger-soft bg-app-shell px-6 py-5 text-sm font-semibold text-app-danger shadow-app-soft">
          {workspaceError}
        </div>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main data-theme={theme} className="flex min-h-screen items-center justify-center bg-app-bg px-6">
        <div className="rounded-2xl border border-app-border bg-app-shell px-6 py-5 text-sm font-semibold text-app-muted shadow-app-soft">
          Loading your workspace...
        </div>
      </main>
    );
  }

  return (
    <div data-theme={theme} className="min-h-screen bg-app-bg text-app-text">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <Topbar session={session} workspaceName={workspace.name} />
          <main className="w-full px-4 py-8 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
