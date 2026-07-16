import { createHash } from "node:crypto";

export const HOLDOUT_STATUSES = ["covered", "partial", "missing", "conflicting", "needs_review"];
export const EVIDENCE_REVIEW_LABELS = [
  "supported",
  "unsupported",
  "partially_supported",
  "wrong_source",
  "negated",
  "topic_only",
  "unrelated_span_combination",
];

const STATUS_SET = new Set(HOLDOUT_STATUSES);
const REVIEW_LABEL_SET = new Set(EVIDENCE_REVIEW_LABELS);
const SOURCE_TYPE_SET = new Set(["client_policy", "client_procedure", "client_standard"]);
const LABEL_FIELD_NAMES = new Set([
  "expectedStatuses",
  "acceptableAlternateStatuses",
  "expectedEvidenceConcepts",
  "expectedEvidenceElements",
  "forbiddenMatches",
  "primaryExpectedStatus",
  "supportedElements",
  "missingElements",
  "validEvidenceSpans",
  "rationale",
  "reviewerLabels",
  "adjudicatedLabel",
  "ambiguityNotes",
]);
const POSITIVE_RELATIONSHIPS = new Set(["supports", "partially_supports"]);

export class BlindHoldoutSchemaError extends Error {}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BlindHoldoutSchemaError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function slug(value, label) {
  const normalized = nonEmptyString(value, label);
  if (!/^[a-z0-9][a-z0-9-]{1,127}$/.test(normalized)) {
    throw new BlindHoldoutSchemaError(`${label} must be a lowercase slug.`);
  }
  return normalized;
}

function identifier(value, label) {
  const normalized = nonEmptyString(value, label);
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(normalized)) {
    throw new BlindHoldoutSchemaError(`${label} must be a lowercase identifier.`);
  }
  return normalized;
}

function stringList(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new BlindHoldoutSchemaError(`${label} must be ${allowEmpty ? "an array" : "a non-empty array"}.`);
  }
  const normalized = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new BlindHoldoutSchemaError(`${label} must not contain duplicates.`);
  }
  return normalized;
}

function status(value, label) {
  const normalized = nonEmptyString(value, label).toLowerCase().replace(/\s+/g, "_");
  if (!STATUS_SET.has(normalized)) {
    throw new BlindHoldoutSchemaError(`${label} must be a supported finding status.`);
  }
  return normalized;
}

function safePdfPath(value, label) {
  const normalized = nonEmptyString(value, label);
  if (!normalized.toLowerCase().endsWith(".pdf")
    || normalized.startsWith("/")
    || normalized.startsWith("\\")
    || normalized.split(/[\\/]/).some((segment) => !segment || segment === "." || segment === "..")) {
    throw new BlindHoldoutSchemaError(`${label} must be a safe relative PDF path.`);
  }
  return normalized;
}

function assertNoAnswerKeyFields(value, label) {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (LABEL_FIELD_NAMES.has(key)) {
      throw new BlindHoldoutSchemaError(`${label} must not include answer-key field ${key}.`);
    }
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function plainObjectEntries(value, label) {
  if (!isRecord(value)) throw new BlindHoldoutSchemaError(`${label} must be an object.`);
  return Object.entries(value);
}

export function validateBlindCorpusManifest(value) {
  if (!isRecord(value)) throw new BlindHoldoutSchemaError("Blind corpus manifest must be an object.");
  assertNoAnswerKeyFields(value, "Blind corpus manifest");
  if (value.blindExecution !== true) {
    throw new BlindHoldoutSchemaError("Blind corpus manifest must declare blindExecution: true.");
  }
  const version = Number(value.version);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new BlindHoldoutSchemaError("Blind corpus manifest version must be a positive integer.");
  }
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 100) {
    throw new BlindHoldoutSchemaError("Blind corpus manifest must contain 1 through 100 cases.");
  }
  const caseIds = new Set();
  const cases = value.cases.map((entry, index) => {
    if (!isRecord(entry)) throw new BlindHoldoutSchemaError(`Blind case ${index + 1} must be an object.`);
    assertNoAnswerKeyFields(entry, `Blind case ${index + 1}`);
    const id = slug(entry.id, `Blind case ${index + 1}.id`);
    if (caseIds.has(id)) throw new BlindHoldoutSchemaError(`Duplicate blind case ID: ${id}.`);
    caseIds.add(id);
    const filename = nonEmptyString(entry.filename, `Blind case ${id}.filename`);
    if (filename !== filename.split(/[\\/]/).pop() || !filename.toLowerCase().endsWith(".pdf")) {
      throw new BlindHoldoutSchemaError(`Blind case ${id}.filename must be a local PDF filename.`);
    }
    const sourceType = nonEmptyString(entry.sourceType, `Blind case ${id}.sourceType`);
    if (!SOURCE_TYPE_SET.has(sourceType)) {
      throw new BlindHoldoutSchemaError(`Blind case ${id}.sourceType is invalid.`);
    }
    const include = isRecord(entry.include) ? entry.include : { isolated: true, combined: false };
    return {
      id,
      filename,
      tier: typeof entry.tier === "string" && entry.tier.trim() ? entry.tier.trim() : "holdout",
      sourceType,
      enabled: entry.enabled !== false,
      include: { isolated: include.isolated !== false, combined: include.combined === true },
      ...(entry.documentPath === undefined ? {} : {
        documentPath: safePdfPath(entry.documentPath, `Blind case ${id}.documentPath`),
      }),
      ...(typeof entry.documentType === "string" && entry.documentType.trim()
        ? { documentType: entry.documentType.trim() }
        : {}),
      ...(typeof entry.notes === "string" && entry.notes.trim() ? { notes: entry.notes.trim() } : {}),
    };
  });
  return { id: slug(value.id, "Blind corpus manifest id"), version, cases };
}

