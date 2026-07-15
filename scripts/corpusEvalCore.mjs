const VALID_TIERS = new Set(["weak", "partial", "strong", "developing", "mixed", "adversarial"]);
const VALID_STATUSES = new Set([
  "covered",
  "partial",
  "missing",
  "conflicting",
  "needs_review",
]);
const VALID_CORPUS_SOURCE_TYPES = new Set([
  "client_policy",
  "client_procedure",
  "client_standard",
]);
const CANONICAL_REQUIREMENT_IDS = new Set([
  "written_incident_response_program",
  "customer_notification_unauthorized_access",
  "incident_assessment_containment_control",
  "safeguards_customer_information",
  "written_compliance_records",
  "incident_evidence_log_preservation",
  "response_recovery_remediation_validation",
  "customer_notification_content",
  "service_provider_incident_oversight_notice",
  "disposal_consumer_customer_information",
  "regulator_law_enforcement_notification_coordination",
]);
const CLIENT_EVIDENCE_SOURCE_TYPES = new Set([
  "unknown",
  "client_policy",
  "client_procedure",
  "client_standard",
]);

export class CorpusManifestError extends Error {}
export class CorpusEvaluationTimeoutError extends Error {}
export class CorpusEvaluationRateLimitWaitExceededError extends Error {}
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
    if (!CANONICAL_REQUIREMENT_IDS.has(requirementId)) {
      throw new CorpusManifestError(`${label}.${requirementId} is not a canonical requirement id.`);
    }
    const statuses = arrayValues || Array.isArray(rawStatus)
      ? stringArray(rawStatus, `${label}.${requirementId}`)
      : [rawStatus];
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

function isSafeRelativePdfPath(value) {
  return typeof value === "string"
    && value.toLowerCase().endsWith(".pdf")
    && !value.startsWith("/")
    && !value.startsWith("\\")
    && value.split(/[\\/]/).every((segment) => segment && segment !== "." && segment !== "..");
}

function v2ExpectedStatusMap(value, caseId) {
  if (!Array.isArray(value)) {
    throw new CorpusManifestError(`Case ${caseId} expectedStatuses must be an array.`);
  }
  const map = {};
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || typeof entry.requirementId !== "string" || !entry.requirementId.trim()) {
      throw new CorpusManifestError(`Case ${caseId} has an invalid expected-status entry.`);
    }
    if (Object.hasOwn(map, entry.requirementId)) {
      throw new CorpusManifestError(`Case ${caseId} repeats expected status for ${entry.requirementId}.`);
    }
    map[entry.requirementId] = entry.expected;
  }
  return map;
}

export function normalizeCorpusManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return manifest;
  if (manifest.version !== 2 || typeof manifest.corpusId !== "string") return manifest;
  if (!Array.isArray(manifest.cases)) return manifest;

  return {
    version: manifest.version,
    id: manifest.corpusId,
    cases: manifest.cases.map((entry) => ({
      id: entry.id,
      filename: entry.filename,
      documentPath: entry.path,
      documentType: entry.documentType,
      notes: entry.notes,
      companyName: entry.companyName,
      entityType: entry.entityType,
      tier: entry.tier,
      enabled: entry.enabled !== false,
      sourceType: entry.sourceType,
      // Every V2 fixture represents a different fictional company. Keep its
      // documents isolated rather than allowing a mixed-company combined run.
      include: { isolated: entry.enabled !== false, combined: false },
      expectedStatuses: v2ExpectedStatusMap(entry.expectedStatuses, entry.id),
      acceptableAlternateStatuses: {},
      forbiddenMatches: {},
      expectedEvidenceConcepts: {},
      expectedEvidenceElements: {},
    })),
  };
}

function expectedEvidenceElementMap(value, label, canonicalRequirementElements) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CorpusManifestError(`${label} must be an object.`);
  }

  const normalized = {};
  for (const [requirementId, elements] of Object.entries(value)) {
    if (!CANONICAL_REQUIREMENT_IDS.has(requirementId)) {
      throw new CorpusManifestError(`${label}.${requirementId} is not a canonical requirement id.`);
    }
    const elementIds = stringArray(elements, `${label}.${requirementId}`);
    const knownElements = canonicalRequirementElements?.[requirementId];
    if (canonicalRequirementElements && (!Array.isArray(knownElements)
      || elementIds.some((elementId) => !knownElements.includes(elementId)))) {
      throw new CorpusManifestError(`${label}.${requirementId} contains an unknown canonical element id.`);
    }
    normalized[requirementId] = elementIds;
  }
  return normalized;
}

