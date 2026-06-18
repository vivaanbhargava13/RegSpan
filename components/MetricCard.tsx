type MetricCardProps = {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
};

const toneClasses: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-app-accent bg-app-accent-soft border-app-accent-soft",
  warning: "text-app-warning bg-[#3b3016] border-[#6f5420]",
  danger: "text-app-danger bg-[#411d1d] border-[#783636]",
};

export function MetricCard({ label, value, tone = "default" }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-app-border bg-app-surface p-4 shadow-app-soft">
      <p className="text-sm font-medium leading-5 text-app-muted">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-normal text-app-text">{value}</p>
        <span className={`h-2.5 w-10 rounded-full border ${toneClasses[tone]}`} />
      </div>
    </div>
  );
}
