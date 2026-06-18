"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import {
  documentTypes,
  initialDocuments,
  mapSupabaseDocument,
  readAllDocuments,
  readStoredDocuments,
  type MockDocument,
  type SupabaseDocumentRecord,
  writeStoredDocuments,
} from "@/components/mockDocuments";
import { StatusBadge } from "@/components/StatusBadge";
import { getBrowserSupabaseClient, isSupabaseConfigured as hasSupabaseEnv } from "@/components/supabaseClient";

function logDocumentsDebug(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[RegSpan documents] ${message}`, details ?? {});
  }
}

function formatSectionsLabel(label: string) {
  return label.replace(/\bchunks\b/gi, "sections");
}

export function DocumentsClient() {
  const [documents, setDocuments] = useState<MockDocument[]>(initialDocuments);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  useEffect(() => {
    void loadDocuments();
  }, []);

  async function loadDocuments() {
    const configured = hasSupabaseEnv();
    const supabase = getBrowserSupabaseClient();
    logDocumentsDebug("Supabase configuration check", { configured });

    if (!supabase) {
      setDocuments(readAllDocuments());
      setWarning("Supabase is not configured. Using local mock document data for this demo workspace.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setWarning("");
    setError("");
    const { data, error: loadError } = await supabase
      .from("documents")
      .select(
        "id, workspace_id, filename, document_type, notes, status, chunks_label, storage_path, file_size, mime_type, uploaded_at",
      )
      .eq("workspace_id", "demo")
      .order("uploaded_at", { ascending: false });

    if (loadError) {
      logDocumentsDebug("Supabase document fetch failed", { message: loadError.message });
      setError(`Unable to load documents from Supabase: ${loadError.message}`);
      setDocuments([]);
    } else {
      logDocumentsDebug("Supabase document fetch succeeded", { rowCount: data?.length ?? 0 });
      setError("");
      setDocuments(((data ?? []) as SupabaseDocumentRecord[]).map(mapSupabaseDocument));
    }

    setIsLoading(false);
  }

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedFile) {
      setError("Choose a source document before adding it.");
      return;
    }

    if (!documentType) {
      setError("Select a document type before adding it.");
      return;
    }

    const supabase = getBrowserSupabaseClient();

    if (supabase) {
      setIsSubmitting(true);
      setError("");

      const documentId = crypto.randomUUID();
      const storagePath = `demo/${documentId}/${selectedFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storagePath, selectedFile, {
          contentType: selectedFile.type || undefined,
          upsert: false,
        });

      if (uploadError) {
        setError(`Supabase storage upload failed: ${uploadError.message}`);
        setIsSubmitting(false);
        return;
      }

      const { error: insertError } = await supabase.from("documents").insert({
        id: documentId,
        workspace_id: "demo",
        filename: selectedFile.name,
        document_type: documentType,
        notes: notes.trim() || null,
        status: "Uploaded",
        chunks_label: "Pending",
        storage_path: storagePath,
        file_size: selectedFile.size,
        mime_type: selectedFile.type || null,
        uploaded_at: new Date().toISOString(),
      });

      if (insertError) {
        setError(`Document metadata insert failed: ${insertError.message}`);
        setIsSubmitting(false);
        return;
      }

      resetForm();
      await loadDocuments();
      setIsSubmitting(false);
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
      updateStoredDocument(newDocument.id, { status: "Processed", chunks: "18 sections" });
    }, 3000);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Documents"
        title="Uploaded documents"
        description="Add the policies, procedures, vendor materials, and incident response plans your team wants reviewed."
        actions={
          <Button variant="appPrimary" onClick={() => setIsUploadOpen(true)}>
            Upload document
          </Button>
        }
      />

      {warning ? (
        <p className="rounded-xl border border-app-warning-soft bg-app-warning-soft px-4 py-3 text-sm font-medium text-app-warning">
          {warning}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-app-danger-soft bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger">
          {error}
        </p>
      ) : null}

      {isUploadOpen ? (
        <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-app-text">Add a document</h2>
              <p className="mt-2 text-sm leading-6 text-app-muted">
                Upload policies, procedures, vendor materials, or response plans for review. RegSpan stores the file and basic details now. Document reading and matching will be connected next.
              </p>
            </div>
            <button
              className="text-left text-sm font-semibold text-app-muted transition-colors hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent sm:text-right"
              type="button"
              onClick={resetForm}
            >
              Cancel
            </button>
          </div>

          <form className="mt-6 grid gap-5 lg:grid-cols-2" onSubmit={handleSubmit} noValidate>
            <label className="block">
              <span className="text-sm font-semibold text-app-text">File</span>
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
                className="mt-2 block w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-muted file:mr-3 file:rounded-md file:border-0 file:bg-app-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-app-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-app-text">Document type</span>
              <select
                value={documentType}
                onChange={(event) => {
                  setDocumentType(event.target.value);
                  setError("");
                }}
                className="mt-2 h-11 w-full rounded-lg border border-app-border bg-app-bg px-3 text-sm text-app-text outline-none transition focus:border-app-accent focus:ring-4 focus:ring-app-accent-soft"
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
              <span className="text-sm font-semibold text-app-text">Notes</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                placeholder="Optional review context"
                className="mt-2 w-full rounded-lg border border-app-border bg-app-bg px-3 py-2 text-sm text-app-text outline-none transition placeholder:text-app-muted focus:border-app-accent focus:ring-4 focus:ring-app-accent-soft"
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row lg:col-span-2">
              <Button type="submit" variant="appPrimary" disabled={isSubmitting}>
                {isSubmitting ? "Adding document..." : "Add document"}
              </Button>
              <Button type="button" variant="appSecondary" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      ) : null}

      {isLoading ? (
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 text-sm font-semibold text-app-muted shadow-app-soft">
          Loading documents...
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 text-sm font-medium text-app-muted shadow-app-soft">
          No documents have been uploaded yet.
        </div>
      ) : (
        <DataTable columns={["Document name", "Type", "Review status", "Uploaded", "Sections", "Actions"]}>
          {documents.map((document) => (
            <tr key={document.id}>
              <td className="px-4 py-4 font-medium text-app-text">
                <span className="block max-w-[320px] truncate" title={document.name}>
                  {document.name}
                </span>
              </td>
              <td className="px-4 py-4 text-app-muted">{document.type}</td>
              <td className="px-4 py-4">
                <StatusBadge>{document.status}</StatusBadge>
              </td>
              <td className="px-4 py-4 text-app-muted">{document.uploaded}</td>
              <td className="px-4 py-4 text-app-muted">{formatSectionsLabel(document.chunks)}</td>
              <td className="px-4 py-4">
                <Link className="text-sm font-semibold text-app-accent transition-colors hover:text-app-accent-hover" href={`/documents/${document.id}`}>
                  Review
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
