export type DashboardFindingStatus = "covered" | "partial" | "missing" | "conflicting" | "needs_review";
export type DashboardFindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type DashboardFindingMetricInput = {
  status: DashboardFindingStatus;
  severity: DashboardFindingSeverity;
};

export type DashboardDocumentMetricInput = {
  totalDocuments: number;
  processedDocuments: number;
};

export function calculateComplianceScore(findings: DashboardFindingMetricInput[]) {
  if (findings.length === 0) return null;
  const coveredCount = findings.filter((finding) => finding.status === "covered").length;
  return Math.round((coveredCount / findings.length) * 100);
}

export function calculateDashboardFindingMetrics(findings: DashboardFindingMetricInput[]) {
  const totalFindings = findings.length;
  const coveredFindings = findings.filter((finding) => finding.status === "covered").length;
  const openFindings = findings.filter((finding) => finding.status !== "covered").length;
  const highRiskOpen = findings.filter(
    (finding) =>
      finding.status !== "covered" &&
      (finding.severity === "high" || finding.severity === "critical"),
  ).length;
  const needsReview = findings.filter((finding) => finding.status === "needs_review").length;

  return {
    totalFindings,
    coveredFindings,
    openFindings,
    highRiskOpen,
    needsReview,
    complianceScore: calculateComplianceScore(findings),
  };
}

export function calculateDocumentProgress({
  totalDocuments,
  processedDocuments,
}: DashboardDocumentMetricInput) {
  const safeTotal = Math.max(0, totalDocuments);
  const safeProcessed = Math.min(Math.max(0, processedDocuments), safeTotal);

  return {
    totalDocuments: safeTotal,
    processedDocuments: safeProcessed,
    percentage: safeTotal === 0 ? null : Math.round((safeProcessed / safeTotal) * 100),
  };
}
