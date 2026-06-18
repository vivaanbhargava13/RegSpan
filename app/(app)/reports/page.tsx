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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Reports"
        title="Review reports"
        description="Prepare summaries your team can review before sharing with counsel, auditors, or examiners."
        actions={
          <Button variant="appPrimary">Prepare report</Button>
        }
      />

      <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
        <h2 className="text-lg font-semibold text-app-text">Report export placeholder</h2>
        <p className="mt-2 text-sm leading-6 text-app-muted">
          Export options will be added after document review workflows are connected.
        </p>
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
