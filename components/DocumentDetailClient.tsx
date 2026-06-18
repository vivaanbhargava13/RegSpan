"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { findMockDocument, type DocumentStatus, type MockDocument } from "@/components/mockDocuments";
import { StatusBadge } from "@/components/StatusBadge";

type DocumentDetailClientProps = {
  documentId: string;
};

type TimelineState = "complete" | "current" | "pending" | "blocked" | "review";

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
  if (status === "Processed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material is listed in the demo workspace.", state: "complete" },
      { label: "Text extraction", status: "Complete", detail: "Demo UI marks extraction as complete for this processed document.", state: "complete" },
      { label: "Chunking", status: "Complete", detail: "Demo UI marks chunking as complete and shows mock chunks.", state: "complete" },
      { label: "Evidence mapping", status: "Not connected", detail: "Control mapping is pending backend processing and retrieval.", state: "pending" },
    ];
  }

  if (status === "Processing") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material was added locally for review.", state: "complete" },
      { label: "Text extraction", status: "Processing", detail: "Demo processing state is in progress.", state: "current" },
      { label: "Chunking", status: "Pending", detail: "Chunking will be represented after processing completes.", state: "pending" },
      { label: "Evidence mapping", status: "Pending", detail: "Control mapping is not connected yet.", state: "pending" },
    ];
  }

  if (status === "Needs Review") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material is available for reviewer attention.", state: "complete" },
      { label: "Text extraction", status: "Review needed", detail: "Extracted text needs human review in this demo state.", state: "review" },
      { label: "Chunking", status: "Review needed", detail: "Chunk grouping should be checked before report use.", state: "review" },
      { label: "Evidence mapping", status: "Not connected", detail: "Control mapping will run after backend retrieval is connected.", state: "pending" },
    ];
  }

  if (status === "Failed") {
    return [
      { label: "Uploaded", status: "Complete", detail: "Source material was added to the mock workspace.", state: "complete" },
      { label: "Text extraction", status: "Failed", detail: "Demo status indicates processing could not continue.", state: "blocked" },
      { label: "Chunking", status: "Blocked", detail: "Chunking is blocked until processing is retried.", state: "blocked" },
      { label: "Evidence mapping", status: "Blocked", detail: "Control mapping is not available for this document.", state: "blocked" },
    ];
  }

  return [
    { label: "Uploaded", status: "Complete", detail: "Source material was added locally for review.", state: "complete" },
    { label: "Text extraction", status: "Queued", detail: "Extraction has not started in the demo workflow.", state: "pending" },
    { label: "Chunking", status: "Pending", detail: "Chunking waits for extraction to complete.", state: "pending" },
    { label: "Evidence mapping", status: "Pending", detail: "Control mapping is not connected yet.", state: "pending" },
  ];
}

const stateClasses: Record<TimelineState, string> = {
  complete: "bg-accent text-white",
  current: "bg-[#fff6e8] text-warning",
  pending: "bg-white text-muted",
  blocked: "bg-[#fff0f0] text-danger",
  review: "bg-[#fff6e8] text-warning",
};

export function DocumentDetailClient({ documentId }: DocumentDetailClientProps) {
  const [document, setDocument] = useState<MockDocument | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  useEffect(() => {
    setDocument(findMockDocument(documentId));
    setHasLoaded(true);
  }, [documentId]);

  if (!hasLoaded) {
    return (
      <div className="rounded-2xl border border-line bg-white p-5 text-sm font-semibold text-muted shadow-sm">
        Loading document review...
      </div>
    );
  }

  if (!document) {
    return (
      <div className="space-y-5">
        <Link href="/documents" className="text-sm font-semibold text-accent">
          Back to documents
        </Link>
        <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-ink">Document not found</h1>
          <p className="mt-3 text-sm leading-6 text-muted">
            This mock document is not available in the current demo workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/documents" className="text-sm font-semibold text-accent">
        Back to documents
      </Link>

      <section className="rounded-2xl border border-line bg-white p-6 shadow-sm">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-normal text-accent">Document review</p>
            <h1 className="mt-2 max-w-4xl break-words text-3xl font-semibold text-ink">{document.name}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
              {document.type} · Uploaded {document.uploaded} · {document.chunks}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:items-center">
            <StatusBadge>{document.status}</StatusBadge>
            {["Reprocess", "Replace", "Delete"].map((action) => (
              <button
                key={action}
                type="button"
                className="h-9 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-muted transition-colors hover:border-[#c6d5ce] hover:bg-canvas hover:text-ink"
              >
                {action}
              </button>
            ))}
          </div>
        </div>

        <dl className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Document type", value: document.type },
            { label: "Uploaded", value: document.uploaded },
            { label: "Chunks", value: document.chunks },
            { label: "Status", value: document.status },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-line bg-canvas p-4">
              <dt className="text-xs font-semibold uppercase tracking-normal text-muted">{item.label}</dt>
              <dd className="mt-2 break-words text-sm font-semibold text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>

        {document.notes ? (
          <div className="mt-6 rounded-xl border border-line bg-canvas p-4">
            <h2 className="text-sm font-semibold text-ink">Notes</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{document.notes}</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-ink">Processing timeline</h2>
          <div className="mt-5 space-y-3">
            {getTimeline(document.status).map((item, index) => (
              <div key={item.label} className="flex gap-3 rounded-xl border border-line bg-canvas p-4">
                <span
                  className={`grid size-8 shrink-0 place-items-center rounded-full text-xs font-bold ${
                    stateClasses[item.state]
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{item.label}</span>
                    <span className="text-xs font-semibold text-muted">{item.status}</span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Extracted chunk preview</h2>
            {document.status === "Processed" ? (
              <div className="mt-5 space-y-3">
                {chunkPreviews.map((chunk) => (
                  <article key={chunk.title} className="rounded-xl border border-line bg-canvas p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-sm font-semibold text-ink">{chunk.title}</h3>
                      <span className="text-xs font-semibold text-muted">{chunk.page}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted">{chunk.excerpt}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-xl border border-line bg-canvas p-4 text-sm leading-6 text-muted">
                Chunk previews will appear here after mock processing reaches a processed review state.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-ink">Evidence mapping status</h2>
            <p className="mt-3 rounded-xl border border-line bg-canvas p-4 text-sm leading-6 text-muted">
              Reg S-P control mapping will run after backend processing and retrieval are connected.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
