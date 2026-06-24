import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const reports = [
  {
    name: "Reg S-P Readiness Summary",
    date: "Today",
    requirementsReviewed: "18 requirements",
    status: "Team review",
  },
  {
    name: "Vendor Oversight Gap Summary",
    date: "Yesterday",
    requirementsReviewed: "6 requirements",
    status: "Prepared",
  },
  {
    name: "Incident Response Review Memo",
    date: "Last week",
    requirementsReviewed: "4 requirements",
    status: "Prepared",
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reports"
        title="Review reports"
        description="Prepare summaries your team can review before sharing with counsel, auditors, or examiners."
        actions={
          <Button variant="appPrimary">Prepare report</Button>
        }
      />

      <div className="app-card relative overflow-hidden p-6">
        <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-app-accent" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-accent">Export readiness</p>
            <h2 className="mt-2 app-section-title">Report generation is coming next</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
              Review outputs will become exportable after requirement matching and findings workflows are connected.
            </p>
          </div>
          <span className="w-fit rounded-full border border-app-border bg-app-elevated px-3 py-1.5 text-xs font-semibold text-app-muted">Not connected</span>
        </div>
      </div>

      <DataTable columns={["Report name", "Date", "Requirements reviewed", "Status"]}>
        {reports.map((report) => (
          <tr key={report.name}>
            <td className="px-4 py-4 font-medium text-app-text">{report.name}</td>
            <td className="px-4 py-4 text-app-muted">{report.date}</td>
            <td className="px-4 py-4 text-app-muted">{report.requirementsReviewed}</td>
            <td className="px-4 py-4">
              <StatusBadge>{report.status}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