export function quoteDigest(quote) {
  return createHash("sha256").update(String(quote ?? "").trim()).digest("hex");
}

function normalizedEngineOutput(value, caseId) {
  if (!isRecord(value)) throw new BlindHoldoutSchemaError(`Blind case ${caseId} must include engineOutput.`);
  assertNoAnswerKeyFields(value, `Blind case ${caseId}.engineOutput`);
  if (!Array.isArray(value.findings) || !Array.isArray(value.evidence)) {
    throw new BlindHoldoutSchemaError(`Blind case ${caseId}.engineOutput must include findings and evidence arrays.`);
  }
  const findingIds = new Set();
  const findingRequirements = new Set();
  const findings = value.findings.map((finding, index) => {
    if (!isRecord(finding)) throw new BlindHoldoutSchemaError(`Blind finding ${caseId}[${index}] must be an object.`);
    const findingId = nonEmptyString(finding.findingId, `Blind finding ${caseId}[${index}].findingId`);
    const requirementId = identifier(finding.requirementId, `Blind finding ${caseId}[${index}].requirementId`);
    if (findingIds.has(findingId) || findingRequirements.has(requirementId)) {
      throw new BlindHoldoutSchemaError(`Blind case ${caseId} must contain one finding per requirement.`);
    }
    findingIds.add(findingId);
    findingRequirements.add(requirementId);
    return { findingId, requirementId, status: status(finding.status, `Blind finding ${caseId}[${index}].status`) };
  }).sort((left, right) => left.requirementId.localeCompare(right.requirementId));
  const evidenceIds = new Set();
  const evidence = value.evidence.map((row, index) => {
    if (!isRecord(row)) throw new BlindHoldoutSchemaError(`Blind evidence ${caseId}[${index}] must be an object.`);
    const evidenceId = nonEmptyString(row.evidenceId, `Blind evidence ${caseId}[${index}].evidenceId`);
    const findingId = nonEmptyString(row.findingId, `Blind evidence ${caseId}[${index}].findingId`);
    if (evidenceIds.has(evidenceId) || !findingIds.has(findingId)) {
      throw new BlindHoldoutSchemaError(`Blind evidence ${caseId}[${index}] must have a unique known finding ID.`);
    }
    evidenceIds.add(evidenceId);
    const quoteHash = nonEmptyString(row.quoteHash, `Blind evidence ${caseId}[${index}].quoteHash`).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(quoteHash)) {
      throw new BlindHoldoutSchemaError(`Blind evidence ${caseId}[${index}].quoteHash must be a SHA-256 digest.`);
    }
    const relationship = nonEmptyString(row.relationship, `Blind evidence ${caseId}[${index}].relationship`);
    const finalElementIds = stringList(row.finalElementIds ?? [], `Blind evidence ${caseId}[${index}].finalElementIds`);
    return {
      evidenceId,
      findingId,
      documentId: nonEmptyString(row.documentId, `Blind evidence ${caseId}[${index}].documentId`),
      chunkId: nonEmptyString(row.chunkId, `Blind evidence ${caseId}[${index}].chunkId`),
      relationship,
      quoteHash,
      quoteLength: Number.isSafeInteger(row.quoteLength) && row.quoteLength >= 0 ? row.quoteLength : 0,
      finalElementIds,
    };
  }).sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return { findings, evidence };
}

function serializedEngineOutput(value) {
  return {
    findings: (value?.findings ?? []).map((finding) => ({
      findingId: finding.findingId,
      requirementId: finding.requirementId,
      status: finding.status,
    })).sort((left, right) => String(left.requirementId).localeCompare(String(right.requirementId))),
    evidence: (value?.evidence ?? []).map((evidence) => ({
      evidenceId: evidence.evidenceId,
      findingId: evidence.findingId,
      documentId: evidence.documentId,
      chunkId: evidence.chunkId,
      relationship: evidence.relationship,
      quoteHash: evidence.quoteHash,
      quoteLength: evidence.quoteLength,
      finalElementIds: Array.isArray(evidence.finalElementIds) ? [...evidence.finalElementIds] : [],
    })).sort((left, right) => String(left.evidenceId).localeCompare(String(right.evidenceId))),
  };
}

