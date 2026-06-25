"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { getBrowserSupabaseClient } from "@/components/supabaseClient";
import {
  REG_SP_REQUIREMENTS,
  type RegSpRequirement,
} from "@/lib/regSpRequirements";
import type {
  EvidenceGrade,
  RequirementDebugStatus,
} from "@/lib/requirementMatching";

type GradedEvidenceChunk = {
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
  grade: EvidenceGrade;
  grade_reason: string;
};

type RequirementMatchResult = {
  requirement: RegSpRequirement;
  status: RequirementDebugStatus;
  status_reason: string;
  direct: GradedEvidenceChunk[];
  partial: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
  irrelevant: GradedEvidenceChunk[];
};

type RequirementDebugResponse = {
  ok?: boolean;
  error?: string;
  topK?: number;
  results?: RequirementMatchResult[];
};

const statusClasses: Record<RequirementDebugStatus, string> = {
  strong_match: "border-app-success/20 bg-app-success-soft text-app-success",
  partial_match: "border-app-warning/20 bg-app-warning-soft text-app-warning",
  weak_match: "border-app-review/20 bg-app-review-soft text-app-review",
  no_match: "border-app-danger/20 bg-app-danger-soft text-app-danger",
};

const statusLabels: Record<RequirementDebugStatus, string> = {
  strong_match: "Strong match",
  partial_match: "Partial match",
  weak_match: "Weak match",
  no_match: "No match",
};

const gradeLabels: Record<EvidenceGrade, string> = {
  direct: "Direct evidence",
  partial: "Partial evidence",
  background: "Background evidence",
  irrelevant: "Ignored candidates",
};

function formatPageRange(chunk: GradedEvidenceChunk) {
  if (chunk.page_start && chunk.page_end && chunk.page_start !== chunk.page_end) {
    return `Pages ${chunk.page_start}–${chunk.page_end}`;
  }
  if (chunk.page_start) {
    return `Page ${chunk.page_start}`;
  }
  return "Page not available";
}

function formatScore(score: number) {
  return Number.isFinite(score) ? score.toFixed(3) : "—";
}

function formatStatusLabel(status: RequirementDebugStatus) {
  return statusLabels[status];
}

function evidenceCount(result: RequirementMatchResult) {
  return result.direct.length + result.partial.length + result.background.length + result.irrelevant.length;
}

function isWeakOrNoMatch(result: RequirementMatchResult) {
  return result.status === "weak_match" || result.status === "no_match";
}

