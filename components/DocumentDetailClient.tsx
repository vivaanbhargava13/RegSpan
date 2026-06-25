"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useState } from "react";
import {
  findMockDocument,
  mapSupabaseDocument,
  type DocumentStatus,
  type MockDocument,
  type SupabaseDocumentRecord,
} from "@/components/mockDocuments";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";
import type { DocumentChunk } from "@/lib/types/ingestion";
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspaces";

type DocumentDetailClientProps = {
  documentId: string;
};

type TimelineState = "complete" | "current" | "pending" | "blocked" | "review";
type ActionName = "reprocess" | "replace" | "delete";

type TimelineStep = {
  label: string;
  status: string;
  detail: string;
  state: TimelineState;
};

type HierarchyHeading = {
  children?: unknown[];
};

type HierarchyRow = {
  hierarchy_json: {
    headings?: HierarchyHeading[];
  } | null;
};

type HierarchySummary = {
  isGenerated: boolean;
  topLevelCount: number;
  childCount: number;
};

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

function validateSelectedPdf(file: File) {
  if (file.size === 0) return "The PDF file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "The PDF exceeds the 10 MB upload limit.";
  if (file.type !== "application/pdf" || !file.name.toLowerCase().endsWith(".pdf")) {
    return "Only PDF files are accepted.";
  }
  return null;
}

function formatSectionsLabel(label: string) {
  return label.replace(/\bchunks\b/gi, "sections");
}

function formatPageRange(pageStart: number | null, pageEnd: number | null) {
  if (pageStart === null && pageEnd === null) {
    return "Page unavailable";
  }

  if (pageStart === pageEnd || pageEnd === null) {
    return `Page ${pageStart}`;
  }

  return `Pages ${pageStart ?? pageEnd}–${pageEnd}`;
}

function summarizeHierarchy(row: HierarchyRow | null): HierarchySummary {
  const headings = Array.isArray(row?.hierarchy_json?.headings)
    ? row.hierarchy_json.headings
    : [];
  const childCount = headings.reduce(
    (count, heading) =>
      count + (Array.isArray(heading.children) ? heading.children.length : 0),
    0,
  );

  return {
    isGenerated: headings.length > 0,
    topLevelCount: headings.length,
    childCount,
  };
}

function formatHierarchySummary(summary: HierarchySummary) {
  if (!summary.isGenerated) {
    return "Not generated";
  }

  const topLevelLabel = `${summary.topLevelCount} top-level section${
    summary.topLevelCount === 1 ? "" : "s"
  }`;
  const childLabel = `${summary.childCount} child section${
    summary.childCount === 1 ? "" : "s"
  }`;

  return `Generated · ${topLevelLabel} · ${childLabel}`;
}

const requirementMatchingStep: TimelineStep = {
  label: "Requirement matching",
  status: "Not connected",
  detail: "Reg S-P requirement matching has not been implemented yet.",
  state: "pending",
};

