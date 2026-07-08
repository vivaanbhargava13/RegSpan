import type { ReactNode } from "react";

type AlertTone = "info" | "success" | "warning" | "danger" | "review";

type AlertProps = {
  children: ReactNode;
  className?: string;
  tone?: AlertTone;
};

const toneClasses: Record<AlertTone, string> = {
  info: "border-app-accent/20 bg-app-accent-soft text-app-accent",
  success: "border-app-success/20 bg-app-success-soft text-app-success",
  warning: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  danger: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  review: "border-app-review/20 bg-app-review-soft text-app-review",
};

export function Alert({ children, className = "", tone = "info" }: AlertProps) {
  const isAssertive = tone === "danger" || tone === "warning";

  return (
    <div
      aria-live={isAssertive ? "assertive" : "polite"}
      className={[
        "flex gap-3 rounded-lg border px-4 py-3 text-sm font-medium leading-6 shadow-app-card",
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role={isAssertive ? "alert" : "status"}
    >
      <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-current" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
