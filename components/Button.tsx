import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "light" | "appPrimary" | "appSecondary";
type ButtonSize = "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  href?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white shadow-sm hover:bg-[#115441] focus-visible:outline-accent",
  secondary:
    "border border-line bg-white text-ink shadow-sm hover:border-[#c6d5ce] hover:bg-canvas focus-visible:outline-accent",
  ghost: "text-muted hover:bg-canvas hover:text-ink focus-visible:outline-accent",
  light: "bg-white text-ink shadow-sm hover:bg-accent-soft focus-visible:outline-white",
  appPrimary: "bg-app-accent text-app-bg shadow-sm hover:bg-app-accent-hover focus-visible:outline-app-accent",
  appSecondary:
    "border border-app-border bg-app-surface text-app-text shadow-sm hover:border-app-border-strong hover:bg-app-elevated focus-visible:outline-app-accent",
};

const sizeClasses: Record<ButtonSize, string> = {
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    "inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
    variantClasses[variant],
    sizeClasses[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
