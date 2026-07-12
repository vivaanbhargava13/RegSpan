const VALID_TIERS = new Set(["weak", "partial", "strong", "adversarial"]);
const VALID_STATUSES = new Set([
  "covered",
  "partial",
  "missing",
  "conflicting",
  "needs_review",
]);

export class CorpusManifestError extends Error {}
export class CorpusEvaluationTimeoutError extends Error {}
export class CorpusEvaluationSafetyError extends Error {}

function normalizedStatus(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new CorpusManifestError(`${label} must be an array of non-empty strings.`);
  }
  return value.map((item) => item.trim());
}

function statusMap(value, label, arrayValues = false) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CorpusManifestError(`${label} must be an object.`);
  }

  const normalized = {};
  for (const [requirementId, rawStatus] of Object.entries(value)) {
    if (!requirementId.trim()) throw new CorpusManifestError(`${label} has an empty requirement id.`);
    const statuses = arrayValues ? stringArray(rawStatus, `${label}.${requirementId}`) : [rawStatus];
    normalized[requirementId] = statuses.map((status) => {
      const value = normalizedStatus(status);
      if (!VALID_STATUSES.has(value)) {
        throw new CorpusManifestError(`${label}.${requirementId} has an invalid status.`);
      }
      return value;
    });
  }
  return normalized;
}

export function validateCorpusManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new CorpusManifestError("Corpus manifest must be an object.");
  }
  if (manifest.version !== 1) throw new CorpusManifestError("Corpus manifest version must be 1.");
  if (typeof manifest.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(manifest.id)) {
    throw new CorpusManifestError("Corpus manifest id must be a lowercase slug.");
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length < 10 || manifest.cases.length > 15) {
    throw new CorpusManifestError("Corpus manifest must contain 10 through 15 cases.");
  }

  const caseIds = new Set();
  const cases = manifest.cases.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CorpusManifestError(`Case ${index + 1} must be an object.`);
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(entry.id)) {
      throw new CorpusManifestError(`Case ${index + 1} id must be a lowercase slug.`);
    }
    if (caseIds.has(entry.id)) throw new CorpusManifestError(`Duplicate case id: ${entry.id}.`);
    caseIds.add(entry.id);
    if (typeof entry.filename !== "string" || entry.filename !== entry.filename.split(/[\\/]/).pop()
      || !entry.filename.toLowerCase().endsWith(".pdf")) {
      throw new CorpusManifestError(`Case ${entry.id} filename must be a local PDF filename.`);
    }
    if (!VALID_TIERS.has(entry.tier)) {
      throw new CorpusManifestError(`Case ${entry.id} tier is invalid.`);
    }

    const include = entry.include ?? { isolated: true, combined: true };
    if (!include || typeof include !== "object" || (!include.isolated && !include.combined)) {
      throw new CorpusManifestError(`Case ${entry.id} must opt into isolated or combined mode.`);
    }

    return {
      id: entry.id,
      filename: entry.filename,
      tier: entry.tier,
      include: { isolated: include.isolated !== false, combined: include.combined !== false },
      expectedStatuses: statusMap(entry.expectedStatuses ?? {}, `cases.${entry.id}.expectedStatuses`),
      acceptableAlternateStatuses: statusMap(
        entry.acceptableAlternateStatuses ?? {},
        `cases.${entry.id}.acceptableAlternateStatuses`,
        true,
      ),
      forbiddenMatches: Object.fromEntries(Object.entries(entry.forbiddenMatches ?? {}).map(
        ([requirementId, phrases]) => [
          requirementId,
          stringArray(phrases, `cases.${entry.id}.forbiddenMatches.${requirementId}`),
        ],
      )),
      expectedEvidenceConcepts: Object.fromEntries(Object.entries(entry.expectedEvidenceConcepts ?? {}).map(
        ([requirementId, concepts]) => [
          requirementId,
          stringArray(concepts, `cases.${entry.id}.expectedEvidenceConcepts.${requirementId}`),
        ],
      )),
    };
  });

  return { id: manifest.id, version: manifest.version, cases };
}

