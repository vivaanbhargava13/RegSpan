import { DataTable } from "@/components/DataTable";
import { MetricCard } from "@/components/MetricCard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const metrics = [
  {
    label: "Reg S-P Readiness",
    value: "72%",
    tooltip:
      "A summary of how complete your current review looks based on the documents you have uploaded and the issues identified so far.",
    tooltipPlacement: "right" as const,
  },
  {
    label: "High-Risk Gaps",
    value: "4",
    tone: "danger" as const,
    tooltip:
      "The number of important issues that may need attention because the current documents appear to be missing key information.",
  },
  {
    label: "Requirements Needing Review",
    value: "12",
    tone: "warning" as const,
    tooltip:
      "The number of Reg S-P requirement areas that still need someone to review or confirm.",
  },
  {
    label: "Documents Uploaded",
    value: "6",
    tooltip: "The number of files currently added to this workspace for review.",
  },
  {
    label: "Open Follow-Up Items",
    value: "9",
    tone: "warning" as const,
    tooltip:
      "The number of next steps still open, such as missing information, review tasks, or items that may need updates.",
    tooltipPlacement: "left" as const,
  },
];

const activities = [
  "Privacy Notice.pdf marked for reviewer attention",
  "Incident Response Plan flagged 2 items for follow-up",
  "Vendor Management Policy review status updated",
];

const gaps = [
  { requirement: "Service Provider Notice", support: "No support found", risk: "High" },
  { requirement: "Incident Response Program", support: "2 supporting sections", risk: "High" },
  { requirement: "Disposal Procedures", support: "3 supporting sections", risk: "Medium" },
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
        eyebrow="Overview"
        title="Reg S-P readiness overview"
        description="See uploaded documents, open gaps, and review progress in one place."
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
          <h2 className="mb-4 text-lg font-semibold text-app-text">Gaps needing review</h2>
          <DataTable columns={["Requirement", "Document support", "Risk"]} minWidth="min-w-[560px]">
            {gaps.map((gap) => (
              <tr key={gap.requirement}>
                <td className="px-4 py-4 font-medium text-app-text">{gap.requirement}</td>
                <td className="px-4 py-4 text-app-muted">{gap.support}</td>
                <td className="px-4 py-4">
                  <StatusBadge>{gap.risk}</StatusBadge>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <h2 className="text-lg font-semibold text-app-text">Document review status</h2>
          <div className="mt-5 space-y-3">
            {["4 documents reviewed", "1 document needs review", "194 document sections available for review"].map((item) => (
              <p key={item} className="rounded-xl border border-app-border bg-app-elevated px-4 py-3 text-sm text-app-muted">
                {item}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <h2 className="text-lg font-semibold text-app-text">Document support by rule area</h2>
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
