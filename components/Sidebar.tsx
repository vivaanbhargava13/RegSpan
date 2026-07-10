"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

export const appNavLinks = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Documents", href: "/documents", icon: "documents" },
  { label: "Requirements", href: "/controls", icon: "requirements" },
  { label: "Analysis", href: "/findings", icon: "analysis" },
  { label: "Reports", href: "/reports", icon: "reports" },
  { label: "Evidence Search", href: "/retrieval-debug", icon: "retrieval" },
  { label: "Internal Debug", href: "/requirement-debug", icon: "matching" },
  { label: "Settings", href: "/settings", icon: "settings" },
];

const primaryNavLinks = appNavLinks.filter((link) => link.icon !== "settings" && link.href !== "/reports");
const administrationNavLinks = appNavLinks.filter((link) => link.icon === "settings");
const internalDebugHrefs = new Set(["/retrieval-debug", "/requirement-debug"]);

export function getVisiblePrimaryNavLinks(showInternalDebugLinks = false) {
  return showInternalDebugLinks
    ? primaryNavLinks
    : primaryNavLinks.filter((link) => !internalDebugHrefs.has(link.href));
}

export function getVisibleMobileNavLinks(showInternalDebugLinks = false) {
  return [...getVisiblePrimaryNavLinks(showInternalDebugLinks), ...administrationNavLinks];
}

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
      {icon === "analysis" ? (
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
      {icon === "matching" ? (
        <>
          <path d="M4.75 6.25h6.5" />
          <path d="M4.75 12h5" />
          <path d="M4.75 17.75h6.5" />
          <path d="m14.25 6.25 1.75 1.75 3.25-3.25" />
          <path d="m14.25 17.75 1.75 1.75 3.25-3.25" />
          <circle cx="16.75" cy="12" r="2.75" />
        </>
      ) : null}
      {icon === "settings" ? (
        <>
          <path d="M10.55 4.25h2.9l.55 2.35c.45.17.88.42 1.28.74l2.32-.72 1.45 2.51-1.78 1.63c.04.24.06.49.06.74s-.02.5-.06.74l1.78 1.63-1.45 2.51-2.32-.72c-.4.32-.83.57-1.28.74l-.55 2.35h-2.9L10 16.4a5.6 5.6 0 0 1-1.28-.74l-2.32.72-1.45-2.51 1.78-1.63a4.52 4.52 0 0 1-.06-.74c0-.25.02-.5.06-.74L4.95 9.13 6.4 6.62l2.32.72c.4-.32.83-.57 1.28-.74l.55-2.35Z" />
          <circle cx="12" cy="11.5" r="2.55" />
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
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-4 focus-visible:ring-app-accent-soft ${
                isActive
                  ? "bg-app-accent-soft text-app-accent ring-1 ring-app-accent/15"
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
                    ? "bg-app-shell text-app-accent"
                    : "text-app-subtle group-hover:text-app-text"
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

export function Sidebar({
  showInternalDebugLinks = false,
}: {
  showInternalDebugLinks?: boolean;
}) {
  const visiblePrimaryNavLinks = getVisiblePrimaryNavLinks(showInternalDebugLinks);

  return (
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col border-r border-app-border bg-app-shell px-4 py-4 md:flex">
      <div className="rounded-lg border border-app-border bg-app-surface p-2">
        <Logo href="/dashboard" tone="dark" className="w-full px-1 py-1" showTagline />
      </div>

      <div className="mt-6 space-y-6">
        <NavGroup label="Workspace" links={visiblePrimaryNavLinks} />
        <div className="h-px bg-app-border/70" />
        <NavGroup label="Administration" links={administrationNavLinks} />
      </div>

      <div className="mt-auto pb-3">
        <div className="rounded-lg border border-app-border bg-app-elevated/70 p-3">
          <div className="flex items-start gap-3">
            <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-md border border-app-success/20 bg-app-success-soft text-app-success">
              <span className="size-1.5 rounded-full bg-app-success" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-app-text">
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
