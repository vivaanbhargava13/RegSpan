import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { getSupabaseRuntimeEnvironment } from "@/lib/supabase/runtimeEnvironment";
import "./globals.css";

// Per-request CSP nonces require request-time rendering so Next.js can apply
// the proxy-provided nonce to framework scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RegSpan | Reg S-P Evidence Mapping",
  description: "AI-assisted Reg S-P evidence mapping for financial firms.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabaseRuntimeEnvironment();
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      data-supabase-url={supabaseUrl || undefined}
      data-supabase-anon-key={supabaseAnonKey || undefined}
    >
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
