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

const fallbackChunkPreviews = [
  {
    title: "Preparation and incident response procedures",
    page: "Page 4",
    excerpt: "Mock excerpt: procedures outline preparation, escalation, and reviewer coordination steps.",
  },
  {
    title: "Detection and analysis process",
    page: "Page 7",
    excerpt: "Mock excerpt: detection criteria and analysis responsibilities are summarized for review.",
  },
  {
    title: "Containment and recovery procedures",
    page: "Page 11",
    excerpt: "Mock excerpt: containment, recovery, and post-incident documentation steps are noted.",
  },
];

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

function getTimeline(status: DocumentStatus): TimelineStep[] {
  if (status === "Uploaded") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Text reading", status: "Not connected", detail: "Not connected yet.", state: "pending" },
      { label: "Document sectioning", status: "Not connected", detail: "Not connected yet.", state: "pending" },
      { label: "Requirement matching", status: "Not connected", detail: "Not connected yet.", state: "pending" },
    ];
  }

  if (status === "Processed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Text reading", status: "Demo complete", detail: "This is a demo review state; no real text reading has run in the browser.", state: "complete" },
      { label: "Document sectioning", status: "Demo complete", detail: "Mock document sections are shown for layout review only.", state: "complete" },
      { label: "Requirement matching", status: "Not connected", detail: "Not connected yet.", state: "pending" },
    ];
  }

  if (status === "Processing") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Text reading", status: "Queued", detail: "Not connected yet.", state: "current" },
      { label: "Document sectioning", status: "Pending", detail: "Not connected yet.", state: "pending" },
      { label: "Requirement matching", status: "Pending", detail: "Not connected yet.", state: "pending" },
    ];
  }

  if (status === "Needs Review") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Text reading", status: "Needs review", detail: "This demo state needs reviewer attention before report use.", state: "review" },
      { label: "Document sectioning", status: "Needs review", detail: "Document sections should be checked before report use.", state: "review" },
      { label: "Requirement matching", status: "Not connected", detail: "Not connected yet.", state: "pending" },
    ];
  }

  if (status === "Failed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Text reading", status: "Failed", detail: "Review could not continue for this demo document.", state: "blocked" },
      { label: "Document sectioning", status: "Blocked", detail: "Document sectioning is blocked until review is retried.", state: "blocked" },
      { label: "Requirement matching", status: "Blocked", detail: "Requirement matching is not available for this document.", state: "blocked" },
    ];
  }

  return [
    { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
    { label: "Text reading", status: "Queued", detail: "Not connected yet.", state: "pending" },
    { label: "Document sectioning", status: "Pending", detail: "Not connected yet.", state: "pending" },
    { label: "Requirement matching", status: "Pending", detail: "Not connected yet.", state: "pending" },
  ];
}

