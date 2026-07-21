import { createHash } from "node:crypto";
import type { FindingStatus } from "./findingsAggregation";
import type { RegSpRequirement } from "./regSpRequirements";
import type { RetrievedChunk } from "./retrieval";
import type {
  OpenAiClassifierRequestBody,
  OpenAiClassifierUsage,
  RequirementEvidenceClassification,
  RequirementEvidenceClassifierEvaluationOutcome,
  RequirementEvidenceClassifierEvaluationErrorCategory,
} from "./requirementEvidenceClassifier";

export const CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA = "classifier-capability-fixtures/v2";
export const CLASSIFIER_CAPABILITY_RESULT_SCHEMA = "classifier-capability-results/v2";

export type ClassifierCapabilityProvenanceSource =
  | "reviewer_answer_key"
  | "manual_adjudication"
  | "diagnostic_artifact"
  | "implementation_inference";

export type ClassifierCapabilityFieldProvenance = {
  confirmed: boolean;
  source_type: ClassifierCapabilityProvenanceSource;
  reviewer_id: string | null;
  reviewed_at: string | null;
  source_path: string;
  source_locator: string;
  source_hash: string;
  normalization_recipe: string | null;
};

export type ClassifierCapabilityExpectedField<T> = {
  value: T;
  provenance: ClassifierCapabilityFieldProvenance;
};

export type ClassifierCapabilityCandidateFixture = RetrievedChunk & {
  expected_relationship: ClassifierCapabilityExpectedField<RequirementEvidenceClassification["relationship"]>;
  expected_covered_elements: ClassifierCapabilityExpectedField<string[]>;
  direct_support_recovery: ClassifierCapabilityExpectedField<boolean>;
  hard_negative: ClassifierCapabilityExpectedField<boolean>;
  source: {
    kind: "committed_corpus" | "regression_diagnostic";
    path: string;
    locator: string;
    content_sha256: string;
    normalization_recipe: string | null;
  };
};

export type ClassifierCapabilityCaseFixture = {
  id: string;
  requirement_id: string;
  category:
    | "incident_assessment_containment"
    | "incident_evidence_log_preservation"
    | "recovery_remediation_validation";
  evaluation_role: "scored" | "diagnostic_only" | "unresolved";
  expected_status: ClassifierCapabilityExpectedField<FindingStatus>;
  expected_supported_elements: ClassifierCapabilityExpectedField<string[]>;
  notes: string;
  candidates: ClassifierCapabilityCandidateFixture[];
};

export type ClassifierCapabilityFixtureSuite = {
  schema_version: typeof CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA;
  fixture_version: string;
  frozen_baseline_commit: string;
  source_diagnostic_artifact: string;
  suite_hash: string;
  requirements: RegSpRequirement[];
  requirement_sha256: Record<string, string>;
  multi_candidate_review: {
    status: "confirmed" | "unresolved";
    case_id: string | null;
    blocker: string | null;
  };
  cases: ClassifierCapabilityCaseFixture[];
};

export type ClassifierCapabilityElementDecision = { element_id: string; reason: string };

export type ClassifierCapabilityCandidateOutput = {
  candidate_chunk_id: string;
  request_hash: string;
  invariant_request_hash: string;
  model: string;
  outcome: RequirementEvidenceClassifierEvaluationOutcome;
  http_status: number | null;
  retry_count: number;
  error_category: RequirementEvidenceClassifierEvaluationErrorCategory | null;
  error_message: string | null;
  raw_response_text: string | null;
  parsed_transport_json: unknown;
  parsed_classification: Omit<RequirementEvidenceClassification, "classifier_provider"> | null;
  post_processed_classification: RequirementEvidenceClassification;
  accepted_elements: ClassifierCapabilityElementDecision[];
  rejected_elements: ClassifierCapabilityElementDecision[];
  validated_quote: string | null;
  exact_quote_valid: boolean;
  latency_ms: number;
  token_usage: OpenAiClassifierUsage;
  estimated_cost_usd: number | null;
};

