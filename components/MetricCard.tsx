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
  default: "text-app-accent bg-app-accent-soft border-app-accent-soft",
  warning: "text-app-warning bg-app-warning-soft border-app-warning-soft",
  danger: "text-app-danger bg-app-danger-soft border-app-danger-soft",
};

export function MetricCard({ label, value, tone = "default", tooltip, tooltipPlacement }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-app-soft">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-5 text-app-muted">{label}</p>
        {tooltip ? (
          <InfoTooltip preferredPlacement={tooltipPlacement}>
            {tooltip}
          </InfoTooltip>
        ) : null}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-normal text-app-text">{value}</p>
        <span className={`h-2.5 w-10 rounded-full border ${toneClasses[tone]}`} />
      </div>
    </div>
  );
}
