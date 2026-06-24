"use client";

import { useThemePreference } from "@/components/themePreference";

type ThemeToggleProps = {
  showLabel?: boolean;
};

function SunIcon({ isActive }: { isActive: boolean }) {
  return (
    <svg aria-hidden="true" className={`size-4 ${isActive ? "text-app-bg" : "text-app-subtle"}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v2.5M12 19.5V22M4.5 4.5l1.8 1.8M17.7 17.7l1.8 1.8M2 12h2.5M19.5 12H22M4.5 19.5l1.8-1.8M17.7 6.3l1.8-1.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function MoonIcon({ isActive }: { isActive: boolean }) {
  return (
    <svg aria-hidden="true" className={`size-4 ${isActive ? "text-app-bg" : "text-app-subtle"}`} viewBox="0 0 24 24" fill="none">
      <path
        d="M20 15.4A8.3 8.3 0 0 1 8.6 4a8.8 8.8 0 1 0 11.4 11.4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ThemeToggle({ showLabel = false }: ThemeToggleProps) {
  const { theme, setTheme } = useThemePreference();
  const isDark = theme === "dark";
  const nextTheme = isDark ? "light" : "dark";

  return (
    <div className="flex items-center gap-3">
      {showLabel ? (
        <span className="text-sm font-medium text-app-muted">Theme</span>
      ) : null}
      <button
        type="button"
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        onClick={() => setTheme(nextTheme)}
        className={`relative grid h-10 w-[76px] grid-cols-2 items-center rounded-xl border p-1 shadow-app-soft transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent ${
          isDark
            ? "border-app-border-strong bg-app-accent-soft"
            : "border-app-border bg-app-elevated"
        }`}
      >
        <span className="z-10 grid place-items-center">
          <SunIcon isActive={!isDark} />
        </span>
        <span className="z-10 grid place-items-center">
          <MoonIcon isActive={isDark} />
        </span>
        <span
          className={`absolute left-1 top-1 size-8 rounded-lg bg-app-accent shadow-[0_6px_16px_rgba(29,78,216,0.24)] transition-transform duration-200 ease-out ${
            isDark ? "translate-x-9" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
