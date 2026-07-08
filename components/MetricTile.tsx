"use client";

import { InfoTooltip } from "@/components/InfoTooltip";

type MetricTone = "default" | "success" | "warning" | "danger" | "review";

type MetricTileProps = {
  label: string;
  value: string;
  className?: string;
  tone?: MetricTone;
  tooltip?: string;
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
};

const toneClasses: Record<MetricTone, string> = {
  default: "bg-app-accent",
  success: "bg-app-success",
  warning: "bg-app-warning",
  danger: "bg-app-danger",
  review: "bg-app-review",
};

export function MetricTile({
  className = "",
  label,
  tone = "default",
  tooltip,
  tooltipPlacement,
  value,
}: MetricTileProps) {
  return (
    <div
      className={[
        "metric-card app-card group relative z-0 min-h-[124px] overflow-visible p-4 hover:z-50 focus-within:z-50 lg:p-5",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className={`absolute inset-y-4 left-0 w-0.5 rounded-r-full ${toneClasses[tone]}`} />
      <div className="flex items-start justify-between gap-3 pl-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-app-subtle">{label}</p>
        {tooltip ? (
          <InfoTooltip preferredPlacement={tooltipPlacement}>
            {tooltip}
          </InfoTooltip>
        ) : null}
      </div>
      <p className="mt-4 pl-2 text-3xl font-semibold tracking-[-0.02em] text-app-text">{value}</p>
    </div>
  );
}
