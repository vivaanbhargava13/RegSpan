import type { DocumentSourceType, EvidenceRole } from "./documentSource";
import {
  createWorkspaceExternalAiProcessingPolicy,
  type WorkspaceExternalAiProcessingPolicy,
} from "./aiProcessingPolicy";
import { detectNegativeEvidence } from "./negativeEvidence";
import {
  requirementSpecificElementMatch,
  requiresOperativeElementSupport,
  usesCanonicalOperativeElementModel,
} from "./operativeEvidenceRules.mjs";
import type { RegSpRequirement } from "./regSpRequirements";
import type { RetrievedChunk } from "./retrieval";

export type RequirementEvidenceRelationship =
  | "supports"
  | "partially_supports"
  | "negative_evidence"
  | "background_context"
  | "irrelevant";

export type RequirementEvidenceConfidence = "high" | "medium" | "low";
export type RequirementEvidenceClassifierProvider = "heuristic" | "openai" | "fallback";

export type RequirementEvidenceClassifierTelemetryPath =
  | "openai_success"
  | "heuristic_disabled"
  | "heuristic_unconfigured"
  | "heuristic_negative_guardrail"
  | "fallback_provider_error"
  | "fallback_parse_error";

export type RequirementEvidenceClassifierProviderFailureCategory =
  | "rate_limit"
  | "timeout"
  | "network"
  | "http_4xx"
  | "http_5xx"
  | "unknown";

/**
 * Deliberately source-free provider-failure metadata for evaluation telemetry.
 * Do not add prompts, source text, response bodies, credentials, or headers
 * other than Retry-After to this shape.
 */
export type RequirementEvidenceClassifierProviderFailureEvent = {
  caseId: string | null;
  requirementId: string;
  candidateChunkId: string | null;
  httpStatus: number | null;
  errorCategory: RequirementEvidenceClassifierProviderFailureCategory;
  elapsedMs: number;
  requestAttempt: number;
  promptCharacters: number;
  model: string;
  retryAfter: string | null;
};

/** A sanitized retry observation. It intentionally contains no request or source content. */
export type RequirementEvidenceClassifierProviderRetryEvent = RequirementEvidenceClassifierProviderFailureEvent & {
  retryDelayMs: number;
};

export type RequirementEvidenceClassifierResolvedConfiguration = {
  provider: RequirementEvidenceClassifierProvider;
  model: string | null;
};

/**
 * Optional, caller-owned observation hooks. Production callers do not provide
 * these hooks; the corpus runner injects them for its evaluation sidecar.
 */
export type RequirementEvidenceClassifierTelemetry = {
  recordResolvedClassifier?: (configuration: RequirementEvidenceClassifierResolvedConfiguration) => void;
  recordPath?: (path: RequirementEvidenceClassifierTelemetryPath) => void;
  recordProviderFailure?: (event: RequirementEvidenceClassifierProviderFailureEvent) => void;
  recordProviderRetry?: (event: RequirementEvidenceClassifierProviderRetryEvent) => void;
  /** Evaluation-only: fail the analysis after recording a provider failure. */
  strictProviderFailures?: boolean;
};

export type RequirementEvidenceClassifierInput = {
  requirement: RegSpRequirement;
  evaluationGuidance: string;
  chunkContent: string;
  candidateChunkId?: string | null;
  evaluationCaseId?: string | null;
  chunkMetadata: {
    filename: string | null;
    sectionPath: string | null;
    pageStart: number | null;
    pageEnd: number | null;
    chunkIndex: number;
    sourceType: DocumentSourceType;
    evidenceRole: EvidenceRole;
    evidenceReason: string | null;
  };
};

export class RequirementEvidenceClassifierProviderFailureError extends Error {
  constructor(public readonly event: RequirementEvidenceClassifierProviderFailureEvent) {
    super(`Classifier provider failure: ${event.errorCategory}.`);
    this.name = "RequirementEvidenceClassifierProviderFailureError";
  }
}

export type RequirementEvidenceClassification = {
  relationship: RequirementEvidenceRelationship;
  confidence: RequirementEvidenceConfidence;
  requirement_supported: boolean;
  control_absent_or_out_of_scope: boolean;
  covered_elements: string[];
  missing_elements: string[];
  vague_elements: string[];
  reason: string;
  supporting_quote: string | null;
  classifier_provider: RequirementEvidenceClassifierProvider;
};

export type RequirementEvidenceClassifier = {
  provider: RequirementEvidenceClassifierProvider;
  classify: (
    input: RequirementEvidenceClassifierInput,
  ) => Promise<RequirementEvidenceClassification>;
};

type ClassifierEnvironment = Record<string, string | undefined>;
export type RequirementEvidenceClassifierRuntime = {
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
};
type SentenceScopedNegativeEvidence = ReturnType<typeof detectNegativeEvidence> & {
  sentence: string | null;
  elementIds: string[];
};

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const CLASSIFIER_TIMEOUT_MS = 30_000;
const CLASSIFIER_MAX_ATTEMPTS = 3;
const CLASSIFIER_RETRY_BACKOFF_BASE_MS = 250;
const CLASSIFIER_RETRY_BACKOFF_CAP_MS = 2_000;
const SILENCE_BASED_NEGATIVE_REASON_PATTERNS = [
  /\bdoes not\s+(?:explicitly\s+)?(?:mention|reference|discuss|describe|state|include|address|contain)\b/i,
  /\bdoesn['’]?t\s+(?:explicitly\s+)?(?:mention|reference|discuss|describe|state|include|address|contain)\b/i,
  /\bno\s+(?:explicit\s+)?(?:mention|reference|discussion|description|evidence)\b/i,
  /\bnot\s+(?:mentioned|referenced|discussed|described|addressed|included|contained)\b/i,
  /\bsilent\s+(?:on|about|regarding)\b/i,
  /\bsilence\b/i,
  /\blacks?\s+(?:any\s+|explicit\s+)?(?:mention|reference|discussion|description|evidence)\b/i,
  /\bfails?\s+to\s+(?:mention|show|demonstrate|establish|provide|address)\b/i,
];
const INFERRED_ABSENCE_REASON_PATTERNS = [
  /\bimplies?\b/i,
  /\bsuggests?\b/i,
  /\binfer(?:s|red|ence)?\b/i,
  /\btherefore\b/i,
];

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function httpStatusForFailure(response: { status?: unknown }) {
  const status = response.status;
  return typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : null;
}

function retryAfterForFailure(response: { headers?: { get?: (name: string) => string | null } }) {
  const value = response.headers?.get?.("retry-after");
  const sanitized = typeof value === "string" ? value.trim().slice(0, 128) : "";
  return sanitized || null;
}

function providerFailureCategoryForHttpStatus(
  status: number | null,
): RequirementEvidenceClassifierProviderFailureCategory {
  if (status === 429) return "rate_limit";
  if (status !== null && status >= 400 && status < 500) return "http_4xx";
  if (status !== null && status >= 500 && status < 600) return "http_5xx";
  return "unknown";
}

function providerFailureCategoryForThrownError(
  error: unknown,
): RequirementEvidenceClassifierProviderFailureCategory {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (error instanceof TypeError || name === "TypeError") return "network";
  return "unknown";
}

function isRetryableProviderFailure({
  httpStatus,
  errorCategory,
}: {
  httpStatus: number | null;
  errorCategory: RequirementEvidenceClassifierProviderFailureCategory;
}) {
  return httpStatus === 429
    || httpStatus === 500
    || httpStatus === 502
    || httpStatus === 503
    || httpStatus === 504
    || errorCategory === "network";
}

function retryAfterDelayMs(retryAfter: string | null, now: () => number) {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - now()) : null;
}

function retryDelayMs({
  attempt,
  retryAfter,
  now,
  random,
}: {
  attempt: number;
  retryAfter: string | null;
  now: () => number;
  random: () => number;
}) {
  const retryAfterDelay = retryAfterDelayMs(retryAfter, now);
  if (retryAfterDelay !== null) return retryAfterDelay;
  const boundedBase = Math.min(
    CLASSIFIER_RETRY_BACKOFF_CAP_MS,
    CLASSIFIER_RETRY_BACKOFF_BASE_MS * (2 ** Math.max(0, attempt - 1)),
  );
  const jitter = 0.5 + Math.min(1, Math.max(0, random()));
  return Math.round(boundedBase * jitter);
}

function countSignalMatches(text: string, signals: string[]) {
  const matched = signals.filter((signal) => {
    const normalizedSignal = normalize(signal);
    return normalizedSignal && text.includes(normalizedSignal);
  });

  return {
    count: matched.length,
    matched,
  };
}

