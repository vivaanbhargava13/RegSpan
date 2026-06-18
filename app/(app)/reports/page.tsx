import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const reports = [
  {
    name: "Reg S-P Evidence Review Summary",
    date: "Today",
    controlsReviewed: "18 controls",
    status: "Draft",
  },
  {
    name: "Vendor Oversight Findings Pack",
    date: "Yesterday",
    controlsReviewed: "6 controls",
    status: "Prepared",
  },
  {
    name: "Incident Response Evidence Memo",
    date: "Last week",
    controlsReviewed: "4 controls",
    status: "Prepared",
  },
];

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Reviewer-ready report drafts"
        description="Prepare cited report drafts for human approval and stakeholder review."
        actions={
          <Button variant="appPrimary">Prepare report</Button>
        }
      />

      <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
        <h2 className="text-lg font-semibold text-app-text">Report export placeholder</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          Export wiring will be added after evidence review and backend workflows are connected.
        </p>
      </div>

      <DataTable columns={["Report name", "Date", "Controls reviewed", "Status"]}>
        {reports.map((report) => (
          <tr key={report.name}>
            <td className="px-4 py-4 font-medium text-app-text">{report.name}</td>
            <td className="px-4 py-4 text-app-muted">{report.date}</td>
            <td className="px-4 py-4 text-app-muted">{report.controlsReviewed}</td>
            <td className="px-4 py-4">
              <StatusBadge>{report.status}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
