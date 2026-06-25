type StatusBadgeProps = {
  children: string;
};

const statusClasses: Record<string, string> = {
  Complete: "border-app-success/20 bg-app-success-soft text-app-success",
  Uploaded: "border-app-border bg-app-elevated text-app-muted",
  Processed: "border-app-success/20 bg-app-success-soft text-app-success",
  Queued: "border-app-accent/20 bg-app-accent-soft text-app-accent",
  Processing: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  Failed: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  Partial: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  "Needs Review": "border-app-review/20 bg-app-review-soft text-app-review",
  "Requires Review": "border-app-review/20 bg-app-review-soft text-app-review",
  Missing: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  High: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  Medium: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  Draft: "bg-app-elevated text-app-muted border-app-border",
  Prepared: "border-app-success/20 bg-app-success-soft text-app-success",
  Pending: "bg-app-elevated text-app-muted border-app-border",
};

export function StatusBadge({ children }: StatusBadgeProps) {
  const toneClass = statusClasses[children] ?? "border-app-border bg-app-elevated text-app-muted";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[0.01em] ${toneClass}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-75" />
      {children}
    </span>
  );
}
