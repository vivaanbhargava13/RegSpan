import { MetricCard } from "@/components/MetricCard";

const metrics = [
  { label: "Reg S-P Readiness", value: "72%" },
  { label: "High-Risk Analysis", value: "4", tone: "danger" as const },
  { label: "Controls Requiring Review", value: "12", tone: "warning" as const },
  { label: "Documents Processed", value: "6" },
  { label: "Open Remediation Tasks", value: "9", tone: "warning" as const },
];

const rows = [
  {
    control: "Incident Response Program",
    status: "Partial",
    evidence: "2 citations",
    risk: "High",
  },
  {
    control: "Service Provider Notice",
    status: "Missing",
    evidence: "No evidence",
    risk: "High",
  },
  {
    control: "Disposal Procedures",
    status: "Complete",
    evidence: "3 citations",
    risk: "Medium",
  },
];

const statusClasses: Record<string, string> = {
  Partial: "bg-[#fff6e8] text-warning",
  Missing: "bg-[#fff0f0] text-danger",
  Complete: "bg-accent-soft text-accent",
};

export function ProductPreview() {
  return (
    <section
      id="product"
      aria-label="RegSpan product preview"
      className="relative scroll-mt-28 rounded-2xl border border-line bg-white p-3 shadow-soft"
    >
      <div className="rounded-xl border border-line bg-canvas p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-sm font-semibold text-ink">Assessment overview</p>
            <p className="mt-1 text-xs font-medium text-muted">Evidence mapping workspace</p>
          </div>
          <div className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-muted">
            Draft review
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-line bg-white">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Draft findings.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead className="bg-canvas text-xs uppercase tracking-normal text-muted">
                <tr>
                  <th className="px-4 py-3 font-semibold">Control</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Evidence</th>
                  <th className="px-4 py-3 font-semibold">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.control}>
                    <td className="px-4 py-4 font-medium text-ink">{row.control}</td>
                    <td className="px-4 py-4">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[row.status]}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-muted">{row.evidence}</td>
                    <td className="px-4 py-4 font-semibold text-ink">{row.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