export function assertCorpusEvaluationSafety({
  environment,
  actorUserId,
  workspacePrefix,
}) {
  if (environment.NODE_ENV === "production" && environment.REGSPAN_EVAL_ENABLED !== "true") {
    throw new CorpusEvaluationSafetyError("Corpus evaluation is disabled in production.");
  }
  if (typeof actorUserId !== "string" || !actorUserId.trim()) {
    throw new CorpusEvaluationSafetyError("Evaluation actor user id is required.");
  }
  if (typeof workspacePrefix !== "string" || !/^regspan-eval-[a-z0-9-]*$/.test(workspacePrefix)) {
    throw new CorpusEvaluationSafetyError("Evaluation workspace prefix must explicitly begin with regspan-eval-.");
  }
  return { actorUserId: actorUserId.trim(), workspacePrefix };
}

export function assertCorpusEvaluationExternalAiOptIn(allowExternalAi) {
  if (allowExternalAi !== true) {
    throw new CorpusEvaluationSafetyError(
      "Corpus evaluation requires --allow-external-ai to process embeddings.",
    );
  }
}

function safeProcessingValue(value) {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized ? normalized.slice(0, 500) : undefined;
}

export function processingResultForReport({ status, step, errorMessage }) {
  return {
    processingStatus: String(status) === "Processed" ? "processed" : "failed",
    processingStep: safeProcessingValue(step),
    processingError: safeProcessingValue(errorMessage),
  };
}

export function evaluationWorkspaceName({ workspacePrefix, corpusId, mode, runId, workspaceKey }) {
  return `${workspacePrefix}${corpusId}-${mode}-${runId}-${workspaceKey}`;
}

export function assertFreshEvaluationWorkspace(existingCount) {
  if (!Number.isSafeInteger(existingCount) || existingCount < 0) {
    throw new CorpusEvaluationSafetyError("Evaluation workspace lookup result is invalid.");
  }
  if (existingCount > 0) {
    throw new CorpusEvaluationSafetyError("Evaluation workspace already exists; start a new invocation.");
  }
}

export function newEvaluationWorkspaceValues({
  workspaceName,
  actorUserId,
  externalAiProcessingEnabled,
}) {
  if (externalAiProcessingEnabled !== true) {
    throw new CorpusEvaluationSafetyError("Evaluation external AI consent is required.");
  }
  return {
    name: workspaceName,
    owner_user_id: actorUserId,
    // This payload is used only for a newly inserted evaluator workspace.
    external_ai_processing_enabled: true,
  };
}

export function createOneShotEvaluationState({
  runId,
  corpusId,
  mode,
  actorUserId,
  workspacePrefix,
  selectedCases,
  startedAt,
}) {
  const workspaceKeys = mode === "combined" ? ["combined"] : selectedCases.map((entry) => entry.id);
  return {
    schemaVersion: 1,
    runId,
    corpusId,
    mode,
    status: "incomplete",
    startedAt,
    actorUserId,
    workspacePrefix,
    workspaces: Object.fromEntries(workspaceKeys.map((key) => [key, {
      key,
      name: evaluationWorkspaceName({ workspacePrefix, corpusId, mode, runId, workspaceKey: key }),
    }])),
    cases: Object.fromEntries(selectedCases.map((definition) => [definition.id, {
      caseId: definition.id,
      tier: definition.tier,
      filename: definition.filename,
      workspaceKey: mode === "combined" ? "combined" : definition.id,
    }])),
    failures: [],
  };
}

export function recordEvaluationFailure(state, caseId, message, diagnosticCode) {
  state.status = "incomplete";
  state.failures.push({ caseId, message, ...(diagnosticCode ? { diagnosticCode } : {}) });
  if (caseId && state.cases[caseId]) {
    state.cases[caseId].error = message;
    if (diagnosticCode) state.cases[caseId].diagnosticCode = diagnosticCode;
  }
  return state;
}

export function snapshotSetViolations(actualDocumentIds, expectedDocumentIds) {
  const actual = new Set(actualDocumentIds);
  const expected = new Set(expectedDocumentIds);
  const violations = [];
  if (actual.size !== actualDocumentIds.length) violations.push("duplicate_snapshot_document");
  if ([...actual].some((documentId) => !expected.has(documentId))) {
    violations.push("unexpected_snapshot_document");
  }
  if ([...expected].some((documentId) => !actual.has(documentId))) {
    violations.push("missing_snapshot_document");
  }
  return violations;
}

