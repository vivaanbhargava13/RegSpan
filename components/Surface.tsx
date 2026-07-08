import type { HTMLAttributes, ReactNode } from "react";

type SurfaceElement = "article" | "aside" | "div" | "header" | "section";
type SurfaceVariant = "default" | "subtle" | "elevated";
type SurfacePadding = "none" | "sm" | "md" | "lg";

type SurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: SurfaceElement;
  children: ReactNode;
  padding?: SurfacePadding;
  variant?: SurfaceVariant;
};

const variantClasses: Record<SurfaceVariant, string> = {
  default: "border-app-border bg-app-surface",
  subtle: "border-app-border bg-app-elevated",
  elevated: "border-app-border-strong bg-app-shell",
};

const paddingClasses: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-5",
  lg: "p-5 lg:p-6",
};

export function Surface({
  as: Component = "div",
  children,
  className = "",
  padding = "md",
  variant = "default",
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={[
        "rounded-lg border shadow-app-card",
        variantClasses[variant],
        paddingClasses[padding],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </Component>
  );
}

export function Panel(props: SurfaceProps) {
  return <Surface {...props} variant={props.variant ?? "default"} />;
}

export function Card(props: SurfaceProps) {
  return <Surface {...props} variant={props.variant ?? "subtle"} />;
}
