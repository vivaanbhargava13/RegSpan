import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  href?: string;
  tone?: "light" | "dark";
  variant?: "full" | "mark";
};

export function Logo({ href = "/", tone = "light", variant = "full" }: LogoProps) {
  const isDark = tone === "dark";

  return (
    <Link
      href={href}
      aria-label="RegSpan"
      className={`inline-flex items-center gap-2.5 text-lg font-semibold ${
        isDark ? "text-app-text" : "text-ink"
      }`}
    >
      <span
        className={`grid size-9 place-items-center rounded-xl border ${
          isDark
            ? "border-app-border-strong bg-app-accent-soft"
            : "border-line bg-white"
        }`}
      >
        <Image
          src="/brand/regspan-mark.png"
          alt=""
          width={27}
          height={27}
          aria-hidden="true"
          className="h-7 w-7 object-contain"
          priority
        />
      </span>
      {variant === "full" ? <span>RegSpan</span> : null}
    </Link>
  );
}
