export const RETRIEVAL_EVAL_REPORT_VERSION = "retrieval-eval-v1";

export const MANUAL_RETRIEVAL_EVAL_QUERIES = [
  {
    id: 1,
    query: "What procedures exist for notifying affected customers after unauthorized access?",
    expected:
      "Customer notification, breach notification, unauthorized access, affected customers, timing/escalation, or communication procedures.",
  },
  {
    id: 2,
    query: "How does the organization classify or escalate major incidents?",
    expected:
      "Incident severity, escalation criteria, major incident definitions, triage, or decision authority.",
  },
  {
    id: 3,
    query: "What does the policy say about incident containment?",
    expected:
      "Containment procedures, isolation, eradication handoff, response phases, or immediate mitigation steps.",
  },
  {
    id: 4,
    query: "What does the policy say about preserving logs or evidence?",
    expected:
      "Log retention, evidence preservation, chain-of-custody, forensic collection, or incident records.",
  },
  {
    id: 5,
    query: "What does the policy say about notifying regulators or law enforcement?",
    expected:
      "Regulator notice, law enforcement contact, legal/compliance escalation, reporting timelines, or notification ownership.",
  },
  {
    id: 6,
    query: "What does the policy say about vendor or third-party breach notification?",
    expected:
      "Vendor incident notice, third-party notification obligations, service provider escalation, or contractual reporting requirements.",
  },
  {
    id: 7,
    query: "What safeguards protect customer information?",
    expected:
      "Access controls, encryption, monitoring, administrative/technical safeguards, customer information protection, or privacy controls.",
  },
  {
    id: 8,
    query: "How are recovery activities validated or tested?",
    expected:
      "Recovery validation, restoration checks, lessons learned, post-incident testing, business continuity, or recovery verification.",
  },
  {
    id: 9,
    query: "What roles are responsible during incident response?",
    expected:
      "Incident commander, response team, legal/compliance, communications, IT/security operations, or role/responsibility matrices.",
  },
  {
    id: 10,
    query: "How are vulnerabilities remediated and tracked?",
    expected:
      "Vulnerability remediation, tracking, prioritization, patching, closure validation, or remediation ownership.",
  },
];

export function normalizeReportText(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function previewText(value, maxLength = 700) {
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

export function shapeRetrievalEvalResult(row, rank) {
  return {
    rank,
    filename: row.filename ?? null,
    document_id: row.document_id,
    page_start: row.page_start ?? null,
    page_end: row.page_end ?? null,
    chunk_index: row.chunk_index,
    section_path: row.section_path ?? null,
    similarity: typeof row.similarity === "number" ? row.similarity : null,
    evidence_reason: row.evidence_reason ?? null,
    content_preview: previewText(row.content_preview, 900),
    embedding_input_preview: previewText(row.embedding_input, 900),
  };
}

export function buildRetrievalEvalReport({
  generatedAt,
  workspaceId,
  documentId = null,
  topK,
  queries,
}) {
  return {
    reportVersion: RETRIEVAL_EVAL_REPORT_VERSION,
    generatedAt,
    workspaceId,
    documentId,
    topK,
    queryCount: queries.length,
    queries: queries.map((query) => {
      const similarities = query.results
        .map((result) => result.similarity)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const averageSimilarity = similarities.length > 0
        ? similarities.reduce((sum, value) => sum + value, 0) / similarities.length
        : null;
      const topResult = query.results[0] ?? null;

      return {
        ...query,
        averageSimilarity,
        topResultSummary: topResult
          ? {
              filename: topResult.filename,
              document_id: topResult.document_id,
              page_start: topResult.page_start,
              page_end: topResult.page_end,
              chunk_index: topResult.chunk_index,
              section_path: topResult.section_path,
              similarity: topResult.similarity,
            }
          : null,
      };
    }),
  };
}

export function formatRetrievalEvalMarkdown(report) {
  const lines = [
    "# RegSpan retrieval evaluation report",
    "",
    "## Summary",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Workspace ID: ${report.workspaceId}`,
    `- Document filter: ${report.documentId ?? "All workspace documents"}`,
    `- Queries run: ${report.queryCount}`,
    `- Top K: ${report.topK}`,
    `- Report version: ${report.reportVersion}`,
    "",
    "### Query summary",
    "",
    "| # | Average similarity | Top result | Top page | Top section |",
    "|---|---:|---|---|---|",
  ];

  for (const query of report.queries) {
    const top = query.topResultSummary;
    lines.push(
      [
        query.id,
        query.averageSimilarity === null ? "—" : query.averageSimilarity.toFixed(4),
        escapeMarkdownTableCell(top?.filename),
        escapeMarkdownTableCell(top ? formatPageRange(top.page_start, top.page_end) : "—"),
        escapeMarkdownTableCell(top?.section_path),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }

  lines.push("");
  lines.push("## Reviewer grading rubric");
  lines.push("");
  lines.push("- Top result relevant: yes / no / weak");
  lines.push("- Top 3 relevant: yes / no / weak");
  lines.push("- Verdict: pass / weak / fail");
  lines.push("");

  for (const query of report.queries) {
    lines.push(`## ${query.id}. ${query.query}`);
    lines.push("");
    lines.push(`Expected signal: ${query.expected}`);
    lines.push("");
    lines.push("### Manual reviewer fields");
    lines.push("");
    lines.push("- Top result relevant: ");
    lines.push("- Top 3 relevant: ");
    lines.push("- Best document: ");
    lines.push("- Best page range: ");
    lines.push("- Problem noticed: ");
    lines.push("- Verdict: ");
    lines.push("");
    lines.push("### Results");
    lines.push("");

    if (query.results.length === 0) {
      lines.push("_No results returned._");
      lines.push("");
      continue;
    }

    for (const result of query.results) {
      lines.push(`#### Rank ${result.rank} · ${result.filename ?? "Untitled document"}`);
      lines.push("");
      lines.push(`- Document ID: ${result.document_id}`);
      lines.push(`- Page range: ${formatPageRange(result.page_start, result.page_end)}`);
      lines.push(`- Chunk index: ${result.chunk_index}`);
      lines.push(`- Section path: ${result.section_path ?? "—"}`);
      lines.push(`- Similarity: ${result.similarity === null ? "—" : result.similarity.toFixed(4)}`);
      lines.push(`- Evidence reason: ${result.evidence_reason ?? "—"}`);
      lines.push("");
      lines.push("Content preview:");
      lines.push("");
      lines.push("> " + (result.content_preview || "—").replace(/\n/g, "\n> "));

      if (result.embedding_input_preview) {
        lines.push("");
        lines.push("<details>");
        lines.push("<summary>Embedding input preview</summary>");
        lines.push("");
        lines.push("```text");
        lines.push(result.embedding_input_preview);
        lines.push("```");
        lines.push("");
        lines.push("</details>");
      }

      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
