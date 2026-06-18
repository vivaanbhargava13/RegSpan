import Link from "next/link";

type LogoProps = {
  href?: string;
  tone?: "light" | "dark";
};

export function Logo({ href = "/", tone = "light" }: LogoProps) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 text-lg font-semibold ${
        tone === "dark" ? "text-app-text" : "text-ink"
      }`}
    >
      <span
        className={`grid size-9 place-items-center rounded-xl border text-sm font-bold ${
          tone === "dark"
            ? "border-app-border-strong bg-app-accent-soft text-app-accent"
            : "border-[#b9d8cb] bg-accent-soft text-accent"
        }`}
      >
        R
      </span>
      <span>RegSpan</span>
    </Link>
  );
}
