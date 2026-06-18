"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

export const appNavLinks = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Documents", href: "/documents" },
  { label: "Controls", href: "/controls" },
  { label: "Findings", href: "/findings" },
  { label: "Reports", href: "/reports" },
  { label: "Settings", href: "/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden min-h-screen w-64 shrink-0 border-r border-app-border bg-app-surface px-4 py-5 md:block">
      <Logo href="/dashboard" tone="dark" />
      <nav className="mt-8 space-y-1">
        {appNavLinks.map((link) => {
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                isActive ? "bg-app-accent-soft text-app-accent" : "text-app-muted hover:bg-app-elevated hover:text-app-text"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
