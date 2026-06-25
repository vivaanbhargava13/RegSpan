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
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspaces";

function logDocumentsDebug(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[RegSpan documents] ${message}`, details ?? {});
  }
}

function formatSectionsLabel(label: string) {
  return label.replace(/\bchunks\b/gi, "sections");
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function validateSelectedPdf(file: File) {
  if (file.size === 0) return "The PDF file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "The PDF exceeds the 10 MB upload limit.";
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    return "Only PDF files are accepted.";
  }
  return null;
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
      setWarning("Supabase is not configured. Using local mock document data.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setWarning("");
    setError("");
    let currentWorkspace: CurrentWorkspace;

    try {
      currentWorkspace = await getCurrentWorkspace(supabase);
    } catch (workspaceError) {
      setError(
        workspaceError instanceof Error
          ? workspaceError.message
          : "Unable to load your workspace.",
      );
      setDocuments([]);
      setIsLoading(false);
      return;
    }

    const { data, error: loadError } = await supabase
      .from("documents")
      .select(
        "id, workspace_id, filename, document_type, notes, status, chunks_label, storage_path, file_size, mime_type, uploaded_at",
      )
      .eq("workspace_id", currentWorkspace.id)
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

    const fileError = validateSelectedPdf(selectedFile);
    if (fileError) {
      setError(fileError);
      return;
    }

    const supabase = getBrowserSupabaseClient();

    if (supabase) {
      setIsSubmitting(true);
      setError("");

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          throw new Error(sessionError?.message || "Your session has expired. Log in again.");
        }

        const formData = new FormData();
        formData.set("file", selectedFile);
        formData.set("documentType", documentType);
        formData.set("notes", notes.trim());

        const response = await fetch("/api/documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
          body: formData,
        });
        const result = (await response.json()) as { ok?: boolean; error?: string };

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Document upload failed.");
        }

        resetForm();
        await loadDocuments();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Document upload failed.");
      } finally {
        setIsSubmitting(false);
      }
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
    <div className="space-y-8">
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
        <div className="flex gap-3 rounded-xl border border-app-warning/20 bg-app-warning-soft px-4 py-3 text-sm font-medium text-app-warning shadow-sm">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-app-warning" />
          <p>{warning}</p>
        </div>
      ) : null}

      {error ? (
        <div className="flex gap-3 rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger shadow-sm">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-app-danger" />
          <p>{error}</p>
        </div>
      ) : null}

      {isUploadOpen ? (
        <section className="app-card p-5 lg:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-app-text">Add a document</h2>
              <p className="mt-2 text-sm leading-6 text-app-muted">
                Upload a PDF for secure storage, server-side text extraction, and deterministic document sectioning.
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
                accept="application/pdf,.pdf"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] ?? null);
                  setError("");
                }}
                className="app-field mt-2 block w-full px-3 py-2 text-sm text-app-muted file:mr-3 file:rounded-lg file:border-0 file:bg-app-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-app-accent"
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
                className="app-field mt-2 h-11 w-full px-3 text-sm text-app-text"
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
                className="app-field mt-2 w-full px-3 py-2 text-sm text-app-text placeholder:text-app-subtle"
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
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <div className="app-empty-state">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-app-accent-soft text-app-accent ring-1 ring-app-accent/10" aria-hidden="true">↥</div>
          <h2 className="mt-4 text-base font-semibold text-app-text">No documents yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-app-muted">
            Upload a policy or procedure to begin secure extraction, chunking, and evidence review.
          </p>
        </div>
      ) : (
        <DataTable columns={["Document name", "Type", "Review status", "Uploaded", "Sections", "Actions"]}>
          {documents.map((document) => (
            <tr key={document.id}>
              <td className="px-4 py-4 font-medium text-app-text">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg border border-app-border bg-app-elevated font-mono text-[10px] font-bold text-app-accent">PDF</span>
                  <span className="block max-w-[280px] truncate" title={document.name}>{document.name}</span>
                </div>
              </td>
              <td className="px-4 py-4 text-app-muted">{document.type}</td>
              <td className="px-4 py-4">
                <StatusBadge>{document.status}</StatusBadge>
              </td>
              <td className="px-4 py-4 text-app-muted">{document.uploaded}</td>
              <td className="px-4 py-4 text-app-muted">{formatSectionsLabel(document.chunks)}</td>
              <td className="px-4 py-4">
                <Link className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-app-accent transition-colors hover:bg-app-accent-soft hover:text-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent" href={`/documents/${document.id}`}>
                  Review <span aria-hidden="true">→</span>
                </Link>
              </td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
