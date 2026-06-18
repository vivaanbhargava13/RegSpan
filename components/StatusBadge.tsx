type StatusBadgeProps = {
  children: string;
};

const statusClasses: Record<string, string> = {
  Complete: "bg-accent-soft text-accent border-[#cce5da]",
  Uploaded: "bg-canvas text-muted border-line",
  Processed: "bg-accent-soft text-accent border-[#cce5da]",
  Queued: "bg-canvas text-muted border-line",
  Processing: "bg-[#fff6e8] text-warning border-[#f1dfbd]",
  Failed: "bg-[#fff0f0] text-danger border-[#efd1d1]",
  Partial: "bg-[#fff6e8] text-warning border-[#f1dfbd]",
  "Needs Review": "bg-[#fff6e8] text-warning border-[#f1dfbd]",
  "Requires Review": "bg-[#fff6e8] text-warning border-[#f1dfbd]",
  Missing: "bg-[#fff0f0] text-danger border-[#efd1d1]",
  High: "bg-[#fff0f0] text-danger border-[#efd1d1]",
  Medium: "bg-[#fff6e8] text-warning border-[#f1dfbd]",
  Draft: "bg-canvas text-muted border-line",
  Prepared: "bg-accent-soft text-accent border-[#cce5da]",
  Pending: "bg-canvas text-muted border-line",
};

export function StatusBadge({ children }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
        statusClasses[children] ?? "border-line bg-canvas text-muted"
      }`}
    >
      {children}
    </span>
  );
}
