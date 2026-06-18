"use client";

import { ThemeToggle } from "@/components/ThemeToggle";
import { useThemePreference } from "@/components/themePreference";

export function AppearanceSettings() {
  const { theme, resetTheme } = useThemePreference();

  return (
    <article className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-app-text">Appearance</h2>
          <p className="mt-3 text-sm leading-6 text-app-muted">
            Choose a product theme for the authenticated workspace. Dark mode remains the default.
          </p>
          <p className="mt-4 text-sm font-medium text-app-subtle">
            Current theme: <span className="font-semibold capitalize text-app-text">{theme}</span>
          </p>
        </div>
        <ThemeToggle showLabel />
      </div>
      <div className="mt-5">
        <button
          type="button"
          onClick={resetTheme}
          className="h-10 rounded-lg border border-app-border bg-app-elevated px-4 text-sm font-semibold text-app-muted transition-colors hover:border-app-border-strong hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
        >
          Reset to default
        </button>
      </div>
    </article>
  );
}
