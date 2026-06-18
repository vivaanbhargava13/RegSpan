type StatusBadgeProps = {
  children: string;
};

const statusClasses: Record<string, string> = {
  Complete: "bg-app-accent-soft text-app-success border-app-accent-soft",
  Uploaded: "bg-app-elevated text-app-muted border-app-border",
  Processed: "bg-app-accent-soft text-app-success border-app-accent-soft",
  Queued: "bg-app-elevated text-app-muted border-app-border",
  Processing: "bg-[#3b3016] text-app-warning border-[#6f5420]",
  Failed: "bg-[#411d1d] text-app-danger border-[#783636]",
  Partial: "bg-[#3b3016] text-app-warning border-[#6f5420]",
  "Needs Review": "bg-[#3b3016] text-app-warning border-[#6f5420]",
  "Requires Review": "bg-[#3b3016] text-app-warning border-[#6f5420]",
  Missing: "bg-[#411d1d] text-app-danger border-[#783636]",
  High: "bg-[#411d1d] text-app-danger border-[#783636]",
  Medium: "bg-[#3b3016] text-app-warning border-[#6f5420]",
  Draft: "bg-app-elevated text-app-muted border-app-border",
  Prepared: "bg-app-accent-soft text-app-success border-app-accent-soft",
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
