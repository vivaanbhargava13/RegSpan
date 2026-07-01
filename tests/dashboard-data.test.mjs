import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculateComplianceScore,
  calculateDashboardFindingMetrics,
  calculateDocumentProgress,
} from "../lib/dashboardMetrics.ts";

test("dashboard compliance score uses covered findings over total findings", () => {
  const findings = [
    { status: "covered", severity: "high" },
    { status: "covered", severity: "info" },
    { status: "partial", severity: "high" },
    { status: "needs_review", severity: "medium" },
  ];

  assert.equal(calculateComplianceScore(findings), 50);
  assert.deepEqual(calculateDashboardFindingMetrics(findings), {
    totalFindings: 4,
    coveredFindings: 2,
    openFindings: 2,
    highRiskOpen: 1,
    needsReview: 1,
    complianceScore: 50,
  });
});

test("dashboard high-risk open excludes covered high-severity findings", () => {
  const metrics = calculateDashboardFindingMetrics([
    { status: "covered", severity: "critical" },
    { status: "covered", severity: "high" },
    { status: "missing", severity: "high" },
  ]);

  assert.equal(metrics.highRiskOpen, 1);
  assert.equal(metrics.openFindings, 1);
});

test("dashboard document progress handles empty and processed document counts", () => {
  assert.deepEqual(calculateDocumentProgress({ totalDocuments: 0, processedDocuments: 0 }), {
    totalDocuments: 0,
    processedDocuments: 0,
    percentage: null,
  });
  assert.deepEqual(calculateDocumentProgress({ totalDocuments: 4, processedDocuments: 3 }), {
    totalDocuments: 4,
    processedDocuments: 3,
    percentage: 75,
  });
});

test("dashboard loader uses latest completed run for metrics instead of stale running run", async () => {
  const loader = await readFile("lib/dashboardData.ts", "utf8");

  assert.match(loader, /getLatestRun/);
  assert.match(loader, /getLatestCompletedRun/);
  assert.match(loader, /\.eq\("status", "completed"\)/);
  assert.match(loader, /latestCompletedRun\?\.id/);
  assert.match(loader, /calculateDashboardFindingMetrics\(findings\)/);
});

test("dashboard API enforces authenticated workspace scope", async () => {
  const route = await readFile("app/api/dashboard/route.ts", "utf8");

  assert.match(route, /authenticateRequest/);
  assert.match(route, /getActorWorkspaceId/);
  assert.match(route, /loadDashboardData/);
  assert.doesNotMatch(route, /workspace_id.*request/i);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("dashboard UI exposes real-data empty states and linked metric cards", async () => {
  const client = await readFile("components/DashboardClient.tsx", "utf8");

  assert.match(client, /No documents uploaded yet/);
  assert.match(client, /Documents are waiting to be processed/);
  assert.match(client, /No findings analysis yet/);
  assert.match(client, /Findings analysis is currently running/);
  assert.match(client, /The latest run failed/);
  assert.match(client, /href="\/findings"/);
  assert.match(client, /href="\/documents"/);
  assert.match(client, /Compliance score/);
  assert.match(client, /High-risk open/);
  assert.match(client, /Needs review/);
});
