import "server-only";

type SupabaseRuntimeEnvironment = Record<string, string | undefined>;

export function getSupabaseRuntimeEnvironment(
  environment: SupabaseRuntimeEnvironment = process.env,
) {
  return {
    url: environment.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "",
    anonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "",
    serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
  };
}
