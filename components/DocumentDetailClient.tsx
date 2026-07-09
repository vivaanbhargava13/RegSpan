"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import {
  findMockDocument,
  mapSupabaseDocument,
  type DocumentStatus,
  type MockDocument,
  type SupabaseDocumentRecord,
} from "@/components/mockDocuments";
import { PageHeader } from "@/components/PageHeader";
import { LifecycleBadge, StatusBadge } from "@/components/StatusBadge";
import { Surface } from "@/components/Surface";
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
  return label
    .replace(/\bchunks\b/gi, "source excerpts")
    .replace(/\bsections\b/gi, "source excerpts")
    .replace(/\bPending\b/i, "Not prepared yet");
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

function documentLifecycleLabel(status: DocumentStatus) {
  switch (status) {
    case "Uploaded":
    case "Queued":
      return "Preparing source text";
    case "Processing":
      return "Preparing source text";
    case "Processed":
      return "Ready for analysis";
    case "Failed":
      return "Source text preparation failed";
    case "Needs Review":
      return "Needs reviewer confirmation";
  }
}

const requirementMatchingStep: TimelineStep = {
  label: "Ready for analysis",
  status: "Pending",
  detail: "Run analysis after client source excerpts are ready.",
  state: "pending",
};

function getTimeline(status: DocumentStatus, chunkCount: number): TimelineStep[] {
  if (status === "Uploaded") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Prepare source text", status: "Ready", detail: "Start source text preparation from the stored PDF.", state: "pending" },
      { label: "Client source excerpts", status: "Pending", detail: "Client source excerpts will be prepared after source text is available.", state: "pending" },
      requirementMatchingStep,
    ];
  }

  if (status === "Processed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      {
        label: "Prepare source text",
        status: "Complete",
        detail: chunkCount > 0
          ? "Source text is ready for evidence review."
          : "Source-text preparation completed, but no client source excerpts are currently available.",
        state: "complete",
      },
      {
        label: "Client source excerpts",
        status: chunkCount > 0 ? "Complete" : "Needs review",
        detail: chunkCount > 0
          ? "Client source excerpts are ready for analysis."
          : "Reprocess this document to prepare client source excerpts.",
        state: chunkCount > 0 ? "complete" : "review",
      },
      { label: "Ready for analysis", status: "Ready", detail: "This document can be included when you run Analysis.", state: "complete" },
    ];
  }

  if (status === "Processing") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Prepare source text", status: "Preparing", detail: "RegSpan is preparing source text from this PDF.", state: "current" },
      { label: "Client source excerpts", status: "Pending", detail: "Client source excerpts will be available after source text is prepared.", state: "pending" },
      requirementMatchingStep,
    ];
  }

  if (status === "Needs Review") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Prepare source text", status: "Needs review", detail: "Prepared source text requires reviewer attention.", state: "review" },
      { label: "Client source excerpts", status: "Needs review", detail: chunkCount > 0 ? "Review the client source excerpts before continuing." : "No client source excerpts are available for review.", state: "review" },
      requirementMatchingStep,
    ];
  }

  if (status === "Failed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
      { label: "Prepare source text", status: "Failed", detail: "RegSpan could not prepare usable text from this PDF.", state: "blocked" },
      { label: "Client source excerpts", status: "Blocked", detail: "Client source excerpts are unavailable because source text preparation failed.", state: "blocked" },
      requirementMatchingStep,
    ];
  }

  return [
    { label: "Uploaded", status: "Complete", detail: "File and document details are saved.", state: "complete" },
    { label: "Prepare source text", status: "Queued", detail: "The document is queued for source text preparation.", state: "current" },
    { label: "Client source excerpts", status: "Pending", detail: "Client source excerpts will be prepared after source text is available.", state: "pending" },
    requirementMatchingStep,
  ];
}

