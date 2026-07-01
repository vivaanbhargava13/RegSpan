"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
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
type BulkAction = "delete" | "process";
type BulkScope = "all" | "selected";
type BulkActionKey = "delete-all" | "delete-selected" | "process-all" | "process-selected";
type BulkActionResult = {
  ok?: boolean;
  requestedCount?: number;
  succeeded?: number;
  failed?: number;
  error?: string;
};

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
  const [message, setMessage] = useState("");
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | BulkActionKey>(null);

  const selectedCount = selectedDocumentIds.size;
  const allVisibleSelected = documents.length > 0 && documents.every((document) => selectedDocumentIds.has(document.id));
  const hasDocuments = documents.length > 0;
  const isBulkBusy = bulkAction !== null;
  const selectedDocumentList = useMemo(
    () => Array.from(selectedDocumentIds),
    [selectedDocumentIds],
  );

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

    setSelectedDocumentIds(new Set());
    setIsSelectMode(false);
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

  function clearSelection() {
    setSelectedDocumentIds(new Set());
    setIsSelectMode(false);
  }

  function toggleDocumentSelection(documentId: string) {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedDocumentIds((current) => {
      if (documents.length > 0 && documents.every((document) => current.has(document.id))) {
        return new Set();
      }
      return new Set(documents.map((document) => document.id));
    });
  }

  function localBulkAction(action: BulkAction, scope: BulkScope, documentIds: string[]) {
    const targetIds = scope === "all"
      ? new Set(documents.map((document) => document.id))
      : new Set(documentIds);

    if (action === "delete") {
      const remaining = documents.filter((document) => !targetIds.has(document.id));
      const remainingStoredDocuments = readStoredDocuments().filter((document) => !targetIds.has(document.id));
      writeStoredDocuments(remainingStoredDocuments);
      setDocuments(remaining);
      setMessage(`Deleted ${targetIds.size} document${targetIds.size === 1 ? "" : "s"}.`);
      clearSelection();
      return;
    }

    const updated = documents.map((document) =>
      targetIds.has(document.id)
        ? { ...document, status: "Queued" as const, chunks: "Pending" }
        : document,
    );
    const updatedStored = readStoredDocuments().map((document) =>
      targetIds.has(document.id)
        ? { ...document, status: "Queued" as const, chunks: "Pending" }
        : document,
    );
    writeStoredDocuments(updatedStored);
    setDocuments(updated);
    setMessage(`Queued ${targetIds.size} document${targetIds.size === 1 ? "" : "s"} for processing.`);
    clearSelection();
  }

  async function runBulkAction(action: BulkAction, scope: BulkScope) {
    const isSelectedScope = scope === "selected";
    const targetCount = isSelectedScope ? selectedCount : documents.length;
    if (targetCount === 0 || isBulkBusy) {
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm(
        isSelectedScope
          ? `Delete ${targetCount} selected document${targetCount === 1 ? "" : "s"}? This cannot be undone.`
          : "Delete all documents in this workspace? This cannot be undone.",
      );
      if (!confirmed) {
        return;
      }
    }

    const actionKey: BulkActionKey = `${action === "delete" ? "delete" : "process"}-${isSelectedScope ? "selected" : "all"}`;
    setBulkAction(actionKey);
    setError("");
    setWarning("");
    setMessage("");

    try {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        localBulkAction(action, scope, selectedDocumentList);
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || "Your session has expired. Log in again.");
      }

      const response = await fetch("/api/documents/bulk", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          scope,
          documentIds: isSelectedScope ? selectedDocumentList : [],
        }),
      });
      const result = (await response.json()) as BulkActionResult;
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Bulk document action failed.");
      }

      const succeeded = result.succeeded ?? 0;
      const failed = result.failed ?? 0;
      if (failed > 0) {
        setWarning(`${succeeded} document${succeeded === 1 ? "" : "s"} succeeded; ${failed} failed.`);
      } else {
        setMessage(
          action === "delete"
            ? `Deleted ${succeeded} document${succeeded === 1 ? "" : "s"}.`
            : `Queued ${succeeded} document${succeeded === 1 ? "" : "s"} for processing.`,
        );
      }
      await loadDocuments();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Bulk document action failed.");
    } finally {
      setBulkAction(null);
    }
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
          <div className="flex flex-wrap items-center gap-2">
            {isSelectMode ? (
              <>
                <Button
                  variant="appSecondary"
                  onClick={() => void runBulkAction("delete", "selected")}
                  disabled={selectedCount === 0 || isBulkBusy}
                  className="border-app-danger/30 text-app-danger hover:bg-app-danger-soft"
                >
                  {bulkAction === "delete-selected" ? "Deleting..." : `Delete selected (${selectedCount})`}
                </Button>
                <Button
                  variant="appSecondary"
                  onClick={() => void runBulkAction("process", "selected")}
                  disabled={selectedCount === 0 || isBulkBusy}
                >
                  {bulkAction === "process-selected" ? "Reprocessing..." : `Reprocess selected (${selectedCount})`}
                </Button>
                <Button variant="appSecondary" onClick={clearSelection} disabled={isBulkBusy}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="appSecondary" onClick={() => setIsSelectMode(true)} disabled={!hasDocuments || isBulkBusy}>
                  Select
                </Button>
                <Button
                  variant="appSecondary"
                  onClick={() => void runBulkAction("delete", "all")}
                  disabled={!hasDocuments || isBulkBusy}
                  className="border-app-danger/30 text-app-danger hover:bg-app-danger-soft"
                >
                  {bulkAction === "delete-all" ? "Deleting..." : "Delete all"}
                </Button>
                <Button
                  variant="appSecondary"
                  onClick={() => void runBulkAction("process", "all")}
                  disabled={!hasDocuments || isBulkBusy}
                >
                  {bulkAction === "process-all" ? "Reprocessing..." : "Reprocess all"}
                </Button>
                <Button variant="appPrimary" onClick={() => setIsUploadOpen(true)} disabled={isBulkBusy}>
                  Upload document
                </Button>
              </>
            )}
          </div>
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

      {message ? (
        <div className="flex gap-3 rounded-xl border border-app-success/20 bg-app-success-soft px-4 py-3 text-sm font-medium text-app-success shadow-sm">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-app-success" />
          <p>{message}</p>
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
        <DataTable
          columns={[
            ...(isSelectMode ? ["Select"] : []),
            "Document name",
            "Type",
            "Review status",
            "Uploaded",
            "Sections",
            "Actions",
          ]}
          minWidth={isSelectMode ? "min-w-[900px]" : "min-w-[760px]"}
        >
          {isSelectMode ? (
            <tr className="bg-app-elevated/35">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all documents"
                  className="size-4 rounded border-app-border text-app-accent focus:ring-app-accent"
                />
              </td>
              <td colSpan={6} className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-app-muted">
                {selectedCount} of {documents.length} selected
              </td>
            </tr>
          ) : null}
          {documents.map((document) => (
            <tr
              key={document.id}
              className={selectedDocumentIds.has(document.id) ? "bg-app-accent-soft/45" : undefined}
            >
              {isSelectMode ? (
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    checked={selectedDocumentIds.has(document.id)}
                    onChange={() => toggleDocumentSelection(document.id)}
                    aria-label={`Select ${document.name}`}
                    className="size-4 rounded border-app-border text-app-accent focus:ring-app-accent"
                  />
                </td>
              ) : null}
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
