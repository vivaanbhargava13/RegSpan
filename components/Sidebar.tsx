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
  { label: "Retrieval", href: "/retrieval-debug", icon: "retrieval" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

const primaryNavLinks = appNavLinks.filter((link) => link.icon !== "settings");
const administrationNavLinks = appNavLinks.filter((link) => link.icon === "settings");

function NavIcon({ icon }: { icon: string }) {
  const iconClass = "size-[18px]";

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={iconClass}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon === "dashboard" ? (
        <>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
        </>
      ) : null}
      {icon === "documents" ? (
        <>
          <path d="M7 3.75h7.25L18 7.5v12.75H7V3.75Z" />
          <path d="M14 3.75V8h4" />
          <path d="M9.75 12.25h4.75" />
          <path d="M9.75 16h4.75" />
        </>
      ) : null}
      {icon === "requirements" ? (
        <>
          <rect x="5" y="4" width="14" height="16" rx="2" />
          <path d="m8.5 12.25 2.25 2.25 4.75-5" />
        </>
      ) : null}
      {icon === "gaps" ? (
        <>
          <path d="M12 4 3.25 19.25h17.5L12 4Z" />
          <path d="M12 9.25v4.25" />
          <path d="M12 16.75h.01" />
        </>
      ) : null}
      {icon === "reports" ? (
        <>
          <rect x="5" y="3.75" width="14" height="16.5" rx="2" />
          <path d="M9 16.25v-3" />
          <path d="M12 16.25v-7" />
          <path d="M15 16.25v-4.75" />
        </>
      ) : null}
      {icon === "retrieval" ? (
        <>
          <circle cx="10.75" cy="10.75" r="5.75" />
          <path d="m15.25 15.25 4.25 4.25" />
          <path d="M8.25 10.75h5" />
          <path d="M10.75 8.25v5" />
        </>
      ) : null}
      {icon === "settings" ? (
        <>
          <path d="M12 3.75v2.1" />
          <path d="M12 18.15v2.1" />
          <path d="m17.9 6.1-1.48 1.48" />
          <path d="m7.58 16.42-1.48 1.48" />
          <path d="M20.25 12h-2.1" />
          <path d="M5.85 12h-2.1" />
          <path d="m17.9 17.9-1.48-1.48" />
          <path d="M7.58 7.58 6.1 6.1" />
          <circle cx="12" cy="12" r="4.1" />
          <circle cx="12" cy="12" r="1.35" />
        </>
      ) : null}
    </svg>
  );
}

function NavGroup({
  label,
  links,
}: {
  label: string;
  links: typeof appNavLinks;
}) {
  const pathname = usePathname();

  return (
    <div>
      <div className="px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-app-subtle">
        {label}
      </div>
      <nav className="mt-2 space-y-1" aria-label={label}>
        {links.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);

          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold outline-none transition duration-150 focus-visible:ring-4 focus-visible:ring-app-accent-soft ${
                isActive
                  ? "bg-app-accent-soft text-app-accent shadow-sm ring-1 ring-app-accent/15"
                  : "text-app-muted hover:bg-app-elevated hover:text-app-text"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute left-0 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full transition ${
                  isActive ? "bg-app-accent opacity-100" : "bg-transparent opacity-0"
                }`}
              />
              <span
                className={`grid size-8 place-items-center rounded-lg transition ${
                  isActive
                    ? "bg-app-shell/80 text-app-accent"
                    : "text-app-subtle group-hover:bg-app-shell group-hover:text-app-text"
                }`}
              >
                <NavIcon icon={link.icon} />
              </span>
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col border-r border-app-border bg-app-shell px-4 py-5 shadow-[1px_0_0_rgb(var(--app-border)/0.35)] md:flex">
      <div className="rounded-[22px] border border-app-border bg-gradient-to-br from-app-surface to-app-elevated p-3 shadow-app-card">
        <Logo href="/dashboard" tone="dark" className="w-full px-1 py-1" showTagline />
      </div>

      <div className="mt-7 space-y-7">
        <NavGroup label="Workspace" links={primaryNavLinks} />
        <div className="h-px bg-app-border/70" />
        <NavGroup label="Administration" links={administrationNavLinks} />
      </div>

      <div className="mt-auto pb-3">
        <div className="rounded-[22px] border border-app-border bg-app-elevated/80 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-app-success-soft text-app-success ring-1 ring-app-success/15">
              <span className="size-2 rounded-full bg-app-success" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-[-0.01em] text-app-text">
                Protected workspace
              </div>
              <p className="mt-1.5 text-xs leading-5 text-app-subtle">
                Private storage, scoped access, and background processing stay isolated to this workspace.
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