const stateClasses: Record<TimelineState, string> = {
  complete: "bg-app-success text-app-bg",
  current: "bg-app-warning-soft text-app-warning",
  pending: "bg-app-elevated text-app-muted",
  blocked: "bg-app-danger-soft text-app-danger",
  review: "bg-app-warning-soft text-app-warning",
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
        const { data, error: loadError } = await supabase
          .from("documents")
          .select("*")
          .eq("workspace_id", "demo")
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
              .eq("workspace_id", "demo")
              .eq("document_id", documentId)
              .order("chunk_index", { ascending: true }),
            supabase
              .from("document_hierarchy")
              .select("hierarchy_json")
              .eq("workspace_id", "demo")
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
      const response = await fetch(`/api/documents/${document.id}/mock-process`, {
        method: "POST",
      });
      const result = (await response.json()) as {
        ok?: boolean;
        chunkCount?: number;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Mock processing failed.");
      }

      setMessage(`Mock processing completed with ${result.chunkCount ?? 0} chunks.`);
      router.refresh();
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Mock processing failed.",
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

    resetActionState();
    setActiveAction("replace");
    const uploadedAt = new Date().toISOString();
    const replacementPath = `demo/${document.id}/replacement-${Date.now()}-${replacementFile.name}`;
    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(replacementPath, replacementFile, {
        contentType: replacementFile.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      setError(`Replacement upload failed: ${uploadError.message}`);
      setActiveAction(null);
      return;
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        filename: replacementFile.name,
        storage_path: replacementPath,
        file_size: replacementFile.size,
        mime_type: replacementFile.type || null,
        status: "Uploaded",
        chunks_label: "Pending",
        uploaded_at: uploadedAt,
      })
      .eq("workspace_id", "demo")
      .eq("id", document.id);

    if (updateError) {
      setError(`Replacement metadata update failed: ${updateError.message}`);
      setActiveAction(null);
      return;
    }

    if (document.storagePath) {
      const { error: removeOldError } = await supabase.storage.from("documents").remove([document.storagePath]);
      if (removeOldError) {
        setWarning(`Replacement succeeded, but old storage cleanup failed: ${removeOldError.message}`);
      }
    }

    setMessage("Replacement uploaded. Document reading and matching are not connected yet.");
    setReplacementFile(null);
    setIsReplaceOpen(false);
    setRefreshKey((current) => current + 1);
    setActiveAction(null);
  }

  async function handleDelete() {
    if (!document) {
      return;
    }

    const confirmed = window.confirm(
      "Remove this document and stored file from the demo workspace?",
    );

    if (!confirmed) {
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured, so this document cannot be deleted.");
      return;
    }

    if (!document.storagePath) {
      setError("No storage path is available for this document.");
      return;
    }

    resetActionState();
    setActiveAction("delete");
    const { error: storageDeleteError } = await supabase.storage.from("documents").remove([document.storagePath]);

    if (storageDeleteError) {
      setError(`Storage delete failed: ${storageDeleteError.message}`);
      setActiveAction(null);
      return;
    }

    const { error: rowDeleteError } = await supabase
      .from("documents")
      .delete()
      .eq("workspace_id", "demo")
      .eq("id", document.id);

    if (rowDeleteError) {
      setError(`Document metadata delete failed: ${rowDeleteError.message}`);
      setActiveAction(null);
      return;
    }

    router.push("/documents");
  }

  function handleReplacementFileChange(event: ChangeEvent<HTMLInputElement>) {
    setReplacementFile(event.target.files?.[0] ?? null);
    setError("");
  }

  if (!hasLoaded) {
    return (
      <div className="rounded-2xl border border-app-border bg-app-surface p-5 text-sm font-semibold text-app-muted shadow-app-soft">
        Loading document review...
      </div>
    );
  }

  if (!document) {
    return (
      <div className="space-y-5">
        <Link href="/documents" className="text-sm font-semibold text-app-accent">
          Back to documents
        </Link>
        <div className="rounded-2xl border border-app-border bg-app-surface p-6 shadow-app-soft">
          <h1 className="text-2xl font-semibold text-app-text">Document not found</h1>
          <p className="mt-3 text-sm leading-6 text-app-muted">
            This mock document is not available in the current demo workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/documents" className="text-sm font-semibold text-app-accent transition-colors hover:text-app-accent-hover">
        Back to documents
      </Link>

      <PageHeader
        eyebrow="Document review"
        title={document.name}
        description={`${document.type} · Uploaded ${document.uploaded} · ${document.status}`}
      />

      {message ? (
        <p className="rounded-xl border border-app-success-soft bg-app-success-soft px-4 py-3 text-sm font-medium text-app-success">
          {message}
        </p>
      ) : null}

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

      <section className="rounded-2xl border border-app-border bg-app-surface p-6 shadow-app-soft">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <StatusBadge>{document.status}</StatusBadge>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:items-center">
            <button
              type="button"
              disabled={Boolean(activeAction)}
              onClick={handleReprocess}
              className="h-9 rounded-lg border border-app-border bg-app-elevated px-3 text-sm font-semibold text-app-muted transition-colors hover:border-app-accent hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
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
              className="h-9 rounded-lg border border-app-border bg-app-elevated px-3 text-sm font-semibold text-app-muted transition-colors hover:border-app-accent hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              Replace file
            </button>
            <button
              type="button"
              disabled={Boolean(activeAction)}
              onClick={handleDelete}
              className="h-9 rounded-lg border border-app-danger-soft bg-app-danger-soft px-3 text-sm font-semibold text-app-danger transition-colors hover:border-app-danger hover:bg-app-danger-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeAction === "delete" ? "Deleting..." : "Delete document"}
            </button>
          </div>
        </div>

        {isReplaceOpen ? (
          <div className="mt-6 rounded-xl border border-app-border bg-app-bg p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block flex-1">
                <span className="text-sm font-semibold text-app-text">Replacement file</span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleReplacementFileChange}
                  className="mt-2 block w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-muted file:mr-3 file:rounded-md file:border-0 file:bg-app-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-app-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(activeAction)}
                  onClick={handleReplace}
                  className="h-10 rounded-lg bg-app-accent px-4 text-sm font-semibold text-app-bg transition-colors hover:bg-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {activeAction === "replace" ? "Replacing..." : "Replace file"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsReplaceOpen(false);
                    setReplacementFile(null);
                  }}
                  className="h-10 rounded-lg border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-muted transition-colors hover:border-app-accent hover:text-app-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <dl className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <div key={item.label} className="rounded-xl border border-app-border bg-app-elevated p-4">
              <dt className="text-xs font-semibold uppercase tracking-normal text-app-muted">{item.label}</dt>
              <dd className="mt-2 break-words text-sm font-semibold text-app-text">{item.value}</dd>
            </div>
          ))}
        </dl>

        {document.storagePath ? (
          <div className="mt-6 rounded-xl border border-app-border bg-app-bg p-4">
            <h2 className="text-sm font-semibold text-app-text">Storage path</h2>
            <p className="mt-2 truncate rounded-lg border border-app-border bg-app-surface px-3 py-2 font-mono text-xs text-app-muted" title={document.storagePath}>
              {document.storagePath}
            </p>
          </div>
        ) : null}

        {document.notes ? (
          <div className="mt-6 rounded-xl border border-app-border bg-app-elevated p-4">
            <h2 className="text-sm font-semibold text-app-text">Notes</h2>
            <p className="mt-2 text-sm leading-6 text-app-muted">{document.notes}</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
          <h2 className="text-lg font-semibold text-app-text">Review timeline</h2>
          <div className="mt-5 space-y-3">
            {getTimeline(document.status).map((item, index) => (
              <div key={item.label} className="flex gap-3 rounded-xl border border-app-border bg-app-elevated p-4">
                <span className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${stateClasses[item.state]}`}>
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-app-text">{item.label}</span>
                    <span className="text-xs font-semibold text-app-muted">{item.status}</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-app-muted">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
            <h2 className="text-lg font-semibold text-app-text">Processed chunks</h2>
            {chunks.length > 0 ? (
              <div className="mt-5 space-y-3">
                {chunks.map((chunk) => (
                  <article key={chunk.id} className="rounded-xl border border-app-border bg-app-elevated p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <span className="text-xs font-semibold uppercase tracking-normal text-app-muted">
                          Chunk {chunk.chunk_index}
                        </span>
                        <h3 className="mt-1 text-sm font-semibold text-app-text">
                          {chunk.section_path || chunk.section_heading || "Unsectioned content"}
                        </h3>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-app-muted">
                        {formatPageRange(chunk.page_start, chunk.page_end)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-app-muted">
                      {chunk.content.length > 220 ? `${chunk.content.slice(0, 220)}…` : chunk.content}
                    </p>
                  </article>
                ))}
              </div>
            ) : document.status === "Processed" ? (
              <div className="mt-5 space-y-3">
                {fallbackChunkPreviews.map((chunk) => (
                  <article key={chunk.title} className="rounded-xl border border-app-border bg-app-elevated p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-sm font-semibold text-app-text">{chunk.title}</h3>
                      <span className="text-xs font-semibold text-app-muted">{chunk.page}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-app-muted">{chunk.excerpt}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-app-border bg-app-elevated p-4 text-sm leading-6 text-app-muted">
                Document sections will appear here after document reading is connected.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
            <h2 className="text-lg font-semibold text-app-text">Document matching status</h2>
            <p className="mt-3 rounded-xl border border-app-border bg-app-elevated p-4 text-sm leading-6 text-app-muted">
              Reg S-P requirement matching will run after document reading is connected.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
