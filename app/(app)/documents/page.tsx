import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";

const documents = [
  {
    name: "Incident Response Plan.pdf",
    type: "Incident Response",
    status: "Processed",
    uploaded: "2 days ago",
    chunks: "84 chunks",
  },
  {
    name: "Vendor Management Policy.pdf",
    type: "Vendor Oversight",
    status: "Processed",
    uploaded: "3 days ago",
    chunks: "52 chunks",
  },
  {
    name: "Privacy Notice.pdf",
    type: "Privacy",
    status: "Needs Review",
    uploaded: "5 days ago",
    chunks: "31 chunks",
  },
  {
    name: "Data Disposal Policy.pdf",
    type: "Disposal",
    status: "Processed",
    uploaded: "1 week ago",
    chunks: "27 chunks",
  },
];

export default function DocumentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-normal text-accent">Documents</p>
        <h1 className="mt-2 text-3xl font-semibold text-ink">Policy evidence library</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Track uploaded source material and processing status for evidence review.
        </p>
      </div>

      <DataTable columns={["Document name", "Type", "Status", "Uploaded", "Chunks", "Actions"]}>
        {documents.map((document) => (
          <tr key={document.name}>
            <td className="px-4 py-4 font-medium text-ink">{document.name}</td>
            <td className="px-4 py-4 text-muted">{document.type}</td>
            <td className="px-4 py-4">
              <StatusBadge>{document.status}</StatusBadge>
            </td>
            <td className="px-4 py-4 text-muted">{document.uploaded}</td>
            <td className="px-4 py-4 text-muted">{document.chunks}</td>
            <td className="px-4 py-4">
              <button className="text-sm font-semibold text-accent" type="button">
                Review
              </button>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
