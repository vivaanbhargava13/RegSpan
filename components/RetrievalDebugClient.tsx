"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";
import {
  DEFAULT_RETRIEVAL_DEBUG_TOP_K,
  MAX_RETRIEVAL_DEBUG_TOP_K,
} from "@/lib/retrievalDebug";
import { getCurrentWorkspace, type CurrentWorkspace } from "@/lib/workspaces";

type DebugDocument = {
  id: string;
  filename: string;
};

type RetrievalDebugResult = {
  chunk_id: string;
  document_id: string;
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  chunk_index: number;
  section_path: string | null;
  content_preview: string;
  similarity: number;
  evidence_reason: string | null;
  embedding_input: string | null;
};

type RetrievalDebugResponse = {
  ok?: boolean;
  error?: string;
  results?: RetrievalDebugResult[];
};

const starterQueries = [
  "What procedures exist for notifying affected customers after unauthorized access?",
  "What does the policy say about incident containment?",
  "What safeguards protect customer information?",
];

function formatPageRange(result: RetrievalDebugResult) {
  if (result.page_start && result.page_end && result.page_start !== result.page_end) {
    return `Pages ${result.page_start}–${result.page_end}`;
  }
  if (result.page_start) {
    return `Page ${result.page_start}`;
  }
  return "Page not available";
}

function formatSimilarity(score: number) {
  if (!Number.isFinite(score)) {
    return "—";
  }
  return score.toFixed(3);
}

