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
      className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-muted transition-colors hover:border-[#c6d5ce] hover:bg-canvas hover:text-ink"
    >
      Log out
    </button>
  );
}
