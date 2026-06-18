import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";

const findings = [
  {
    control: "Incident Response Program",
    status: "Partial",
    evidence: "2 citations",
    gap: "Escalation timing needs reviewer confirmation.",
    risk: "High",
    reviewStatus: "Requires Review",
  },
  {
    control: "Service Provider Notice",
    status: "Missing",
    evidence: "No evidence",
    gap: "No cited provider notice evidence found in current documents.",
    risk: "High",
    reviewStatus: "Draft",
  },
  {
    control: "Privacy Notice",
    status: "Requires Review",
    evidence: "1 citation",
    gap: "Notice language may need stakeholder review.",
    risk: "Medium",
    reviewStatus: "Requires Review",
  },
  {
    control: "Disposal Procedures",
    status: "Complete",
    evidence: "3 citations",
    gap: "No draft gap noted.",
    risk: "Medium",
    reviewStatus: "Prepared",
  },
];

export default function FindingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-accent">Findings</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Draft findings review</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Triage draft gaps and evidence notes before including them in reviewer-ready reports.
        </p>
      </div>

      <DataTable
        columns={["Control", "Status", "Evidence", "Gap", "Risk", "Review status"]}
        minWidth="min-w-[960px]"
      >
        {findings.map((finding) => (
          <tr key={finding.control}>
            <td className="px-4 py-4 font-medium text-ink">{finding.control}</td>
            <td className="px-4 py-4">
              <StatusBadge>{finding.status}</StatusBadge>
            </td>
            <td className="px-4 py-4 text-muted">{finding.evidence}</td>
            <td className="px-4 py-4 text-muted">{finding.gap}</td>
            <td className="px-4 py-4">
              <StatusBadge>{finding.risk}</StatusBadge>
            </td>
            <td className="px-4 py-4">
              <StatusBadge>{finding.reviewStatus}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
