import { Suspense } from "react";
import { DataTable } from "@/components/DataTable";
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
    severity: requirement.regulatoryRole === "supporting_control" ? "medium" : "high",
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

async function ControlsTable() {
  const { controls, source, error } = await loadControlsForPage();

  if (controls.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4">
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

      <DataTable
        columns={["Control", "Rule area", "Role", "Summary", "Required elements", "SEC citations", "Risk"]}
        minWidth="min-w-[1180px]"
      >
        {controls.map((control) => (
          <tr key={control.id}>
            <td className="px-4 py-4">
              <div className="font-mono text-xs font-semibold text-app-accent">{control.controlKey}</div>
              <div className="mt-1 font-semibold text-app-text">{control.name}</div>
            </td>
            <td className="px-4 py-4 text-app-muted">{control.category ?? control.regulation}</td>
            <td className="px-4 py-4 text-app-muted">{titleCase(control.regulatoryRole)}</td>
            <td className="max-w-[320px] px-4 py-4 text-app-muted">{control.summary}</td>
            <td className="max-w-[280px] px-4 py-4 text-app-muted">
              {control.elements.filter((element) => element.required).length > 0
                ? control.elements
                  .filter((element) => element.required)
                  .map((element) => element.label)
                  .join("; ")
                : "No required elements configured"}
            </td>
            <td className="max-w-[260px] px-4 py-4 text-app-muted">
              {control.citations.length > 0
                ? control.citations.map(citationLabel).join("; ")
                : "No SEC citation attached"}
            </td>
            <td className="px-4 py-4">
              <StatusBadge>{titleCase(control.severity)}</StatusBadge>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export default function ControlsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Requirements"
        title="Reg S-P requirements"
        description="Review the canonical controls RegSpan checks against workspace evidence."
      />

      <Suspense fallback={<LoadingState />}>
        <ControlsTable />
      </Suspense>
    </div>
  );
}
