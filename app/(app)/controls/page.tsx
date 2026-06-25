import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const requirements = [
  {
    id: "SP-01",
    category: "Incident Response",
    requirement: "Maintain a written incident response program for covered data events.",
    status: "Partial",
    supportCount: "2",
    severity: "High",
  },
  {
    id: "SP-02",
    category: "Vendor Oversight",
    requirement: "Review service provider notice and oversight documentation.",
    status: "Missing",
    supportCount: "0",
    severity: "High",
  },
  {
    id: "SP-03",
    category: "Privacy",
    requirement: "Confirm privacy notice documentation is current and reviewable.",
    status: "Requires Review",
    supportCount: "1",
    severity: "Medium",
  },
  {
    id: "SP-04",
    category: "Disposal",
    requirement: "Document disposal procedures for customer information.",
    status: "Complete",
    supportCount: "3",
    severity: "Medium",
  },
];

export default function ControlsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Requirements"
        title="Reg S-P requirements"
        description="Review the rule areas RegSpan checks against your uploaded documents."
      />

      <div className="app-card flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-app-accent-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-app-accent">
            Baseline
          </span>
          <span className="text-sm font-semibold text-app-text">Regulation S-P</span>
        </div>
        <span className="text-sm text-app-muted">4 requirement areas in view</span>
      </div>

      <DataTable
        columns={["Requirement ID", "Rule area", "Requirement", "Status", "Supporting sections", "Risk"]}
        minWidth="min-w-[900px]"
      >
        {requirements.map((requirement) => (
          <tr key={requirement.id}>
            <td className="px-4 py-4 font-mono text-xs font-semibold text-app-accent">{requirement.id}</td>
            <td className="px-4 py-4 text-app-muted">{requirement.category}</td>
            <td className="px-4 py-4 text-app-muted">{requirement.requirement}</td>
            <td className="px-4 py-4">
              <StatusBadge>{requirement.status}</StatusBadge>
            </td>
            <td className="px-4 py-4 text-app-muted">{requirement.supportCount}</td>
            <td className="px-4 py-4">
              <StatusBadge>{requirement.severity}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
