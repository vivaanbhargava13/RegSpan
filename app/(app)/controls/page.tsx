import { Suspense } from "react";
import { ControlsHashScroller } from "@/components/ControlsHashScroller";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { loadActiveRegulatoryControls } from "@/lib/regulatoryControls";
import {
  REG_SP_SOURCE_KEY,
  canonicalControlKeyForRequirement,
  type RegulatoryControl,
} from "@/lib/regulatoryControlFramework";
import { REG_SP_REQUIREMENTS } from "@/lib/regSpRequirements";

export const dynamic = "force-dynamic";

type ControlLoadResult = {
  controls: RegulatoryControl[];
  source: "database" | "fallback";
  error: string | null;
};

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function regulatoryRoleLabel(role: RegulatoryControl["regulatoryRole"]) {
  switch (role) {
    case "direct_reg_s_p":
      return "Direct Reg S-P requirement";
    case "supporting_control":
      return "Supporting implementation control";
    case "future_scope":
      return "Future-scope requirement";
  }
}

function riskAccentClass(severity: RegulatoryControl["severity"]) {
  switch (severity) {
    case "critical":
      return "bg-app-danger";
    case "high":
      return "bg-app-danger";
    case "medium":
      return "bg-app-warning";
    case "low":
      return "bg-app-review";
  }
}

function fallbackControls(): RegulatoryControl[] {
  return REG_SP_REQUIREMENTS.map((requirement, index) => ({
    id: requirement.id,
    controlKey: canonicalControlKeyForRequirement(requirement),
    name: requirement.title,
    regulation: "Reg S-P",
    sourceKey: REG_SP_SOURCE_KEY,
    category: requirement.mvpScope === "mvp" ? "Core requirement" : "Supporting control",
    summary: requirement.description,
    regulatoryRole: requirement.regulatoryRole,
    severity: requirement.riskSeverity,
    status: "active",
    displayOrder: index + 1,
    metadata: {
      fallback: true,
      sourceBasis: requirement.sourceBasis,
    },
    elements: requirement.coverageElements.map((element, elementIndex) => ({
      id: `${requirement.id}:${element.id}`,
      elementKey: element.id,
      label: element.label,
      description: element.label,
      required: element.requiredForCovered,
      evidenceQuestion: null,
      missingIfAbsent: element.requiredForCovered,
      displayOrder: elementIndex + 1,
      metadata: { signals: element.signals },
    })),
    citations: [{
      id: `${requirement.id}:source-basis`,
      controlElementId: null,
      sourceChunkId: "fallback-source-basis",
      citationType: "primary",
      citationNote: requirement.sourceBasis,
      displayOrder: 1,
      metadata: { fallback: true },
      sourceChunk: null,
    }],
  }));
}

async function loadControlsForPage(): Promise<ControlLoadResult> {
  try {
    const controls = await loadActiveRegulatoryControls();
    if (controls.length > 0) {
      return { controls, source: "database", error: null };
    }

    return {
      controls: fallbackControls(),
      source: "fallback",
      error: "No active DB-backed controls are seeded yet, so RegSpan is showing the built-in framework.",
    };
  } catch (error) {
    return {
      controls: fallbackControls(),
      source: "fallback",
      error: error instanceof Error
        ? `DB-backed controls could not be loaded: ${error.message}`
        : "DB-backed controls could not be loaded.",
    };
  }
}

function citationLabel(citation: RegulatoryControl["citations"][number]) {
  if (!citation.sourceChunk) {
    return citation.citationNote ?? "Built-in source basis";
  }

  const pageLabel = citation.sourceChunk.pageStart === citation.sourceChunk.pageEnd
    ? `p. ${citation.sourceChunk.pageStart}`
    : `pp. ${citation.sourceChunk.pageStart}-${citation.sourceChunk.pageEnd}`;
  return [
    citation.sourceChunk.sectionPath ?? citation.sourceChunk.heading ?? "SEC source chunk",
    pageLabel,
  ].join(", ");
}

function controlAnchor(control: RegulatoryControl) {
  return `control-${control.controlKey}`;
}

function citationAnchor(
  control: RegulatoryControl,
  citation: RegulatoryControl["citations"][number],
  citationIndex: number,
) {
  return `citation-${control.controlKey}-${citation.id || citationIndex}`;
}

function requiredElements(control: RegulatoryControl) {
  return control.elements.filter((element) => element.required);
}