export function RetrievalDebugClient() {
  const [query, setQuery] = useState("");
  const [topK, setTopK] = useState(DEFAULT_RETRIEVAL_DEBUG_TOP_K);
  const [documentId, setDocumentId] = useState("");
  const [documents, setDocuments] = useState<DebugDocument[]>([]);
  const [workspace, setWorkspace] = useState<CurrentWorkspace | null>(null);
  const [results, setResults] = useState<RetrievalDebugResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");

  const topKOptions = useMemo(
    () => Array.from({ length: MAX_RETRIEVAL_DEBUG_TOP_K }, (_, index) => index + 1),
    [],
  );

  useEffect(() => {
    void loadDocuments();
  }, []);

  async function loadDocuments() {
    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured for this environment.");
      setIsLoadingDocuments(false);
      return;
    }

    try {
      const currentWorkspace = await getCurrentWorkspace(supabase);
      setWorkspace(currentWorkspace);

      const { data, error: documentsError } = await supabase
        .from("documents")
        .select("id, filename")
        .eq("workspace_id", currentWorkspace.id)
        .order("uploaded_at", { ascending: false });

      if (documentsError) {
        throw new Error(documentsError.message);
      }

      setDocuments((data ?? []) as DebugDocument[]);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load retrieval debug context.",
      );
    } finally {
      setIsLoadingDocuments(false);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setError("Enter a retrieval query before searching.");
      setResults([]);
      setHasSearched(false);
      return;
    }

    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured for this environment.");
      return;
    }

    setIsSearching(true);
    setError("");
    setHasSearched(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || "Your session has expired. Log in again.");
      }

      const response = await fetch("/api/retrieval-debug", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: normalizedQuery,
          topK,
          documentId: documentId || null,
        }),
      });
      const body = (await response.json()) as RetrievalDebugResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Retrieval search failed.");
      }

      setResults(body.results ?? []);
    } catch (searchError) {
      setResults([]);
      setError(searchError instanceof Error ? searchError.message : "Retrieval search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Internal debug"
        title="Retrieval debug"
        description="Run workspace-scoped semantic searches against stored evidence chunks before requirement matching is connected."
      />

      <section className="app-card overflow-hidden">
        <div className="border-b border-app-border bg-app-elevated/55 px-5 py-4 lg:px-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-[-0.01em] text-app-text">
              Search stored evidence chunks
            </h2>
            <p className="max-w-3xl text-sm leading-6 text-app-muted">
              Queries are embedded server-side and matched only against chunks in your current workspace.
            </p>
          </div>
        </div>

        <div className="p-5 lg:p-6">
          <form className="space-y-5" onSubmit={handleSearch}>
            <label className="block">
              <span className="text-sm font-semibold text-app-text">Compliance or cybersecurity question</span>
              <span className="mt-1 block text-xs leading-5 text-app-subtle">
                Ask the kind of evidence question a reviewer would use before mapping a requirement.
              </span>
              <textarea
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setError("");
                }}
                rows={4}
                placeholder="Ask about incident containment, customer notification, vendor breach escalation, safeguards, or recovery validation."
                className="app-field mt-2 min-h-32 resize-y leading-6"
              />
            </label>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_150px_auto] lg:items-end">
              <label className="block">
                <span className="text-sm font-semibold text-app-text">Document filter</span>
                <select
                  value={documentId}
                  onChange={(event) => setDocumentId(event.target.value)}
                  disabled={isLoadingDocuments}
                  className="app-field mt-2 h-11"
                >
                  <option value="">All documents in {workspace?.name ?? "workspace"}</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.filename}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-app-text">Top matches</span>
                <select
                  value={topK}
                  onChange={(event) => setTopK(Number(event.target.value))}
                  className="app-field mt-2 h-11"
                >
                  {topKOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <Button type="submit" variant="appPrimary" disabled={isSearching || isLoadingDocuments}>
                {isSearching ? "Searching…" : "Search chunks"}
              </Button>
            </div>
          </form>

          <div className="mt-6 border-t border-app-border pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-app-subtle">
              Starter queries
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {starterQueries.map((starterQuery) => (
                <button
                  key={starterQuery}
                  type="button"
                  onClick={() => setQuery(starterQuery)}
                  className="rounded-full border border-app-border bg-app-elevated px-3 py-1.5 text-xs font-semibold text-app-muted transition hover:border-app-border-strong hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                >
                  {starterQuery}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex gap-3 rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger shadow-sm">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-app-danger" />
          <p>{error}</p>
        </div>
      ) : null}

      {isSearching ? (
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Creating query embedding and matching workspace chunks…
        </div>
      ) : hasSearched && results.length === 0 && !error ? (
        <div className="app-empty-state">
          <h2 className="text-base font-semibold text-app-text">No matching chunks found</h2>
          <p className="mt-2 text-sm text-app-muted">
            Try a broader question, remove the document filter, or reprocess documents to ensure embeddings are current.
          </p>
        </div>
      ) : results.length > 0 ? (
        <section className="space-y-4" aria-label="Retrieval results">
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="app-section-title">Top matches</h2>
            <span className="text-xs font-semibold text-app-subtle">
              {results.length} result{results.length === 1 ? "" : "s"}
            </span>
          </div>

          {results.map((result, index) => (
            <article key={result.chunk_id} className="app-card overflow-hidden">
              <div className="border-b border-app-border bg-app-elevated/65 px-5 py-4 lg:px-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-app-accent-soft px-2.5 py-1 text-[11px] font-bold text-app-accent">
                        #{index + 1}
                      </span>
                      <span className="truncate text-sm font-semibold text-app-text">
                        {result.filename ?? "Untitled document"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-app-muted">
                      {result.section_path || "No section path available"}
                    </p>
                  </div>
                  <dl className="grid shrink-0 grid-cols-3 overflow-hidden rounded-xl border border-app-border bg-app-shell text-center shadow-sm">
                    <div className="border-r border-app-border px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-app-subtle">Page</dt>
                      <dd className="mt-1 whitespace-nowrap text-xs font-semibold text-app-text">{formatPageRange(result)}</dd>
                    </div>
                    <div className="border-r border-app-border px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-app-subtle">Chunk</dt>
                      <dd className="mt-1 text-xs font-semibold text-app-text">{result.chunk_index}</dd>
                    </div>
                    <div className="px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-app-subtle">Score</dt>
                      <dd className="mt-1 font-mono text-xs font-semibold text-app-accent">{formatSimilarity(result.similarity)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="space-y-4 p-5 lg:p-6">
                {result.evidence_reason ? (
                  <p className="rounded-xl border border-app-border bg-app-elevated/70 px-4 py-3 text-xs font-medium leading-5 text-app-muted">
                    <span className="font-semibold text-app-text">Evidence reason:</span>{" "}
                    {result.evidence_reason}
                  </p>
                ) : null}

                <p className="rounded-xl border border-app-border bg-app-surface px-4 py-3.5 whitespace-pre-wrap text-sm leading-7 text-app-text shadow-sm">
                  {result.content_preview}
                </p>

                {result.embedding_input ? (
                  <details className="rounded-xl border border-app-border bg-app-elevated/50">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-app-muted transition hover:text-app-text">
                      Debug embedding input
                    </summary>
                    <pre className="max-h-64 overflow-auto border-t border-app-border bg-app-shell px-4 py-3 font-mono text-[11px] leading-5 text-app-muted">
                      {result.embedding_input}
                    </pre>
                  </details>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