export type ClassifierCapabilityCaseOutput = {
  case_id: string;
  normalized_fixture_input: { requirement: RegSpRequirement; candidates: RetrievedChunk[] };
  final_requirement_status: FindingStatus;
  candidates: ClassifierCapabilityCandidateOutput[];
};

export type ClassifierCapabilityArmOutput = {
  name: "baseline" | "challenger";
  model: string;
  valid: boolean;
  invalid_reasons: string[];
  input_cost_per_million_tokens: number | null;
  output_cost_per_million_tokens: number | null;
  cases: ClassifierCapabilityCaseOutput[];
};

export type ClassifierCapabilityExcludedCandidate = {
  case_id: string;
  candidate_chunk_id: string;
  reason: string;
};

export type ClassifierCapabilityMetrics = {
  scored_candidate_count: number;
  model_success_candidate_count: number;
  excluded_candidates: ClassifierCapabilityExcludedCandidate[];
  direct_support_recovery: { numerator: number; denominator: number; rate: number | null };
  element_precision: { numerator: number; denominator: number; rate: number | null };
  element_recall: { numerator: number; denominator: number; rate: number | null };
  element_f1: number | null;
  requirement_status_accuracy: { numerator: number; denominator: number; rate: number | null };
  false_assurance: { count: number; denominator: number; rate: number | null };
  hard_negative_rejection: { numerator: number; denominator: number; rate: number | null };
  exact_quote_fixed_eligible_positive: { numerator: number; denominator: number; rate: number | null };
  exact_quote_positive_prediction: { numerator: number; denominator: number; rate: number | null };
};

export type ClassifierCapabilityResult = {
  schema_version: typeof CLASSIFIER_CAPABILITY_RESULT_SCHEMA;
  fixture_version: string;
  frozen_baseline_commit: string;
  fixture_suite_hash: string;
  generated_at: string;
  fixture_path: string;
  comparative_conclusions_suppressed: boolean;
  arms: [ClassifierCapabilityArmOutput, ClassifierCapabilityArmOutput];
  metrics: { baseline: ClassifierCapabilityMetrics; challenger: ClassifierCapabilityMetrics };
};

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function jsonHash(value: unknown) {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function classifierCapabilityFixtureSuiteHash(
  suite: Omit<ClassifierCapabilityFixtureSuite, "suite_hash"> | ClassifierCapabilityFixtureSuite,
) {
  const payload = { ...(suite as ClassifierCapabilityFixtureSuite) } as Partial<ClassifierCapabilityFixtureSuite>;
  delete payload.suite_hash;
  return jsonHash(payload);
}

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
}