export function toBlindExecutionArtifact(state) {
  const cases = Object.fromEntries(Object.entries(state.cases ?? {}).map(([caseId, entry]) => [caseId, {
    caseId: entry.caseId,
    tier: entry.tier,
    filename: entry.filename,
    workspaceId: state.workspaces?.[entry.workspaceKey]?.id,
    documentId: entry.documentId,
    processingJobId: entry.processingJobId,
    analysisRunId: entry.analysisRunId,
    processingStatus: entry.processingStatus,
    analysisStatus: entry.analysisStatus,
    classifierProgress: entry.classifierProgress ? {
      caseId: entry.classifierProgress.caseId ?? null,
      requirementId: entry.classifierProgress.requirementId ?? null,
      phase: entry.classifierProgress.phase,
      queueDepth: entry.classifierProgress.queueDepth,
      inFlight: entry.classifierProgress.inFlight,
      cooldownReason: entry.classifierProgress.cooldownReason,
      expectedResumeAt: entry.classifierProgress.expectedResumeAt,
      timestamp: entry.classifierProgress.timestamp,
    } : undefined,
    completed: entry.completed === true,
    diagnosticCode: entry.diagnosticCode,
    engineOutput: serializedEngineOutput(entry.engineOutput),
  }]));
  return {
    artifactKind: "regspan_blind_holdout_execution",
    schemaVersion: 1,
    blindExecution: true,
    runId: state.runId,
    corpusId: state.corpusId,
    corpusVersion: state.corpusVersion,
    mode: state.mode,
    selectedCaseIds: state.selectedCaseIds,
    selectedCaseCount: state.selectedCaseCount,
    filtered: state.filtered === true,
    executionStatus: state.executionStatus,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    cases,
  };
}

export function validateBlindExecutionArtifact(value) {
  if (!isRecord(value)) throw new BlindHoldoutSchemaError("Blind execution artifact must be an object.");
  assertNoAnswerKeyFields(value, "Blind execution artifact");
  if (value.artifactKind !== "regspan_blind_holdout_execution" || value.blindExecution !== true || value.schemaVersion !== 1) {
    throw new BlindHoldoutSchemaError("Artifact is not a supported blind holdout execution result.");
  }
  const selectedCaseIds = stringList(value.selectedCaseIds, "Blind execution artifact selectedCaseIds", { allowEmpty: false });
  if (Number(value.selectedCaseCount) !== selectedCaseIds.length) {
    throw new BlindHoldoutSchemaError("Blind execution artifact selectedCaseCount does not match selectedCaseIds.");
  }
  const cases = Object.fromEntries(plainObjectEntries(value.cases, "Blind execution artifact cases").map(([key, entry]) => {
    if (!isRecord(entry)) throw new BlindHoldoutSchemaError(`Blind execution case ${key} must be an object.`);
    assertNoAnswerKeyFields(entry, `Blind execution case ${key}`);
    const caseId = slug(entry.caseId, `Blind execution case ${key}.caseId`);
    if (caseId !== key || !selectedCaseIds.includes(caseId)) {
      throw new BlindHoldoutSchemaError(`Blind execution case ${key} is not in selectedCaseIds.`);
    }
    if (entry.completed !== true) {
      throw new BlindHoldoutSchemaError(`Blind execution case ${key} did not complete.`);
    }
    return [caseId, {
      caseId,
      tier: typeof entry.tier === "string" ? entry.tier : "holdout",
      filename: nonEmptyString(entry.filename, `Blind execution case ${caseId}.filename`),
      workspaceId: typeof entry.workspaceId === "string" ? entry.workspaceId : null,
      documentId: typeof entry.documentId === "string" ? entry.documentId : null,
      analysisRunId: typeof entry.analysisRunId === "string" ? entry.analysisRunId : null,
      completed: entry.completed === true,
      diagnosticCode: typeof entry.diagnosticCode === "string" ? entry.diagnosticCode : null,
      engineOutput: normalizedEngineOutput(entry.engineOutput, caseId),
    }];
  }));
  if (Object.keys(cases).length !== selectedCaseIds.length) {
    throw new BlindHoldoutSchemaError("Blind execution artifact is missing a selected case.");
  }
  return {
    artifactKind: value.artifactKind,
    schemaVersion: value.schemaVersion,
    runId: nonEmptyString(value.runId, "Blind execution artifact runId"),
    corpusId: slug(value.corpusId, "Blind execution artifact corpusId"),
    corpusVersion: Number(value.corpusVersion),
    mode: nonEmptyString(value.mode, "Blind execution artifact mode"),
    selectedCaseIds: selectedCaseIds.sort((left, right) => left.localeCompare(right)),
    executionStatus: nonEmptyString(value.executionStatus, "Blind execution artifact executionStatus"),
    cases,
  };
}

function normalizedEvidenceSpan(value, label) {
  if (!isRecord(value)) throw new BlindHoldoutSchemaError(`${label} must be an object.`);
  return {
    spanId: nonEmptyString(value.spanId, `${label}.spanId`),
    ...(typeof value.documentRef === "string" && value.documentRef.trim() ? { documentRef: value.documentRef.trim() } : {}),
    ...(typeof value.location === "string" && value.location.trim() ? { location: value.location.trim() } : {}),
  };
}

