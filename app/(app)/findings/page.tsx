import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const gaps = [
  {
    requirement: "Incident Response Program",
    status: "Partial",
    support: "2 supporting sections",
    gap: "Escalation timing needs reviewer confirmation.",
    risk: "High",
    reviewStatus: "Requires Review",
  },
  {
    requirement: "Service Provider Notice",
    status: "Missing",
    support: "No support found",
    gap: "No provider notice documentation found in current documents.",
    risk: "High",
    reviewStatus: "Needs Review",
  },
  {
    requirement: "Privacy Notice",
    status: "Requires Review",
    support: "1 supporting section",
    gap: "Notice language may need stakeholder review.",
    risk: "Medium",
    reviewStatus: "Requires Review",
  },
  {
    requirement: "Disposal Procedures",
    status: "Complete",
    support: "3 supporting sections",
    gap: "No open gap noted.",
    risk: "Medium",
    reviewStatus: "Prepared",
  },
];

export default function FindingsPage() {
  const openGapCount = gaps.filter((gap) => gap.status !== "Complete").length;
  const highRiskCount = gaps.filter((gap) => gap.risk === "High").length;
  const preparedCount = gaps.filter((gap) => gap.reviewStatus === "Prepared").length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Gaps"
        title="Open documentation gaps"
        description="Review missing, weak, or unclear documentation that may need follow-up."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="app-card-subtle px-4 py-3.5"><span className="text-xs text-app-muted">Open gaps</span><strong className="mt-1 block text-xl text-app-text">{openGapCount}</strong></div>
        <div className="app-card-subtle px-4 py-3.5"><span className="text-xs text-app-muted">High risk</span><strong className="mt-1 block text-xl text-app-danger">{highRiskCount}</strong></div>
        <div className="app-card-subtle px-4 py-3.5"><span className="text-xs text-app-muted">Prepared</span><strong className="mt-1 block text-xl text-app-success">{preparedCount}</strong></div>
      </div>

      <DataTable
        columns={["Requirement", "Status", "Document support", "Gap", "Risk", "Review status"]}
        minWidth="min-w-[960px]"
      >
        {gaps.map((gap) => (
          <tr key={gap.requirement}>
            <td className="px-4 py-4 font-medium text-app-text">{gap.requirement}</td>
            <td className="px-4 py-4">
              <StatusBadge>{gap.status}</StatusBadge>
            </td>
            <td className="px-4 py-4 text-app-muted">{gap.support}</td>
            <td className="px-4 py-4 text-app-muted">{gap.gap}</td>
            <td className="px-4 py-4">
              <StatusBadge>{gap.risk}</StatusBadge>
            </td>
            <td className="px-4 py-4">
              <StatusBadge>{gap.reviewStatus}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
