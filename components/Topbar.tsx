"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSessionDisplayName, type DemoSession } from "@/components/demoAuth";
import { LogoutButton } from "@/components/LogoutButton";
import { appNavLinks } from "@/components/Sidebar";

type TopbarProps = {
  session: DemoSession;
};

export function Topbar({ session }: TopbarProps) {
  const pathname = usePathname();
  const displayName = getSessionDisplayName(session);

  return (
    <header className="sticky top-0 z-10 border-b border-app-border bg-app-bg/90 backdrop-blur">
      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-app-text">{session.workspaceName}</p>
            <span className="rounded-full border border-app-border bg-app-elevated px-2.5 py-1 text-xs font-semibold text-app-accent">
              Demo workspace
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-app-muted">
            {displayName} · {session.email}
          </p>
        </div>
        <LogoutButton />
      </div>
      <nav className="flex gap-2 overflow-x-auto border-t border-app-border px-4 py-2 md:hidden">
        {appNavLinks.map((link) => {
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${
                isActive ? "bg-app-elevated text-app-accent" : "text-app-muted"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
