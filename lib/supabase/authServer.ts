import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseRuntimeEnvironment } from "@/lib/supabase/runtimeEnvironment";

export async function getServerSupabaseAuthClient() {
  const { url: supabaseUrl, anonKey } = getSupabaseRuntimeEnvironment();

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase Auth server environment variables are missing.");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always set cookies. Middleware handles refreshes.
        }
      },
    },
  });
}
