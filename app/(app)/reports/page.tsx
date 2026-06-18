import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-normal text-accent">Reports</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Reviewer-ready report drafts</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Prepare cited report drafts for human approval and stakeholder review.
          </p>
        </div>
        <Button>Prepare report</Button>
      </div>

      <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-ink">Report export placeholder</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Export wiring will be added after evidence review and backend workflows are connected.
        </p>
      </div>

      <DataTable columns={["Report name", "Date", "Controls reviewed", "Status"]}>
        {reports.map((report) => (
          <tr key={report.name}>
            <td className="px-4 py-4 font-medium text-ink">{report.name}</td>
            <td className="px-4 py-4 text-muted">{report.date}</td>
            <td className="px-4 py-4 text-muted">{report.controlsReviewed}</td>
            <td className="px-4 py-4">
              <StatusBadge>{report.status}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
