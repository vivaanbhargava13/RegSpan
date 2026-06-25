import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  href?: string;
  tone?: "light" | "dark";
  variant?: "full" | "mark";
  className?: string;
  showTagline?: boolean;
};

export function Logo({
  href = "/",
  tone = "light",
  variant = "full",
  className = "",
  showTagline = false,
}: LogoProps) {
  const isDark = tone === "dark";

  return (
    <Link
      href={href}
      aria-label="RegSpan"
      className={`group inline-flex items-center gap-3 rounded-2xl outline-none transition focus-visible:ring-4 focus-visible:ring-app-accent-soft ${
        isDark ? "text-app-text" : "text-ink"
      } ${className}`}
    >
      <span
        className={`grid size-10 place-items-center rounded-[15px] border shadow-sm transition duration-200 group-hover:scale-[1.02] ${
          isDark
            ? "border-app-accent/20 bg-app-accent-soft shadow-app-card"
            : "border-line bg-white shadow-app-card"
        }`}
      >
        <Image
          src="/brand/regspan-mark.png"
          alt=""
          width={29}
          height={29}
          aria-hidden="true"
          className="h-[29px] w-[29px] object-contain"
          priority
        />
      </span>
      {variant === "full" ? (
        <span className="flex flex-col leading-none">
          <span className="text-[20px] font-bold tracking-[-0.045em] text-app-text">
            RegSpan
          </span>
          {showTagline ? (
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-app-subtle">
              Compliance OS
            </span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}
