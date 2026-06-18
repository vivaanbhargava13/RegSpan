"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import {
  documentTypes,
  initialDocuments,
  readAllDocuments,
  readStoredDocuments,
  type MockDocument,
  writeStoredDocuments,
} from "@/components/mockDocuments";
import { StatusBadge } from "@/components/StatusBadge";

export function DocumentsClient() {
  const [documents, setDocuments] = useState<MockDocument[]>(initialDocuments);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setDocuments(readAllDocuments());
  }, []);

  function updateStoredDocument(id: string, updates: Partial<MockDocument>) {
    const updatedStoredDocuments = readStoredDocuments().map((document) =>
      document.id === id ? { ...document, ...updates } : document,
    );

    writeStoredDocuments(updatedStoredDocuments);
    setDocuments([...initialDocuments, ...updatedStoredDocuments]);
  }

  function resetForm() {
    setSelectedFile(null);
    setDocumentType("");
    setNotes("");
    setError("");
    setIsUploadOpen(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setError("Choose a source document before adding it.");
      return;
    }

    if (!documentType) {
      setError("Select a document type before adding it.");
      return;
    }

    const newDocument: MockDocument = {
      id: `local-${Date.now()}`,
      name: selectedFile.name,
      type: documentType,
      status: "Queued",
      uploaded: "Just now",
      chunks: "Pending",
      notes: notes.trim() || undefined,
    };
    const updatedStoredDocuments = [newDocument, ...readStoredDocuments()];

    // Frontend-only mock state. File contents are never stored or uploaded here.
    writeStoredDocuments(updatedStoredDocuments);
    setDocuments([...initialDocuments, ...updatedStoredDocuments]);
    resetForm();

    window.setTimeout(() => {
      updateStoredDocument(newDocument.id, { status: "Processing" });
    }, 1000);

    window.setTimeout(() => {
      updateStoredDocument(newDocument.id, { status: "Processed", chunks: "18 chunks" });
    }, 3000);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-normal text-accent">Documents</p>
          <h1 className="mt-2 text-3xl font-semibold text-ink">Policy evidence library</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
            Track uploaded source material and processing status for evidence review.
          </p>
        </div>
        <Button onClick={() => setIsUploadOpen(true)}>Upload document</Button>
      </div>

      {isUploadOpen ? (
        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">Add source material</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                This creates a local mock document row for review. No file contents are stored.
              </p>
            </div>
            <button
              className="text-left text-sm font-semibold text-muted transition-colors hover:text-ink sm:text-right"
              type="button"
              onClick={resetForm}
            >
              Cancel
            </button>
          </div>

          <form className="mt-6 grid gap-5 lg:grid-cols-2" onSubmit={handleSubmit} noValidate>
            <label className="block">
              <span className="text-sm font-semibold text-ink">File</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
                className="mt-2 block w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-accent"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-ink">Document type</span>
              <select
                value={documentType}
                onChange={(event) => {
                  setDocumentType(event.target.value);
                  setError("");
                }}
                className="mt-2 h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
              >
                <option value="">Select document type</option>
                {documentTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="block lg:col-span-2">
              <span className="text-sm font-semibold text-ink">Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Optional review context"
                className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition focus:border-accent focus:ring-4 focus:ring-accent-soft"
              />
            </label>

            {error ? (
              <p className="rounded-lg border border-[#efd1d1] bg-[#fff0f0] px-3 py-2 text-sm font-medium text-danger lg:col-span-2">
                {error}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 sm:flex-row lg:col-span-2">
              <Button type="submit">Add document</Button>
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      <DataTable columns={["Document name", "Type", "Status", "Uploaded", "Chunks", "Actions"]}>
        {documents.map((document) => (
          <tr key={document.id}>
            <td className="px-4 py-4 font-medium text-ink">
              <span className="block max-w-[320px] truncate" title={document.name}>
                {document.name}
              </span>
            </td>
            <td className="px-4 py-4 text-muted">{document.type}</td>
            <td className="px-4 py-4">
              <StatusBadge>{document.status}</StatusBadge>
            </td>
            <td className="px-4 py-4 text-muted">{document.uploaded}</td>
            <td className="px-4 py-4 text-muted">{document.chunks}</td>
            <td className="px-4 py-4">
              <Link className="text-sm font-semibold text-accent" href={`/documents/${document.id}`}>
                Review
              </Link>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
