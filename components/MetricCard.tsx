type MetricCardProps = {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
};

const toneClasses: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  default: "text-accent bg-accent-soft border-[#cce5da]",
  warning: "text-warning bg-[#fff6e8] border-[#f1dfbd]",
  danger: "text-danger bg-[#fff0f0] border-[#efd1d1]",
};

export function MetricCard({ label, value, tone = "default" }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <p className="text-sm font-medium leading-5 text-muted">{label}</p>
      <div className="mt-4 flex items-end justify-between gap-3">
        <p className="text-3xl font-semibold tracking-normal text-ink">{value}</p>
        <span className={`h-2.5 w-10 rounded-full border ${toneClasses[tone]}`} />
      </div>
    </div>
  );
}
