"use client";

import { MetricTile } from "@/components/MetricTile";

type MetricCardProps = {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
  tooltip?: string;
  tooltipPlacement?: "top" | "bottom" | "left" | "right";
};

const metricCardTooltipAnchorClasses = "overflow-visible hover:z-50 focus-within:z-50";

export function MetricCard({ label, value, tone = "default", tooltip, tooltipPlacement }: MetricCardProps) {
  return (
    <MetricTile
      className={metricCardTooltipAnchorClasses}
      label={label}
      tone={tone}
      tooltip={tooltip}
      tooltipPlacement={tooltipPlacement}
      value={value}
    />
  );
}
