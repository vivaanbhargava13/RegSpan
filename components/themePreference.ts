"use client";

import { useEffect, useState } from "react";

export type ThemePreference = "dark" | "light";

const THEME_STORAGE_KEY = "regspan.theme";
const THEME_CHANGE_EVENT = "regspan-theme-change";
const DEFAULT_THEME: ThemePreference = "light";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light";
}

export function getThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(storedTheme) ? storedTheme : DEFAULT_THEME;
}

export function setThemePreference(theme: ThemePreference) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

export function resetThemePreference() {
  window.localStorage.removeItem(THEME_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: DEFAULT_THEME }));
}

export function useThemePreference() {
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_THEME);

  useEffect(() => {
    setTheme(getThemePreference());

    function syncTheme(event: Event) {
      if (event instanceof CustomEvent && isThemePreference(event.detail)) {
        setTheme(event.detail);
        return;
      }

      setTheme(getThemePreference());
    }

    window.addEventListener(THEME_CHANGE_EVENT, syncTheme);
    window.addEventListener("storage", syncTheme);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme);
      window.removeEventListener("storage", syncTheme);
    };
  }, []);

  return {
    theme,
    setTheme: setThemePreference,
    resetTheme: resetThemePreference,
  };
}