export function validateBlindAnswerKey(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new BlindHoldoutSchemaError("Blind answer key must declare schemaVersion: 1.");
  }
  if (!Array.isArray(value.expectations) || value.expectations.length === 0) {
    throw new BlindHoldoutSchemaError("Blind answer key must include non-empty expectations.");
  }
  const pairs = new Set();
  const expectations = value.expectations.map((entry, index) => {
    if (!isRecord(entry)) throw new BlindHoldoutSchemaError(`Answer-key expectation ${index + 1} must be an object.`);
    const caseId = slug(entry.caseId, `Answer-key expectation ${index + 1}.caseId`);
    const requirementId = identifier(entry.requirementId, `Answer-key expectation ${index + 1}.requirementId`);
    const pair = `${caseId}\u0000${requirementId}`;
    if (pairs.has(pair)) throw new BlindHoldoutSchemaError(`Answer key repeats ${caseId}/${requirementId}.`);
    pairs.add(pair);
    const supportedElements = stringList(entry.supportedElements ?? [], `Answer-key ${caseId}/${requirementId}.supportedElements`);
    const missingElements = stringList(entry.missingElements ?? [], `Answer-key ${caseId}/${requirementId}.missingElements`);
    if (supportedElements.some((elementId) => missingElements.includes(elementId))) {
      throw new BlindHoldoutSchemaError(`Answer-key ${caseId}/${requirementId} cannot support and miss the same element.`);
    }
    const spans = (entry.validEvidenceSpans ?? []).map((span, spanIndex) =>
      normalizedEvidenceSpan(span, `Answer-key ${caseId}/${requirementId}.validEvidenceSpans[${spanIndex}]`));
    if (new Set(spans.map((span) => span.spanId)).size !== spans.length) {
      throw new BlindHoldoutSchemaError(`Answer-key ${caseId}/${requirementId} repeats a valid evidence span.`);
    }
    const primaryExpectedStatus = status(entry.primaryExpectedStatus, `Answer-key ${caseId}/${requirementId}.primaryExpectedStatus`);
    if (primaryExpectedStatus !== "missing" && spans.length === 0) {
      throw new BlindHoldoutSchemaError(`Answer-key ${caseId}/${requirementId} needs a valid evidence span unless expected missing.`);
    }
    const reviewerLabels = (entry.reviewerLabels ?? []).map((label, labelIndex) => {
      if (!isRecord(label)) throw new BlindHoldoutSchemaError(`Answer-key ${caseId}/${requirementId}.reviewerLabels[${labelIndex}] must be an object.`);
      const reviewerId = nonEmptyString(label.reviewerId, `Answer-key ${caseId}/${requirementId}.reviewerLabels[${labelIndex}].reviewerId`);
      const reviewerLabel = nonEmptyString(label.label, `Answer-key ${caseId}/${requirementId}.reviewerLabels[${labelIndex}].label`).toLowerCase();
      if (!STATUS_SET.has(reviewerLabel) && reviewerLabel !== "ambiguous") {
        throw new BlindHoldoutSchemaError(`Answer-key ${caseId}/${requirementId}.reviewerLabels[${labelIndex}].label is invalid.`);
      }
      return { reviewerId, label: reviewerLabel };
    });
    const adjudicatedLabel = entry.adjudicatedLabel === undefined || entry.adjudicatedLabel === null
      ? null
      : nonEmptyString(entry.adjudicatedLabel, `Answer-key ${caseId}/${requirementId}.adjudicatedLabel`).toLowerCase();
    if (adjudicatedLabel && !STATUS_SET.has(adjudicatedLabel) && adjudicatedLabel !== "ambiguous") {
      throw new BlindHoldoutSchemaError(`Answer-key ${caseId}/${requirementId}.adjudicatedLabel is invalid.`);
    }
    return {
      caseId,
      requirementId,
      primaryExpectedStatus,
      supportedElements,
      missingElements,
      validEvidenceSpans: spans,
      rationale: typeof entry.rationale === "string" ? entry.rationale.trim() : "",
      reviewerLabels,
      adjudicatedLabel,
      ambiguityNotes: typeof entry.ambiguityNotes === "string" ? entry.ambiguityNotes.trim() : "",
    };
  }).sort((left, right) => `${left.caseId}\u0000${left.requirementId}`.localeCompare(`${right.caseId}\u0000${right.requirementId}`));
  return {
    schemaVersion: 1,
    corpusId: slug(value.corpusId, "Blind answer key corpusId"),
    corpusVersion: Number.isSafeInteger(value.corpusVersion) ? value.corpusVersion : null,
    expectations,
  };
}

