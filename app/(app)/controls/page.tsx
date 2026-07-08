import { Suspense } from "react";
import { Alert } from "@/components/Alert";
import { ControlsHashScroller } from "@/components/ControlsHashScroller";
import { EmptyState as SharedEmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RiskBadge, StatusBadge } from "@/components/StatusBadge";
import { Surface } from "@/components/Surface";
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

function severityRank(severity: RegulatoryControl["severity"]) {
  return {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  }[severity];
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
    citation.sourceChunk.sectionPath ?? citation.sourceChunk.heading ?? "SEC source citation",
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
    <SharedEmptyState title="No active Regulation S-P controls">
      <p>No active Regulation S-P controls are available yet.</p>
    </SharedEmptyState>
  );
}

function LoadingState() {
  return (
    <Surface className="text-sm text-app-muted">
      Loading canonical controls...
    </Surface>
  );
}

async function ControlsList() {
  const { controls, source, error } = await loadControlsForPage();

  if (controls.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-5">
      <Surface className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" padding="md">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge showDot={false}>{source === "database" ? "DB-backed" : "Fallback"}</StatusBadge>
          <span className="text-sm font-semibold text-app-text">SEC Release No. 34-100155</span>
        </div>
        <span className="text-sm text-app-muted">{controls.length} controls in the control register</span>
      </Surface>

      {error ? (
        <Alert tone="warning">{error}</Alert>
      ) : null}

      <section className="space-y-3" aria-label="Reg S-P controls">
        {[...controls].sort((left, right) =>
          severityRank(left.severity) - severityRank(right.severity) ||
          left.displayOrder - right.displayOrder ||
          left.name.localeCompare(right.name),
        ).map((control) => {
          const required = requiredElements(control);

          return (
            <Surface
              as="article"
              key={control.id}
              id={controlAnchor(control)}
              className="requirement-card relative overflow-hidden border-app-border-strong/70"
              padding="none"
            >
              <div aria-hidden="true" className={`absolute inset-y-0 left-0 w-0.5 ${riskAccentClass(control.severity)}`} />
              <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)] lg:px-6">
                <div className="min-w-0 pl-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-app-subtle">
                        Requirement basis
                      </p>
                      <h2 className="mt-1 text-base font-semibold text-app-text lg:text-lg">
                        {control.name}
                      </h2>
                    </div>
                    <a
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-app-accent transition-colors hover:bg-app-accent-soft hover:text-app-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-app-accent"
                      href={`#${controlAnchor(control)}`}
                    >
                      Control link
                    </a>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <RiskBadge label={`${titleCase(control.severity)} risk`} value={control.severity} />
                    <StatusBadge showDot={false}>{control.category ?? control.regulation}</StatusBadge>
                    <StatusBadge showDot={false}>{regulatoryRoleLabel(control.regulatoryRole)}</StatusBadge>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-app-muted">{control.summary}</p>
                </div>

                <div className="rounded-lg border border-app-border bg-app-elevated/55 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-app-text">Required elements</h3>
                    <span className="text-xs font-medium text-app-muted">{required.length} required</span>
                  </div>
                  {required.length > 0 ? (
                    <ul className="mt-3 space-y-2 text-sm leading-6 text-app-muted">
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

              <div className="border-t border-app-border bg-app-elevated/40 px-5 py-4 lg:px-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold text-app-text">SEC basis</h3>
                  <span className="text-xs text-app-muted">
                    {control.citations.length} source {control.citations.length === 1 ? "citation" : "citations"}
                  </span>
                </div>
                {control.citations.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {control.citations.map((citation, citationIndex) => (
                      <details
                        key={citation.id}
                        id={citationAnchor(control, citation, citationIndex)}
                        className="citation-disclosure scroll-mt-28"
                      >
                        <summary className="cursor-pointer list-none rounded-md border border-app-border bg-app-surface px-3 py-1.5 text-xs font-semibold text-app-muted outline-none transition-colors hover:border-app-accent/50 hover:text-app-text focus-visible:ring-4 focus-visible:ring-app-accent-soft">
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
            </Surface>
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
        title="Control register"
        description="Review the Regulation S-P requirement basis, required elements, and SEC source citations used for analysis."
      />

      <Suspense fallback={<LoadingState />}>
        <ControlsList />
      </Suspense>
    </div>
  );
}
