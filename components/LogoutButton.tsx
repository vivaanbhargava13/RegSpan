"use client";

import { useRouter } from "next/navigation";
import { clearDemoSession } from "@/components/demoAuth";

export function LogoutButton() {
  const router = useRouter();

  function handleLogout() {
    // Temporary demo auth only. Replace with provider logout when backend auth lands.
    clearDemoSession();
    router.replace("/auth");
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="h-9 rounded-lg border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-muted transition-colors hover:border-app-accent hover:bg-app-elevated hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
    >
      Log out
    </button>
  );
}