export function validateEvidenceReviews(value) {
  if (value === undefined || value === null) return { schemaVersion: 1, corpusId: null, reviews: [] };
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.reviews)) {
    throw new BlindHoldoutSchemaError("Evidence review metadata must declare schemaVersion: 1 and a reviews array.");
  }
  const seen = new Set();
  const reviews = value.reviews.map((entry, index) => {
    if (!isRecord(entry)) throw new BlindHoldoutSchemaError(`Evidence review ${index + 1} must be an object.`);
    const runId = nonEmptyString(entry.runId, `Evidence review ${index + 1}.runId`);
    const caseId = slug(entry.caseId, `Evidence review ${index + 1}.caseId`);
    const requirementId = identifier(entry.requirementId, `Evidence review ${index + 1}.requirementId`);
    const evidenceId = nonEmptyString(entry.evidenceId, `Evidence review ${index + 1}.evidenceId`);
    const label = nonEmptyString(entry.label, `Evidence review ${index + 1}.label`).toLowerCase();
    if (!REVIEW_LABEL_SET.has(label)) {
      throw new BlindHoldoutSchemaError(`Evidence review ${index + 1}.label is invalid.`);
    }
    const key = `${runId}\u0000${caseId}\u0000${requirementId}\u0000${evidenceId}`;
    if (seen.has(key)) throw new BlindHoldoutSchemaError("Evidence reviews must not duplicate an engine evidence row.");
    seen.add(key);
    return { runId, caseId, requirementId, evidenceId, label, notes: typeof entry.notes === "string" ? entry.notes.trim() : "" };
  });
  return {
    schemaVersion: 1,
    corpusId: typeof value.corpusId === "string" ? slug(value.corpusId, "Evidence review corpusId") : null,
    reviews,
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function metricCounts(records, label) {
  const truePositive = records.filter((record) => record.expected === label && record.actual === label).length;
  const falsePositive = records.filter((record) => record.expected !== label && record.actual === label).length;
  const falseNegative = records.filter((record) => record.expected === label && record.actual !== label).length;
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  return { label, truePositive, falsePositive, falseNegative, support: truePositive + falseNegative, precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
}

export function statusMetrics(records) {
  const classes = sortedUnique(records.flatMap((record) => [record.expected, record.actual]));
  const classMetrics = classes.map((label) => metricCounts(records, label));
  const confusion = Object.fromEntries(classes.map((expected) => [expected, Object.fromEntries(classes.map((actual) => [actual, 0]))]));
  for (const record of records) confusion[record.expected][record.actual] += 1;
  const matched = records.filter((record) => record.expected === record.actual).length;
  const falseAssurancePopulation = records.filter((record) => ["partial", "missing"].includes(record.expected));
  const falseAssuranceCount = falseAssurancePopulation.filter((record) => record.actual === "covered").length;
  return {
    total: records.length,
    matched,
    accuracy: ratio(matched, records.length),
    classes,
    confusion,
    classMetrics,
    macroPrecision: ratio(classMetrics.reduce((total, entry) => total + entry.precision, 0), classMetrics.length),
    macroRecall: ratio(classMetrics.reduce((total, entry) => total + entry.recall, 0), classMetrics.length),
    macroF1: ratio(classMetrics.reduce((total, entry) => total + entry.f1, 0), classMetrics.length),
    falseAssuranceCount,
    falseAssuranceDenominator: falseAssurancePopulation.length,
    falseAssuranceRate: ratio(falseAssuranceCount, falseAssurancePopulation.length),
  };
}

function aggregateElementMetrics(records) {
  const truePositive = records.filter((record) => record.actual && record.expected).length;
  const falsePositive = records.filter((record) => record.actual && !record.expected).length;
  const falseNegative = records.filter((record) => !record.actual && record.expected).length;
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  return { truePositive, falsePositive, falseNegative, precision, recall, f1: ratio(2 * precision * recall, precision + recall) };
}

function elementMetricsForStatusRecords(records) {
  const elementRecords = [];
  for (const record of records) {
    const universe = new Set([...record.supportedElements, ...record.missingElements, ...record.actualElements]);
    for (const elementId of universe) {
      elementRecords.push({
        caseId: record.caseId,
        requirementId: record.requirementId,
        elementId,
        expected: record.supportedElements.includes(elementId),
        actual: record.actualElements.includes(elementId),
      });
    }
  }
  const byRequirement = Object.fromEntries(sortedUnique(elementRecords.map((record) => record.requirementId)).map((requirementId) => [
    requirementId,
    aggregateElementMetrics(elementRecords.filter((record) => record.requirementId === requirementId)),
  ]));
  return { overall: aggregateElementMetrics(elementRecords), byRequirement, records: elementRecords };
}

function groupDocumentMetrics(records) {
  return sortedUnique(records.map((record) => record.caseId)).map((caseId) => {
    const documentRecords = records.filter((record) => record.caseId === caseId);
    const matched = documentRecords.filter((record) => record.expected === record.actual).length;
    return {
      caseId,
      total: documentRecords.length,
      matched,
      accuracy: ratio(matched, documentRecords.length),
      exactMatch: matched === documentRecords.length,
    };
  });
}

function requirementMetrics(records) {
  return Object.fromEntries(sortedUnique(records.map((record) => record.requirementId)).map((requirementId) => [
    requirementId,
    statusMetrics(records.filter((record) => record.requirementId === requirementId)),
  ]));
}

function reviewMetrics(records, reviews) {
  const reviewByEvidence = new Map(reviews.map((review) => [
    `${review.runId}\u0000${review.caseId}\u0000${review.requirementId}\u0000${review.evidenceId}`,
    review,
  ]));
  for (const review of reviews) {
    const found = records.some((record) =>
      record.runId === review.runId
      && record.caseId === review.caseId
      && record.requirementId === review.requirementId
      && record.evidence.some((evidence) => evidence.evidenceId === review.evidenceId));
    if (!found) throw new BlindHoldoutSchemaError("Evidence review references an unknown engine evidence row.");
  }
  const positiveEvidence = records.flatMap((record) => record.evidence
    .filter((evidence) => POSITIVE_RELATIONSHIPS.has(evidence.relationship))
    .map((evidence) => ({ ...evidence, runId: record.runId, caseId: record.caseId, requirementId: record.requirementId })));
  const reviewed = positiveEvidence.map((evidence) => ({
    ...evidence,
    review: reviewByEvidence.get(`${evidence.runId}\u0000${evidence.caseId}\u0000${evidence.requirementId}\u0000${evidence.evidenceId}`) ?? null,
  })).filter((evidence) => evidence.review);
  const unsupported = reviewed.filter((evidence) => evidence.review.label !== "supported");
  return {
    positiveEvidenceCount: positiveEvidence.length,
    reviewedPositiveEvidenceCount: reviewed.length,
    unreviewedPositiveEvidenceCount: positiveEvidence.length - reviewed.length,
    labels: Object.fromEntries(EVIDENCE_REVIEW_LABELS.map((label) => [label, reviewed.filter((entry) => entry.review.label === label).length])),
    unsupportedGroundedClaimCount: unsupported.length,
    unsupportedGroundedClaimRate: ratio(unsupported.length, reviewed.length),
  };
}

function pairwiseAgreement(values, equality = (left, right) => left === right) {
  if (values.length < 2) return { agreements: 0, comparisons: 0, score: null };
  let agreements = 0;
  let comparisons = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      comparisons += 1;
      if (equality(values[left], values[right])) agreements += 1;
    }
  }
  return { agreements, comparisons, score: ratio(agreements, comparisons) };
}

function jaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 1;
  return ratio([...leftSet].filter((item) => rightSet.has(item)).length, union.size);
}

export function repeatabilityMetrics(records, runIds) {
  if (runIds.length < 3) return { available: false, minimumRuns: 3, runCount: runIds.length, perCase: [], perRequirement: [] };
  const dimensions = new Map();
  for (const record of records) {
    const key = `${record.caseId}\u0000${record.requirementId}`;
    const entries = dimensions.get(key) ?? [];
    entries.push(record);
    dimensions.set(key, entries);
  }
  const measures = [];
  for (const [key, entries] of dimensions) {
    if (entries.length !== runIds.length) throw new BlindHoldoutSchemaError(`Repeatability data is incomplete for ${key.replace("\u0000", "/")}.`);
    const statusAgreement = pairwiseAgreement(entries.map((entry) => entry.actual));
    const elementPairs = pairwiseAgreement(entries, (left, right) => jaccard(left.actualElements, right.actualElements) === 1);
    const evidencePairs = pairwiseAgreement(entries, (left, right) => jaccard(
      left.evidence.filter((evidence) => POSITIVE_RELATIONSHIPS.has(evidence.relationship)).map((evidence) => evidence.quoteHash),
      right.evidence.filter((evidence) => POSITIVE_RELATIONSHIPS.has(evidence.relationship)).map((evidence) => evidence.quoteHash),
    ) === 1);
    const [caseId, requirementId] = key.split("\u0000");
    measures.push({
      caseId,
      requirementId,
      statusAgreement: statusAgreement.score,
      elementLedgerAgreement: elementPairs.score,
      evidenceSelectionAgreement: evidencePairs.score,
      instability: 1 - statusAgreement.score,
    });
  }
  const summarize = (entries, idField, id) => ({
    [idField]: id,
    statusAgreement: ratio(entries.reduce((total, entry) => total + entry.statusAgreement, 0), entries.length),
    elementLedgerAgreement: ratio(entries.reduce((total, entry) => total + entry.elementLedgerAgreement, 0), entries.length),
    evidenceSelectionAgreement: ratio(entries.reduce((total, entry) => total + entry.evidenceSelectionAgreement, 0), entries.length),
    instability: ratio(entries.reduce((total, entry) => total + entry.instability, 0), entries.length),
  });
  const perCase = sortedUnique(measures.map((entry) => entry.caseId)).map((caseId) => summarize(measures.filter((entry) => entry.caseId === caseId), "caseId", caseId));
  const perRequirement = sortedUnique(measures.map((entry) => entry.requirementId)).map((requirementId) => summarize(measures.filter((entry) => entry.requirementId === requirementId), "requirementId", requirementId));
  return {
    available: true,
    runCount: runIds.length,
    overall: summarize(measures, "scope", "overall"),
    perCase,
    perRequirement,
  };
}

