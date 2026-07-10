"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import {
  initialDocuments,
  mapSupabaseDocument,
  readAllDocuments,
  readStoredDocuments,
  type MockDocument,
  type SupabaseDocumentRecord,
  writeStoredDocuments,
} from "@/components/mockDocuments";
import { LifecycleBadge } from "@/components/StatusBadge";
import { Surface } from "@/components/Surface";
import { getBrowserSupabaseClient, isSupabaseConfigured as hasSupabaseEnv } from "@/components/supabaseClient";
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspaces";

function logDocumentsDebug(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "development") {
    console.info(`[RegSpan documents] ${message}`, details ?? {});
  }
}

function formatSectionsLabel(label: string) {
  return label
    .replace(/\bchunks\b/gi, "source excerpts")
    .replace(/\bsections\b/gi, "source excerpts")
    .replace(/\bPending\b/i, "Not prepared yet");
}

function documentLifecycleLabel(status: MockDocument["status"]) {
  switch (status) {
    case "Uploaded":
    case "Queued":
      return "Preparing source text";
    case "Processing":
      return "Preparing source text";
    case "Processed":
      return "Ready for Analysis";
    case "Failed":
      return "Source text preparation failed";
    case "Needs Review":
      return "Needs reviewer confirmation";
  }
}

function documentLifecycleNextStep(status: MockDocument["status"]) {
  switch (status) {
    case "Uploaded":
    case "Queued":
      return "Source text preparation starts automatically after upload.";
    case "Processing":
      return "RegSpan is preparing source text for Analysis.";
    case "Processed":
      return "This document can be included when you run Analysis.";
    case "Failed":
      return "Reprocess or replace this document.";
    case "Needs Review":
      return "Review this document before relying on its evidence.";
  }
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_DOCUMENT_TYPE = "Information Security";
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
    setMessage(`Queued ${targetIds.size} document${targetIds.size === 1 ? "" : "s"} for source text preparation.`);
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
            : `Queued ${succeeded} document${succeeded === 1 ? "" : "s"} for source text preparation.`,
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
      setError("Choose a PDF before uploading.");
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
      setWarning("");
      setMessage("");

      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) {
          throw new Error(sessionError?.message || "Your session has expired. Log in again.");
        }

        const formData = new FormData();
        formData.set("file", selectedFile);

        const response = await fetch("/api/documents", {
          method: "POST",
          headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
          body: formData,
        });
        const result = (await response.json()) as {
          ok?: boolean;
          error?: string;
          processingQueued?: boolean;
          processingError?: string | null;
        };

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "Document upload failed.");
        }

        resetForm();
        await loadDocuments();
        if (result.processingQueued) {
          setMessage("Document uploaded. Source text preparation has started.");
        } else {
          setWarning(
            result.processingError
              ? `Document uploaded, but source text preparation could not start: ${result.processingError}`
              : "Document uploaded, but source text preparation could not start. Use Prepare again to retry.",
          );
        }
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
      type: DEFAULT_DOCUMENT_TYPE,
      status: "Queued",
      uploaded: "Just now",
      chunks: "Pending",
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
      updateStoredDocument(newDocument.id, { status: "Processed", chunks: "18 source excerpts" });
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
            <Button variant="appSecondary" onClick={() => setIsSelectMode(true)} disabled={!hasDocuments || isBulkBusy || isSelectMode}>
              Select documents
            </Button>
            <Button variant="appPrimary" onClick={() => setIsUploadOpen(true)} disabled={isBulkBusy}>
              Upload document
            </Button>
          </div>
        }
      />

      {warning ? (
        <Alert tone="warning">{warning}</Alert>
      ) : null}

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      {message ? (
        <Alert tone="success">{message}</Alert>
      ) : null}

      {isSelectMode ? (
        <Surface as="section" className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" padding="md">
          <label className="flex items-center gap-3 text-sm font-semibold text-app-text">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              aria-label="Select all documents"
              className="size-4 rounded border-app-border text-app-accent focus:ring-app-accent"
            />
            <span>{selectedCount} of {documents.length} selected</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="danger"
              onClick={() => void runBulkAction("delete", "selected")}
              disabled={selectedCount === 0 || isBulkBusy}
            >
              {bulkAction === "delete-selected" ? "Deleting..." : `Delete selected (${selectedCount})`}
            </Button>
            <Button
              variant="appSecondary"
              onClick={() => void runBulkAction("process", "selected")}
              disabled={selectedCount === 0 || isBulkBusy}
            >
              {bulkAction === "process-selected" ? "Preparing..." : `Prepare selected (${selectedCount})`}
            </Button>
            <Button
              variant="appSecondary"
              onClick={() => void runBulkAction("process", "all")}
              disabled={!hasDocuments || isBulkBusy}
            >
              {bulkAction === "process-all" ? "Preparing..." : "Prepare all"}
            </Button>
            <Button
              variant="danger"
              onClick={() => void runBulkAction("delete", "all")}
              disabled={!hasDocuments || isBulkBusy}
            >
              {bulkAction === "delete-all" ? "Deleting..." : "Delete all"}
            </Button>
            <Button variant="appSecondary" onClick={clearSelection} disabled={isBulkBusy}>
              Cancel
            </Button>
          </div>
        </Surface>
      ) : null}

      {isUploadOpen ? (
        <Surface as="section" padding="lg">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-app-text">Add a document</h2>
              <p className="mt-2 text-sm leading-6 text-app-muted">
                Upload a PDF for secure storage and source text preparation.
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

          <form className="mt-6 grid max-w-2xl gap-5" onSubmit={handleSubmit} noValidate>
            <label className="block min-w-0">
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
              {selectedFile ? (
                <span className="mt-2 block max-w-full text-xs font-medium leading-5 text-app-muted [overflow-wrap:anywhere]">
                  {selectedFile.name}
                </span>
              ) : null}
            </label>

            <p className="text-sm leading-6 text-app-muted">
              RegSpan will save the PDF, prepare source text automatically, and mark it Ready for Analysis when client source excerpts are available.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" variant="appPrimary" disabled={isSubmitting}>
                {isSubmitting ? "Uploading..." : "Upload document"}
              </Button>
              <Button type="button" variant="appSecondary" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </Surface>
      ) : null}

      {isLoading ? (
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <EmptyState
          action={(
            <Button variant="appPrimary" onClick={() => setIsUploadOpen(true)}>
              Upload document
            </Button>
          )}
          icon={<span className="font-mono text-[10px] font-bold">PDF</span>}
          title="No documents yet"
        >
          <p>
            Upload a policy or procedure to prepare source text for evidence review.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="hidden lg:block">
            <DataTable
              columns={[
                ...(isSelectMode ? ["Select"] : []),
                "Document name",
                "Type",
                "Review status",
                "Uploaded",
                "Source excerpts",
                "Actions",
              ]}
              minWidth={isSelectMode ? "min-w-[900px]" : "min-w-[760px]"}
            >
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
                  <td className="min-w-0 px-4 py-4 font-medium text-app-text">
                    <div className="flex min-w-0 items-center gap-3">
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md border border-app-border bg-app-elevated font-mono text-[10px] font-bold text-app-accent">PDF</span>
                      <span className="block min-w-0 max-w-[360px] whitespace-normal break-words leading-5 [overflow-wrap:anywhere]" title={document.name}>{document.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-app-muted">{document.type}</td>
                  <td className="px-4 py-4">
                    <div className="space-y-1">
                      <LifecycleBadge label={documentLifecycleLabel(document.status)} value={document.status} />
                      <p className="max-w-[220px] text-xs leading-5 text-app-muted">
                        {documentLifecycleNextStep(document.status)}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-app-muted">{document.uploaded}</td>
                  <td className="px-4 py-4 text-app-muted">{formatSectionsLabel(document.chunks)}</td>
                  <td className="px-4 py-4">
                    <Link className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-semibold text-app-accent transition-colors hover:bg-app-accent-soft hover:text-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent" href={`/documents/${document.id}`}>
                      Review <span aria-hidden="true">→</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </DataTable>
          </div>

          <div className="grid gap-3 lg:hidden">
            {documents.map((document) => (
              <Surface key={document.id} className={selectedDocumentIds.has(document.id) ? "border-app-accent/30 bg-app-accent-soft/35" : ""} padding="md">
                <div className="flex items-start gap-3">
                  {isSelectMode ? (
                    <input
                      type="checkbox"
                      checked={selectedDocumentIds.has(document.id)}
                      onChange={() => toggleDocumentSelection(document.id)}
                      aria-label={`Select ${document.name}`}
                      className="mt-1 size-4 rounded border-app-border text-app-accent focus:ring-app-accent"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words font-semibold leading-5 text-app-text [overflow-wrap:anywhere]" title={document.name}>{document.name}</p>
                        <p className="mt-1 break-words text-xs font-medium text-app-muted [overflow-wrap:anywhere]">{document.type} · Uploaded {document.uploaded}</p>
                      </div>
                      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md border border-app-border bg-app-elevated font-mono text-[10px] font-bold text-app-accent">PDF</span>
                    </div>
                    <div className="mt-3 space-y-1">
                      <LifecycleBadge label={documentLifecycleLabel(document.status)} value={document.status} />
                      <p className="text-xs leading-5 text-app-muted">{documentLifecycleNextStep(document.status)}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-app-muted">
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">Source excerpts: {formatSectionsLabel(document.chunks)}</span>
                      <Link className="shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-app-accent transition-colors hover:bg-app-accent-soft hover:text-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent" href={`/documents/${document.id}`}>
                        Review
                      </Link>
                    </div>
                  </div>
                </div>
              </Surface>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
