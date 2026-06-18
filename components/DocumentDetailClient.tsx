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

const chunkPreviews = [
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

function getTimeline(status: DocumentStatus): TimelineStep[] {
  if (status === "Uploaded") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material and metadata are available for review.", state: "complete" },
      { label: "Text extraction", status: "Not connected", detail: "Text extraction is not connected yet.", state: "pending" },
      { label: "Chunking", status: "Not connected", detail: "Chunking is not connected yet.", state: "pending" },
      { label: "Evidence mapping", status: "Not connected", detail: "Evidence mapping is not connected yet.", state: "pending" },
    ];
  }

  if (status === "Processed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material is available in the demo workspace.", state: "complete" },
      { label: "Text extraction", status: "Demo complete", detail: "This is a demo review state; no real extraction has run in the browser.", state: "complete" },
      { label: "Chunking", status: "Demo complete", detail: "Mock chunk previews are shown for layout review only.", state: "complete" },
      { label: "Evidence mapping", status: "Not connected", detail: "Evidence mapping is not connected yet.", state: "pending" },
    ];
  }

  if (status === "Processing") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material is available for review.", state: "complete" },
      { label: "Text extraction", status: "Queued", detail: "Backend extraction is not connected yet.", state: "current" },
      { label: "Chunking", status: "Pending", detail: "Chunking is not connected yet.", state: "pending" },
      { label: "Evidence mapping", status: "Pending", detail: "Evidence mapping is not connected yet.", state: "pending" },
    ];
  }

  if (status === "Needs Review") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material is available for reviewer attention.", state: "complete" },
      { label: "Text extraction", status: "Review needed", detail: "This demo state needs reviewer attention before report use.", state: "review" },
      { label: "Chunking", status: "Review needed", detail: "Chunk grouping should be checked before report use.", state: "review" },
      { label: "Evidence mapping", status: "Not connected", detail: "Evidence mapping is not connected yet.", state: "pending" },
    ];
  }

  if (status === "Failed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material was added to the demo workspace.", state: "complete" },
      { label: "Text extraction", status: "Failed", detail: "Processing could not continue for this demo document.", state: "blocked" },
      { label: "Chunking", status: "Blocked", detail: "Chunking is blocked until processing is retried.", state: "blocked" },
      { label: "Evidence mapping", status: "Blocked", detail: "Evidence mapping is not available for this document.", state: "blocked" },
    ];
  }

  return [
    { label: "Uploaded", status: "Complete", detail: "Source material was added for review.", state: "complete" },
    { label: "Text extraction", status: "Queued", detail: "Backend extraction is not connected yet.", state: "pending" },
    { label: "Chunking", status: "Pending", detail: "Chunking is not connected yet.", state: "pending" },
    { label: "Evidence mapping", status: "Pending", detail: "Evidence mapping is not connected yet.", state: "pending" },
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
          setDocument(mapSupabaseDocument(data as SupabaseDocumentRecord));
          setHasLoaded(true);
          return;
        }
      }

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

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured, so reprocessing metadata cannot be updated.");
      return;
    }

    resetActionState();
    setActiveAction("reprocess");
    const { error: updateError } = await supabase
      .from("documents")
      .update({ status: "Queued", chunks_label: "Pending" })
      .eq("workspace_id", "demo")
      .eq("id", document.id);

    if (updateError) {
      setError(`Reprocess update failed: ${updateError.message}`);
    } else {
      setMessage("Document marked for reprocessing. Backend extraction is not connected yet.");
      setRefreshKey((current) => current + 1);
    }

    setActiveAction(null);
  }

  async function handleReplace() {
    if (!document || !replacementFile) {
      setError("Choose a replacement source file first.");
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

    setMessage("Replacement uploaded. Backend extraction is not connected yet.");
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
      "Remove this document metadata and stored source file from the demo workspace?",
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
        description={`${document.type} · Uploaded ${document.uploaded} · ${document.chunks}`}
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
              {activeAction === "reprocess" ? "Queuing..." : "Reprocess"}
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
              Replace
            </button>
            <button
              type="button"
              disabled={Boolean(activeAction)}
              onClick={handleDelete}
              className="h-9 rounded-lg border border-app-danger-soft bg-app-danger-soft px-3 text-sm font-semibold text-app-danger transition-colors hover:border-app-danger hover:bg-app-danger-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-danger disabled:cursor-not-allowed disabled:opacity-60"
            >
              {activeAction === "delete" ? "Deleting..." : "Delete"}
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
            { label: "Chunks", value: document.chunks },
            { label: "Status", value: document.status },
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
          <h2 className="text-lg font-semibold text-app-text">Processing timeline</h2>
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
            <h2 className="text-lg font-semibold text-app-text">Extracted chunk preview</h2>
            {document.status === "Processed" ? (
              <div className="mt-5 space-y-3">
                {chunkPreviews.map((chunk) => (
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
                Chunk previews will appear here after backend document processing is connected.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-app-soft">
            <h2 className="text-lg font-semibold text-app-text">Evidence mapping status</h2>
            <p className="mt-3 rounded-xl border border-app-border bg-app-elevated p-4 text-sm leading-6 text-app-muted">
              Reg S-P control mapping will run after backend processing and retrieval are connected.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
