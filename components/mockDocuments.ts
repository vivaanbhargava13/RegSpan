export type DocumentStatus = "Uploaded" | "Processed" | "Needs Review" | "Queued" | "Processing" | "Failed";

export type MockDocument = {
  id: string;
  name: string;
  type: string;
  status: DocumentStatus;
  uploaded: string;
  chunks: string;
  notes?: string;
  storagePath?: string;
  fileSize?: number;
  mimeType?: string;
};

export type SupabaseDocumentRecord = {
  id: string;
  workspace_id?: string | null;
  filename?: string | null;
  document_type?: string | null;
  notes?: string | null;
  status?: string | null;
  chunks_label?: string | null;
  storage_path?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  uploaded_at?: string | null;
  created_at?: string | null;
};

export const documentTypes = [
  "Incident Response",
  "Vendor Oversight",
  "Privacy",
  "Disposal",
  "Information Security",
  "Other",
];

export const initialDocuments: MockDocument[] = [
  {
    id: "demo-incident-response-plan",
    name: "Incident Response Plan.pdf",
    type: "Incident Response",
    status: "Processed",
    uploaded: "2 days ago",
    chunks: "84 chunks",
  },
  {
    id: "demo-vendor-management-policy",
    name: "Vendor Management Policy.pdf",
    type: "Vendor Oversight",
    status: "Processed",
    uploaded: "3 days ago",
    chunks: "52 chunks",
  },
  {
    id: "demo-privacy-notice",
    name: "Privacy Notice.pdf",
    type: "Privacy",
    status: "Needs Review",
    uploaded: "5 days ago",
    chunks: "31 chunks",
  },
  {
    id: "demo-data-disposal-policy",
    name: "Data Disposal Policy.pdf",
    type: "Disposal",
    status: "Processed",
    uploaded: "1 week ago",
    chunks: "27 chunks",
  },
];

const MOCK_DOCUMENTS_KEY = "regspan.mockDocuments";

export function readStoredDocuments(): MockDocument[] {
  const rawDocuments = localStorage.getItem(MOCK_DOCUMENTS_KEY);

  if (!rawDocuments) {
    return [];
  }

  try {
    return JSON.parse(rawDocuments) as MockDocument[];
  } catch {
    localStorage.removeItem(MOCK_DOCUMENTS_KEY);
    return [];
  }
}

export function writeStoredDocuments(documents: MockDocument[]) {
  localStorage.setItem(MOCK_DOCUMENTS_KEY, JSON.stringify(documents));
}

export function readAllDocuments() {
  return [...initialDocuments, ...readStoredDocuments()];
}

export function findMockDocument(id: string) {
  return readAllDocuments().find((document) => document.id === id) ?? null;
}

function normalizeStatus(status?: string | null): DocumentStatus {
  if (
    status === "Uploaded" ||
    status === "Processed" ||
    status === "Needs Review" ||
    status === "Queued" ||
    status === "Processing" ||
    status === "Failed"
  ) {
    return status;
  }

  return "Uploaded";
}

function formatUploaded(uploadedAt?: string | null) {
  if (!uploadedAt) {
    return "Uploaded";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(uploadedAt));
}

export function mapSupabaseDocument(record: SupabaseDocumentRecord): MockDocument {
  return {
    id: record.id,
    name: record.filename || "Untitled document",
    type: record.document_type || "Other",
    status: normalizeStatus(record.status),
    uploaded: formatUploaded(record.uploaded_at ?? record.created_at),
    chunks: record.chunks_label || "Pending",
    notes: record.notes || undefined,
    storagePath: record.storage_path || undefined,
    fileSize: record.file_size ?? undefined,
    mimeType: record.mime_type || undefined,
  };
}
