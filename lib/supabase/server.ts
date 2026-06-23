import "server-only";

import { createClient } from "@supabase/supabase-js";

export function getServerSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

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
