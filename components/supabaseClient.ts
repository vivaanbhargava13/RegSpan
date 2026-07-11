import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

function runtimeConfiguration() {
  if (typeof document === "undefined") return null;
  const supabaseUrl = document.documentElement.dataset.supabaseUrl?.trim();
  const supabaseAnonKey = document.documentElement.dataset.supabaseAnonKey?.trim();
  return supabaseUrl && supabaseAnonKey ? { supabaseUrl, supabaseAnonKey } : null;
}

export function isSupabaseConfigured() {
  return runtimeConfiguration() !== null;
}

export function getBrowserSupabaseClient() {
  const configuration = runtimeConfiguration();
  if (!configuration) return null;

  if (!browserClient) {
    browserClient = createBrowserClient(
      configuration.supabaseUrl,
      configuration.supabaseAnonKey,
    );
  }

  return browserClient;
}
