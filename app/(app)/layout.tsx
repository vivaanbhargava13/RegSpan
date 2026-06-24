import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getServerSupabaseAuthClient } from "@/lib/supabase/authServer";

export default async function ProtectedAppLayout({ children }: { children: ReactNode }) {
  const supabase = await getServerSupabaseAuthClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/auth");
  }

  return <AppShell>{children}</AppShell>;
}
