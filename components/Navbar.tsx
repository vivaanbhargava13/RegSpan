import Link from "next/link";
import { Button } from "@/components/Button";
import { Logo } from "@/components/Logo";

const navLinks = [
  { label: "Product", href: "#product" },
  { label: "Workflow", href: "#workflow" },
  { label: "Security", href: "#security" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Logo />
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button href="/auth" variant="ghost" className="hidden sm:inline-flex">
            Log in
          </Button>
          <Button href="/auth">Get started</Button>
        </div>
      </nav>
    </header>
  );
}
