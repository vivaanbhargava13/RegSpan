import type { ReactNode } from "react";

type EmptyStateProps = {
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  eyebrow?: string;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({
  action,
  children,
  className = "",
  eyebrow,
  icon,
  title,
}: EmptyStateProps) {
  return (
    <div className={["app-empty-state", className].filter(Boolean).join(" ")}>
      {icon ? (
        <div className="mx-auto mb-4 grid size-10 place-items-center rounded-lg border border-app-border bg-app-elevated text-app-muted">
          {icon}
        </div>
      ) : null}
      {eyebrow ? (
        <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-app-subtle">
          {eyebrow}
        </p>
      ) : null}
      <h2 className={eyebrow ? "mt-2 text-base font-semibold text-app-text" : "text-base font-semibold text-app-text"}>
        {title}
      </h2>
      {children ? (
        <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-app-muted">
          {children}
        </div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
