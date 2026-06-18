import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";

export default function ProtectedAppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
