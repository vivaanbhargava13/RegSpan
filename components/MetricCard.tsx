"use client";

import { InfoTooltip } from "@/components/InfoTooltip";

type MetricCardProps = {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
  tooltip?: string;
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
};

const toneClasses: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "bg-app-accent",
  warning: "bg-app-warning",
  danger: "bg-app-danger",
};

export function MetricCard({ label, value, tone = "default", tooltip, tooltipPlacement }: MetricCardProps) {
  return (
    <div className="metric-card app-card group relative z-0 min-h-[148px] overflow-visible p-5 hover:z-50 focus-within:z-50">
      <span aria-hidden="true" className={`absolute left-5 top-0 h-[3px] w-12 rounded-b-full opacity-85 ${toneClasses[tone]}`} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-semibold leading-5 text-app-muted">{label}</p>
        {tooltip ? (
          <InfoTooltip preferredPlacement={tooltipPlacement}>
            {tooltip}
          </InfoTooltip>
        ) : null}
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        <p className="text-[32px] font-semibold tracking-[-0.04em] text-app-text">{value}</p>
        <span aria-hidden="true" className="mb-1 flex h-1.5 w-11 overflow-hidden rounded-full bg-app-elevated ring-1 ring-inset ring-app-border">
          <span className={`h-full w-7 rounded-full opacity-80 ${toneClasses[tone]}`} />
        </span>
      </div>
    </div>
  );
}