function seededRandom(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

export function bootstrapHoldoutMetrics({ records, seed = "regspan-blind-holdout", samples = 2_000, confidenceLevel = 0.95 }) {
  if (!Number.isSafeInteger(samples) || samples < 100 || samples > 20_000) {
    throw new BlindHoldoutSchemaError("Bootstrap samples must be an integer from 100 through 20000.");
  }
  if (!(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw new BlindHoldoutSchemaError("Bootstrap confidence level must be between zero and one.");
  }
  const caseIds = sortedUnique(records.map((record) => record.caseId));
  if (caseIds.length === 0) throw new BlindHoldoutSchemaError("Bootstrap requires scored documents.");
  const recordsByCase = new Map(caseIds.map((caseId) => [caseId, records.filter((record) => record.caseId === caseId)]));
  const random = seededRandom(seed);
  const distributions = { accuracy: [], macroF1: [], falseAssuranceRate: [], documentExactMatchRate: [] };
  for (let sample = 0; sample < samples; sample += 1) {
    const sampledRecords = Array.from({ length: caseIds.length }, () => caseIds[Math.floor(random() * caseIds.length)])
      .flatMap((caseId) => recordsByCase.get(caseId));
    const metrics = statusMetrics(sampledRecords);
    const documents = groupDocumentMetrics(sampledRecords);
    distributions.accuracy.push(metrics.accuracy);
    distributions.macroF1.push(metrics.macroF1);
    distributions.falseAssuranceRate.push(metrics.falseAssuranceRate);
    distributions.documentExactMatchRate.push(ratio(documents.filter((document) => document.exactMatch).length, documents.length));
  }
  const alpha = (1 - confidenceLevel) / 2;
  return {
    method: "percentile bootstrap resampling complete documents",
    seed: String(seed),
    samples,
    confidenceLevel,
    intervals: Object.fromEntries(Object.entries(distributions).map(([name, values]) => {
      const ordered = [...values].sort((left, right) => left - right);
      return [name, { lower: percentile(ordered, alpha), upper: percentile(ordered, 1 - alpha) }];
    })),
  };
}

function normalizeRunsAndAnswerKey(runArtifacts, answerKey) {
  const runs = runArtifacts.map(validateBlindExecutionArtifact);
  if (runs.length === 0) throw new BlindHoldoutSchemaError("At least one completed blind execution artifact is required.");
  const key = validateBlindAnswerKey(answerKey);
  const answerCaseIds = sortedUnique(key.expectations.map((entry) => entry.caseId));
  const answerRequirements = new Map(answerCaseIds.map((caseId) => [
    caseId,
    sortedUnique(key.expectations.filter((entry) => entry.caseId === caseId).map((entry) => entry.requirementId)),
  ]));
  for (const run of runs) {
    if (run.corpusId !== key.corpusId || (key.corpusVersion !== null && run.corpusVersion !== key.corpusVersion)) {
      throw new BlindHoldoutSchemaError("Blind execution artifact corpus identifier does not match the answer key.");
    }
    if (run.executionStatus !== "completed") {
      throw new BlindHoldoutSchemaError("Blind holdout scoring requires completed execution artifacts.");
    }
    if (run.selectedCaseIds.join("\u0000") !== answerCaseIds.join("\u0000")) {
      throw new BlindHoldoutSchemaError("Blind execution artifact cases do not match the answer key.");
    }
    for (const caseId of answerCaseIds) {
      const actualRequirements = sortedUnique(run.cases[caseId].engineOutput.findings.map((finding) => finding.requirementId));
      const expectedRequirements = answerRequirements.get(caseId);
      if (actualRequirements.join("\u0000") !== expectedRequirements.join("\u0000")) {
        throw new BlindHoldoutSchemaError(`Blind execution artifact requirements do not match the answer key for ${caseId}.`);
      }
    }
  }
  if (new Set(runs.map((run) => run.runId)).size !== runs.length) {
    throw new BlindHoldoutSchemaError("Blind execution artifacts must have distinct run IDs.");
  }
  return { runs, key, answerCaseIds };
}

function scoredRecordsForRuns(runs, key) {
  const expectationByPair = new Map(key.expectations.map((entry) => [`${entry.caseId}\u0000${entry.requirementId}`, entry]));
  const records = [];
  for (const run of runs) {
    for (const [caseId, entry] of Object.entries(run.cases)) {
      const findingByRequirement = new Map(entry.engineOutput.findings.map((finding) => [finding.requirementId, finding]));
      for (const [pair, expected] of expectationByPair) {
        if (!pair.startsWith(`${caseId}\u0000`)) continue;
        const finding = findingByRequirement.get(expected.requirementId);
        const evidence = entry.engineOutput.evidence.filter((row) => row.findingId === finding.findingId);
        const actualElements = sortedUnique(evidence
          .filter((row) => POSITIVE_RELATIONSHIPS.has(row.relationship))
          .flatMap((row) => row.finalElementIds));
        records.push({
          runId: run.runId,
          caseId,
          requirementId: expected.requirementId,
          expected: expected.primaryExpectedStatus,
          actual: finding.status,
          supportedElements: expected.supportedElements,
          missingElements: expected.missingElements,
          validEvidenceSpans: expected.validEvidenceSpans,
          actualElements,
          evidence,
        });
      }
    }
  }
  return records.sort((left, right) => `${left.runId}\u0000${left.caseId}\u0000${left.requirementId}`.localeCompare(`${right.runId}\u0000${right.caseId}\u0000${right.requirementId}`));
}

export function scoreBlindHoldout({ runArtifacts, answerKey, reviewerAdjudication = null, bootstrap = {} }) {
  const { runs, key } = normalizeRunsAndAnswerKey(runArtifacts, answerKey);
  const reviewData = validateEvidenceReviews(reviewerAdjudication);
  if (reviewData.corpusId && reviewData.corpusId !== key.corpusId) {
    throw new BlindHoldoutSchemaError("Evidence review corpus identifier does not match the answer key.");
  }
  const records = scoredRecordsForRuns(runs, key);
  const perRun = Object.fromEntries(runs.map((run) => {
    const runRecords = records.filter((record) => record.runId === run.runId);
    return [run.runId, {
      status: statusMetrics(runRecords),
      perRequirement: requirementMetrics(runRecords),
      perDocument: groupDocumentMetrics(runRecords),
      elements: elementMetricsForStatusRecords(runRecords),
      evidenceGrounding: reviewMetrics(runRecords, reviewData.reviews),
      bootstrap: bootstrapHoldoutMetrics({ records: runRecords, ...bootstrap }),
    }];
  }));
  return {
    schemaVersion: 1,
    corpusId: key.corpusId,
    corpusVersion: key.corpusVersion,
    runIds: runs.map((run) => run.runId),
    status: statusMetrics(records),
    perRequirement: requirementMetrics(records),
    perDocument: groupDocumentMetrics(records),
    elements: elementMetricsForStatusRecords(records),
    evidenceGrounding: reviewMetrics(records, reviewData.reviews),
    repeatability: repeatabilityMetrics(records, runs.map((run) => run.runId)),
    perRun,
    records,
  };
}

export function evidenceReviewTemplateRows(metrics) {
  return metrics.records.flatMap((record) => record.evidence.map((evidence) => ({
    runId: record.runId,
    caseId: record.caseId,
    requirementId: record.requirementId,
    evidenceId: evidence.evidenceId,
    findingId: evidence.findingId,
    relationship: evidence.relationship,
    quoteHash: evidence.quoteHash,
    finalElementIds: evidence.finalElementIds.join("|"),
    validEvidenceSpanIds: record.validEvidenceSpans.map((span) => span.spanId).join("|"),
    reviewerLabel: "",
    reviewNotes: "",
  })));
}

export function toCsv(rows, columns) {
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [columns.join(","), ...rows.map((row) => columns.map((column) => quote(row[column])).join(","))].join("\n") + "\n";
}

export function renderBlindHoldoutSummary(metrics) {
  const status = metrics.status;
  const repeatability = metrics.repeatability;
  const bootstrapLines = Object.entries(metrics.perRun).map(([runId, result]) => {
    const interval = result.bootstrap.intervals.accuracy;
    return `- ${runId}: ${(interval.lower * 100).toFixed(1)}% to ${(interval.upper * 100).toFixed(1)}%`;
  });
  return `# RegSpan Blind Holdout Score\n\nCorpus ID: ${metrics.corpusId}\n\nRuns scored: ${metrics.runIds.join(", ")}\n\n`
    + `Overall status accuracy: ${(status.accuracy * 100).toFixed(1)}% (${status.matched}/${status.total})\n\n`
    + `Macro precision / recall / F1: ${(status.macroPrecision * 100).toFixed(1)}% / ${(status.macroRecall * 100).toFixed(1)}% / ${(status.macroF1 * 100).toFixed(1)}%\n\n`
    + `False assurance: ${status.falseAssuranceCount}/${status.falseAssuranceDenominator} (${(status.falseAssuranceRate * 100).toFixed(1)}%)\n\n`
    + `Element precision / recall / F1: ${(metrics.elements.overall.precision * 100).toFixed(1)}% / ${(metrics.elements.overall.recall * 100).toFixed(1)}% / ${(metrics.elements.overall.f1 * 100).toFixed(1)}%\n\n`
    + `Unsupported grounded claims: ${metrics.evidenceGrounding.unsupportedGroundedClaimCount}/${metrics.evidenceGrounding.reviewedPositiveEvidenceCount} reviewed (${(metrics.evidenceGrounding.unsupportedGroundedClaimRate * 100).toFixed(1)}%); unreviewed positive evidence: ${metrics.evidenceGrounding.unreviewedPositiveEvidenceCount}\n\n`
    + `Bootstrap accuracy interval by run:\n${bootstrapLines.join("\n")}\n\n`
    + `Repeatability: ${repeatability.available ? `${repeatability.runCount} runs; status agreement ${(repeatability.overall.statusAgreement * 100).toFixed(1)}%; element-ledger agreement ${(repeatability.overall.elementLedgerAgreement * 100).toFixed(1)}%; evidence-selection agreement ${(repeatability.overall.evidenceSelectionAgreement * 100).toFixed(1)}%` : `not available (${repeatability.runCount}/${repeatability.minimumRuns} runs)`}\n`;
}
