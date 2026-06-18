import Link from "next/link";

type LogoProps = {
  href?: string;
};

export function Logo({ href = "/" }: LogoProps) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5 text-lg font-semibold text-ink">
      <span className="grid size-9 place-items-center rounded-xl border border-[#b9d8cb] bg-accent-soft text-sm font-bold text-accent">
        R
      </span>
      <span>RegSpan</span>
    </Link>
  );
}
