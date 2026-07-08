import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  REG_SP_SOURCE_KEY,
  regulatoryControlToRegSpRequirement,
  type RegulatoryControl,
  type RegulatoryControlCitation,
  type RegulatoryControlElement,
} from "@/lib/regulatoryControlFramework";
import { REG_SP_REQUIREMENTS, type RegSpRequirement } from "@/lib/regSpRequirements";
import { getServerSupabaseAdminClient } from "@/lib/supabase/server";

type LoadControlsInput = {
  supabase?: SupabaseClient;
  sourceKey?: string;
};

type JsonRecord = Record<string, unknown>;

type ControlRow = {
  id: string;
  control_key: string | null;
  name: string | null;
  control_name?: string | null;
  regulation: string | null;
  source_key: string | null;
  category: string | null;
  summary: string | null;
  requirement_text?: string | null;
  regulatory_role: RegulatoryControl["regulatoryRole"] | null;
  severity: RegulatoryControl["severity"] | null;
  status: string | null;
  display_order: number | null;
  metadata: JsonRecord | null;
  control_elements: ControlElementRow[] | null;
  control_citations: ControlCitationRow[] | null;
};

type ControlElementRow = {
  id: string;
  element_key: string;
  label: string;
  description: string | null;
  required: boolean | null;
  evidence_question: string | null;
  missing_if_absent: boolean | null;
  display_order: number | null;
  metadata: JsonRecord | null;
};

type ControlCitationRow = {
  id: string;
  control_element_id: string | null;
  source_chunk_id: string;
  citation_type: RegulatoryControlCitation["citationType"];
  citation_note: string | null;
  display_order: number | null;
  metadata: JsonRecord | null;
  regulatory_source_chunks: SourceChunkRow | SourceChunkRow[] | null;
};

type SourceChunkRow = {
    id: string;
    chunk_index: number;
    page_start: number;
    page_end: number;
    heading: string | null;
    parent_heading: string | null;
    section_path: string | null;
    chunk_kind: string;
    content: string;
    synopsis: string | null;
    metadata: JsonRecord | null;
};

export class RegulatoryControlsUnavailableError extends Error {
  constructor(
    public readonly code: string,
    message = "Regulatory controls are not available.",
  ) {
    super(message);
    this.name = "RegulatoryControlsUnavailableError";
  }
}

function asRecord(value: JsonRecord | null | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeElement(row: ControlElementRow): RegulatoryControlElement {
  return {
    id: row.id,
    elementKey: row.element_key,
    label: row.label,
    description: row.description ?? row.label,
    required: row.required ?? true,
    evidenceQuestion: row.evidence_question,
    missingIfAbsent: row.missing_if_absent ?? true,
    displayOrder: row.display_order ?? 0,
    metadata: asRecord(row.metadata),
  };
}

function normalizeCitation(row: ControlCitationRow): RegulatoryControlCitation {
  const sourceChunk = Array.isArray(row.regulatory_source_chunks)
    ? row.regulatory_source_chunks[0] ?? null
    : row.regulatory_source_chunks;

  return {
    id: row.id,
    controlElementId: row.control_element_id,
    sourceChunkId: row.source_chunk_id,
    citationType: row.citation_type,
    citationNote: row.citation_note,
    displayOrder: row.display_order ?? 0,
    metadata: asRecord(row.metadata),
    sourceChunk: sourceChunk
      ? {
        id: sourceChunk.id,
        chunkIndex: sourceChunk.chunk_index,
        pageStart: sourceChunk.page_start,
        pageEnd: sourceChunk.page_end,
        heading: sourceChunk.heading,
        parentHeading: sourceChunk.parent_heading,
        sectionPath: sourceChunk.section_path,
        chunkKind: sourceChunk.chunk_kind,
        content: sourceChunk.content,
        synopsis: sourceChunk.synopsis,
        metadata: asRecord(sourceChunk.metadata),
      }
      : null,
  };
}

function normalizeControl(row: ControlRow): RegulatoryControl | null {
  if (!row.control_key) return null;
  const name = row.name ?? row.control_name;
  const summary = row.summary ?? row.requirement_text;
  if (!name || !summary) return null;

  return {
    id: row.id,
    controlKey: row.control_key as RegulatoryControl["controlKey"],
    name,
    regulation: row.regulation ?? "Reg S-P",
    sourceKey: row.source_key ?? REG_SP_SOURCE_KEY,
    category: row.category,
    summary,
    regulatoryRole: row.regulatory_role ?? "direct_reg_s_p",
    severity: row.severity ?? "medium",
    status: row.status ?? "active",
    displayOrder: row.display_order ?? 0,
    metadata: asRecord(row.metadata),
    elements: (row.control_elements ?? [])
      .map(normalizeElement)
      .sort((left, right) => left.displayOrder - right.displayOrder),
    citations: (row.control_citations ?? [])
      .map(normalizeCitation)
      .sort((left, right) => left.displayOrder - right.displayOrder),
  };
}

export async function loadActiveRegulatoryControls({
  supabase = getServerSupabaseAdminClient(),
  sourceKey = REG_SP_SOURCE_KEY,
}: LoadControlsInput = {}): Promise<RegulatoryControl[]> {
  const { data, error } = await supabase
    .from("controls")
    .select(`
      id,
      control_key,
      name,
      control_name,
      regulation,
      source_key,
      category,
      summary,
      requirement_text,
      regulatory_role,
      severity,
      status,
      display_order,
      metadata,
      control_elements (
        id,
        element_key,
        label,
        description,
        required,
        evidence_question,
        missing_if_absent,
        display_order,
        metadata
      ),
      control_citations (
        id,
        control_element_id,
        source_chunk_id,
        citation_type,
        citation_note,
        display_order,
        metadata,
        regulatory_source_chunks (
          id,
          chunk_index,
          page_start,
          page_end,
          heading,
          parent_heading,
          section_path,
          chunk_kind,
          content,
          synopsis,
          metadata
        )
      )
    `)
    .eq("source_key", sourceKey)
    .eq("status", "active")
    .order("display_order", { ascending: true });

  if (error) {
    throw new RegulatoryControlsUnavailableError(
      error.code ?? "controls_lookup_failed",
      error.message,
    );
  }

  return ((data ?? []) as unknown as ControlRow[])
    .map(normalizeControl)
    .filter((control): control is RegulatoryControl => control !== null);
}

export async function loadRegSpRequirementsForFindings({
  supabase,
}: {
  supabase?: SupabaseClient;
} = {}): Promise<RegSpRequirement[]> {
  try {
    const controls = await loadActiveRegulatoryControls({ supabase });
    if (controls.length > 0) {
      return controls.map(regulatoryControlToRegSpRequirement);
    }
  } catch (error) {
    if (!(error instanceof RegulatoryControlsUnavailableError)) {
      throw error;
    }
  }

  return REG_SP_REQUIREMENTS;
}