function hasAnySignal(text: string, signals: string[]) {
  return countSignalMatches(text, signals).count > 0;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function validCoverageElementIds(requirement: RegSpRequirement) {
  return new Set((requirement.coverageElements ?? []).map((element) => element.id));
}

function sanitizeElementIds(value: unknown, requirement: RegSpRequirement) {
  if (!Array.isArray(value)) return [];
  const validIds = validCoverageElementIds(requirement);
  return uniqueStrings(
    value.map((item) => (typeof item === "string" ? item.trim() : null))
      .filter((item) => item && validIds.has(item)),
  );
}

function assessCoverageElements(requirement: RegSpRequirement, text: string) {
  const coverageElements = requirement.coverageElements ?? [];
  const requiredElements = requirement.requiredElementsForCovered ?? [];
  const covered = coverageElements
    .filter((element) => coverageElementMatches(requirement, element.id, element.signals, text))
    .map((element) => element.id);
  const missingRequired = requiredElements.filter(
    (elementId) => !covered.includes(elementId),
  );

  return {
    covered,
    missingRequired,
    vague: [] as string[],
  };
}

function sentenceContaining(rawText: string, signals: string[]) {
  const sentences = (rawText.match(/[^.!?]+[.!?]?/g) ?? [rawText])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const normalizedSignals = signals.map(normalize).filter(Boolean);
  const matched = sentences.find((sentence) => {
    const normalizedSentence = normalize(sentence);
    return normalizedSignals.some((signal) => normalizedSentence.includes(signal));
  });
  if (!matched) {
    return null;
  }
  return rawText.includes(matched) ? matched : null;
}

function normalizeWhitespace(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function evidenceSentences(rawText: string) {
  return (rawText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [rawText])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedQuoteTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/([a-z0-9])-\s*\n\s*([a-z0-9])/gi, "$1$2")
    .match(/[a-z0-9]+/g) ?? [];
}

function quoteTokenPattern(token: string) {
  return token
    .split("")
    .map(escapeRegExp)
    .join("(?:-\\s*)?");
}

function normalizedSourceQuoteSpan(chunkContent: string, quote: string) {
  const tokens = normalizedQuoteTokens(quote);
  if (tokens.length < 4) return null;
  const separator = "(?:[\\s\\p{P}]+)";
  const expression = new RegExp(`\\b${tokens.map(quoteTokenPattern).join(separator)}\\b`, "iu");
  const match = expression.exec(chunkContent);
  return match?.[0] ?? null;
}

function hasOperativePolicyAction(value: string) {
  return /\b(?:must|shall|will|is required to|are required to|maintains?|requires?|assigns?|responsible for|reviews?|retains?|preserves?|collects?|notifies?|protects?|implements?|approves?)\b/i.test(value);
}

export function isAdministrativeMetadataOnlyQuote(value: string | null | undefined) {
  const text = normalizeWhitespace(value);
  if (!text) return true;
  const administrativeMarker = /\b(?:revision history|version history|change log|release notes?|document control|effective date|policy code|approved initial release|draft circulated|updated (?:ownership|terminology|responsibilities|metadata|formatting)|version\s+\d+(?:\.\d+)?|date\s+change\s+approved by)\b/i;
  return administrativeMarker.test(text) && !hasOperativePolicyAction(text);
}

function normalizeForNegativePosition(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function negativeSignalAppearsAfterPhrase(sentence: string, matchedPhrase: string | null, matchedSignal: string | null) {
  if (!matchedPhrase || !matchedSignal) return false;
  const normalizedSentence = normalizeForNegativePosition(sentence);
  const phraseIndex = normalizedSentence.indexOf(normalizeForNegativePosition(matchedPhrase));
  const signalIndex = normalizedSentence.indexOf(normalizeForNegativePosition(matchedSignal));
  return phraseIndex >= 0 && signalIndex >= phraseIndex;
}

function directSignalAbsenceAfterPhrase(sentence: string, signals: string[]) {
  const normalizedSentence = normalizeForNegativePosition(sentence);
  const absenceMatch = /\b(?:(?:does not|doesn t|do not)\s+(?:fully\s+|completely\s+|adequately\s+|formally\s+)?(?:define|establish|authorize|require|impose|maintain|create|replace|address|include|satisfy|cover|document|specify)|without\s+(?:formal\s+|documented\s+|written\s+)?(?:program|plan|procedure|policy|standard|requirement|notification|reporting|validation|preservation|process)|lacks?|missing|excluded|outside the scope|out of scope|reserved for|delegated to|no\s+(?:formal\s+|documented\s+|written\s+)?(?:program|plan|procedure|policy|standard|requirement|notification|reporting|validation|preservation|process))\b/.exec(normalizedSentence);
  if (!absenceMatch) return null;

  const phraseIndex = absenceMatch.index;
  const matchedSignal = uniqueStrings(signals)
    .map(normalizeForNegativePosition)
    .filter((signal) => signal.length >= 4)
    .find((signal) => normalizedSentence.indexOf(signal, phraseIndex) >= phraseIndex);

  return matchedSignal
    ? {
      isNegativeEvidence: true,
      matchedPhrase: absenceMatch[0].trim(),
      matchedSignal,
    }
    : null;
}

function negativeScopeSignals(requirement: RegSpRequirement) {
  const baseSignals = [
    ...requirement.directSignals,
    ...(requirement.coverageElements ?? []).flatMap((element) => element.signals),
  ];
  if (requirement.id === "customer_notification_unauthorized_access") {
    baseSignals.push("breach notice", "breach notices", "customer breach notice", "customer breach notices");
  }
  if (classifierLegacyRequirementId(requirement.id) === "vendor_incident_handling") {
    baseSignals.push(
      "vendor incident reporting",
      "service provider incident reporting",
      "supplier incident reporting",
      "vendor notification responsibilities",
    );
  }
  return uniqueStrings(baseSignals);
}

function hasExplicitCustomerNotificationNegativeScope(
  sentence: string,
  matchedPhrase: string | null,
) {
  const normalizedSentence = normalizeForNegativePosition(sentence);
  const normalizedPhrase = normalizeForNegativePosition(matchedPhrase);
  const phraseIndex = normalizedPhrase
    ? normalizedSentence.indexOf(normalizedPhrase)
    : -1;
  const notificationScope = [
    /\b(?:customer|consumer|individual|affected customer|affected individual|affected consumer)\s+(?:notification|notice)\b/,
    /\b(?:notification|notice)\s+(?:to|for)\s+(?:affected\s+)?(?:customers?|individuals?|consumers?)\b/,
    /\bnotify\s+(?:affected\s+)?(?:customers?|individuals?|consumers?)\b/,
    /\b(?:customer|consumer|individual)\s+breach\s+notices?\b/,
    /\b(?:notification|notice)\s+(?:duty|obligation|requirement|trigger|determination|timing)\b/,
  ];

  return notificationScope.some((pattern) => {
    const match = pattern.exec(normalizedSentence);
    if (!match) return false;
    if (phraseIndex < 0) return true;
    return Math.abs(match.index - phraseIndex) <= 240;
  });
}

function negativeEvidenceIsRequirementScoped(
  requirement: RegSpRequirement,
  sentence: string,
  matchedPhrase: string | null,
) {
  if (requirement.id !== "customer_notification_unauthorized_access") {
    return true;
  }
  return hasExplicitCustomerNotificationNegativeScope(sentence, matchedPhrase);
}

function detectSentenceScopedNegativeEvidence(
  input: RequirementEvidenceClassifierInput,
): SentenceScopedNegativeEvidence {
  const elementSignals = (input.requirement.coverageElements ?? [])
    .map((element) => ({
      id: element.id,
      signals: uniqueStrings(element.signals),
    }))
    .filter((element) => element.signals.length > 0);

  for (const sentence of evidenceSentences(input.chunkContent)) {
    const matches: SentenceScopedNegativeEvidence[] = [];
    for (const element of elementSignals) {
      const match = detectNegativeEvidence(sentence, element.signals);
      if (
        match.isNegativeEvidence
        && negativeEvidenceIsRequirementScoped(input.requirement, sentence, match.matchedPhrase)
      ) {
        matches.push({ ...match, sentence, elementIds: [element.id] });
      }
    }
    if (matches.length > 0) {
      return matches.find((match) =>
        negativeSignalAppearsAfterPhrase(sentence, match.matchedPhrase, match.matchedSignal),
      ) ?? matches[0];
    }

    const directSignals = negativeScopeSignals(input.requirement);
    const directSignalMatch = detectNegativeEvidence(sentence, directSignals);
    if (
      directSignalMatch.isNegativeEvidence
      && negativeEvidenceIsRequirementScoped(
        input.requirement,
        sentence,
        directSignalMatch.matchedPhrase,
      )
      && (
        negativeSignalAppearsAfterPhrase(
          sentence,
          directSignalMatch.matchedPhrase,
          directSignalMatch.matchedSignal,
        )
        || classifierLegacyRequirementId(input.requirement.id) === "vendor_incident_handling"
      )
    ) {
      return {
        ...directSignalMatch,
        sentence,
        elementIds: input.requirement.requiredElementsForCovered,
      };
    }
    const scopedDirectAbsence = directSignalAbsenceAfterPhrase(sentence, directSignals);
    if (
      scopedDirectAbsence
      && negativeEvidenceIsRequirementScoped(
        input.requirement,
        sentence,
        scopedDirectAbsence.matchedPhrase,
      )
    ) {
      return {
        ...scopedDirectAbsence,
        sentence,
        elementIds: input.requirement.requiredElementsForCovered,
      };
    }

    if (elementSignals.length === 0) {
      const match = detectNegativeEvidence(sentence, input.requirement.directSignals);
      if (match.isNegativeEvidence) {
        return { ...match, sentence, elementIds: [] };
      }
    }
  }

  return {
    isNegativeEvidence: false,
    matchedPhrase: null,
    matchedSignal: null,
    sentence: null,
    elementIds: [],
  };
}

function positiveSupportSentence(
  input: RequirementEvidenceClassifierInput,
  signals: string[],
) {
  const normalizedSignals = uniqueStrings(signals.map(normalize)).filter(Boolean);
  for (const sentence of evidenceSentences(input.chunkContent)) {
    const normalizedSentence = normalize(sentence);
    if (!normalizedSignals.some((signal) => normalizedSentence.includes(signal))) {
      continue;
    }
    if (detectNegativeEvidence(sentence, input.requirement.directSignals).isNegativeEvidence) {
      continue;
    }
    return sentence;
  }
  return null;
}

function sourceSentences(rawText: string) {
  return evidenceSentences(rawText).filter((sentence) => rawText.includes(sentence));
}

function rawSpanForSentences(rawText: string, firstSentence: string, lastSentence: string) {
  const start = rawText.indexOf(firstSentence);
  if (start < 0) return null;
  const end = rawText.indexOf(lastSentence, start);
  if (end < 0) return null;
  const span = rawText.slice(start, end + lastSentence.length).trim();
  return span && rawText.includes(span) ? span : null;
}

// These bounds permit one ordinary policy list while keeping persisted excerpts reviewable.
const MAX_CONTIGUOUS_QUOTE_SPAN_SENTENCES = 8;
const MAX_CONTIGUOUS_QUOTE_SPAN_CHARS = 1_800;
function boundedContiguousCoverageSpans(
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  sentences: string[],
) {
  const candidates: string[] = [];
  for (let startIndex = 0; startIndex < sentences.length; startIndex += 1) {
    const startElements = quoteSupportedElementIds(input, classification, sentences[startIndex]);
    if (startElements.length === 0) continue;

    const finalIndex = Math.min(
      sentences.length,
      startIndex + MAX_CONTIGUOUS_QUOTE_SPAN_SENTENCES,
    );
    for (let endIndex = startIndex + 1; endIndex < finalIndex; endIndex += 1) {
      const span = rawSpanForSentences(
        input.chunkContent,
        sentences[startIndex],
        sentences[endIndex],
      );
      if (!span || span.length > MAX_CONTIGUOUS_QUOTE_SPAN_CHARS) break;

      // An endpoint can depend on the scoped record or policy language that
      // precedes it. Judge coverage from the complete exact-source span.
      const spanElements = quoteSupportedElementIds(input, classification, span);
      if (spanElements.length > startElements.length) candidates.push(span);
    }
  }
  return candidates;
}

function completedSourceQuote(chunkContent: string, quote: string) {
  if (!chunkContent.includes(quote)) return quote;
  const quoteStart = chunkContent.indexOf(quote);
  const quoteEnd = quoteStart + quote.length;
  const overlapping = sourceSentences(chunkContent).filter((sentence) => {
    const sentenceStart = chunkContent.indexOf(sentence);
    const sentenceEnd = sentenceStart + sentence.length;
    return sentenceStart >= 0 && sentenceStart < quoteEnd && sentenceEnd > quoteStart;
  });

  if (overlapping.length === 0) return quote;
  const start = chunkContent.indexOf(overlapping[0]);
  const last = overlapping[overlapping.length - 1];
  const end = chunkContent.indexOf(last, start) + last.length;
  const span = chunkContent.slice(start, end).trim();
  return span || quote;
}

function quoteSignalGroups(
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
) {
  const coverageSignals = (input.requirement.coverageElements ?? [])
    .filter((element) => (classification.covered_elements ?? []).includes(element.id))
    .flatMap((element) => element.signals);
  const negativeSignals = (input.requirement.coverageElements ?? [])
    .filter((element) => [
      ...(classification.missing_elements ?? []),
      ...(classification.vague_elements ?? []),
    ].includes(element.id))
    .flatMap((element) => element.signals);

  return {
    coverage: uniqueStrings(coverageSignals),
    negative: uniqueStrings(negativeSignals),
    direct: uniqueStrings(input.requirement.directSignals ?? []),
    action: uniqueStrings(input.requirement.actionSignals ?? []),
    partial: uniqueStrings(input.requirement.partialSignals ?? []),
  };
}

function quoteWordCount(value: string) {
  return value.match(/[A-Za-z0-9]+/g)?.length ?? 0;
}

function hasAbsenceLanguage(value: string) {
  return /\b(?:does not|doesn['’]?t|do not|does not fully|does not establish|does not define|does not state|does not list|does not require|does not address|does not include|without\s+(?:formal\s+|documented\s+|written\s+|clear\s+|specific\s+)?(?:program|plan|procedure|policy|standard|requirement|notification|reporting|validation|preservation|process|timeline|timing|details)|lacks?|missing|excluded|outside the scope|out of scope|reserved for|delegated to|not intended)\b/i.test(value);
}

function looksLikeHeadingOnly(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/[;:!?]/.test(trimmed)) return false;
  if (trimmed.includes("\n")) return false;
  if (/\b(?:does not|doesn['’]?t|do not|outside the scope|out of scope|lacks?|missing|defined in|established in|handled in|covered in|addressed in|documented in|specified in|reserved for)\b/i.test(trimmed)) {
    return false;
  }
  const hasOperativeVerb = /\b(?:must|shall|should|will|may|maintains?|requires?|defines?|defined|describes?|assigns?|applies?|includes?|provides?|protects?|notifies?|records?|retains?|validates?|confirms?|tracks?|restores?|reviews?|approves?|encrypts?|monitors?|preserves?|collects?|identifies?|assesses?|contains?)\b/i.test(trimmed);
  return !hasOperativeVerb && (quoteWordCount(trimmed) <= 10 || trimmed.includes("/"));
}

function hasDanglingEnding(value: string) {
  return /\b(?:and|or|but|with|including|such as|assigns|requires|defines|includes|provides)\s*$/i.test(value.trim());
}

function classifierLegacyRequirementId(requirementId: string) {
  const legacyIds: Record<string, string> = {
    incident_assessment_containment_control: "unauthorized_access_detection_escalation",
    service_provider_incident_oversight_notice: "vendor_incident_handling",
    safeguards_customer_information: "customer_information_safeguards",
    incident_evidence_log_preservation: "evidence_log_preservation",
    regulator_law_enforcement_notification_coordination: "regulator_law_enforcement_notification",
    response_recovery_remediation_validation: "remediation_recovery_validation",
  };
  return legacyIds[requirementId] ?? requirementId;
}

function coverageElementMatches(
  requirement: RegSpRequirement,
  elementId: string,
  signals: string[],
  text: string,
) {
  const elementIds = (requirement.coverageElements ?? []).map((element) => element.id);
  const requirementSpecific = usesCanonicalOperativeElementModel(requirement.id, elementIds)
    ? requirementSpecificElementMatch(requirement.id, elementId, text)
    : null;
  if (requirementSpecific !== null) return requirementSpecific;
  const normalizedText = normalize(text);
  return signals.some((signal) => {
    const normalizedSignal = normalize(signal);
    return normalizedSignal && normalizedText.includes(normalizedSignal);
  });
}

function extraElementSignals(requirementId: string, elementId: string) {
  const signals: Record<string, Record<string, string[]>> = {
    evidence_log_preservation: {
      incident_materials: [
        "preserving relevant logs",
        "preserve relevant logs",
        "relevant logs are preserved",
        "logs are preserved",
        "retain incident logs",
        "incident materials retained",
        "preserve evidence",
        "preserving evidence",
        "investigation notes",
        "security console exports",
        "volatile information",
        "logs and evidence",
        "investigation materials",
        "investigation materials retained",
        "retain investigation materials",
        "retaining investigation materials",
        "incident records retained",
        "retain incident records",
        "recordkeeping for evidence",
      ],
    },
    remediation_recovery_validation: {
      recovery_steps: [
        "recovery activities",
        "restoring affected services",
        "restore affected services",
        "restoring services",
        "service restoration",
        "business restart",
      ],
      remediation_tracking: [
        "remediation tracking",
        "corrective-action tracking",
        "corrective action tracking",
        "remediation tasks",
        "corrective actions",
        "closure criteria",
      ],
      validation_testing: [
        "validating user access",
        "validating access",
        "validation evidence",
        "validation",
      ],
    },
    customer_information_safeguards: {
      customer_information_scope: [
        "customer information systems",
        "customer information system",
        "customer information repositories",
        "customer information records",
      ],
      safeguards_controls: [
        "access approval",
        "role-based access",
        "multifactor authentication",
        "multi-factor authentication",
        "periodic access review",
        "privileged access review",
        "privileged access logging",
        "change management",
        "encryption in transit",
        "encryption at rest",
        "encrypted",
        "encryption",
      ],
    },
    customer_notification_content: {
      incident_description: [
        "incident description",
        "description of the incident",
        "description of what happened",
        "what happened",
        "plain language",
      ],
      information_involved: [
        "affected information",
        "information involved",
        "information involved when known",
        "sensitive customer information involved",
      ],
      protective_steps: [
        "protective steps",
        "actions customers can take",
        "actions customers can take to protect themselves",
        "account-protection resources",
        "account protection resources",
        "credit monitoring",
        "remediation resources",
      ],
      contact_information: [
        "contact information",
        "contact information for questions",
      ],
    },
    written_compliance_records: {
      compliance_record_scope: [
        "written compliance records",
        "records documenting compliance",
        "records demonstrating implementation",
        "records documenting implementation",
        "compliance review materials",
        "compliance records",
      ],
      notice_determination_records: [
        "notification determinations",
        "notice determinations",
        "incident determinations",
        "customer notices",
        "notice records",
        "incident records",
      ],
      retention_accessibility: [
        "retained",
        "retention",
        "retention schedule",
        "accessible storage",
        "disposal register",
        "certificates of destruction",
      ],
    },
    unauthorized_access_detection_escalation: {
      assesses_scope: [
        "assessment of unauthorized access",
        "assess the nature and scope",
      ],
      customer_information_systems: [
        "affected customer information",
        "affected systems",
        "information types",
      ],
      containment_control: [
        "containment",
        "contain and control",
        "contain the incident",
        "control the incident",
      ],
    },
  };
  return signals[classifierLegacyRequirementId(requirementId)]?.[elementId] ?? [];
}

function elementSignals(requirementId: string, elementId: string, baseSignals: string[]) {
  return uniqueStrings([
    ...baseSignals,
    ...extraElementSignals(requirementId, elementId),
  ]);
}

function quoteSupportedElementIds(
  input: RequirementEvidenceClassifierInput,
  _classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  quote: string,
) {
  const text = quote;
  return (input.requirement.coverageElements ?? [])
    .filter((element) => {
      const signals = elementSignals(input.requirement.id, element.id, element.signals);
      const matches = coverageElementMatches(input.requirement, element.id, signals, text);
      if (
        classifierLegacyRequirementId(input.requirement.id) === "evidence_log_preservation"
        && element.id === "incident_materials"
        && !usesCanonicalOperativeElementModel(
          input.requirement.id,
          (input.requirement.coverageElements ?? []).map((candidate) => candidate.id),
        )
      ) {
        const normalizedText = normalize(text);
        const retentionAction = /\b(?:preserv\w*|retain\w*|maintain\w*)\b/.test(normalizedText);
        const incidentMaterial = /\b(?:logs?|exports?|screenshots?|forensic (?:data|evidence)|investigation (?:materials?|records?|notes)|incident (?:materials?|records?)|security[- ]console exports?|volatile information)\b/.test(normalizedText);
        return retentionAction && incidentMaterial;
      }
      return matches;
    })
    .map((element) => element.id);
}

function hasDirectQuoteAlignment(
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  quote: string,
) {
  const text = normalize(quote);
  const groups = quoteSignalGroups(input, classification);
  const directHits = countSignalMatches(text, groups.direct).count;
  const actionHits = countSignalMatches(text, groups.action).count;
  return directHits > 0 && (actionHits > 0 || quoteSupportedElementIds(input, classification, quote).length > 0);
}

function quoteIsValidForRelationship(
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  quote: string,
) {
  if (!input.chunkContent.includes(quote)) return false;
  if (quoteWordCount(quote) < 5 || looksLikeHeadingOnly(quote) || hasDanglingEnding(quote)) return false;

  if (classification.relationship === "negative_evidence") {
    return detectSentenceScopedNegativeEvidence({
      ...input,
      chunkContent: quote,
    }).isNegativeEvidence;
  }

  if (hasAbsenceLanguage(quote)) return false;
  if (isAdministrativeMetadataOnlyQuote(quote)) return false;

  if (
    input.requirement.id === "customer_notification_content"
    && /\b(?:vendor|service provider|supplier|third party)\b/i.test(quote)
    && countSignalMatches(normalize(quote), [
      ...quoteSignalGroups(input, classification).coverage,
      "notice content",
      "incident description",
      "information involved",
      "sensitive customer information involved",
      "protective steps",
      "affected individuals",
      "fraud alert",
      "credit report",
      "identity theft",
      "contact information",
    ]).count === 0
  ) {
    return false;
  }

  return quoteSupportedElementIds(input, classification, quote).length > 0
    || hasDirectQuoteAlignment(input, classification, quote);
}

function evaluateQuoteCandidate(
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  quote: string,
) {
  const supportedElements = quoteSupportedElementIds(input, classification, quote);
  const requiredElements = input.requirement.requiredElementsForCovered ?? [];
  return {
    quote,
    supportedElements,
    hasFullRequiredCoverage: requiredElements.every((elementId) => supportedElements.includes(elementId)),
    score: scoreQuoteCandidate(quote, input, classification),
  };
}

function scoreQuoteCandidate(
  candidate: string,
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
) {
  const text = normalize(candidate);
  const signals = quoteSignalGroups(input, classification);
  let score = 0;

  if (classification.relationship === "negative_evidence") {
    score += countSignalMatches(text, signals.negative).count * 12;
    score += detectSentenceScopedNegativeEvidence({
      ...input,
      chunkContent: candidate,
    }).isNegativeEvidence ? 20 : 0;
  } else {
    score += quoteSupportedElementIds(input, classification, candidate).length * 25;
    score += countSignalMatches(text, signals.coverage).count * 12;
    score += countSignalMatches(text, signals.direct).count * 8;
    score += countSignalMatches(text, signals.action).count * 4;
    score += countSignalMatches(text, signals.partial).count * 2;
  }

  if (input.requirement.id === "customer_notification_content") {
    const hasContentSignal = countSignalMatches(text, [
      ...signals.coverage,
      ...signals.direct,
    ]).count > 0;
    const vendorOnly = /\b(?:vendor|service provider|supplier|third party)\b/i.test(candidate)
      && !hasContentSignal;
    if (vendorOnly) score -= 40;
  }

  return score;
}

function extractSourceQuote(
  input: RequirementEvidenceClassifierInput,
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
) {
  if (!relationshipRequiresSourceQuote(classification.relationship)) {
    return null;
  }

  if (classification.relationship === "negative_evidence") {
    const negativeEvidence = detectSentenceScopedNegativeEvidence(input);
    if (negativeEvidence.sentence && input.chunkContent.includes(negativeEvidence.sentence)) {
      return negativeEvidence.sentence;
    }
  }

  const sentences = sourceSentences(input.chunkContent);
  const candidates = new Set<string>();
  for (let index = 0; index < sentences.length; index += 1) {
    candidates.add(sentences[index]);
    const next = sentences[index + 1];
    if (next) {
      const span = rawSpanForSentences(input.chunkContent, sentences[index], next);
      if (span) candidates.add(span);
    }
  }
  for (const span of boundedContiguousCoverageSpans(input, classification, sentences)) {
    candidates.add(span);
  }

  const ranked = [...candidates]
    .map((candidate) => ({
      candidate,
      score: scoreQuoteCandidate(candidate, input, classification),
    }))
    .filter((item) =>
      item.score > 0
      && input.chunkContent.includes(item.candidate)
      && quoteIsValidForRelationship(input, classification, item.candidate)
    )
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.candidate.length - right.candidate.length;
    });

  return ranked[0]?.candidate ?? null;
}

export function buildRequirementEvaluationGuidance(requirement: RegSpRequirement) {
  const sharedGuidance = [
    "Classify only the provided retrieved chunk, not the whole document.",
    "A mention of requirement keywords is not proof.",
    "Direct support requires that the chunk explicitly addresses the requirement action.",
    "Do not classify evidence as supports merely because it shares the same broad topic.",
    "Identify which requirement coverage elements are actually proven by this chunk.",
    "If evidence is broad but missing one or more required coverage elements, classify it as partially_supports.",
    "If evidence is related but does not prove a required coverage element, classify it as background_context.",
    "If the chunk says the control is absent, excluded, delegated elsewhere, handled in another policy, or out of scope, classify it as negative_evidence.",
    "Guidance/reference documents may support interpretation, but organization compliance evidence requires organization/client policy, procedure, or contract content.",
    `Coverage elements: ${(requirement.coverageElements ?? []).map((element) => `${element.id}=${element.label}${element.requiredForCovered ? " (required)" : " (optional)"}`).join("; ")}`,
  ];

  const requirementSpecificGuidance: Record<string, string> = {
    written_incident_response_program:
      "Covered support requires a maintained written program that applies to customer information and directly covers detection, response, and recovery. A narrower incident workflow may be partial; provider-notice text alone is not program evidence.",
    unauthorized_access_detection_escalation:
      "Covered support requires direct nature-and-scope assessment, identification of affected customer information systems or information types, and concrete containment/control actions. Coordination language alone is context, not assessment or containment proof.",
    customer_notification_unauthorized_access:
      "Supports only when an operative customer-notice obligation is tied to unauthorized access, unauthorized use, or a breach involving customer information. Management discretion over communications is context only, not a notification trigger or timing requirement.",
    customer_notification_content:
      "Covered support requires the material notice-content categories, identity-protection resources, and clear written delivery requirements. A notice with incident details, contact information, or account-monitoring advice alone may be partial.",
    regulator_law_enforcement_notification:
      "This is supporting-control evidence, not a standalone Reg S-P customer-notice obligation. Supports only incident-specific external-notification decisioning plus legal/compliance coordination or ownership. Contact authority alone is not notification decisioning.",
    vendor_incident_handling:
      "Supports only operative obligations imposed on or governing service providers, vendors, suppliers, or third parties, such as due diligence, monitoring, customer-information safeguards, breach notice to the firm, or 72-hour reporting. An internal owner or coordinator role alone is context only.",
    customer_information_safeguards:
      "Covered support requires administrative, technical, and physical safeguards for customer information. A subset of operative safeguards may be partial; generic security language is context only.",
    disposal_consumer_customer_information:
      "Treat a definite policy scope statement that enumerates multiple stored forms of consumer, customer, or securityholder-linked information as disposal_scope, even when the disposal method is in a separate chunk. Do not infer scope from a title, a bare data inventory, or a discretionary description. Secure disposal methods still require an operative disposal action.",
    written_compliance_records:
      "Treat a maintained archive of current or superseded procedures plus a compliance-record inventory covering multiple safeguards, disposal, incident, determination, notice, delay, or provider categories as operative recordkeeping. Specific retention duration and accessible storage prove retention_accessibility; determinations or copies of security messages/notices prove notice_determination_records. Generic departmental or operational retention remains context only.",
    evidence_log_preservation:
      "This is supporting-control evidence. An accountable direction to preserve relevant logs or communications, or non-discretionary log capture paired with restricted incident/case-folder access, is an operative preservation process. Do not require formal chain-of-custody wording for the optional integrity element. A lone mention of logs, emails, notes, tickets, screenshots, or attachments remains context only.",
    incident_evidence_log_preservation:
      "This is supporting-control evidence. An accountable direction to preserve relevant logs or communications, or non-discretionary log capture paired with restricted incident/case-folder access, is an operative preservation process. Do not require formal chain-of-custody wording for the optional integrity element. A lone mention of logs, emails, notes, tickets, screenshots, or attachments remains context only.",
    remediation_recovery_validation:
      "Covered support requires operative recovery actions, remediation tracking, and validation or closure. Appendix, index, or record-category lists are not a recovery procedure, though they may provide partial context.",
  };

  return [
    ...sharedGuidance,
    requirementSpecificGuidance[requirement.id],
  ].filter(Boolean).join(" ");
}

function heuristicClassificationReason(prefix: string, matched: string[]) {
  const signals = matched.filter(Boolean);
  return signals.length > 0
    ? `${prefix}: ${signals.slice(0, 6).join(", ")}.`
    : prefix;
}

function classifyRequirementEvidenceHeuristicallyInternal(
  input: RequirementEvidenceClassifierInput,
  provider: RequirementEvidenceClassifierProvider = "heuristic",
): RequirementEvidenceClassification {
  const { requirement, chunkContent } = input;
  const text = normalize(chunkContent);
  const negativeEvidence = detectSentenceScopedNegativeEvidence(input);
  const direct = countSignalMatches(text, requirement.directSignals);
  const action = countSignalMatches(text, requirement.actionSignals);
  const partial = countSignalMatches(text, requirement.partialSignals);
  const background = countSignalMatches(text, requirement.backgroundSignals);
  const coverage = assessCoverageElements(requirement, chunkContent);
  const hasExplicitAction = action.count > 0;
  const hasVendorIncidentHandlingContext = requirement.id !== "vendor_incident_handling"
    || (
      hasAnySignal(text, ["vendor", "service provider", "third party", "supplier"])
      && hasAnySignal(text, [
        "incident",
        "breach",
        "notification",
        "notify",
        "report",
        "reporting",
        "escalation",
        "escalate",
        "coordinate",
        "coordination",
        "contract",
        "responsibilities",
        "cooperate",
        "cooperation",
      ])
    );
  const hasCompleteOperativeCoverage = requiresOperativeElementSupport(
    requirement.id,
    (requirement.coverageElements ?? []).map((element) => element.id),
  ) && coverage.missingRequired.length === 0;
  const hasDirectSupportSignals = hasVendorIncidentHandlingContext && (
    (hasExplicitAction && direct.count >= 2)
    || hasCompleteOperativeCoverage
  );
  const positiveSupportQuote = positiveSupportSentence(input, [
    ...direct.matched,
    ...action.matched,
    ...partial.matched,
    ...background.matched,
    ...(requirement.coverageElements ?? []).flatMap((element) =>
      coverage.covered.includes(element.id) ? element.signals : []
    ),
  ]);
  const hasMultipleEvidenceSentences = evidenceSentences(chunkContent).length > 1;

  const hasSeparatePositiveSupportQuote = Boolean(
    positiveSupportQuote
    && hasMultipleEvidenceSentences
    && normalize(positiveSupportQuote) !== normalize(negativeEvidence.sentence)
    && !detectSentenceScopedNegativeEvidence({
      ...input,
      chunkContent: positiveSupportQuote,
    }).isNegativeEvidence,
  );

  if (negativeEvidence.isNegativeEvidence && coverage.covered.length > 0 && positiveSupportQuote && hasSeparatePositiveSupportQuote) {
    const matched = [
      ...direct.matched,
      ...action.matched.slice(0, 2),
      ...partial.matched,
      ...background.matched.slice(0, 1),
    ];
    return {
      relationship: "partially_supports",
      confidence: "medium",
      requirement_supported: false,
      control_absent_or_out_of_scope: false,
      covered_elements: coverage.covered,
      missing_elements: coverage.missingRequired,
      vague_elements: coverage.vague,
      reason:
        heuristicClassificationReason(
          "Partial support signals matched; nearby limitation language was not treated as overriding the supported elements",
          matched,
        ),
      supporting_quote: positiveSupportQuote,
      classifier_provider: provider,
    };
  }

  if (negativeEvidence.isNegativeEvidence) {
    const negatedElements = negativeEvidence.elementIds.length > 0
      ? negativeEvidence.elementIds
      : requirement.requiredElementsForCovered;
    return {
      relationship: "negative_evidence",
      confidence: "high",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: [],
      missing_elements: uniqueStrings(negatedElements),
      vague_elements: coverage.vague,
      reason:
        `Negative evidence: cited text states this requirement is absent, excluded, delegated elsewhere, or out of scope (${negativeEvidence.matchedPhrase} near ${negativeEvidence.matchedSignal}).`,
      supporting_quote: negativeEvidence.sentence ?? sentenceContaining(chunkContent, [
        negativeEvidence.matchedPhrase ?? "",
        negativeEvidence.matchedSignal ?? "",
      ]),
      classifier_provider: provider,
    };
  }

  if (
    requiresOperativeElementSupport(
      requirement.id,
      (requirement.coverageElements ?? []).map((element) => element.id),
    )
    && coverage.covered.length === 0
  ) {
    return {
      relationship: direct.count > 0 || partial.count > 0 || background.count > 0
        ? "background_context"
        : "irrelevant",
      confidence: "medium",
      requirement_supported: false,
      control_absent_or_out_of_scope: false,
      covered_elements: [],
      missing_elements: requirement.requiredElementsForCovered,
      vague_elements: [],
      reason:
        "The cited text is related context, but does not establish an operative requirement-specific obligation.",
      supporting_quote: null,
      classifier_provider: provider,
    };
  }

  if (
    hasDirectSupportSignals &&
    coverage.missingRequired.length === 0
  ) {
    const matched = [...direct.matched, ...action.matched.slice(0, 2)];
    return {
      relationship: "supports",
      confidence: "high",
      requirement_supported: true,
      control_absent_or_out_of_scope: false,
      covered_elements: coverage.covered,
      missing_elements: [],
      vague_elements: coverage.vague,
      reason: heuristicClassificationReason("Direct support signals matched", matched),
      supporting_quote: sentenceContaining(chunkContent, matched),
      classifier_provider: provider,
    };
  }

  if (
    direct.count >= 1 ||
    (hasExplicitAction && partial.count >= 1) ||
    partial.count >= 2 ||
    (partial.count >= 1 && background.count >= 1)
  ) {
    const matched = [
      ...direct.matched,
      ...action.matched.slice(0, 2),
      ...partial.matched,
      ...background.matched.slice(0, 1),
    ];
    return {
      relationship: "partially_supports",
      confidence: "medium",
      requirement_supported: false,
      control_absent_or_out_of_scope: false,
      covered_elements: coverage.covered,
      missing_elements: coverage.missingRequired,
      vague_elements: coverage.vague,
      reason: heuristicClassificationReason("Partial support signals matched", matched),
      supporting_quote: sentenceContaining(chunkContent, matched),
      classifier_provider: provider,
    };
  }

  if (partial.count === 1 || background.count >= 2) {
    const matched = [...partial.matched, ...background.matched];
    return {
      relationship: "background_context",
      confidence: "medium",
      requirement_supported: false,
      control_absent_or_out_of_scope: false,
      covered_elements: coverage.covered,
      missing_elements: coverage.missingRequired,
      vague_elements: coverage.vague,
      reason: heuristicClassificationReason("Background context signals matched", matched),
      supporting_quote: sentenceContaining(chunkContent, matched),
      classifier_provider: provider,
    };
  }

  return {
    relationship: "irrelevant",
    confidence: "low",
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: [],
    missing_elements: requirement.requiredElementsForCovered,
    vague_elements: [],
    reason:
      "Candidate was retrieved semantically, but it does not contain enough requirement-specific support, absence, or context for this classifier.",
    supporting_quote: null,
    classifier_provider: provider,
  };
}

export function classifyRequirementEvidenceHeuristically(
  input: RequirementEvidenceClassifierInput,
  provider: RequirementEvidenceClassifierProvider = "heuristic",
): RequirementEvidenceClassification {
  const classification = classifyRequirementEvidenceHeuristicallyInternal(input, provider);
  const { classifier_provider: classifierProvider, ...withoutProvider } = classification;
  const recovery = recoverRequirementSpecificElementSupport(withoutProvider, input);
  return {
    ...preserveRecoveredElementLevelSupport(
      downgradeUngroundedEvidence(recovery.classification, input),
      recovery.promoteElementLevelSupport,
    ),
    classifier_provider: classifierProvider,
  };
}

function validateRelationship(value: unknown): value is RequirementEvidenceRelationship {
  return [
    "supports",
    "partially_supports",
    "negative_evidence",
    "background_context",
    "irrelevant",
  ].includes(String(value));
}

function validateConfidence(value: unknown): value is RequirementEvidenceConfidence {
  return ["high", "medium", "low"].includes(String(value));
}

function coerceString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function coerceNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeSupportingQuote(quote: string | null, chunkContent: string) {
  if (!quote) {
    return null;
  }
  const trimmed = quote.trim();
  if (chunkContent.includes(trimmed)) return completedSourceQuote(chunkContent, trimmed);

  const normalizedQuote = normalizeWhitespace(trimmed);
  const matched = sourceSentences(chunkContent).find((sentence) =>
    normalizeWhitespace(sentence) === normalizedQuote
    || normalizeWhitespace(sentence).includes(normalizedQuote)
  );
  if (matched) return completedSourceQuote(chunkContent, matched);

  const normalizedSpan = normalizedSourceQuoteSpan(chunkContent, trimmed);
  return normalizedSpan ? completedSourceQuote(chunkContent, normalizedSpan) : null;
}

function relationshipRequiresSourceQuote(relationship: RequirementEvidenceRelationship) {
  return relationship === "supports"
    || relationship === "partially_supports"
    || relationship === "negative_evidence";
}

function downgradeUngroundedEvidence(
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  input: RequirementEvidenceClassifierInput,
): Omit<RequirementEvidenceClassification, "classifier_provider"> {
  if (!relationshipRequiresSourceQuote(classification.relationship)) {
    return classification;
  }

  const sanitizedQuote = sanitizeSupportingQuote(classification.supporting_quote, input.chunkContent);
  const extractedQuote = extractSourceQuote(input, classification);
  const supportingQuote = uniqueStrings([sanitizedQuote, extractedQuote])
    .filter((quote) => quoteIsValidForRelationship(input, classification, quote))
    .map((quote) => evaluateQuoteCandidate(input, classification, quote))
    .sort((left, right) => {
      if (left.hasFullRequiredCoverage !== right.hasFullRequiredCoverage) {
        return left.hasFullRequiredCoverage ? -1 : 1;
      }
      const coverageDelta = right.supportedElements.length - left.supportedElements.length;
      if (coverageDelta !== 0) return coverageDelta;
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.quote.length - right.quote.length;
    })[0];

  if (supportingQuote) {
    if (classification.relationship === "negative_evidence") {
      return {
        ...classification,
        supporting_quote: supportingQuote.quote,
      };
    }

    const supportedElements = supportingQuote.supportedElements;
    if (supportedElements.length === 0) {
      return {
        relationship: "background_context",
        confidence: classification.confidence === "high" ? "medium" : classification.confidence,
        requirement_supported: false,
        control_absent_or_out_of_scope: false,
        covered_elements: [],
        missing_elements: classification.missing_elements,
        vague_elements: classification.vague_elements,
        reason:
          `Downgraded because ${classification.relationship} evidence must align to at least one required element in the exact source quote. ${classification.reason}`,
        supporting_quote: null,
      };
    }

    const missingRequired = input.requirement.requiredElementsForCovered.filter(
      (elementId) => !supportedElements.includes(elementId),
    );
    const relationship = classification.relationship === "supports" && missingRequired.length > 0
      ? "partially_supports"
      : classification.relationship;

    return {
      ...classification,
      relationship,
      requirement_supported: relationship === "supports" && missingRequired.length === 0
        ? classification.requirement_supported
        : false,
      covered_elements: supportedElements,
      missing_elements: uniqueStrings([...classification.missing_elements, ...missingRequired]),
      supporting_quote: supportingQuote.quote,
    };
  }

  return {
    relationship: classification.relationship === "negative_evidence"
      ? "irrelevant"
      : "background_context",
    confidence: classification.confidence === "high" ? "medium" : classification.confidence,
    requirement_supported: false,
    control_absent_or_out_of_scope: false,
    covered_elements: [],
    missing_elements: classification.missing_elements,
    vague_elements: classification.vague_elements,
    reason:
      `Downgraded because ${classification.relationship} evidence must include an exact source quote from the raw cited text. ${classification.reason}`,
    supporting_quote: null,
  };
}

function reasonIsSilenceBasedNegativeEvidence(reason: string) {
  return SILENCE_BASED_NEGATIVE_REASON_PATTERNS.some((pattern) => pattern.test(reason));
}

function reasonInfersAbsence(reason: string) {
  return INFERRED_ABSENCE_REASON_PATTERNS.some((pattern) => pattern.test(reason));
}

function recoverRequirementSpecificElementSupport(
  parsed: Omit<RequirementEvidenceClassification, "classifier_provider">,
  input: RequirementEvidenceClassifierInput,
) {
  if (parsed.relationship === "negative_evidence") {
    return { classification: parsed, promoteElementLevelSupport: false };
  }

  const requirementId = classifierLegacyRequirementId(input.requirement.id);
  if (![
    "disposal_consumer_customer_information",
    "evidence_log_preservation",
    "written_compliance_records",
  ].includes(requirementId)) {
    return { classification: parsed, promoteElementLevelSupport: false };
  }

  const coverage = assessCoverageElements(input.requirement, input.chunkContent);
  if (coverage.covered.length === 0) {
    return { classification: parsed, promoteElementLevelSupport: false };
  }

  const recovered = {
    ...parsed,
    relationship: "supports" as const,
    covered_elements: coverage.covered,
    missing_elements: coverage.missingRequired,
    vague_elements: coverage.vague,
  };
  const supportingQuote = extractSourceQuote(input, recovered);
  if (!supportingQuote) {
    return { classification: parsed, promoteElementLevelSupport: false };
  }

  const fullySupported = coverage.missingRequired.length === 0;
  return {
    classification: {
      ...recovered,
      confidence: parsed.confidence === "high" ? "high" as const : "medium" as const,
      requirement_supported: fullySupported,
      control_absent_or_out_of_scope: false,
      reason:
        "Recovered requirement-specific element support from an exact, operative source quote. " +
        parsed.reason,
      supporting_quote: supportingQuote,
    },
    // Aggregation already requires an exact quote and validates each element. The
    // disposal requirement has intentionally separate scope and method passages,
    // so retain a strict direct proof of either element for that existing ledger.
    promoteElementLevelSupport: !fullySupported
      && shouldPromoteDisposalElementLevelSupport(requirementId, coverage.covered, input.chunkContent),
  };
}

function shouldPromoteDisposalElementLevelSupport(
  requirementId: string,
  coveredElements: string[],
  chunkContent: string,
) {
  if (requirementId !== "disposal_consumer_customer_information") return false;
  if (coveredElements.includes("secure_disposal_method")) return true;
  if (!coveredElements.includes("disposal_scope")) return false;

  const normalized = normalize(chunkContent);
  const inventoryItems = [
    "copies",
    "extracts",
    "reports",
    "screenshots",
    "recordings",
    "backups",
    "replicas",
  ].filter((item) => new RegExp(`\\b${item}\\b`).test(normalized)).length;
  return inventoryItems >= 2
    && /\bwithin scope\b/.test(normalized)
    && /\b(?:linked|related|attributable)\b/.test(normalized)
    && /\b(?:consumer|customer|securityholder)s?\b/.test(normalized);
}

function preserveRecoveredElementLevelSupport(
  classification: Omit<RequirementEvidenceClassification, "classifier_provider">,
  promoteElementLevelSupport: boolean,
): Omit<RequirementEvidenceClassification, "classifier_provider"> {
  if (
    !promoteElementLevelSupport
    || classification.relationship !== "partially_supports"
    || classification.covered_elements.length === 0
    || !classification.supporting_quote
  ) {
    return classification;
  }

  return {
    ...classification,
    relationship: "supports",
    // This is direct proof for its listed element(s). The existing ledger still
    // requires a direct, source-grounded support chunk for every required element
    // before it reports the whole requirement as covered.
    requirement_supported: true,
    reason:
      "Preserved exact, operative element-level support for existing cross-chunk aggregation. " +
      classification.reason,
  };
}

function chunkHasExplicitAbsenceLanguage(input: RequirementEvidenceClassifierInput) {
  return detectSentenceScopedNegativeEvidence(input).isNegativeEvidence;
}

function parseOpenAiClassification(
  body: unknown,
  requirement: RegSpRequirement,
): Omit<RequirementEvidenceClassification, "classifier_provider"> {
  const content = (body as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Classifier returned no JSON content.");
  }
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const relationship = validateRelationship(parsed.relationship)
    ? parsed.relationship
    : "background_context";
  const confidence = validateConfidence(parsed.confidence)
    ? parsed.confidence
    : "low";
  const controlAbsent = Boolean(parsed.control_absent_or_out_of_scope)
    || relationship === "negative_evidence";
  const requirementSupported = relationship === "supports"
    ? Boolean(parsed.requirement_supported)
    : false;

  return {
    relationship,
    confidence,
    requirement_supported: requirementSupported,
    control_absent_or_out_of_scope: controlAbsent,
    covered_elements: sanitizeElementIds(parsed.covered_elements, requirement),
    missing_elements: sanitizeElementIds(parsed.missing_elements, requirement),
    vague_elements: sanitizeElementIds(parsed.vague_elements, requirement),
    reason: coerceString(parsed.reason, "Classifier did not provide a reason."),
    supporting_quote: coerceNullableString(parsed.supporting_quote),
  };
}

export function postProcessOpenAiClassification(
  parsed: Omit<RequirementEvidenceClassification, "classifier_provider">,
  input: RequirementEvidenceClassifierInput,
): Omit<RequirementEvidenceClassification, "classifier_provider"> {
  const explicitAbsence = chunkHasExplicitAbsenceLanguage(input);
  const silenceBasedNegative = reasonIsSilenceBasedNegativeEvidence(parsed.reason);
  const inferredAbsence = reasonInfersAbsence(parsed.reason);
  const supportingQuote = sanitizeSupportingQuote(parsed.supporting_quote, input.chunkContent);
  const parsedCoveredElements = parsed.covered_elements ?? [];
  const parsedMissingElements = parsed.missing_elements ?? [];
  const parsedVagueElements = parsed.vague_elements ?? [];

  if (
    parsed.relationship === "negative_evidence"
    && (!explicitAbsence || silenceBasedNegative || inferredAbsence)
  ) {
    const downgradedNegative = {
      relationship: "irrelevant" as const,
      confidence: parsed.confidence === "high" ? "medium" : parsed.confidence,
      requirement_supported: false,
      control_absent_or_out_of_scope: false,
      covered_elements: parsedCoveredElements,
      missing_elements: uniqueStrings([
        ...parsedMissingElements,
        ...(input.requirement.requiredElementsForCovered ?? []).filter(
          (elementId) => !parsedCoveredElements.includes(elementId),
        ),
      ]),
      vague_elements: parsedVagueElements,
      reason:
        `Downgraded from negative_evidence because absence must be explicit for this requirement and cannot be inferred from silence or adjacent controls. ${parsed.reason}`,
      supporting_quote: null,
    };
    const recovery = recoverRequirementSpecificElementSupport(downgradedNegative, input);
    return preserveRecoveredElementLevelSupport(
      downgradeUngroundedEvidence(recovery.classification, input),
      recovery.promoteElementLevelSupport,
    );
  }

  if (
    parsed.relationship === "negative_evidence"
    && parsedCoveredElements.length > 0
    && (!supportingQuote || !detectNegativeEvidence(supportingQuote, input.requirement.directSignals).isNegativeEvidence)
  ) {
    return downgradeUngroundedEvidence({
      relationship: "partially_supports",
      confidence: parsed.confidence === "high" ? "medium" : parsed.confidence,
      requirement_supported: false,
      control_absent_or_out_of_scope: false,
      covered_elements: parsedCoveredElements,
      missing_elements: uniqueStrings([
        ...parsedMissingElements,
        ...(input.requirement.requiredElementsForCovered ?? []).filter(
          (elementId) => !parsedCoveredElements.includes(elementId),
        ),
      ]),
      vague_elements: parsedVagueElements,
      reason:
        `Downgraded from negative_evidence because the cited client text supports required elements and the supporting quote is not explicit absence language. ${parsed.reason}`,
      supporting_quote: supportingQuote,
    }, input);
  }

  const recovery = recoverRequirementSpecificElementSupport(parsed, input);
  const recovered = recovery.classification;
  const recoveredCoveredElements = recovered.covered_elements ?? [];
  const requiredMissing = (input.requirement.requiredElementsForCovered ?? []).filter(
    (elementId) => !recoveredCoveredElements.includes(elementId),
  );
  const relationship = recovered.relationship === "supports" && requiredMissing.length > 0
    ? "partially_supports"
    : recovered.relationship;

  return preserveRecoveredElementLevelSupport(downgradeUngroundedEvidence({
    ...recovered,
    relationship,
    requirement_supported: relationship === "supports" && requiredMissing.length === 0
      ? recovered.requirement_supported
      : false,
    control_absent_or_out_of_scope: explicitAbsence
      ? recovered.control_absent_or_out_of_scope
      : false,
    covered_elements: recoveredCoveredElements,
    missing_elements: uniqueStrings([...(recovered.missing_elements ?? []), ...requiredMissing]),
    vague_elements: recovered.vague_elements ?? [],
    supporting_quote: recovered.supporting_quote,
  }, input), recovery.promoteElementLevelSupport);
}

export function buildRequirementEvidenceClassifierPrompt(input: RequirementEvidenceClassifierInput) {
  return {
    system:
      "You classify one retrieved evidence chunk for a Reg S-P compliance review debug tool. Return only valid JSON. Do not infer facts outside the chunk. Do not treat keyword mentions as proof.",
    user: [
      "Requirement:",
      `${input.requirement.title} (${input.requirement.id})`,
      input.requirement.description,
      "",
      "Evaluation guidance:",
      input.evaluationGuidance,
      "",
      "Chunk metadata:",
      JSON.stringify({
        filename: input.chunkMetadata.filename,
        section_path: input.chunkMetadata.sectionPath,
        page_start: input.chunkMetadata.pageStart,
        page_end: input.chunkMetadata.pageEnd,
        chunk_index: input.chunkMetadata.chunkIndex,
        source_type: input.chunkMetadata.sourceType,
        evidence_role: input.chunkMetadata.evidenceRole,
        evidence_reason: input.chunkMetadata.evidenceReason,
      }, null, 2),
      "",
      "Classify whether this chunk proves the requirement, partially supports it, contradicts it or says it is absent/out of scope, merely provides background context, or is irrelevant.",
      "Coverage elements to evaluate:",
      JSON.stringify(input.requirement.coverageElements ?? [], null, 2),
      "Return covered_elements as the IDs of elements actually proven by the chunk.",
      "Return missing_elements as required element IDs that are not proven by the chunk.",
      "Return vague_elements as element IDs mentioned only in broad or ambiguous terms.",
      "Do not return supports unless all requiredElementsForCovered are proven by the chunk.",
      "Use negative_evidence narrowly: only when the chunk explicitly states that the requirement/control is absent, excluded, not defined, not required, not established, delegated elsewhere, reserved for another policy/team, or outside the document scope.",
      "A chunk that merely does not mention the requirement is irrelevant, not negative_evidence.",
      "Do not infer absence from silence.",
      "Do not mark control_absent_or_out_of_scope true unless the chunk explicitly says the control is absent, excluded, delegated, reserved elsewhere, or out of scope.",
      "Classify explicit absence/delegation/exclusion/out-of-scope language as negative_evidence. Examples: this procedure does not fully define customer notification; customer notification is handled in a separate policy; this document excludes law enforcement reporting; vendor incident reporting is outside the scope of this procedure; this addendum does not replace internal incident response procedures.",
      "supporting_quote must be an exact substring copied from the chunk text. If there is no exact quote, set supporting_quote to null. Do not invent or paraphrase quotes.",
      "Use relationship exactly as one of: supports, partially_supports, negative_evidence, background_context, irrelevant.",
      "Use confidence exactly as one of: high, medium, low.",
      "Set requirement_supported true only when the chunk itself explicitly supports the requirement action.",
      "Set control_absent_or_out_of_scope true when the chunk says the requirement is absent, excluded, delegated elsewhere, or out of scope.",
      "Return JSON with keys: relationship, confidence, requirement_supported, control_absent_or_out_of_scope, covered_elements, missing_elements, vague_elements, reason, supporting_quote.",
      "",
      "Chunk text:",
      input.chunkContent.slice(0, 6000),
    ].join("\n"),
  };
}

export function createRequirementEvidenceClassifier(
  environment: ClassifierEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch,
  workspacePolicy?: WorkspaceExternalAiProcessingPolicy,
  telemetry?: RequirementEvidenceClassifierTelemetry,
  runtime: RequirementEvidenceClassifierRuntime = {},
): RequirementEvidenceClassifier {
  const requestedProvider = (environment.REQUIREMENT_CLASSIFIER_PROVIDER ?? "heuristic")
    .trim()
    .toLowerCase();

  if (requestedProvider !== "openai") {
    telemetry?.recordResolvedClassifier?.({ provider: "heuristic", model: null });
    return {
      provider: "heuristic",
      async classify(input) {
        telemetry?.recordPath?.("heuristic_disabled");
        return classifyRequirementEvidenceHeuristically(input, "heuristic");
      },
    };
  }

  const externalAiPolicy = createWorkspaceExternalAiProcessingPolicy({
    workspaceId: workspacePolicy?.workspaceId,
    workspaceConsentEnabled: workspacePolicy?.workspaceConsentEnabled,
    environment,
  });
  if (!externalAiPolicy.externalAiClassifierEnabled) {
    telemetry?.recordResolvedClassifier?.({ provider: "fallback", model: null });
    return {
      provider: "fallback",
      async classify(input) {
        telemetry?.recordPath?.("heuristic_unconfigured");
        const fallback = classifyRequirementEvidenceHeuristically(input, "fallback");
        return {
          ...fallback,
          reason:
            "LLM classifier was requested but external AI classification is disabled by workspace and server policy. " +
            fallback.reason,
        };
      },
    };
  }

  const model = environment.REQUIREMENT_CLASSIFIER_MODEL?.trim();
  const apiKey = environment.REQUIREMENT_CLASSIFIER_API_KEY?.trim()
    || environment.OPENAI_API_KEY?.trim();

  if (!model || !apiKey) {
    telemetry?.recordResolvedClassifier?.({ provider: "fallback", model: null });
    return {
      provider: "fallback",
      async classify(input) {
        telemetry?.recordPath?.("heuristic_unconfigured");
        const fallback = classifyRequirementEvidenceHeuristically(input, "fallback");
        return {
          ...fallback,
          reason:
            "LLM classifier was requested but REQUIREMENT_CLASSIFIER_MODEL or REQUIREMENT_CLASSIFIER_API_KEY/OPENAI_API_KEY is missing. " +
            fallback.reason,
        };
      },
    };
  }

  telemetry?.recordResolvedClassifier?.({ provider: "openai", model });
  return {
    provider: "openai",
    async classify(input) {
      const heuristicGuardrail = classifyRequirementEvidenceHeuristically(input, "heuristic");
      if (heuristicGuardrail.relationship === "negative_evidence") {
        telemetry?.recordPath?.("heuristic_negative_guardrail");
        return {
          ...heuristicGuardrail,
          classifier_provider: "heuristic",
          reason: `Heuristic negative-evidence guardrail applied before LLM classification. ${heuristicGuardrail.reason}`,
        };
      }

      const prompt = buildRequirementEvidenceClassifierPrompt(input);
      const now = runtime.now ?? (() => Date.now());
      const sleep = runtime.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
      const random = runtime.random ?? Math.random;
      const requestStartedAt = now();
      const promptCharacters = prompt.system.length + prompt.user.length;
      const providerFailure = ({
        httpStatus,
        errorCategory,
        retryAfter,
        requestAttempt,
      }: {
        httpStatus: number | null;
        errorCategory: RequirementEvidenceClassifierProviderFailureCategory;
        retryAfter: string | null;
        requestAttempt: number;
      }) => {
        const event: RequirementEvidenceClassifierProviderFailureEvent = {
          caseId: input.evaluationCaseId ?? null,
          requirementId: input.requirement.id,
          candidateChunkId: input.candidateChunkId ?? null,
          httpStatus,
          errorCategory,
          elapsedMs: Math.max(0, now() - requestStartedAt),
          requestAttempt,
          promptCharacters,
          model: model.slice(0, 128),
          retryAfter,
        };
        telemetry?.recordPath?.("fallback_provider_error");
        telemetry?.recordProviderFailure?.(event);
        if (telemetry?.strictProviderFailures) {
          throw new RequirementEvidenceClassifierProviderFailureError(event);
        }
        return {
          ...classifyRequirementEvidenceHeuristically(input, "fallback"),
          reason:
            "LLM classifier failed or returned invalid output; deterministic heuristic fallback was used.",
        };
      };

      const retryProviderRequest = async ({
        httpStatus,
        errorCategory,
        retryAfter,
        requestAttempt,
      }: {
        httpStatus: number | null;
        errorCategory: RequirementEvidenceClassifierProviderFailureCategory;
        retryAfter: string | null;
        requestAttempt: number;
      }) => {
        if (!isRetryableProviderFailure({ httpStatus, errorCategory }) || requestAttempt >= CLASSIFIER_MAX_ATTEMPTS) {
          return false;
        }
        const retryDelay = retryDelayMs({ attempt: requestAttempt, retryAfter, now, random });
        telemetry?.recordProviderRetry?.({
          caseId: input.evaluationCaseId ?? null,
          requirementId: input.requirement.id,
          candidateChunkId: input.candidateChunkId ?? null,
          httpStatus,
          errorCategory,
          elapsedMs: Math.max(0, now() - requestStartedAt),
          requestAttempt,
          promptCharacters,
          model: model.slice(0, 128),
          retryAfter,
          retryDelayMs: retryDelay,
        });
        await sleep(retryDelay);
        return true;
      };

      for (let requestAttempt = 1; requestAttempt <= CLASSIFIER_MAX_ATTEMPTS; requestAttempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
        try {
          const response = await fetchImplementation(OPENAI_CHAT_COMPLETIONS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: prompt.system },
                { role: "user", content: prompt.user },
              ],
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            const httpStatus = httpStatusForFailure(response);
            const errorCategory = providerFailureCategoryForHttpStatus(httpStatus);
            const retryAfter = retryAfterForFailure(response);
            if (await retryProviderRequest({ httpStatus, errorCategory, retryAfter, requestAttempt })) continue;
            return providerFailure({ httpStatus, errorCategory, retryAfter, requestAttempt });
          }

          try {
            const parsed = postProcessOpenAiClassification(
              parseOpenAiClassification(await response.json(), input.requirement),
              input,
            );
            telemetry?.recordPath?.("openai_success");
            return {
              ...parsed,
              classifier_provider: "openai",
            };
          } catch {
            telemetry?.recordPath?.("fallback_parse_error");
            return {
              ...classifyRequirementEvidenceHeuristically(input, "fallback"),
              reason:
                "LLM classifier failed or returned invalid output; deterministic heuristic fallback was used.",
            };
          }
        } catch (error) {
          if (error instanceof RequirementEvidenceClassifierProviderFailureError) throw error;
          const httpStatus = null;
          const errorCategory = providerFailureCategoryForThrownError(error);
          const retryAfter = null;
          if (await retryProviderRequest({ httpStatus, errorCategory, retryAfter, requestAttempt })) continue;
          return providerFailure({ httpStatus, errorCategory, retryAfter, requestAttempt });
        } finally {
          clearTimeout(timeout);
        }
      }

      return providerFailure({
        httpStatus: null,
        errorCategory: "unknown",
        retryAfter: null,
        requestAttempt: CLASSIFIER_MAX_ATTEMPTS,
      });
    },
  };
}

export function classifierInputForChunk(
  requirement: RegSpRequirement,
  chunk: RetrievedChunk,
  telemetryContext: { caseId?: string | null } = {},
): RequirementEvidenceClassifierInput {
  return {
    requirement,
    evaluationGuidance: buildRequirementEvaluationGuidance(requirement),
    chunkContent: chunk.content_preview ?? "",
    candidateChunkId: chunk.chunk_id,
    evaluationCaseId: telemetryContext.caseId ?? null,
    chunkMetadata: {
      filename: chunk.filename ?? null,
      sectionPath: chunk.section_path ?? null,
      pageStart: chunk.page_start ?? null,
      pageEnd: chunk.page_end ?? null,
      chunkIndex: chunk.chunk_index,
      sourceType: chunk.source_type,
      evidenceRole: chunk.evidence_role,
      evidenceReason: chunk.evidence_reason ?? null,
    },
  };
}
