import type { ReportFinding, ReportFindingEvidence } from "./findingsReport";
import { REG_SP_REQUIREMENTS } from "./regSpRequirements";
import { REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID } from "./regulatoryControlFramework";

// The run schema has no verifiable reviewer approval record. Completion is not approval.
// Do not infer review from status, free text, or caller-supplied metadata.
export const REPORT_REVIEW_LABEL = "Draft / Not Independently Reviewed";
export const REPORT_REVIEW_REQUIREMENT = "Reviewer verification required before distribution or reliance.";

export const STATUS_ORDER = ["covered", "partial", "missing", "conflicting", "needs_review"] as const;
export const STATUS_LABELS = { covered: "Covered", partial: "Partial", missing: "Missing", conflicting: "Conflicting", needs_review: "Needs Review" };
export const STATUS_COLORS = { covered: "#41836F", partial: "#DCA758", missing: "#B94D4D", conflicting: "#B94D4D", needs_review: "#64748B" };
export const STATUS_DEFINITIONS = {
  covered: "Reviewed documents support documentary coverage of the assessed requirement.",
  partial: "Reviewed documents address part of the requirement; details remain unresolved.",
  missing: "No clear supporting client-document evidence was identified in the reviewed scope.",
  conflicting: "Reviewed document language is inconsistent for the assessed requirement.",
  needs_review: "The stored assessment requires reviewer confirmation.",
};
export type AssessmentEvidence = ReportFindingEvidence & { id: string; document_id?: string | null; chunk_id?: string | null };
export type AssessmentFinding = Omit<ReportFinding, "evidence"> & {
  id: string; workspace_id: string; analysis_run_id: string; evidence: AssessmentEvidence[];
};
export type AssessmentInput = {
  workspaceName: string;
  workspaceId: string;
  run: { id: string; workspace_id: string; status: string; completed_at: string | null; requirement_count: number; finding_count: number };
  findings: AssessmentFinding[];
  documents: { document_id: string | null; filename: string | null }[];
};
export function reportMetrics(findings: Pick<AssessmentFinding, "status" | "severity">[]) {
  const counts = Object.fromEntries(STATUS_ORDER.map(s => [s, 0])) as Record<ReportFinding["status"], number>;
  for (const finding of findings) {
    if (!(finding.status in counts)) throw new Error("Unknown finding status");
    counts[finding.status]++;
  }
  const total = findings.length;
  return { total, counts, coveredPercent: total ? counts.covered / total * 100 : 0,
    unresolved: total - counts.covered,
    highRisk: findings.filter(f => f.status !== "covered" && ["critical", "high"].includes(f.severity)).length,
    segments: STATUS_ORDER.map(status => ({ status, count: counts[status], percent: total ? counts[status] / total * 100 : 0 })) };
}
export function exactQuotes(e: AssessmentEvidence) {
  return [...new Set([e.quote, e.evidence_quote].filter((q): q is string => typeof q === "string" && q.trim().length > 0))];
}
export function evidencePageReference(e: ReportFindingEvidence) {
  return e.page_start == null ? "Page not recorded" : e.page_end != null && e.page_end !== e.page_start ? `Pages ${e.page_start}-${e.page_end}` : `Page ${e.page_start}`;
}
export function evidenceLocation(e: ReportFindingEvidence) {
  return `${e.filename || "Filename not recorded"} | ${e.section_path || "Section not recorded"} | ${evidencePageReference(e)}`;
}
export function createAssessmentReport(input: AssessmentInput) {
  const { run, workspaceId, findings } = input;
  if (run.status !== "completed" || !run.completed_at || !Number.isFinite(Date.parse(run.completed_at))) throw new Error("A completed analysis is required");
  if (run.workspace_id !== workspaceId || findings.some(f => f.workspace_id !== workspaceId || f.analysis_run_id !== run.id)) throw new Error("Report scope mismatch");
  if (!findings.length || run.finding_count !== findings.length || run.requirement_count !== findings.length || new Set(findings.map(f => f.id)).size !== findings.length || new Set(findings.map(f => f.requirement_id)).size !== findings.length) throw new Error("Analysis counts do not reconcile");
  const severityOrder = ["critical", "high", "medium", "low", "info"];
  for (const f of findings) if (!severityOrder.includes(f.severity)) throw new Error("Unknown finding severity");
  const metrics = reportMetrics(findings);
  const items = findings.map((f, i) => {
    const key = REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID[f.requirement_id as keyof typeof REG_SP_CONTROL_KEY_BY_LEGACY_REQUIREMENT_ID] ?? f.requirement_id;
    const basis = REG_SP_REQUIREMENTS.find(r => r.id === key || r.id === f.requirement_id);
    const evidence = f.evidence.map(e => ({ ...e, quotes: exactQuotes(e) }));
    const relevant = [...evidence].sort((a,b) => {
      const rank = (e: AssessmentEvidence) => {
        if (f.status === "conflicting" && e.relationship === "contradicts") return -1;
        const index = ["supports", "partially_supports", "negative_evidence", "background_context"].indexOf(e.relationship || "");
        return index < 0 ? 5 : index;
      };
      return (a.quotes.length ? 0 : 10) - (b.quotes.length ? 0 : 10) + rank(a) - rank(b);
    }).find(e => e.quotes.length);
    return { ...f, ref: `F-${String(i+1).padStart(2,"0")}`, basis, evidence, relevant };
  });
  const priorities = items.filter(f => f.status !== "covered").sort((a,b) => severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity) || a.ref.localeCompare(b.ref));
  return { ...input, reviewLabel: REPORT_REVIEW_LABEL, metrics, items, priorities };
}
export type AssessmentReport = ReturnType<typeof createAssessmentReport>;

/** Presentation only: do not reinterpret or replace stored assessment content. */
export function findingPresentation(finding: ReportFinding) {
  const sameText = (a: string | null, b: string | null) =>
    Boolean(a?.trim()) && a?.trim().replace(/\s+/g, " ") === b?.trim().replace(/\s+/g, " ");
  return {
    conclusion: finding.summary?.trim() ? finding.summary : finding.rationale,
    rationale: sameText(finding.summary, finding.rationale) || !finding.summary?.trim() ? null : finding.rationale,
    unresolvedRisk: finding.status === "covered" ? "None indicated (Covered)" : finding.severity,
  };
}
