type StatusBadgeProps = {
  children: string;
};

const statusClasses: Record<string, string> = {
  Complete: "bg-app-success-soft text-app-success border-app-success-soft",
  Uploaded: "bg-app-success-soft text-app-success border-app-success-soft",
  Processed: "bg-app-success-soft text-app-success border-app-success-soft",
  Queued: "bg-app-accent-soft text-app-accent border-app-accent-soft",
  Processing: "bg-app-warning-soft text-app-warning border-app-warning-soft",
  Failed: "bg-app-danger-soft text-app-danger border-app-danger-soft",
  Partial: "bg-app-warning-soft text-app-warning border-app-warning-soft",
  "Needs Review": "bg-app-warning-soft text-app-warning border-app-warning-soft",
  "Requires Review": "bg-app-warning-soft text-app-warning border-app-warning-soft",
  Missing: "bg-app-danger-soft text-app-danger border-app-danger-soft",
  High: "bg-app-danger-soft text-app-danger border-app-danger-soft",
  Medium: "bg-app-warning-soft text-app-warning border-app-warning-soft",
  Draft: "bg-app-elevated text-app-muted border-app-border",
  Prepared: "bg-app-success-soft text-app-success border-app-success-soft",
  Pending: "bg-app-elevated text-app-muted border-app-border",
};

export function StatusBadge({ children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        statusClasses[children] ?? "border-app-border bg-app-elevated text-app-muted"
      }`}
    >
      {children}
    </span>
  );
}
