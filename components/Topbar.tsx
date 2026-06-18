"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { DemoSession } from "@/components/demoAuth";
import { LogoutButton } from "@/components/LogoutButton";
import { appNavLinks } from "@/components/Sidebar";

type TopbarProps = {
  session: DemoSession;
};

export function Topbar({ session }: TopbarProps) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur">
      <div className="flex min-h-16 flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div>
          <p className="text-sm font-semibold text-ink">{session.workspaceName}</p>
          <p className="mt-1 text-xs font-medium text-muted">
            {session.displayName} · {session.email}
          </p>
        </div>
        <LogoutButton />
      </div>
      <nav className="flex gap-2 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {appNavLinks.map((link) => {
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${
                isActive ? "bg-accent-soft text-accent" : "text-muted"
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