function EvidenceGroup({
  grade,
  chunks,
}: {
  grade: EvidenceGrade;
  chunks: GradedEvidenceChunk[];
}) {
  return (
    <details className="group rounded-2xl border border-app-border bg-app-elevated/45">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none transition hover:bg-app-elevated focus-visible:ring-4 focus-visible:ring-app-accent-soft [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-semibold text-app-text">{gradeLabels[grade]}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-app-border bg-app-shell px-2.5 py-1 text-[11px] font-semibold text-app-muted">
            {chunks.length}
          </span>
          <span aria-hidden="true" className="text-app-subtle transition group-open:rotate-180">⌄</span>
        </span>
      </summary>

      <div className="border-t border-app-border px-4 py-4">
        {chunks.length === 0 ? (
          <p className="text-sm leading-6 text-app-subtle">No candidates in this bucket.</p>
        ) : (
          <div className="space-y-3">
          {chunks.map((chunk) => (
            <article key={chunk.chunk_id} className="rounded-xl border border-app-border bg-app-surface p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-app-text">
                    {chunk.filename ?? "Untitled document"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-app-muted">
                    {chunk.section_path || "No section path available"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-app-muted">
                  <span className="rounded-full bg-app-elevated px-2.5 py-1">{formatPageRange(chunk)}</span>
                  <span className="rounded-full bg-app-elevated px-2.5 py-1">Chunk {chunk.chunk_index}</span>
                  <span className="rounded-full bg-app-elevated px-2.5 py-1">Score {formatScore(chunk.similarity)}</span>
                </div>
              </div>

              <p className="mt-3 rounded-lg border border-app-border bg-app-elevated/55 px-3 py-2 text-xs font-medium leading-5 text-app-muted">
                <span className="font-semibold text-app-text">Grade reason:</span>{" "}
                {chunk.grade_reason}
              </p>
              {chunk.evidence_reason ? (
                <p className="mt-2 text-xs leading-5 text-app-subtle">
                  <span className="font-semibold text-app-muted">Chunk classifier:</span>{" "}
                  {chunk.evidence_reason}
                </p>
              ) : null}
              <details className="mt-3 rounded-lg border border-app-border bg-app-elevated/35">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-app-muted outline-none transition hover:text-app-text focus-visible:ring-4 focus-visible:ring-app-accent-soft">
                  Read chunk text
                </summary>
                <p className="border-t border-app-border px-3 py-3 whitespace-pre-wrap text-sm leading-6 text-app-muted">
                  {chunk.content_preview}
                </p>
              </details>
            </article>
          ))}
          </div>
        )}
      </div>
    </details>
  );
}

export function RequirementDebugClient() {
  const [requirementId, setRequirementId] = useState("all");
  const [topK, setTopK] = useState(15);
  const [results, setResults] = useState<RequirementMatchResult[]>([]);
  const [expandedRequirementIds, setExpandedRequirementIds] = useState<Set<string>>(new Set());
  const [showWeakOnly, setShowWeakOnly] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");

  const visibleResults = showWeakOnly
    ? results.filter((result) => isWeakOrNoMatch(result))
    : results;

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = getBrowserSupabaseClient();
    if (!supabase) {
      setError("Supabase is not configured for this environment.");
      return;
    }

    setIsRunning(true);
    setHasRun(true);
    setError("");

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !sessionData.session) {
        throw new Error(sessionError?.message || "Your session has expired. Log in again.");
      }

      const response = await fetch("/api/requirement-debug", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requirementId, topK }),
      });
      const body = (await response.json()) as RequirementDebugResponse;

      if (!response.ok || !body.ok) {
        throw new Error(body.error || "Requirement matching failed.");
      }

      setResults(body.results ?? []);
      setExpandedRequirementIds(new Set());
    } catch (runError) {
      setResults([]);
      setError(runError instanceof Error ? runError.message : "Requirement matching failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Internal debug"
        title="Requirement matching debug"
        description="Retrieve candidate evidence for a small Reg S-P baseline and grade each chunk before any findings workflow is productized."
      />

      <section className="app-card overflow-hidden">
        <div className="border-b border-app-border bg-app-elevated/55 px-5 py-4 lg:px-6">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-app-text">
            Run candidate evidence matching
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-app-muted">
            This debug prototype uses existing retrieval, then applies a deterministic evidence grader.
            Status is based on candidate evidence grades, not similarity alone.
          </p>
        </div>

        <form className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_150px_auto] lg:items-end lg:p-6" onSubmit={handleRun}>
          <label className="block">
            <span className="text-sm font-semibold text-app-text">Requirement</span>
            <select
              value={requirementId}
              onChange={(event) => setRequirementId(event.target.value)}
              className="app-field mt-2 h-11"
            >
              <option value="all">Run all requirements</option>
              {REG_SP_REQUIREMENTS.map((requirement) => (
                <option key={requirement.id} value={requirement.id}>
                  {requirement.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-app-text">Top candidates</span>
            <select
              value={topK}
              onChange={(event) => setTopK(Number(event.target.value))}
              className="app-field mt-2 h-11"
            >
              {[10, 15, 20, 25].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <Button type="submit" variant="appPrimary" disabled={isRunning}>
            {isRunning ? "Running…" : "Run matching"}
          </Button>
        </form>
      </section>

      {error ? (
        <div className="flex gap-3 rounded-xl border border-app-danger/20 bg-app-danger-soft px-4 py-3 text-sm font-medium text-app-danger shadow-sm">
          <span aria-hidden="true" className="mt-2 size-2 shrink-0 rounded-full bg-app-danger" />
          <p>{error}</p>
        </div>
      ) : null}

      {isRunning ? (
        <div className="app-card flex items-center gap-3 p-5 text-sm font-semibold text-app-muted">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-app-accent" />
          Retrieving and grading candidate chunks…
        </div>
      ) : hasRun && results.length === 0 && !error ? (
        <div className="app-empty-state">
          <h2 className="text-base font-semibold text-app-text">No requirement matches returned</h2>
          <p className="mt-2 text-sm text-app-muted">
            Reprocess documents to create current chunks and embeddings, then run the debug match again.
          </p>
        </div>
      ) : results.length > 0 ? (
        <section className="space-y-5" aria-label="Requirement debug results">
          <div className="app-card flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-app-text">Debug result controls</h2>
              <p className="mt-1 text-xs leading-5 text-app-muted">
                Requirement cards and evidence buckets are collapsed by default to keep review focused.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setExpandedRequirementIds(new Set(results.map((result) => result.requirement.id)))}
                className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-semibold text-app-muted transition hover:border-app-border-strong hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent"
              >
                Expand all requirements
              </button>
              <button
                type="button"
                onClick={() => setExpandedRequirementIds(new Set())}
                className="rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-semibold text-app-muted transition hover:border-app-border-strong hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent"
              >
                Collapse all requirements
              </button>
              <button
                type="button"
                onClick={() => setShowWeakOnly((current) => !current)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent ${
                  showWeakOnly
                    ? "border-app-review/30 bg-app-review-soft text-app-review"
                    : "border-app-border bg-app-surface text-app-muted hover:border-app-border-strong hover:text-app-text"
                }`}
              >
                {showWeakOnly ? "Show all requirements" : "Show only weak/no-match requirements"}
              </button>
            </div>
          </div>

          {visibleResults.length === 0 ? (
            <div className="app-empty-state">
              <h2 className="text-base font-semibold text-app-text">No weak/no-match requirements</h2>
              <p className="mt-2 text-sm text-app-muted">
                Toggle the filter off to review all requirement matches.
              </p>
            </div>
          ) : null}

          {visibleResults.map((result) => {
            const isExpanded = expandedRequirementIds.has(result.requirement.id);

            return (
            <article key={result.requirement.id} className="app-card overflow-hidden">
              <div className="border-b border-app-border bg-app-elevated/65 px-5 py-4 lg:px-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={() => {
                        setExpandedRequirementIds((current) => {
                          const next = new Set(current);
                          if (next.has(result.requirement.id)) {
                            next.delete(result.requirement.id);
                          } else {
                            next.add(result.requirement.id);
                          }
                          return next;
                        });
                      }}
                      className="flex text-left text-lg font-semibold tracking-[-0.02em] text-app-text outline-none transition hover:text-app-accent focus-visible:ring-4 focus-visible:ring-app-accent-soft"
                    >
                      <span aria-hidden="true" className={`mr-2 text-app-subtle transition ${isExpanded ? "rotate-90" : ""}`}>›</span>
                      {result.requirement.title}
                    </button>
                    <p className="mt-2 max-w-4xl text-sm leading-6 text-app-muted">
                      {result.requirement.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`w-fit rounded-full border px-3 py-1.5 text-xs font-bold ${statusClasses[result.status]}`}>
                      {formatStatusLabel(result.status)}
                    </span>
                    <span className="rounded-full border border-app-border bg-app-shell px-3 py-1.5 text-xs font-semibold text-app-muted">
                      {evidenceCount(result)} candidates
                    </span>
                  </div>
                </div>
                <p className="mt-3 rounded-xl border border-app-border bg-app-shell px-3.5 py-3 text-xs font-medium leading-5 text-app-muted">
                  <span className="font-semibold text-app-text">Status reason:</span>{" "}
                  {result.status_reason}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-app-muted">
                  <span className="rounded-full bg-app-shell px-2.5 py-1 ring-1 ring-app-border">Direct {result.direct.length}</span>
                  <span className="rounded-full bg-app-shell px-2.5 py-1 ring-1 ring-app-border">Partial {result.partial.length}</span>
                  <span className="rounded-full bg-app-shell px-2.5 py-1 ring-1 ring-app-border">Background {result.background.length}</span>
                  <span className="rounded-full bg-app-shell px-2.5 py-1 ring-1 ring-app-border">Ignored {result.irrelevant.length}</span>
                </div>
              </div>

              {isExpanded ? (
                <div className="grid gap-4 p-5 xl:grid-cols-2 lg:p-6">
                  <EvidenceGroup grade="direct" chunks={result.direct} />
                  <EvidenceGroup grade="partial" chunks={result.partial} />
                  <EvidenceGroup grade="background" chunks={result.background} />
                  <EvidenceGroup grade="irrelevant" chunks={result.irrelevant} />
                </div>
              ) : null}
            </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
