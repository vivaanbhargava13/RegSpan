"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readDemoSession, type DemoSession } from "@/components/demoAuth";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const router = useRouter();
  const [session, setSession] = useState<DemoSession | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    // Temporary demo auth only. Replace this client guard with real protected routing later.
    const demoSession = readDemoSession();

    if (!demoSession) {
      router.replace("/auth");
      return;
    }

    setSession(demoSession);
    setIsCheckingSession(false);
  }, [router]);

  if (isCheckingSession || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
        <div className="rounded-2xl border border-line bg-white px-6 py-5 text-sm font-semibold text-muted shadow-soft">
          Checking demo workspace...
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <Topbar session={session} />
          <main className="mx-auto w-full max-w-7xl px-4 py-8 lg:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
