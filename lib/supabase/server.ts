import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeEnvironment } from "@/lib/supabase/runtimeEnvironment";

export function getServerSupabaseAdminClient() {
  const { url: supabaseUrl, serviceRoleKey } = getSupabaseRuntimeEnvironment();

  console.info("[RegSpan ingestion] Supabase admin configuration", {
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasServiceRoleKey: Boolean(serviceRoleKey),
  });

  if (!supabaseUrl) {
    throw new Error(
      "Missing required server environment variable: NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Missing required server environment variable: SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