function getTimeline(status: DocumentStatus, chunkCount: number): TimelineStep[] {
  if (status === "Uploaded") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "PDF text extraction", status: "Ready", detail: "Start processing to extract text from the stored PDF.", state: "pending" },
      { label: "Chunking", status: "Pending", detail: "Document chunks will be generated after PDF text extraction.", state: "pending" },
      requirementMatchingStep,
    ];
  }

  if (status === "Processed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      {
        label: "PDF text extraction",
        status: "Complete",
        detail: chunkCount > 0
          ? "PDF text was extracted by the secure ingestion worker."
          : "PDF processing completed, but no extracted chunks are currently available.",
        state: "complete",
      },
      {
        label: "Chunking",
        status: chunkCount > 0 ? "Complete" : "No chunks",
        detail: chunkCount > 0
          ? "Document chunks were generated from extracted PDF text."
          : "Reprocess this document to generate extracted text chunks.",
        state: chunkCount > 0 ? "complete" : "review",
      },
      requirementMatchingStep,
    ];
  }

  if (status === "Processing") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "PDF text extraction", status: "Processing", detail: "The secure ingestion worker is extracting text from the PDF.", state: "current" },
      { label: "Chunking", status: "Pending", detail: "Chunks will be stored after text extraction completes.", state: "pending" },
      requirementMatchingStep,
    ];
  }

  if (status === "Needs Review") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "PDF text extraction", status: "Needs review", detail: "Extracted PDF text requires reviewer attention.", state: "review" },
      { label: "Chunking", status: "Needs review", detail: chunkCount > 0 ? "Review the generated chunks before continuing." : "No extracted chunks are available for review.", state: "review" },
      requirementMatchingStep,
    ];
  }

  if (status === "Failed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "PDF text extraction", status: "Failed", detail: "The ingestion worker could not extract usable text from this PDF.", state: "blocked" },
      { label: "Chunking", status: "Blocked", detail: "Chunks were not generated because PDF text extraction failed.", state: "blocked" },
      requirementMatchingStep,
    ];
  }

  return [
    { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
    { label: "PDF text extraction", status: "Queued", detail: "The document is queued for secure PDF text extraction.", state: "current" },
    { label: "Chunking", status: "Pending", detail: "Chunking will begin after the worker extracts PDF text.", state: "pending" },
    requirementMatchingStep,
  ];
}

function getChunkEmptyState(status: DocumentStatus) {
  if (status === "Processed") {
    return "Processing completed, but no extracted chunks are available. Reprocess the document to run PDF extraction and chunking again.";
  }
  if (status === "Processing") {
    return "PDF text extraction and chunking are currently in progress.";
  }
  if (status === "Queued") {
    return "This document is queued. Extracted chunks will appear after processing completes.";
  }
  if (status === "Failed") {
    return "Extracted chunks are unavailable because PDF processing failed. Reprocess the document to try again.";
  }
  return "Start processing this document to extract PDF text and generate chunks.";
}

const stateClasses: Record<TimelineState, string> = {
  complete: "border-app-success/20 bg-app-success text-white",
  current: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  pending: "border-app-border bg-app-elevated text-app-muted",
  blocked: "border-app-danger/20 bg-app-danger-soft text-app-danger",
  review: "border-app-review/20 bg-app-review-soft text-app-review",
};

