"use client";

import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { getVisibleMobileNavLinks } from "@/components/Sidebar";

type TopbarProps = {
  session: Session;
  showInternalDebugLinks?: boolean;
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

export function Topbar({ session, showInternalDebugLinks = false, workspaceName }: TopbarProps) {
  const pathname = usePathname();
  const displayName = getDisplayName(session);
  const visibleMobileNavLinks = getVisibleMobileNavLinks(showInternalDebugLinks);
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <header className="sticky top-0 z-20 border-b border-app-border bg-app-shell/95 shadow-app-border backdrop-blur">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-app-subtle">
            <span className="text-app-muted">RegSpan</span>
            <span aria-hidden="true">/</span>
            <span className="truncate text-app-muted">{workspaceName}</span>
          </div>
          <p className="mt-1 truncate text-sm font-semibold tracking-[-0.01em] text-app-text">
            Compliance review workspace
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 border-r border-app-border pr-4 sm:flex">
            <span className="grid size-8 place-items-center rounded-lg border border-app-accent/15 bg-app-accent-soft text-xs font-bold text-app-accent">
              {initials || "R"}
            </span>
            <div className="max-w-48 leading-tight">
              <p className="truncate text-sm font-semibold text-app-text">{displayName}</p>
              <p className="mt-0.5 truncate text-xs text-app-subtle">{session.user.email || "Authenticated user"}</p>
            </div>
          </div>
          <LogoutButton />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-app-border px-4 py-2 md:hidden" aria-label="Mobile navigation">
        {visibleMobileNavLinks.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-4 focus-visible:ring-app-accent-soft ${
                isActive
                  ? "bg-app-accent-soft text-app-accent ring-1 ring-app-accent/10"
                  : "text-app-muted hover:bg-app-elevated hover:text-app-text"
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
