type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "review";

type StatusBadgeProps = {
  children: string;
  showDot?: boolean;
  tone?: BadgeTone;
};

type SemanticBadgeProps = {
  label?: string;
  value: string | null | undefined;
};

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border-app-border bg-app-elevated text-app-muted",
  accent: "border-app-accent/20 bg-app-accent-soft text-app-accent",
  success: "border-app-success/20 bg-app-success-soft text-app-success",
  warning: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  danger: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  review: "border-app-review/20 bg-app-review-soft text-app-review",
};

const statusToneByLabel: Record<string, BadgeTone> = {
  complete: "success",
  completed: "success",
  covered: "success",
  prepared: "success",
  processed: "success",
  ready: "success",
  uploaded: "neutral",
  draft: "neutral",
  pending: "neutral",
  queued: "accent",
  running: "accent",
  processing: "warning",
  partial: "warning",
  medium: "warning",
  "medium risk": "warning",
  failed: "danger",
  missing: "danger",
  high: "danger",
  critical: "danger",
  "high risk": "danger",
  "critical risk": "danger",
  "needs review": "review",
  "requires review": "review",
  "team review": "review",
  low: "review",
  "low risk": "review",
};

function humanize(value: string | null | undefined) {
  return (value ?? "unknown")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function inferredTone(label: string) {
  return statusToneByLabel[normalized(label)] ?? "neutral";
}

export function StatusBadge({ children, showDot = true, tone }: StatusBadgeProps) {
  const toneClass = toneClasses[tone ?? inferredTone(children)];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold leading-none tracking-[0.01em] ${toneClass}`}
    >
      {showDot ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current opacity-75" /> : null}
      {children}
    </span>
  );
}

export function RiskBadge({ label, value }: SemanticBadgeProps) {
  const displayLabel = label ?? `${humanize(value)} risk`;
  const risk = normalized(value ?? "");
  const tone: BadgeTone = risk === "critical" || risk === "high"
    ? "danger"
    : risk === "medium"
      ? "warning"
      : risk === "low"
        ? "review"
        : "neutral";

  return <StatusBadge tone={tone}>{displayLabel}</StatusBadge>;
}

export function LifecycleBadge({ label, value }: SemanticBadgeProps) {
  return <StatusBadge>{label ?? humanize(value)}</StatusBadge>;
}

export function RunStatusBadge({ label, value }: SemanticBadgeProps) {
  return <StatusBadge>{label ?? humanize(value)}</StatusBadge>;
}
