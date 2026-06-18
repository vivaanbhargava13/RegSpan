import Link from "next/link";
import { Logo } from "@/components/Logo";

const links = [
  { label: "Product", href: "#product" },
  { label: "Security", href: "#security" },
  { label: "Workflow", href: "#workflow" },
  { label: "Login", href: "/auth" },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-white px-6 py-10 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">
            AI-assisted Reg S-P evidence mapping for financial firms, built for review workflows and cited reporting.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted transition-colors hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