function validateProvenance(value: unknown, label: string): asserts value is ClassifierCapabilityFieldProvenance {
  assertObject(value, `${label} provenance`);
  const sources = new Set(["reviewer_answer_key", "manual_adjudication", "diagnostic_artifact", "implementation_inference"]);
  if (typeof value.confirmed !== "boolean" || !sources.has(String(value.source_type))) {
    throw new Error(`${label} has invalid confirmation provenance.`);
  }
  for (const field of ["source_path", "source_locator", "source_hash"]) {
    if (typeof value[field] !== "string" || !value[field]) throw new Error(`${label} provenance is missing ${field}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(value.source_hash))) throw new Error(`${label} source_hash must be SHA-256.`);
  if (value.confirmed && value.source_type !== "reviewer_answer_key" && value.source_type !== "manual_adjudication") {
    throw new Error(`${label} cannot be confirmed from ${String(value.source_type)}.`);
  }
  if (value.source_type === "manual_adjudication" && value.confirmed
    && (typeof value.reviewer_id !== "string" || !value.reviewer_id
      || typeof value.reviewed_at !== "string" || !value.reviewed_at)) {
    throw new Error(`${label} manual adjudication requires reviewer_id and reviewed_at.`);
  }
}

function validateExpectedField(value: unknown, label: string) {
  assertObject(value, label);
  if (!("value" in value)) throw new Error(`${label} is missing value.`);
  validateProvenance(value.provenance, label);
}

export function independentlyConfirmed(provenance: ClassifierCapabilityFieldProvenance) {
  return provenance.confirmed
    && (provenance.source_type === "reviewer_answer_key" || provenance.source_type === "manual_adjudication");
}

export function caseHasConfirmedScoringFields(fixtureCase: ClassifierCapabilityCaseFixture) {
  return independentlyConfirmed(fixtureCase.expected_status.provenance)
    && independentlyConfirmed(fixtureCase.expected_supported_elements.provenance)
    && fixtureCase.candidates.every((candidate) =>
      independentlyConfirmed(candidate.expected_relationship.provenance)
      && independentlyConfirmed(candidate.expected_covered_elements.provenance)
      && independentlyConfirmed(candidate.direct_support_recovery.provenance)
      && independentlyConfirmed(candidate.hard_negative.provenance));
}

export function validateClassifierCapabilityFixtures(value: unknown): ClassifierCapabilityFixtureSuite {
  assertObject(value, "Fixture suite");
  if (value.schema_version !== CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA) {
    throw new Error(`Unsupported classifier capability fixture schema: ${String(value.schema_version)}.`);
  }
  if (!Array.isArray(value.requirements) || value.requirements.length !== 3) {
    throw new Error("Fixture suite must freeze exactly the three in-scope requirement definitions.");
  }
  if (!Array.isArray(value.cases) || value.cases.length < 8) throw new Error("Fixture suite must contain at least eight cases.");
  assertObject(value.requirement_sha256, "requirement_sha256");
  assertObject(value.multi_candidate_review, "multi_candidate_review");

  const requirements = value.requirements as RegSpRequirement[];
  const requirementById = new Map<string, RegSpRequirement>();
  for (const requirement of requirements) {
    if (!requirement.id || requirementById.has(requirement.id)) throw new Error(`Duplicate or empty requirement id: ${requirement.id}.`);
    requirementById.set(requirement.id, requirement);
    if (value.requirement_sha256[requirement.id] !== jsonHash(requirement)) {
      throw new Error(`Frozen requirement hash mismatch for ${requirement.id}.`);
    }
  }

  const caseIds = new Set<string>();
  for (const rawCase of value.cases as ClassifierCapabilityCaseFixture[]) {
    if (!rawCase.id || caseIds.has(rawCase.id)) throw new Error(`Duplicate or empty case id: ${rawCase.id}.`);
    caseIds.add(rawCase.id);
    const requirement = requirementById.get(rawCase.requirement_id);
    if (!requirement) throw new Error(`Case ${rawCase.id} references an unfrozen requirement.`);
    if (!["scored", "diagnostic_only", "unresolved"].includes(rawCase.evaluation_role)) {
      throw new Error(`Case ${rawCase.id} has invalid evaluation_role.`);
    }
    validateExpectedField(rawCase.expected_status, `${rawCase.id}.expected_status`);
    validateExpectedField(rawCase.expected_supported_elements, `${rawCase.id}.expected_supported_elements`);
    if (!Array.isArray(rawCase.candidates) || rawCase.candidates.length === 0) throw new Error(`Case ${rawCase.id} has no candidates.`);
    const chunkIds = new Set<string>();
    for (const candidate of rawCase.candidates) {
      if (!candidate.chunk_id || chunkIds.has(candidate.chunk_id)) throw new Error(`Case ${rawCase.id} has a duplicate or empty candidate id.`);
      chunkIds.add(candidate.chunk_id);
      if (candidate.source.content_sha256 !== sha256(candidate.content_preview)) {
        throw new Error(`Candidate source hash mismatch for ${rawCase.id}/${candidate.chunk_id}.`);
      }
      validateExpectedField(candidate.expected_relationship, `${rawCase.id}/${candidate.chunk_id}.expected_relationship`);
      validateExpectedField(candidate.expected_covered_elements, `${rawCase.id}/${candidate.chunk_id}.expected_covered_elements`);
      validateExpectedField(candidate.direct_support_recovery, `${rawCase.id}/${candidate.chunk_id}.direct_support_recovery`);
      validateExpectedField(candidate.hard_negative, `${rawCase.id}/${candidate.chunk_id}.hard_negative`);
      const knownElements = new Set(requirement.coverageElements.map((element) => element.id));
      if (candidate.expected_covered_elements.value.some((element) => !knownElements.has(element))) {
        throw new Error(`Case ${rawCase.id} expects an unknown coverage element.`);
      }
    }
    if (rawCase.evaluation_role === "scored" && !caseHasConfirmedScoringFields(rawCase)) {
      throw new Error(`Scored case ${rawCase.id} has unconfirmed expected fields.`);
    }
  }
  const suite = value as unknown as ClassifierCapabilityFixtureSuite;
  if (suite.suite_hash !== classifierCapabilityFixtureSuiteHash(suite)) throw new Error("Fixture suite hash mismatch.");
  return suite;
}

export function paidRunReadinessBlockers(fixtures: ClassifierCapabilityFixtureSuite) {
  const blockers: string[] = [];
  const scored = fixtures.cases.filter((item) => item.evaluation_role === "scored");
  if (scored.length === 0) blockers.push("No independently confirmed scored fixtures are available.");
  for (const fixtureCase of scored) {
    if (!caseHasConfirmedScoringFields(fixtureCase)) blockers.push(`Scored case ${fixtureCase.id} has unconfirmed fields.`);
    const provenances = fixtureCase.candidates.flatMap((candidate) => [
      candidate.expected_relationship.provenance,
      candidate.expected_covered_elements.provenance,
      candidate.direct_support_recovery.provenance,
      candidate.hard_negative.provenance,
    ]);
    if (provenances.some((item) => item.source_type === "diagnostic_artifact")) {
      blockers.push(`Scored case ${fixtureCase.id} is provider-output-derived.`);
    }
  }
  const multi = fixtures.multi_candidate_review;
  const multiCase = multi.case_id ? fixtures.cases.find((item) => item.id === multi.case_id) : null;
  const positiveCandidates = multiCase?.candidates.filter((candidate) =>
    candidate.expected_relationship.value === "supports" || candidate.expected_relationship.value === "partially_supports") ?? [];
  const positiveElementSets = positiveCandidates.map((candidate) => new Set(candidate.expected_covered_elements.value));
  const positiveElementUnion = new Set(positiveCandidates.flatMap((candidate) => candidate.expected_covered_elements.value));
  const complementarySupport = positiveCandidates.length >= 2
    && positiveElementUnion.size > 0
    && positiveElementSets.every((elements) => elements.size > 0 && elements.size < positiveElementUnion.size);
  const hasHighSignalDistractor = multiCase?.candidates.some((candidate) => candidate.hard_negative.value) ?? false;
  if (multi.status !== "confirmed" || !multiCase || multiCase.evaluation_role !== "scored"
    || multiCase.candidates.length < 3 || !caseHasConfirmedScoringFields(multiCase)
    || !complementarySupport || !hasHighSignalDistractor) {
    blockers.push(multi.blocker ?? "No confirmed scored multi-candidate case is available.");
  }
  return [...new Set(blockers)];
}

export function invariantOpenAiRequestBody(body: OpenAiClassifierRequestBody) {
  return { ...body, model: "__MODEL_IDENTIFIER__" };
}

export function assertRequestsDifferOnlyByModel(baseline: OpenAiClassifierRequestBody, challenger: OpenAiClassifierRequestBody) {
  if (baseline.model === challenger.model) throw new Error("Baseline and challenger model identifiers must differ.");
  const invariant = jsonHash(invariantOpenAiRequestBody(baseline));
  if (invariant !== jsonHash(invariantOpenAiRequestBody(challenger))) {
    throw new Error("A/B request payloads differ outside the model identifier.");
  }
  return invariant;
}

function ratio(numerator: number, denominator: number) { return denominator === 0 ? null : numerator / denominator; }

function statusRank(status: FindingStatus) {
  if (status === "missing") return 0;
  if (status === "partial") return 1;
  if (status === "covered") return 2;
  return null;
}

export function classifierCapabilityMetrics(fixtures: ClassifierCapabilityFixtureSuite, arm: ClassifierCapabilityArmOutput): ClassifierCapabilityMetrics {
  let scoredCandidateCount = 0;
  let modelSuccessCandidateCount = 0;
  const excluded: ClassifierCapabilityExcludedCandidate[] = [];
  let directDenominator = 0;
  let directNumerator = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let statusDenominator = 0;
  let statusNumerator = 0;
  let falseAssuranceDenominator = 0;
  let falseAssuranceCount = 0;
  let hardNegativeDenominator = 0;
  let hardNegativeNumerator = 0;
  let fixedQuoteDenominator = 0;
  let fixedQuoteNumerator = 0;
  let predictedQuoteDenominator = 0;
  let predictedQuoteNumerator = 0;

  const outputByCase = new Map(arm.cases.map((item) => [item.case_id, item]));
  for (const fixtureCase of fixtures.cases) {
    const caseOutput = outputByCase.get(fixtureCase.id);
    if (!caseOutput) throw new Error(`Result contains no output for ${fixtureCase.id}.`);
    if (fixtureCase.evaluation_role !== "scored" || !caseHasConfirmedScoringFields(fixtureCase)) {
      for (const candidate of fixtureCase.candidates) excluded.push({
        case_id: fixtureCase.id,
        candidate_chunk_id: candidate.chunk_id,
        reason: fixtureCase.evaluation_role !== "scored" ? `fixture_${fixtureCase.evaluation_role}` : "unconfirmed_expected_fields",
      });
      continue;
    }
    const candidateOutputs = new Map(caseOutput.candidates.map((item) => [item.candidate_chunk_id, item]));
    let allModelSuccess = true;
    for (const candidate of fixtureCase.candidates) {
      scoredCandidateCount += 1;
      const output = candidateOutputs.get(candidate.chunk_id);
      if (!output) throw new Error(`Result contains no candidate output for ${fixtureCase.id}/${candidate.chunk_id}.`);
      if (output.outcome !== "model_success") {
        allModelSuccess = false;
        excluded.push({ case_id: fixtureCase.id, candidate_chunk_id: candidate.chunk_id, reason: output.outcome });
        continue;
      }
      modelSuccessCandidateCount += 1;
      const actual = output.post_processed_classification;
      if (candidate.direct_support_recovery.value) {
        directDenominator += 1;
        if (actual.relationship === "supports" && output.exact_quote_valid) directNumerator += 1;
      }
      const expectedElements = new Set(candidate.expected_covered_elements.value);
      const actualElements = new Set(actual.covered_elements);
      for (const element of actualElements) {
        if (expectedElements.has(element)) tp += 1;
        else fp += 1;
      }
      for (const element of expectedElements) if (!actualElements.has(element)) fn += 1;
      if (candidate.hard_negative.value) {
        hardNegativeDenominator += 1;
        if (["irrelevant", "background_context", "negative_evidence"].includes(actual.relationship)) hardNegativeNumerator += 1;
      }
      if (["supports", "partially_supports"].includes(candidate.expected_relationship.value)) {
        fixedQuoteDenominator += 1;
        if (output.exact_quote_valid) fixedQuoteNumerator += 1;
      }
      if (["supports", "partially_supports"].includes(actual.relationship)) {
        predictedQuoteDenominator += 1;
        if (output.exact_quote_valid) predictedQuoteNumerator += 1;
      }
    }
    if (allModelSuccess) {
      statusDenominator += 1;
      if (caseOutput.final_requirement_status === fixtureCase.expected_status.value) statusNumerator += 1;
      const expectedRank = statusRank(fixtureCase.expected_status.value);
      const actualRank = statusRank(caseOutput.final_requirement_status);
      if (expectedRank !== null && actualRank !== null) {
        falseAssuranceDenominator += 1;
        if (actualRank > expectedRank) falseAssuranceCount += 1;
      }
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  return {
    scored_candidate_count: scoredCandidateCount,
    model_success_candidate_count: modelSuccessCandidateCount,
    excluded_candidates: excluded,
    direct_support_recovery: { numerator: directNumerator, denominator: directDenominator, rate: ratio(directNumerator, directDenominator) },
    element_precision: { numerator: tp, denominator: tp + fp, rate: precision },
    element_recall: { numerator: tp, denominator: tp + fn, rate: recall },
    element_f1: f1,
    requirement_status_accuracy: { numerator: statusNumerator, denominator: statusDenominator, rate: ratio(statusNumerator, statusDenominator) },
    false_assurance: { count: falseAssuranceCount, denominator: falseAssuranceDenominator, rate: ratio(falseAssuranceCount, falseAssuranceDenominator) },
    hard_negative_rejection: { numerator: hardNegativeNumerator, denominator: hardNegativeDenominator, rate: ratio(hardNegativeNumerator, hardNegativeDenominator) },
    exact_quote_fixed_eligible_positive: { numerator: fixedQuoteNumerator, denominator: fixedQuoteDenominator, rate: ratio(fixedQuoteNumerator, fixedQuoteDenominator) },
    exact_quote_positive_prediction: { numerator: predictedQuoteNumerator, denominator: predictedQuoteDenominator, rate: ratio(predictedQuoteNumerator, predictedQuoteDenominator) },
  };
}

export function validateClassifierCapabilityResultAlignment(fixtures: ClassifierCapabilityFixtureSuite, result: ClassifierCapabilityResult) {
  if (result.schema_version !== CLASSIFIER_CAPABILITY_RESULT_SCHEMA) throw new Error(`Unsupported stored result schema: ${String(result.schema_version)}.`);
  if (result.fixture_version !== fixtures.fixture_version || result.frozen_baseline_commit !== fixtures.frozen_baseline_commit
    || result.fixture_suite_hash !== fixtures.suite_hash) throw new Error("Stored result fixture suite hash mismatch.");
  if (!Array.isArray(result.arms) || result.arms.length !== 2 || result.arms[0].name !== "baseline"
    || result.arms[1].name !== "challenger" || result.arms[0].model === result.arms[1].model) {
    throw new Error("Stored result must contain aligned, distinct baseline and challenger arms.");
  }
  const expectedCaseIds = fixtures.cases.map((item) => item.id);
  for (const arm of result.arms) {
    const actualCaseIds = arm.cases.map((item) => item.case_id);
    if (new Set(actualCaseIds).size !== actualCaseIds.length) throw new Error(`Stored ${arm.name} arm has duplicate case IDs.`);
    if (JSON.stringify(actualCaseIds) !== JSON.stringify(expectedCaseIds)) throw new Error(`Stored ${arm.name} case IDs or order changed.`);
    for (let index = 0; index < fixtures.cases.length; index += 1) {
      const fixtureCase = fixtures.cases[index];
      const output = arm.cases[index];
      const expectedCandidateIds = fixtureCase.candidates.map((item) => item.chunk_id);
      const actualCandidateIds = output.candidates.map((item) => item.candidate_chunk_id);
      if (new Set(actualCandidateIds).size !== actualCandidateIds.length) throw new Error(`Stored ${arm.name}/${fixtureCase.id} has duplicate candidate IDs.`);
      if (JSON.stringify(actualCandidateIds) !== JSON.stringify(expectedCandidateIds)) throw new Error(`Stored ${arm.name}/${fixtureCase.id} candidate IDs or order changed.`);
      if (output.candidates.some((candidate) => candidate.model !== arm.model)) throw new Error(`Stored ${arm.name} candidate model mismatch.`);
    }
  }
  if (JSON.stringify(result.arms[0].cases.map((item) => item.case_id)) !== JSON.stringify(result.arms[1].cases.map((item) => item.case_id))) {
    throw new Error("Baseline/challenger case alignment mismatch.");
  }
}

function percent(value: number | null) { return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`; }
function scored(metric: { numerator: number; denominator: number; rate: number | null }) { return `${metric.numerator}/${metric.denominator} (${percent(metric.rate)})`; }

export function formatClassifierCapabilityMarkdown(fixtures: ClassifierCapabilityFixtureSuite, result: ClassifierCapabilityResult) {
  const metrics = {
    baseline: classifierCapabilityMetrics(fixtures, result.arms[0]),
    challenger: classifierCapabilityMetrics(fixtures, result.arms[1]),
  };
  const invalid = !result.arms[0].valid || !result.arms[1].valid;
  const lines = [
    "# Classifier capability A/B report",
    "",
    `Fixture suite hash: \`${fixtures.suite_hash}\`  `,
    `Frozen baseline: \`${fixtures.frozen_baseline_commit}\`  `,
    `Generated: ${result.generated_at}`,
    "",
  ];
  if (invalid) lines.push(
    "# ⚠ INVALID RUN — COMPARATIVE QUALITY CONCLUSIONS SUPPRESSED",
    "",
    "At least one scored candidate did not complete as `model_success`. Diagnostics are retained below; quality metrics must not be used to compare models.",
    "",
  );
  lines.push("## Arm validity", "", "| Arm | Valid | Reasons |", "| --- | --- | --- |",
    ...result.arms.map((arm) => `| ${arm.name} (${arm.model}) | ${arm.valid ? "yes" : "**NO**"} | ${arm.invalid_reasons.join("; ") || "none"} |`), "");
  if (!invalid) {
    lines.push("## Quality metrics", "", "| Metric | Baseline | Challenger |", "| --- | ---: | ---: |",
      `| Direct-support recovery | ${scored(metrics.baseline.direct_support_recovery)} | ${scored(metrics.challenger.direct_support_recovery)} |`,
      `| Element precision | ${scored(metrics.baseline.element_precision)} | ${scored(metrics.challenger.element_precision)} |`,
      `| Element recall | ${scored(metrics.baseline.element_recall)} | ${scored(metrics.challenger.element_recall)} |`,
      `| Element F1 | ${percent(metrics.baseline.element_f1)} | ${percent(metrics.challenger.element_f1)} |`,
      `| Requirement-status accuracy | ${scored(metrics.baseline.requirement_status_accuracy)} | ${scored(metrics.challenger.requirement_status_accuracy)} |`,
      `| False assurance | ${metrics.baseline.false_assurance.count}/${metrics.baseline.false_assurance.denominator} | ${metrics.challenger.false_assurance.count}/${metrics.challenger.false_assurance.denominator} |`,
      `| Hard-negative rejection | ${scored(metrics.baseline.hard_negative_rejection)} | ${scored(metrics.challenger.hard_negative_rejection)} |`,
      `| Exact quote / fixed eligible positives | ${scored(metrics.baseline.exact_quote_fixed_eligible_positive)} | ${scored(metrics.challenger.exact_quote_fixed_eligible_positive)} |`,
      `| Exact quote / positive predictions | ${scored(metrics.baseline.exact_quote_positive_prediction)} | ${scored(metrics.challenger.exact_quote_positive_prediction)} |`, "");
  }
  lines.push("## Excluded candidates", "");
  for (const arm of result.arms) {
    lines.push(`### ${arm.name}`, "");
    const excluded = metrics[arm.name].excluded_candidates;
    if (excluded.length === 0) lines.push("None.", "");
    else lines.push(...excluded.map((item) => `- \`${item.case_id}/${item.candidate_chunk_id}\`: ${item.reason}`), "");
  }
  lines.push("## Candidate diagnostics", "", "| Arm | Case / candidate | Outcome | HTTP | Retries | Error |", "| --- | --- | --- | ---: | ---: | --- |");
  for (const arm of result.arms) for (const caseOutput of arm.cases) for (const candidate of caseOutput.candidates) {
    lines.push(`| ${arm.name} | ${caseOutput.case_id} / ${candidate.candidate_chunk_id} | ${candidate.outcome} | ${candidate.http_status ?? "n/a"} | ${candidate.retry_count} | ${candidate.error_message ?? ""} |`);
  }
  lines.push("", "Results detect accidental or inconsistent modification by binding outputs to the selected fixture suite. They do not protect against an actor who deliberately rewrites both fixture and result files.", "");
  return lines.join("\n");
}
