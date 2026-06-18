import { DataTable } from "@/components/DataTable";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const metrics = [
  { label: "Reg S-P Readiness", value: "72%" },
  { label: "High-Risk Gaps", value: "4", tone: "danger" as const },
  { label: "Controls Requiring Review", value: "12", tone: "warning" as const },
  { label: "Documents Processed", value: "6" },
  { label: "Open Remediation Tasks", value: "9", tone: "warning" as const },
];

const activities = [
  "Privacy Notice.pdf marked for reviewer attention",
  "Incident Response Plan mapped to 2 draft findings",
  "Vendor Management Policy processing completed",
];

const findings = [
  { control: "Service Provider Notice", evidence: "No evidence", risk: "High" },
  { control: "Incident Response Program", evidence: "2 citations", risk: "High" },
  { control: "Disposal Procedures", evidence: "3 citations", risk: "Medium" },
];

const coverage = [
  { category: "Incident Response", value: "68%" },
  { category: "Vendor Oversight", value: "74%" },
  { category: "Privacy", value: "61%" },
  { category: "Disposal", value: "82%" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Evidence readiness dashboard"
        description="Review draft evidence coverage, gaps, and document status before preparing reports."
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <h2 className="text-lg font-semibold text-app-text">Recent activity</h2>
          <div className="mt-5 space-y-3">
            {activities.map((activity) => (
              <div key={activity} className="rounded-xl border border-app-border bg-app-elevated p-4 text-sm text-app-muted">
                {activity}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-lg font-semibold text-app-text">Findings requiring review</h2>
          <DataTable columns={["Control", "Evidence", "Risk"]} minWidth="min-w-[520px]">
            {findings.map((finding) => (
              <tr key={finding.control}>
                <td className="px-4 py-4 font-medium text-app-text">{finding.control}</td>
                <td className="px-4 py-4 text-app-muted">{finding.evidence}</td>
                <td className="px-4 py-4">
                  <StatusBadge>{finding.risk}</StatusBadge>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <h2 className="text-lg font-semibold text-app-text">Document processing status</h2>
          <div className="mt-5 space-y-3">
            {["4 processed documents", "1 document needs review", "194 total chunks indexed for review"].map((item) => (
              <p key={item} className="rounded-xl border border-app-border bg-app-elevated px-4 py-3 text-sm text-app-muted">
                {item}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <h2 className="text-lg font-semibold text-app-text">Evidence coverage by category</h2>
          <div className="mt-5 space-y-4">
            {coverage.map((item) => (
              <div key={item.category}>
                <div className="flex justify-between text-sm font-medium">
                  <span>{item.category}</span>
                  <span className="text-app-muted">{item.value}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-app-elevated">
                  <div className="h-2 rounded-full bg-app-accent" style={{ width: item.value }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
