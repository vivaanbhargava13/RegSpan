"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

export const appNavLinks = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Documents", href: "/documents", icon: "documents" },
  { label: "Requirements", href: "/controls", icon: "requirements" },
  { label: "Gaps", href: "/findings", icon: "gaps" },
  { label: "Reports", href: "/reports", icon: "reports" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

function NavIcon({ icon }: { icon: string }) {
  const paths: Record<string, string> = {
    dashboard: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z",
    documents: "M7 3h7l4 4v14H7V3Zm7 0v5h5M10 12h5M10 16h5",
    requirements: "m7 12 3 3 7-7M5 4h14v16H5V4Z",
    gaps: "M12 3 2.8 20h18.4L12 3Zm0 6v5m0 3v.01",
    reports: "M5 3h14v18H5V3Zm4 13v-3m3 3V8m3 8v-5",
    settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5.5 1 2.2 2.4.5 1.8-1.5 2.6 2.6-1.5 1.8.5 2.4 2.2 1-1 3.6-2.4.5-1.8 1.5-2.6 2.6-1.8-1.5-2.4.5-1 2.2H9l-1-2.2-2.4-.5-1.8 1.5-2.6-2.6 1.5-1.8-.5-2.4L0 12l1-3.6 2.4-.5 1.8-1.5 2.6-2.6 1.8 1.5 2.4-.5L12 3Z",
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[icon]} />
    </svg>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-app-border bg-app-shell px-4 py-5 md:flex">
      <div className="flex h-12 items-center px-2">
        <Logo href="/dashboard" tone="dark" />
      </div>
      <div className="mt-7 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-app-subtle">
        Workspace
      </div>
      <nav className="mt-2 space-y-1">
        {appNavLinks.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-app-accent-soft text-app-accent shadow-sm ring-1 ring-app-accent/10"
                  : "text-app-muted hover:bg-app-elevated hover:text-app-text"
              }`}
            >
              <NavIcon icon={link.icon} />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto rounded-2xl border border-app-border bg-app-elevated p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-app-text">
          <span className="size-2 rounded-full bg-app-success shadow-[0_0_0_3px_rgb(var(--app-success-soft))]" />
          Protected workspace
        </div>
        <p className="mt-2 text-xs leading-5 text-app-subtle">
          Private storage and workspace-scoped access controls are active.
        </p>
      </div>
    </aside>
  );
}
