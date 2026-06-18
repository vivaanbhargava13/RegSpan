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
    <aside className="hidden min-h-screen w-64 shrink-0 border-r border-line bg-white px-4 py-5 md:block">
      <Logo href="/dashboard" />
      <nav className="mt-8 space-y-1">
        {appNavLinks.map((link) => {
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
                isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-canvas hover:text-ink"
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