export function validateCorpusManifest(manifest, { canonicalRequirementElements } = {}) {
  manifest = normalizeCorpusManifest(manifest);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new CorpusManifestError("Corpus manifest must be an object.");
  }
  if (manifest.version !== 1 && manifest.version !== 2) {
    throw new CorpusManifestError("Corpus manifest version must be 1 or 2.");
  }
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
    if (!VALID_CORPUS_SOURCE_TYPES.has(entry.sourceType)) {
      throw new CorpusManifestError(`Case ${entry.id} sourceType is invalid.`);
    }

    const enabled = entry.enabled !== false;
    const include = entry.include ?? { isolated: enabled, combined: enabled };
    if (!include || typeof include !== "object" || (enabled && !include.isolated && !include.combined)) {
      throw new CorpusManifestError(`Case ${entry.id} must opt into isolated or combined mode.`);
    }
    if (entry.documentPath !== undefined && !isSafeRelativePdfPath(entry.documentPath)) {
      throw new CorpusManifestError(`Case ${entry.id} documentPath must be a safe relative PDF path.`);
    }

    return {
      id: entry.id,
      filename: entry.filename,
      tier: entry.tier,
      sourceType: entry.sourceType,
      enabled,
      include: { isolated: include.isolated !== false, combined: include.combined !== false },
      documentPath: entry.documentPath,
      documentType: typeof entry.documentType === "string" && entry.documentType.trim()
        ? entry.documentType.trim()
        : undefined,
      notes: typeof entry.notes === "string" && entry.notes.trim() ? entry.notes.trim() : undefined,
      companyName: typeof entry.companyName === "string" && entry.companyName.trim()
        ? entry.companyName.trim()
        : undefined,
      entityType: typeof entry.entityType === "string" && entry.entityType.trim()
        ? entry.entityType.trim()
        : undefined,
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
      expectedEvidenceElements: expectedEvidenceElementMap(
        entry.expectedEvidenceElements ?? {},
        `cases.${entry.id}.expectedEvidenceElements`,
        canonicalRequirementElements,
      ),
    };
  });

  return { id: manifest.id, version: manifest.version, cases };
}

export function selectCorpusCases({ cases, requestedCaseIds = [], mode }) {
  if (!Array.isArray(cases)) {
    throw new CorpusManifestError("Corpus cases must be loaded before selection.");
  }
  if (mode !== "isolated" && mode !== "combined") {
    throw new CorpusManifestError("Corpus mode must be isolated or combined.");
  }
  if (!Array.isArray(requestedCaseIds)
    || requestedCaseIds.some((caseId) => typeof caseId !== "string" || !caseId.trim())) {
    throw new CorpusManifestError("Requested corpus case IDs must be non-empty strings.");
  }

  const requested = [...new Set(requestedCaseIds.map((caseId) => caseId.trim()))];
  const validIds = cases.map((entry) => entry.id);
  const unknown = requested.filter((caseId) => !validIds.includes(caseId));
  if (unknown.length > 0) {
    throw new CorpusManifestError(
      `Unknown corpus case ID${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Valid case IDs: ${validIds.join(", ")}.`,
    );
  }

  const requestedSet = new Set(requested);
  const requestedCases = cases.filter((entry) => requestedSet.has(entry.id));
  const unavailable = requestedCases
    .filter((entry) => entry.enabled === false || entry.include?.[mode] === false)
    .map((entry) => entry.id);
  if (unavailable.length > 0) {
    throw new CorpusManifestError(
      `Selected corpus case ID${unavailable.length === 1 ? "" : "s"} not enabled for ${mode}: ${unavailable.join(", ")}.`,
    );
  }

  const selectedCases = requested.length > 0
    ? requestedCases
    : cases.filter((entry) => entry.enabled !== false && entry.include?.[mode] !== false);

  return {
    selectedCases,
    selectedCaseIds: selectedCases.map((entry) => entry.id),
    filtered: requested.length > 0,
  };
}

