export const REQUIREMENT_EVAL_REPORT_VERSION = "requirement-eval-v1";

export function normalizeReportText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function previewText(value, maxLength = 900) {
  const normalized = normalizeReportText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function escapeMarkdownTableCell(value) {
  return String(value ?? "—")
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, " ")
    .trim() || "—";
}

export function formatPageRange(pageStart, pageEnd) {
  if (pageStart === null && pageEnd === null) {
    return "—";
  }
  if (pageStart === pageEnd || pageEnd === null) {
    return `Page ${pageStart}`;
  }
  return `Pages ${pageStart ?? pageEnd}–${pageEnd}`;
}

function incrementCount(counts, key) {
  const normalizedKey = key || "unknown";
  counts[normalizedKey] = (counts[normalizedKey] ?? 0) + 1;
}

export function shapeRequirementEvidenceChunk(chunk) {
  return {
    rank: chunk.rank ?? null,
    filename: chunk.filename ?? null,
    document_id: chunk.document_id,
    page_start: chunk.page_start ?? null,
    page_end: chunk.page_end ?? null,
    chunk_index: chunk.chunk_index,
    section_path: chunk.section_path ?? null,
    similarity: typeof chunk.similarity === "number" ? chunk.similarity : null,
    grade: chunk.grade,
    grade_reason: chunk.grade_reason,
    source_type: chunk.source_type,
    evidence_role: chunk.evidence_role,
    evidence_reason: chunk.evidence_reason ?? null,
    content_preview: previewText(chunk.content_preview, 900),
  };
}

export function buildRequirementEvalReport({
  generatedAt,
  workspaceId,
  workspaceName = null,
  topK,
  requirementId = "all",
  results,
}) {
  return {
    reportVersion: REQUIREMENT_EVAL_REPORT_VERSION,
    generatedAt,
    workspaceId,
    workspaceName,
    topK,
    requirementId,
    requirementCount: results.length,
    requirements: results.map((result) => {
      const candidates = [
        ...result.direct,
        ...result.partial,
        ...result.background,
        ...result.irrelevant,
      ];
      const evidenceRoleCounts = {
        organization_evidence: 0,
        requirement_reference: 0,
        supporting_context: 0,
      };
      const sourceTypeMix = {};

      for (const candidate of candidates) {
        incrementCount(evidenceRoleCounts, candidate.evidence_role);
        incrementCount(sourceTypeMix, candidate.source_type);
      }

      return {
        requirement_id: result.requirement.id,
        title: result.requirement.title,
        description: result.requirement.description,
        status: result.status,
        status_reason: result.status_reason,
        top_k: topK,
        candidate_count: candidates.length,
        direct_count: result.direct.length,
        partial_count: result.partial.length,
        background_count: result.background.length,
        irrelevant_count: result.irrelevant.length,
        organization_evidence_count: evidenceRoleCounts.organization_evidence,
        requirement_reference_count: evidenceRoleCounts.requirement_reference,
        supporting_context_count: evidenceRoleCounts.supporting_context,
        source_type_mix: sourceTypeMix,
        top_evidence_chunks: candidates.map(shapeRequirementEvidenceChunk),
      };
    }),
  };
}

function formatCountMap(counts) {
  const entries = Object.entries(counts ?? {});
  if (entries.length === 0) {
    return "—";
  }
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

export function formatRequirementEvalMarkdown(report) {
  const lines = [
    "# RegSpan requirement matching evaluation report",
    "",
    "## Summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Workspace ID: ${report.workspaceId}`,
    `- Workspace name: ${report.workspaceName ?? "—"}`,
    `- Requirement filter: ${report.requirementId}`,
    `- Requirements run: ${report.requirementCount}`,
    `- Top K: ${report.topK}`,
    `- Report version: ${report.reportVersion}`,
    "",
    "### Requirement summary",
    "",
    "| Requirement | Status | Candidates | Direct | Partial | Background | Ignored | Org evidence | Reference | Context | Source mix |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const requirement of report.requirements) {
    lines.push(
      [
        escapeMarkdownTableCell(requirement.title),
        escapeMarkdownTableCell(requirement.status),
        requirement.candidate_count,
        requirement.direct_count,
        requirement.partial_count,
        requirement.background_count,
        requirement.irrelevant_count,
        requirement.organization_evidence_count,
        requirement.requirement_reference_count,
        requirement.supporting_context_count,
        escapeMarkdownTableCell(formatCountMap(requirement.source_type_mix)),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("");
  lines.push("## Reviewer grading rubric");
  lines.push("");
  lines.push("- correct status?: yes / no / weak");
  lines.push("- best evidence present?: yes / no / weak");
  lines.push("- source role correct?: yes / no / weak");
  lines.push("- grading issue?: ");
  lines.push("- retrieval issue?: ");
  lines.push("- chunking issue?: ");
  lines.push("- notes: ");
  lines.push("");

  for (const requirement of report.requirements) {
    lines.push(`## ${requirement.requirement_id} · ${requirement.title}`);
    lines.push("");
    lines.push(requirement.description);
    lines.push("");
    lines.push(`- Status: ${requirement.status}`);
    lines.push(`- Status reason: ${requirement.status_reason}`);
    lines.push(`- Top K used: ${requirement.top_k}`);
    lines.push(`- Candidate count: ${requirement.candidate_count}`);
    lines.push(`- Direct / partial / background / ignored: ${requirement.direct_count} / ${requirement.partial_count} / ${requirement.background_count} / ${requirement.irrelevant_count}`);
    lines.push(`- Evidence roles: organization_evidence ${requirement.organization_evidence_count}, requirement_reference ${requirement.requirement_reference_count}, supporting_context ${requirement.supporting_context_count}`);
    lines.push(`- Source type mix: ${formatCountMap(requirement.source_type_mix)}`);
    lines.push("");
    lines.push("### Manual reviewer fields");
    lines.push("");
    lines.push("- correct status?: ");
    lines.push("- best evidence present?: ");
    lines.push("- source role correct?: ");
    lines.push("- grading issue?: ");
    lines.push("- retrieval issue?: ");
    lines.push("- chunking issue?: ");
    lines.push("- notes: ");
    lines.push("");
    lines.push("### Top evidence chunks");
    lines.push("");

    if (requirement.top_evidence_chunks.length === 0) {
      lines.push("_No candidates returned._");
      lines.push("");
      continue;
    }

    for (const chunk of requirement.top_evidence_chunks) {
      lines.push(`#### ${chunk.rank === null ? "Candidate" : `Rank ${chunk.rank}`} · ${chunk.grade} · ${chunk.filename ?? "Untitled document"}`);
      lines.push("");
      lines.push(`- Document ID: ${chunk.document_id}`);
      lines.push(`- Page range: ${formatPageRange(chunk.page_start, chunk.page_end)}`);
      lines.push(`- Chunk index: ${chunk.chunk_index}`);
      lines.push(`- Section path: ${chunk.section_path ?? "—"}`);
      lines.push(`- Similarity: ${chunk.similarity === null ? "—" : chunk.similarity.toFixed(4)}`);
      lines.push(`- Grade reason: ${chunk.grade_reason}`);
      lines.push(`- Source type: ${chunk.source_type}`);
      lines.push(`- Evidence role: ${chunk.evidence_role}`);
      lines.push(`- Chunk classifier: ${chunk.evidence_reason ?? "—"}`);
      lines.push("");
      lines.push("Content preview:");
      lines.push("");
      lines.push("> " + (chunk.content_preview || "—").replace(/\n/g, "\n> "));
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