export async function pollForTerminal({
  load,
  terminalStatuses,
  timeoutMs,
  intervalMs = 1_000,
  now = () => Date.now(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  label = "operation",
}) {
  const startedAt = now();
  let latest = await load();
  while (!terminalStatuses.has(String(latest?.status ?? ""))) {
    if (now() - startedAt >= timeoutMs) {
      throw new CorpusEvaluationTimeoutError(`${label} did not reach a terminal state before timeout.`);
    }
    await wait(Math.min(intervalMs, Math.max(0, timeoutMs - (now() - startedAt))));
    latest = await load();
  }
  return latest;
}

function evidenceTextForFinding(finding, evidenceRows) {
  return evidenceRows
    .filter((row) => row.finding_id === finding.id)
    .map((row) => String(row.quote ?? row.evidence_quote ?? row.source_quote ?? ""))
    .join("\n")
    .toLowerCase();
}

export function scoreCaseFindings({ caseDefinition, findings, evidenceRows }) {
  const findingsByRequirement = new Map(findings.map((finding) => [finding.requirement_id, finding]));
  const statusResults = [];
  const conceptResults = [];
  const forbiddenResults = [];

  for (const [requirementId, statuses] of Object.entries(caseDefinition.expectedStatuses)) {
    const finding = findingsByRequirement.get(requirementId);
    const actualStatus = normalizedStatus(finding?.status);
    const alternates = caseDefinition.acceptableAlternateStatuses[requirementId] ?? [];
    statusResults.push({
      requirementId,
      expected: statuses,
      alternates,
      actual: actualStatus || null,
      matched: statuses.includes(actualStatus) || alternates.includes(actualStatus),
    });
  }

  for (const [requirementId, concepts] of Object.entries(caseDefinition.expectedEvidenceConcepts)) {
    const finding = findingsByRequirement.get(requirementId);
    const text = finding ? evidenceTextForFinding(finding, evidenceRows) : "";
    const missingConcepts = concepts.filter((concept) => !text.includes(concept.toLowerCase()));
    conceptResults.push({ requirementId, concepts, missingConcepts, matched: missingConcepts.length === 0 });
  }

  for (const [requirementId, phrases] of Object.entries(caseDefinition.forbiddenMatches)) {
    const finding = findingsByRequirement.get(requirementId);
    const text = finding ? evidenceTextForFinding(finding, evidenceRows) : "";
    const matchedPhrases = phrases.filter((phrase) => text.includes(phrase.toLowerCase()));
    forbiddenResults.push({ requirementId, phrases, matchedPhrases, matched: matchedPhrases.length === 0 });
  }

  const unexpectedCovered = findings
    .filter((finding) => ["covered", "partial"].includes(normalizedStatus(finding.status)))
    .filter((finding) => caseDefinition.expectedStatuses[finding.requirement_id]?.includes("missing"))
    .map((finding) => finding.requirement_id);

  return {
    statusResults,
    conceptResults,
    forbiddenResults,
    unexpectedCovered,
    matchedStatuses: statusResults.filter((result) => result.matched).length,
    expectedStatuses: statusResults.length,
  };
}

export function evidenceIntegrityViolations({
  workspaceId,
  snapshotDocumentIds,
  caseDocumentIds,
  findings,
  evidenceRows,
}) {
  const snapshotIds = new Set(snapshotDocumentIds);
  const caseIds = new Set(caseDocumentIds);
  const evidenceByFinding = new Map();
  const violations = [];

  for (const evidence of evidenceRows) {
    const rows = evidenceByFinding.get(evidence.finding_id) ?? [];
    rows.push(evidence);
    evidenceByFinding.set(evidence.finding_id, rows);
    if (evidence.workspace_id !== workspaceId) violations.push("evidence_workspace_mismatch");
    if (!evidence.document_id || !snapshotIds.has(evidence.document_id)) {
      violations.push("evidence_outside_run_snapshot");
    }
    if (evidence.document_id && !caseIds.has(evidence.document_id)) {
      violations.push("cross_case_evidence");
    }
    if (evidence.source_type && evidence.source_type !== "client_policy") {
      violations.push("regulatory_or_non_client_evidence");
    }
  }

  for (const finding of findings) {
    if (!["covered", "partial"].includes(normalizedStatus(finding.status))) continue;
    const primary = (evidenceByFinding.get(finding.id) ?? []).filter((evidence) =>
      ["supports", "partially_supports", "negative_evidence"].includes(evidence.relationship)
      && String(evidence.quote ?? evidence.evidence_quote ?? evidence.source_quote ?? "").trim(),
    );
    if (primary.length === 0) violations.push(`missing_primary_evidence:${finding.requirement_id}`);
  }

  return [...new Set(violations)];
}