function getChunkEmptyState(status: DocumentStatus) {
  if (status === "Processed") {
    return "Source-text preparation completed, but no client source excerpts are available. Prepare the document again.";
  }
  if (status === "Processing") {
    return "Source text and client source excerpts are currently being prepared.";
  }
  if (status === "Queued") {
    return "This document is queued. Client source excerpts will appear after source text is prepared.";
  }
  if (status === "Failed") {
    return "Client source excerpts are unavailable because source text preparation failed. Reprocess the document to try again.";
  }
  return "Start preparing this document to create source text and client source excerpts.";
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
              "Document metadata loaded, but prepared source excerpts are unavailable. Prepare this document again or confirm local setup is complete.",
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
        throw new Error(result.error || "Preparation could not be started.");
      }

      setMessage("Document preparation was queued. RegSpan will prepare source text for analysis.");
      router.refresh();
      setRefreshKey((current) => current + 1);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Preparation could not be started.",
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
      setMessage("Replacement uploaded. Reprocess the document to prepare source text for analysis.");
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
      <Surface className="flex items-center gap-3 text-sm font-semibold text-app-muted">
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
        Loading document review…
      </Surface>
    );
  }

  if (!document) {
    return (
      <div className="space-y-5">
        <Link href="/documents" className="inline-flex items-center gap-2 text-sm font-semibold text-app-accent">
          <span aria-hidden="true">←</span> Back to documents
        </Link>
        <EmptyState title="Document not found">
          <p>
            This document is not available in your current workspace.
          </p>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/documents" className="inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold text-app-accent transition-colors hover:text-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent">
        <span aria-hidden="true">←</span> Back to documents
      </Link>

      <PageHeader
        eyebrow="Document record"
        title={document.name}
        description={`${document.type} · Uploaded ${document.uploaded}`}
        actions={(
          <Button
            type="button"
            variant="appPrimary"
            onClick={handleReprocess}
            disabled={Boolean(activeAction)}
          >
            {activeAction === "reprocess" ? "Preparing..." : "Prepare again"}
          </Button>
        )}
      />

      {message ? (
        <Alert tone="success">{message}</Alert>
      ) : null}

      {warning ? (
        <Alert tone="warning">{warning}</Alert>
      ) : null}

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}

      <Surface as="section" className="overflow-hidden" padding="none">
        <div className="border-b border-app-border bg-app-elevated/55 px-5 py-4 lg:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <LifecycleBadge label={documentLifecycleLabel(document.status)} value={document.status} />
              <StatusBadge showDot={false}>{documentLifecycleLabel(document.status)}</StatusBadge>
              <span className="text-xs font-medium text-app-muted">Secure document workspace</span>
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.08em] text-app-subtle">
              Audit record
            </span>
          </div>
        </div>

        <dl className="grid divide-y divide-app-border text-sm sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
          {[
            { label: "Document type", value: document.type },
            { label: "Uploaded", value: document.uploaded },
            { label: "Source excerpts", value: formatSectionsLabel(document.chunks) },
            { label: "Review status", value: documentLifecycleLabel(document.status) },
            ...(chunks.length > 0 ? [{ label: "Client source excerpts", value: String(chunks.length) }] : []),
            ...(hierarchySummary !== null
              ? [{ label: "Hierarchy", value: formatHierarchySummary(hierarchySummary) }]
              : []),
            ...(document.fileSize ? [{ label: "File size", value: `${Math.round(document.fileSize / 1024)} KB` }] : []),
            ...(document.mimeType ? [{ label: "MIME type", value: document.mimeType }] : []),
          ].map((item) => (
            <div key={item.label} className="min-w-0 px-5 py-4">
              <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">
                {item.label}
              </dt>
              <dd className="mt-2 break-words text-sm font-semibold leading-5 text-app-text">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Surface>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Surface as="section" padding="lg">
          <div className="flex items-center justify-between gap-3">
            <h2 className="app-section-title">Document lifecycle</h2>
            <span className="text-xs font-medium text-app-muted">4 stages</span>
          </div>
          <div className="mt-5 space-y-3">
            {getTimeline(document.status, chunks.length).map((item, index) => (
              <div key={item.label} className="flex gap-3 rounded-lg border border-app-border bg-app-elevated/65 p-4">
                <span className={`grid size-8 shrink-0 place-items-center rounded-md border text-xs font-bold ${stateClasses[item.state]}`}>
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-app-text">{item.label}</span>
                    <StatusBadge showDot={false}>{item.status}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-app-muted">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Surface>

        <div className="space-y-4">
          <Surface as="section" padding="lg">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">Source review</p>
                <h2 className="mt-1 app-section-title">Client source excerpts</h2>
              </div>
              {chunks.length > 0 ? (
                <StatusBadge showDot={false}>{`${chunks.length} source excerpts`}</StatusBadge>
              ) : null}
            </div>
            {chunks.length > 0 ? (
              <div className="mt-5 divide-y divide-app-border rounded-lg border border-app-border">
                {chunks.map((chunk) => (
                  <article key={chunk.id} className="bg-app-surface p-4 first:rounded-t-lg last:rounded-b-lg">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-app-subtle">
                          Source excerpt {String(chunk.chunk_index + 1).padStart(2, "0")}
                        </span>
                        <h3 className="mt-1 text-sm font-semibold text-app-text">
                          {chunk.section_path || chunk.section_heading || "Unsectioned content"}
                        </h3>
                      </div>
                      <span className="shrink-0 rounded-md border border-app-border bg-app-elevated px-2.5 py-1 font-mono text-[10px] font-semibold text-app-muted">
                        {formatPageRange(chunk.page_start, chunk.page_end)}
                      </span>
                    </div>
                    <p className="mt-3 rounded-md border border-app-border bg-app-elevated/60 px-3.5 py-3 text-sm leading-6 text-app-muted">
                      {chunk.content.length > 220 ? `${chunk.content.slice(0, 220)}…` : chunk.content}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState className="mt-4" title="No client source excerpts available">
                <p>{getChunkEmptyState(document.status)}</p>
              </EmptyState>
            )}
          </Surface>

          <Surface as="section" padding="lg">
            <div className="flex items-center justify-between gap-3">
              <h2 className="app-section-title">Analysis readiness</h2>
              <StatusBadge>{chunks.length > 0 ? "Ready" : "Pending"}</StatusBadge>
            </div>
            <p className="mt-4 rounded-lg border border-dashed border-app-border-strong bg-app-elevated/55 p-4 text-sm leading-6 text-app-muted">
              {chunks.length > 0
                ? "Client source excerpts are ready. Run Analysis to compare this client document against the Reg S-P requirements."
                : "Prepare client source excerpts before running Analysis."}
            </p>
          </Surface>
        </div>
      </section>

      <Surface as="section" padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="app-section-title">Safe document actions</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
              Replace or remove this document only when the audit record should change for the current workspace.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="appSecondary"
              disabled={Boolean(activeAction)}
              onClick={() => {
                resetActionState();
                setIsReplaceOpen(true);
              }}
            >
              Replace file
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={Boolean(activeAction)}
              onClick={handleDelete}
            >
              {activeAction === "delete" ? "Deleting..." : "Delete document"}
            </Button>
          </div>
        </div>

        {isReplaceOpen ? (
          <div className="mt-5 rounded-lg border border-app-border bg-app-elevated/65 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <label className="block flex-1">
                <span className="text-sm font-semibold text-app-text">Replacement file</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleReplacementFileChange}
                  className="app-field mt-2 block w-full px-3 py-2 text-sm text-app-muted file:mr-3 file:rounded-md file:border-0 file:bg-app-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-app-accent"
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="appPrimary"
                  disabled={Boolean(activeAction)}
                  onClick={handleReplace}
                >
                  {activeAction === "replace" ? "Replacing..." : "Replace file"}
                </Button>
                <Button
                  type="button"
                  variant="appSecondary"
                  onClick={() => {
                    setIsReplaceOpen(false);
                    setReplacementFile(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {document.storagePath ? (
          <div className="mt-5 rounded-lg border border-app-border bg-app-elevated/45 p-4">
            <h3 className="text-sm font-semibold text-app-text">Stored file reference</h3>
            <p className="mt-2 overflow-x-auto rounded-md border border-app-border bg-app-surface px-3 py-2 font-mono text-[11px] text-app-muted" title={document.storagePath}>
              {document.storagePath}
            </p>
          </div>
        ) : null}

        {document.notes ? (
          <div className="mt-5 rounded-lg border border-app-border bg-app-elevated/65 p-4">
            <h3 className="text-sm font-semibold text-app-text">Notes</h3>
            <p className="mt-2 text-sm leading-6 text-app-muted">{document.notes}</p>
          </div>
        ) : null}
      </Surface>
    </div>
  );
}