export function corpusChunkClassificationViolations({ chunks, sourceType, requireOrganizationEvidence }) {
  const violations = [];
  if (!Array.isArray(chunks) || chunks.length === 0) violations.push("missing_document_chunks");
  for (const chunk of chunks ?? []) {
    const metadata = chunk?.metadata ?? {};
    if (metadata.source_type !== sourceType) violations.push("source_type_mismatch");
    if (requireOrganizationEvidence && metadata.evidence_role !== "organization_evidence") {
      violations.push("evidence_role_not_organization_evidence");
    }
  }
  return [...new Set(violations)];
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

function assertEvaluationRateLimitAuthorization({
  evaluationAuthorized,
  workspaceName,
  workspacePrefix,
  actorOwnsWorkspace,
  environment,
}) {
  if (evaluationAuthorized !== true
    || actorOwnsWorkspace !== true
    || typeof workspaceName !== "string"
    || typeof workspacePrefix !== "string"
    || !workspaceName.startsWith(workspacePrefix)
    || !/^regspan-eval-[a-z0-9-]*$/.test(workspacePrefix)) {
    throw new CorpusEvaluationSafetyError("Evaluation Analysis quota is not authorized for this workspace.");
  }
  if (environment?.NODE_ENV === "production" && environment.REGSPAN_EVAL_ENABLED !== "true") {
    throw new CorpusEvaluationSafetyError("Corpus evaluation is disabled in production.");
  }
}

export function evaluationAnalysisRateLimitCategory(input) {
  assertEvaluationRateLimitAuthorization(input);
  return "findings_generate_eval";
}

export function evaluationDocumentUploadRateLimitCategory(input) {
  assertEvaluationRateLimitAuthorization(input);
  return "document_upload_eval";
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
  corpusVersion = 1,
  corpusPath = "",
  mode,
  actorUserId,
  workspacePrefix,
  selectedCases,
  filtered = false,
  startedAt,
}) {
  const workspaceKeys = mode === "combined" ? ["combined"] : selectedCases.map((entry) => entry.id);
  return {
    schemaVersion: 1,
    runId,
    corpusId,
    corpusVersion,
    corpusPath,
    mode,
    status: "incomplete",
    executionStatus: "running",
    evaluationStatus: "pending",
    startedAt,
    actorUserId,
    workspacePrefix,
    selectedCaseIds: selectedCases.map((entry) => entry.id),
    selectedCaseCount: selectedCases.length,
    filtered,
    workspaces: Object.fromEntries(workspaceKeys.map((key) => [key, {
      key,
      name: evaluationWorkspaceName({ workspacePrefix, corpusId, mode, runId, workspaceKey: key }),
    }])),
    cases: Object.fromEntries(selectedCases.map((definition) => [definition.id, {
      caseId: definition.id,
      tier: definition.tier,
      filename: definition.filename,
      workspaceKey: mode === "combined" ? "combined" : definition.id,
      expectedStatuses: definition.expectedStatuses ?? {},
    }])),
    failures: [],
    assertionFailures: [],
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

export async function runIsolatedCaseSequence({
  cases,
  runCase,
  onCaseFailure,
  shouldStopOnCaseFailure = () => false,
}) {
  for (const definition of cases) {
    try {
      await runCase(definition);
    } catch (error) {
      await onCaseFailure(definition, error);
      if (shouldStopOnCaseFailure(error, definition)) return;
    }
  }
}

function expectedStatusEntries(entry) {
  return Object.entries(entry.expectedStatuses ?? {}).flatMap(([requirementId, statuses]) =>
    (Array.isArray(statuses) ? statuses : typeof statuses === "string" ? [statuses] : [])
      .map((status) => ({ requirementId, status }))
  );
}

export function summarizeEvaluationState(state) {
  const entries = Object.values(state.cases ?? {});
  const scored = entries.filter((entry) => entry.score);
  const statusResults = scored.flatMap((entry) =>
    (entry.score?.statusResults ?? []).map((result) => ({ caseId: entry.caseId, ...result }))
  );
  const evaluatedExpected = statusResults.length > 0
    ? statusResults.length
    : scored.reduce((total, entry) => total + (entry.score?.expectedStatuses ?? 0), 0);
  const primaryStatusMatched = statusResults.length > 0
    ? statusResults.filter((result) => result.primaryMatched ?? result.actual === result.expected?.[0]).length
    : scored.reduce((total, entry) => total + (entry.score?.primaryMatchedStatuses ?? entry.score?.matchedStatuses ?? 0), 0);
  const acceptedStatusMatched = statusResults.length > 0
    ? statusResults.filter((result) => result.acceptedMatched ?? result.matched ?? (
      result.actual === result.expected?.[0]
      || (result.alternates ?? []).includes(result.actual)
    )).length
    : scored.reduce((total, entry) => total + (entry.score?.acceptedMatchedStatuses ?? entry.score?.matchedStatuses ?? 0), 0);
  const alternateStatusMatches = statusResults.length > 0
    ? statusResults.filter((result) => result.alternateMatched ?? (
      result.actual !== result.expected?.[0]
      && (result.alternates ?? []).includes(result.actual)
    )).length
    : scored.reduce((total, entry) => total + (entry.score?.alternateMatchedStatuses ?? 0), 0);
  const primaryStatusMismatches = evaluatedExpected - primaryStatusMatched;
  const concepts = scored.flatMap((entry) => entry.score?.conceptResults ?? []);
  const elements = scored.flatMap((entry) => entry.score?.elementResults ?? []);
  const forbiddenEvidenceAssertionFailures = scored.flatMap((entry) =>
    (entry.score?.forbiddenResults ?? [])
      .filter((result) => !result.matched)
      .map((result) => ({
        caseId: entry.caseId,
        requirementId: result.requirementId ?? null,
        assertion: "forbidden_evidence",
      }))
  );
  const expectedStatusTotals = {};
  const evaluatedExpectedStatusTotals = {};
  const actualStatusTotals = {};
  for (const entry of entries) {
    for (const { status } of expectedStatusEntries(entry)) {
      expectedStatusTotals[status] = (expectedStatusTotals[status] ?? 0) + 1;
    }
  }
  for (const result of statusResults) {
    for (const expectedStatus of result.expected) {
      evaluatedExpectedStatusTotals[expectedStatus] = (evaluatedExpectedStatusTotals[expectedStatus] ?? 0) + 1;
    }
    if (result.actual) actualStatusTotals[result.actual] = (actualStatusTotals[result.actual] ?? 0) + 1;
  }
  const completedCases = entries.filter((entry) => entry.completed && entry.score).length;
  const operationallyFailedCases = entries.filter((entry) => Boolean(entry.error || entry.diagnosticCode)).length;
  const notStartedCases = Math.max(0, entries.length - completedCases - operationallyFailedCases);
  const totalExpectedStatuses = entries.reduce(
    (total, entry) => total + expectedStatusEntries(entry).length,
    0,
  );
  const executionStatus = state.executionStatus
    ?? (notStartedCases === 0 ? "completed" : "incomplete");
  const evaluationStatus = state.evaluationStatus
    ?? (state.status === "completed"
      ? "passed"
      : (operationallyFailedCases > 0 || forbiddenEvidenceAssertionFailures.length > 0 ? "failed" : "pending"));

  return {
    // Legacy accepted-status aliases retained for existing results consumers.
    expected: evaluatedExpected,
    matched: acceptedStatusMatched,
    score: evaluatedExpected === 0 ? 1 : acceptedStatusMatched / evaluatedExpected,
    evaluatedStatusExpected: evaluatedExpected,
    evaluatedStatusMatched: acceptedStatusMatched,
    selectedStatuses: totalExpectedStatuses,
    evaluatedStatuses: evaluatedExpected,
    primaryStatusMatched,
    primaryStatusExpected: evaluatedExpected,
    primaryStatusScore: evaluatedExpected === 0 ? 1 : primaryStatusMatched / evaluatedExpected,
    acceptedStatusMatched,
    acceptedStatusExpected: evaluatedExpected,
    acceptedStatusScore: evaluatedExpected === 0 ? 1 : acceptedStatusMatched / evaluatedExpected,
    alternateStatusMatches,
    primaryStatusMismatches,
    totalExpectedStatuses,
    completedCases,
    failedCases: operationallyFailedCases,
    operationallyFailedCases,
    notStartedCases,
    allSelectedCasesCompleted: completedCases === entries.length && operationallyFailedCases === 0,
    executionStatus,
    evaluationStatus,
    conceptsExpected: concepts.length,
    conceptsMatched: concepts.filter((entry) => entry.matched).length,
    elementsExpected: elements.length,
    elementsMatched: elements.filter((entry) => entry.matched).length,
    forbiddenEvidenceAssertionFailures,
    forbiddenEvidenceAssertionFailureCount: forbiddenEvidenceAssertionFailures.length,
    unexpectedCovered: scored.flatMap((entry) => entry.score?.unexpectedCovered ?? []).length,
    expectedStatusTotals,
    evaluatedExpectedStatusTotals,
    actualStatusTotals,
  };
}

export function formatEvaluationStatusAccuracy(summary) {
  return `Primary status accuracy: ${(summary.primaryStatusScore * 100).toFixed(1)}% (${summary.primaryStatusMatched}/${summary.primaryStatusExpected})`;
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

export async function retryRateLimitedOperation({
  operation,
  beforeRetry = async () => null,
  isRateLimitError,
  waitOnRateLimit = true,
  maxRateLimitWaitMs,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onWait = async () => {},
}) {
  let rateLimitWaitCount = 0;
  let rateLimitWaitMs = 0;

  while (true) {
    try {
      const value = await operation();
      return { value, rateLimitWaitCount, rateLimitWaitMs };
    } catch (error) {
      if (!isRateLimitError(error) || !waitOnRateLimit) throw error;
      const waitMs = Math.max(1_000, Math.ceil(Number(error.retryAfterSeconds) * 1_000) || 1_000);
      if (rateLimitWaitMs + waitMs > maxRateLimitWaitMs) {
        throw new CorpusEvaluationRateLimitWaitExceededError(
          "Analysis rate-limit wait exceeded the configured maximum.",
        );
      }
      rateLimitWaitCount += 1;
      rateLimitWaitMs += waitMs;
      await onWait({ rateLimitWaitCount, rateLimitWaitMs, waitMs });
      await sleep(waitMs);
      const recovered = await beforeRetry();
      if (recovered) return { value: recovered, rateLimitWaitCount, rateLimitWaitMs };
    }
  }
}

const POSITIVE_EVIDENCE_RELATIONSHIPS = new Set([
  "supports",
  "partially_supports",
]);

function positiveEvidenceForFinding(finding, evidenceRows) {
  return evidenceRows
    .filter((row) => row.finding_id === finding.id)
    .filter((row) => POSITIVE_EVIDENCE_RELATIONSHIPS.has(String(row.relationship ?? "").trim()));
}

function positiveEvidenceTextForFinding(finding, evidenceRows) {
  return positiveEvidenceForFinding(finding, evidenceRows)
    .map((row) => String(row.quote ?? row.evidence_quote ?? row.source_quote ?? ""))
    .join("\n")
    .toLowerCase();
}

export function scoreCaseFindings({
  caseDefinition,
  findings,
  evidenceRows,
  resolveFinalQuoteElementIds = () => [],
}) {
  const findingsByRequirement = new Map(findings.map((finding) => [finding.requirement_id, finding]));
  const statusResults = [];
  const conceptResults = [];
  const elementResults = [];
  const forbiddenResults = [];

  for (const [requirementId, statuses] of Object.entries(caseDefinition.expectedStatuses)) {
    const finding = findingsByRequirement.get(requirementId);
    const actualStatus = normalizedStatus(finding?.status);
    const alternates = caseDefinition.acceptableAlternateStatuses[requirementId] ?? [];
    const primaryExpected = statuses[0] ?? null;
    const primaryMatched = actualStatus === primaryExpected;
    const alternateMatched = !primaryMatched && alternates.includes(actualStatus);
    statusResults.push({
      requirementId,
      expected: statuses,
      primaryExpected,
      alternates,
      actual: actualStatus || null,
      primaryMatched,
      alternateMatched,
      acceptedMatched: primaryMatched || alternateMatched,
      matched: primaryMatched || alternateMatched,
    });
  }

  for (const [requirementId, concepts] of Object.entries(caseDefinition.expectedEvidenceConcepts)) {
    const finding = findingsByRequirement.get(requirementId);
    const text = finding ? positiveEvidenceTextForFinding(finding, evidenceRows) : "";
    const missingConcepts = concepts.filter((concept) => !text.includes(concept.toLowerCase()));
    conceptResults.push({ requirementId, concepts, missingConcepts, matched: missingConcepts.length === 0 });
  }

  for (const [requirementId, elements] of Object.entries(caseDefinition.expectedEvidenceElements ?? {})) {
    const finding = findingsByRequirement.get(requirementId);
    const matchedElements = new Set();
    if (finding) {
      for (const evidence of positiveEvidenceForFinding(finding, evidenceRows)) {
        const quote = String(evidence.quote ?? evidence.evidence_quote ?? evidence.source_quote ?? "").trim();
        if (!quote) continue;
        for (const elementId of resolveFinalQuoteElementIds({ requirementId, finding, evidence, quote }) ?? []) {
          if (elements.includes(elementId)) matchedElements.add(elementId);
        }
      }
    }
    const missingElements = elements.filter((elementId) => !matchedElements.has(elementId));
    elementResults.push({
      requirementId,
      elements,
      matchedElements: [...matchedElements],
      missingElements,
      matched: missingElements.length === 0,
    });
  }

  for (const [requirementId, phrases] of Object.entries(caseDefinition.forbiddenMatches)) {
    const finding = findingsByRequirement.get(requirementId);
    const text = finding ? positiveEvidenceTextForFinding(finding, evidenceRows) : "";
    const matchedPhrases = phrases.filter((phrase) => text.includes(phrase.toLowerCase()));
    forbiddenResults.push({ requirementId, phrases, matchedPhrases, matched: matchedPhrases.length === 0 });
  }

  const unexpectedCovered = findings
    .filter((finding) => ["covered", "partial"].includes(normalizedStatus(finding.status)))
    .filter((finding) => {
      const expected = caseDefinition.expectedStatuses[finding.requirement_id] ?? [];
      const alternates = caseDefinition.acceptableAlternateStatuses[finding.requirement_id] ?? [];
      return expected.length > 0 && ![...expected, ...alternates].includes(normalizedStatus(finding.status));
    })
    .map((finding) => finding.requirement_id);

  return {
    statusResults,
    conceptResults,
    elementResults,
    forbiddenResults,
    unexpectedCovered,
    primaryMatchedStatuses: statusResults.filter((result) => result.primaryMatched).length,
    acceptedMatchedStatuses: statusResults.filter((result) => result.acceptedMatched).length,
    alternateMatchedStatuses: statusResults.filter((result) => result.alternateMatched).length,
    primaryMismatches: statusResults.filter((result) => !result.primaryMatched).length,
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

  const hasAcceptedProvenance = (evidence) => {
    const sourceType = String(evidence.source_type ?? "").trim().toLowerCase();
    return evidence.source_resolution === "client_document_chunk"
      && evidence.chunk_document_id === evidence.document_id
      && evidence.chunk_workspace_id === workspaceId
      && Boolean(evidence.document_id && snapshotIds.has(evidence.document_id))
      && (!sourceType || CLIENT_EVIDENCE_SOURCE_TYPES.has(sourceType));
  };

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
    if (evidence.source_resolution !== "client_document_chunk") {
      violations.push("evidence_source_not_client_document_chunk");
    }
    if (evidence.chunk_document_id !== evidence.document_id) {
      violations.push("evidence_chunk_document_mismatch");
    }
    if (evidence.chunk_workspace_id !== workspaceId) {
      violations.push("evidence_chunk_workspace_mismatch");
    }
    const sourceType = String(evidence.source_type ?? "").trim().toLowerCase();
    if (sourceType && !CLIENT_EVIDENCE_SOURCE_TYPES.has(sourceType)) {
      violations.push("regulatory_or_non_client_evidence");
    }
  }

  for (const finding of findings) {
    if (!["covered", "partial"].includes(normalizedStatus(finding.status))) continue;
    const primary = (evidenceByFinding.get(finding.id) ?? []).filter((evidence) =>
      ["supports", "partially_supports", "negative_evidence"].includes(evidence.relationship)
      && hasAcceptedProvenance(evidence)
      && String(evidence.quote ?? evidence.evidence_quote ?? evidence.source_quote ?? "").trim(),
    );
    if (primary.length === 0) violations.push(`missing_primary_evidence:${finding.requirement_id}`);
  }

  return [...new Set(violations)];
}
