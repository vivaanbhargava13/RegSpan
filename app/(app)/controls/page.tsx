import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";

const controls = [
  {
    id: "SP-01",
    category: "Incident Response",
    requirement: "Maintain a written incident response program for covered data events.",
    status: "Partial",
    evidenceCount: "2",
    severity: "High",
  },
  {
    id: "SP-02",
    category: "Vendor Oversight",
    requirement: "Review service provider notice and oversight evidence.",
    status: "Missing",
    evidenceCount: "0",
    severity: "High",
  },
  {
    id: "SP-03",
    category: "Privacy",
    requirement: "Confirm privacy notice evidence is current and reviewable.",
    status: "Requires Review",
    evidenceCount: "1",
    severity: "Medium",
  },
  {
    id: "SP-04",
    category: "Disposal",
    requirement: "Document disposal procedures for customer information.",
    status: "Complete",
    evidenceCount: "3",
    severity: "Medium",
  },
];

export default function ControlsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Controls"
        title="Reg S-P control checklist"
        description="Review draft control coverage and evidence counts before assigning remediation."
      />

      <DataTable
        columns={["Control ID", "Category", "Requirement", "Status", "Evidence count", "Severity"]}
        minWidth="min-w-[900px]"
      >
        {controls.map((control) => (
          <tr key={control.id}>
            <td className="px-4 py-4 font-semibold text-app-text">{control.id}</td>
            <td className="px-4 py-4 text-app-muted">{control.category}</td>
            <td className="px-4 py-4 text-app-muted">{control.requirement}</td>
            <td className="px-4 py-4">
              <StatusBadge>{control.status}</StatusBadge>
            </td>
            <td className="px-4 py-4 text-app-muted">{control.evidenceCount}</td>
            <td className="px-4 py-4">
              <StatusBadge>{control.severity}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
