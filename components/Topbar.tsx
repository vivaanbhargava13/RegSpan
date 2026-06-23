"use client";

import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { appNavLinks } from "@/components/Sidebar";

type TopbarProps = {
  session: Session;
  workspaceName: string;
};

function getDisplayName(session: Session) {
  const metadata = session.user.user_metadata;
  const fullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  const firstName = typeof metadata.first_name === "string" ? metadata.first_name.trim() : "";
  const lastName = typeof metadata.last_name === "string" ? metadata.last_name.trim() : "";
  const emailName = session.user.email?.split("@")[0]?.replace(/[._-]+/g, " ");

  return fullName || [firstName, lastName].filter(Boolean).join(" ") || emailName || "Reviewer";
}

export function Topbar({ session, workspaceName }: TopbarProps) {
  const pathname = usePathname();
  const displayName = getDisplayName(session);

  return (
    <header className="sticky top-0 z-10 border-b border-app-border bg-app-shell/90 backdrop-blur">
      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-semibold text-app-text">{workspaceName}</p>
            <span className="rounded-full border border-app-border-strong bg-app-accent-soft px-2.5 py-1 text-xs font-semibold text-app-accent">
              Workspace
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-app-muted">
            {displayName} · {session.user.email || "Authenticated user"}
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
                isActive ? "bg-app-accent-soft text-app-accent" : "text-app-muted"
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