export function DocumentDetailClient({ documentId }: DocumentDetailClientProps) {
  const router = useRouter();
  const [document, setDocument] = useState<MockDocument | null>(null);
  const [chunks, setChunks] = useState<DocumentChunk[]>([]);
  const [hierarchySummary, setHierarchySummary] = useState<HierarchySummary | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeAction, setActiveAction] = useState<ActionName | null>(null);
  const [isReplaceOpen, setIsReplaceOpen] = useState(false);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDocument() {
      const supabase = getBrowserSupabaseClient();

      if (supabase) {
        let currentWorkspace: CurrentWorkspace;

        try {
          currentWorkspace = await getCurrentWorkspace(supabase);
        } catch (workspaceError) {
          setError(
            workspaceError instanceof Error
              ? workspaceError.message
              : "Unable to load your workspace.",
          );
          setDocument(null);
          setHasLoaded(true);
          return;
        }

        const { data, error: loadError } = await supabase
          .from("documents")
          .select("*")
          .eq("workspace_id", currentWorkspace.id)
          .eq("id", documentId)
          .maybeSingle();

        if (loadError) {
          setError(`Unable to load Supabase document metadata: ${loadError.message}`);
        }

        if (data) {
          const [chunksResult, hierarchyResult] = await Promise.all([
            supabase
              .from("document_chunks")
              .select("*")
              .eq("workspace_id", currentWorkspace.id)
              .eq("document_id", documentId)
              .order("chunk_index", { ascending: true }),
            supabase
              .from("document_hierarchy")
              .select("hierarchy_json")
              .eq("workspace_id", currentWorkspace.id)
              .eq("document_id", documentId)
              .maybeSingle(),
          ]);

          const loadedChunks = chunksResult.error
            ? []
            : ((chunksResult.data ?? []) as DocumentChunk[]);

          if (chunksResult.error || hierarchyResult.error) {
            setWarning(
              "Document metadata loaded, but processed data is unavailable. Confirm the ingestion migration has been applied.",
            );
          }

          setChunks(loadedChunks);
          setHierarchySummary(
            hierarchyResult.error
              ? null
              : summarizeHierarchy(hierarchyResult.data as HierarchyRow | null),
          );
          setDocument(mapSupabaseDocument(data as SupabaseDocumentRecord));
          setHasLoaded(true);
          return;
        }

        setChunks([]);
        setHierarchySummary(null);
        setDocument(null);
        setHasLoaded(true);
        return;
      }

      setChunks([]);
      setHierarchySummary(null);
      setDocument(findMockDocument(documentId));
      setHasLoaded(true);
    }

    void loadDocument();
  }, [documentId, refreshKey]);

  function resetActionState() {
    setError("");
    setWarning("");
    setMessage("");
  }

  async function handleReprocess() {
    if (!document) {
      return;
    }

    resetActionState();
    setActiveAction("reprocess");
    try {
      const supabase = getBrowserSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase Auth is not configured.");
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || "Your session has expired. Log in again.");
      }

      const response = await fetch(`/api/documents/${document.id}/process`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
      });
      const result = (await response.json()) as {
        ok?: boolean;
        jobId?: string;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Processing could not be started.");
      }

      setMessage("Document processing was queued securely.");
      router.refresh();
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Processing could not be started.",
      );
    }

    setActiveAction(null);
  }

  async function handleReplace() {
    if (!document || !replacementFile) {
      setError("Choose a replacement file first.");
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured, so replacement upload cannot run.");
      return;
    }

    const fileError = validateSelectedPdf(replacementFile);
    if (fileError) {
      setError(fileError);
      return;
    }

    resetActionState();
    setActiveAction("replace");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || "Your session has expired. Log in again.");
      }

      const formData = new FormData();
      formData.set("file", replacementFile);
      const response = await fetch(`/api/documents/${document.id}/replace`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
        body: formData,
      });
      const result = (await response.json()) as {
        ok?: boolean;
        cleanupWarning?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Replacement failed.");
      }

      if (result.cleanupWarning) {
        setWarning("Replacement succeeded; old object cleanup will need server follow-up.");
      }
      setMessage("Replacement uploaded. Reprocess the document to extract text and generate chunks.");
      setReplacementFile(null);
      setIsReplaceOpen(false);
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Replacement failed.");
    } finally {
      setActiveAction(null);
    }
  }

  async function handleDelete() {
    if (!document) {
      return;
    }

    const confirmed = window.confirm(
      "Remove this document and stored file from your workspace?",
    );

    if (!confirmed) {
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured, so this document cannot be deleted.");
      return;
    }

    resetActionState();
    setActiveAction("delete");
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || "Your session has expired. Log in again.");
      }

      const response = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
      });
      const result = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Document delete failed.");
      }
      router.push("/documents");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Document delete failed.");
      setActiveAction(null);
    }
  }

  function handleReplacementFileChange(event: ChangeEvent<HTMLInputElement>) {
    setReplacementFile(event.target.files?.[0] ?? null);
    setError("");
  }

  if (!hasLoaded) {
    return (
      <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
        Loading document review…
      </div>
    );
  }

  if (!document) {
    return (
      <div className="space-y-5">
        <Link href="/documents" className="inline-flex items-center gap-2 text-sm font-semibold text-app-accent">
          <span aria-hidden="true">←</span> Back to documents
        </Link>
        <div className="app-card p-6">
          <h1 className="text-2xl font-semibold text-app-text">Document not found</h1>
          <p className="mt-3 text-sm leading-6 text-app-muted">
            This document is not available in your current workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Link href="/documents" className="inline-flex items-center gap-2 rounded-lg px-1 py-1 text-sm font-semibold text-app-accent transition-colors hover:text-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent">
        <span aria-hidden="true">←</span> Back to documents
      </Link>

      <PageHeader
        eyebrow="Document review"
        title={document.name}
        description={`${document.type} · Uploaded ${document.uploaded} · ${document.status}`}
      />

      {message ? (
        <p className="rounded-xl border border-app-success/20 bg-app-success-soft px-4 py-3 text-sm font-medium text-app-success shadow-sm">
          {message}
        </p>
      ) : null}

      {warning ? (
        <p className="rounded-xl border border-app-warning/20 bg-app-warning-soft px-4 py-3 text-sm font-medium text-app-warning shadow-sm">
          {warning}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger shadow-sm">
          {error}
        </p>
      ) : null}

      <section className="app-card overflow-hidden">
        <div className="border-b border-app-border bg-app-elevated/55 px-5 py-4 lg:px-6">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge>{document.status}</StatusBadge>
              <span className="text-xs text-app-muted">Secure document workspace</span>
            </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:items-center">
            <button
              type="button"
              disabled={Boolean(activeAction)}
              onClick={handleReprocess}
              className="h-9 rounded-xl border border-app-border bg-app-surface px-3.5 text-sm font-semibold text-app-muted shadow-sm transition-colors hover:border-app-accent hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeAction === "reprocess" ? "Reprocessing..." : "Reprocess"}
            </button>
            <button
              type="button"
              disabled={Boolean(activeAction)}
              onClick={() => {
                resetActionState();
                setIsReplaceOpen(true);
              }}
              className="h-9 rounded-xl border border-app-border bg-app-surface px-3.5 text-sm font-semibold text-app-muted shadow-sm transition-colors hover:border-app-accent hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Replace file
            </button>
            <button
              type="button"
              disabled={Boolean(activeAction)}
              onClick={handleDelete}
              className="h-9 rounded-xl border border-app-danger/20 bg-app-danger-soft px-3.5 text-sm font-semibold text-app-danger transition-colors hover:border-app-danger hover:bg-app-danger/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeAction === "delete" ? "Deleting..." : "Delete document"}
            </button>
          </div>
        </div>
        </div>

        <div className="p-5 lg:p-6">

        {isReplaceOpen ? (
          <div className="mb-6 rounded-xl border border-app-border bg-app-elevated/65 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block flex-1">
                <span className="text-sm font-semibold text-app-text">Replacement file</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleReplacementFileChange}
                  className="app-field mt-2 block w-full px-3 py-2 text-sm text-app-muted file:mr-3 file:rounded-lg file:border-0 file:bg-app-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-app-accent"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(activeAction)}
                  onClick={handleReplace}
                  className="h-10 rounded-xl bg-app-accent px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeAction === "replace" ? "Replacing..." : "Replace file"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsReplaceOpen(false);
                    setReplacementFile(null);
                  }}
                  className="h-10 rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-muted shadow-sm transition-colors hover:border-app-accent hover:text-app-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Document type", value: document.type },
            { label: "Uploaded", value: document.uploaded },
            { label: "Sections", value: formatSectionsLabel(document.chunks) },
            { label: "Review status", value: document.status },
            ...(chunks.length > 0 ? [{ label: "Processed chunks", value: String(chunks.length) }] : []),
            ...(hierarchySummary !== null
              ? [{ label: "Hierarchy", value: formatHierarchySummary(hierarchySummary) }]
              : []),
            ...(document.fileSize ? [{ label: "File size", value: `${Math.round(document.fileSize / 1024)} KB` }] : []),
            ...(document.mimeType ? [{ label: "MIME type", value: document.mimeType }] : []),
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-app-border bg-app-elevated/65 p-4">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">{item.label}</dt>
              <dd className="mt-2 break-words text-sm font-semibold leading-5 text-app-text">{item.value}</dd>
            </div>
          ))}
        </dl>

        {document.storagePath ? (
          <div className="mt-5 rounded-xl border border-app-border bg-app-elevated/45 p-4">
            <h2 className="text-sm font-semibold text-app-text">Storage path</h2>
            <p className="mt-2 truncate rounded-lg border border-app-border bg-app-surface px-3 py-2 font-mono text-[11px] text-app-muted" title={document.storagePath}>
              {document.storagePath}
            </p>
          </div>
        ) : null}

        {document.notes ? (
          <div className="mt-5 rounded-xl border border-app-border bg-app-elevated/65 p-4">
            <h2 className="text-sm font-semibold text-app-text">Notes</h2>
            <p className="mt-2 text-sm leading-6 text-app-muted">{document.notes}</p>
          </div>
        ) : null}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="app-card p-5 lg:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="app-section-title">Processing timeline</h2>
            <span className="text-xs font-medium text-app-muted">4 stages</span>
          </div>
          <div className="mt-5 space-y-3">
            {getTimeline(document.status, chunks.length).map((item, index) => (
              <div key={item.label} className="flex gap-3 rounded-xl border border-app-border bg-app-elevated/65 p-4">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-xs font-bold shadow-sm ${stateClasses[item.state]}`}>
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-app-text">{item.label}</span>
                    <span className="rounded-full bg-app-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-app-muted ring-1 ring-inset ring-app-border">{item.status}</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-app-muted">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="app-card p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-accent">Evidence workspace</p>
                <h2 className="mt-1 app-section-title">Extracted chunks</h2>
              </div>
              {chunks.length > 0 ? <span className="rounded-full bg-app-accent-soft px-2.5 py-1 text-xs font-semibold text-app-accent">{chunks.length} stored</span> : null}
            </div>
            {chunks.length > 0 ? (
              <div className="mt-5 space-y-4">
                {chunks.map((chunk) => (
                  <article key={chunk.id} className="group relative overflow-hidden rounded-xl border border-app-border bg-app-elevated/60 p-4 transition-colors hover:border-app-border-strong hover:bg-app-elevated">
                    <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-app-accent opacity-70" />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-app-accent">
                          Evidence chunk {String(chunk.chunk_index).padStart(3, "0")}
                        </span>
                        <h3 className="mt-1 text-sm font-semibold text-app-text">
                          {chunk.section_path || chunk.section_heading || "Unsectioned content"}
                        </h3>
                      </div>
                      <span className="shrink-0 rounded-lg border border-app-border bg-app-surface px-2.5 py-1 font-mono text-[10px] font-semibold text-app-muted">
                        {formatPageRange(chunk.page_start, chunk.page_end)}
                      </span>
                    </div>
                    <p className="mt-3 border-t border-app-border pt-3 text-sm leading-6 text-app-muted">
                      {chunk.content.length > 220 ? `${chunk.content.slice(0, 220)}…` : chunk.content}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-app-border-strong bg-app-elevated/55 p-5 text-sm leading-6 text-app-muted">
                {getChunkEmptyState(document.status)}
              </p>
            )}
          </div>

          <div className="app-card p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="app-section-title">Requirement matching</h2>
              <span className="rounded-full border border-app-border bg-app-elevated px-2.5 py-1 text-[11px] font-semibold text-app-muted">Not connected</span>
            </div>
            <p className="mt-4 rounded-xl border border-dashed border-app-border-strong bg-app-elevated/55 p-4 text-sm leading-6 text-app-muted">
              {chunks.length > 0
                ? "Reg S-P requirement matching is not connected yet. Extracted chunks are ready for a future matching workflow."
                : "Reg S-P requirement matching is not connected yet."}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