function EmptyState() {
  return (
    <div className="app-card px-5 py-8 text-sm text-app-muted">
      No active Regulation S-P controls are available yet.
    </div>
  );
}

function LoadingState() {
  return (
    <div className="app-card px-5 py-8 text-sm text-app-muted">
      Loading canonical controls...
    </div>
  );
}

async function ControlsList() {
  const { controls, source, error } = await loadControlsForPage();

  if (controls.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-6">
      <div className="app-card flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-app-accent-soft px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-app-accent">
            {source === "database" ? "DB-backed" : "Fallback"}
          </span>
          <span className="text-sm font-semibold text-app-text">SEC Release No. 34-100155</span>
        </div>
        <span className="text-sm text-app-muted">{controls.length} controls in view</span>
      </div>

      {error ? (
        <div className="rounded-lg border border-app-warning/20 bg-app-warning-soft px-4 py-3 text-sm text-app-warning">
          {error}
        </div>
      ) : null}

      <section className="space-y-7" aria-label="Reg S-P controls">
        {controls.map((control) => {
          const required = requiredElements(control);

          return (
            <article
              key={control.id}
              id={controlAnchor(control)}
              className="requirement-card app-card relative overflow-hidden border-app-border-strong/70 bg-gradient-to-br from-app-surface to-app-elevated/45 shadow-app-card"
            >
              <div aria-hidden="true" className={`h-1 ${riskAccentClass(control.severity)}`} />
              <div className="border-b border-app-border bg-gradient-to-r from-app-elevated/95 to-app-surface px-5 py-4 lg:px-6">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold tracking-[-0.02em] text-app-text">
                      {control.name}
                    </h2>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-xs font-semibold text-app-muted">
                        {control.category ?? control.regulation}
                      </span>
                      <span className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 text-xs font-semibold text-app-muted">
                        {regulatoryRoleLabel(control.regulatoryRole)}
                      </span>
                    </div>
                  </div>
                  <StatusBadge>{`${titleCase(control.severity)} risk`}</StatusBadge>
                </div>
              </div>

              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] lg:p-6">
                <div>
                  <h3 className="text-sm font-semibold text-app-text">Summary</h3>
                  <p className="mt-2 text-sm leading-6 text-app-muted">{control.summary}</p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-app-text">Required elements</h3>
                  {required.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm leading-6 text-app-muted">
                      {required.map((element) => (
                        <li key={element.id} className="flex gap-2">
                          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-app-accent" />
                          <span>{element.label}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-app-muted">No required elements configured.</p>
                  )}
                </div>
              </div>

              <div className="border-t border-app-border bg-app-surface/70 px-5 py-4 lg:px-6">
                <h3 className="text-sm font-semibold text-app-text">SEC basis</h3>
                {control.citations.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {control.citations.map((citation, citationIndex) => (
                      <details
                        key={citation.id}
                        id={citationAnchor(control, citation, citationIndex)}
                        className="citation-disclosure scroll-mt-28"
                      >
                        <summary className="cursor-pointer list-none rounded-full border border-app-border bg-app-surface px-3 py-1.5 text-xs font-semibold text-app-muted outline-none transition hover:border-app-accent/50 hover:text-app-text focus-visible:ring-4 focus-visible:ring-app-accent-soft">
                          {citationLabel(citation)}
                          <span className="ml-2 text-app-subtle">View SEC basis</span>
                        </summary>
                        <div className="mt-2 max-w-3xl rounded-lg border border-app-border bg-app-elevated/70 px-3 py-2 text-xs leading-5 text-app-muted">
                          {citation.citationNote ? <p>{citation.citationNote}</p> : null}
                          {citation.sourceChunk?.synopsis ? <p className="mt-2">{citation.sourceChunk.synopsis}</p> : null}
                          {citation.sourceChunk?.content ? <p className="mt-2">{citation.sourceChunk.content}</p> : null}
                        </div>
                      </details>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-app-muted">No SEC citation attached.</p>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

export default function ControlsPage() {
  return (
    <div className="space-y-8">
      <ControlsHashScroller />
      <PageHeader
        eyebrow="Requirements"
        title="Reg S-P requirements"
        description="Review the canonical controls RegSpan checks against workspace evidence."
      />

      <Suspense fallback={<LoadingState />}>
        <ControlsList />
      </Suspense>
    </div>
  );
}
