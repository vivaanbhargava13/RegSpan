import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getServerSupabaseAuthClient } from "@/lib/supabase/authServer";

export default async function AuthPage() {
  const supabase = await getServerSupabaseAuthClient();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <AuthForm />
    </main>
  );
}
