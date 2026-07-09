"use client";

import { Button } from "@/components/Button";
import { Surface } from "@/components/Surface";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useThemePreference } from "@/components/themePreference";

export function AppearanceSettings() {
  const { theme, resetTheme } = useThemePreference();

  return (
    <Surface as="section" className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-app-subtle">
            Appearance
          </p>
          <h2 className="mt-1 text-base font-semibold text-app-text">Interface theme</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
            Choose the interface theme for this browser. Light mode remains the default review workspace.
          </p>
          <p className="mt-3 text-xs font-semibold text-app-subtle">
            Current theme: <span className="font-semibold capitalize text-app-text">{theme}</span>
          </p>
        </div>
        <ThemeToggle showLabel />
      </div>
      <div className="border-t border-app-border pt-4">
        <Button type="button" variant="appSecondary" onClick={resetTheme}>
          Reset to default
        </Button>
      </div>
    </Surface>
  );
}
