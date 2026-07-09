import type { DocumentSourceType, EvidenceRole } from "./documentSource";
import {
  isExternalAiClassifierEnabled,
  isExternalAiProcessingEnabled,
} from "./aiProcessingPolicy";
import { detectNegativeEvidence } from "./negativeEvidence";
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

export type RequirementEvidenceClassifierInput = {
  requirement: RegSpRequirement;
  evaluationGuidance: string;
  chunkContent: string;
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

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const CLASSIFIER_TIMEOUT_MS = 30_000;
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
    .filter((element) =>
      element.signals.some((signal) => {
        const normalizedSignal = normalize(signal);
        return normalizedSignal && text.includes(normalizedSignal);
      }),
    )
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

function evidenceSentences(rawText: string) {
  return (rawText.match(/[^.!?]+[.!?]?/g) ?? [rawText])
    .flatMap((sentence) => sentence.split("\n"))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function detectSentenceScopedNegativeEvidence(
  input: RequirementEvidenceClassifierInput,
) {
  const signals = [...input.requirement.directSignals];
  for (const sentence of evidenceSentences(input.chunkContent)) {
    const match = detectNegativeEvidence(sentence, signals);
    if (match.isNegativeEvidence) {
      return { ...match, sentence };
    }
  }

  const metadataMatch = detectNegativeEvidence([
    input.chunkMetadata.sectionPath,
    input.chunkMetadata.evidenceReason,
  ].filter(Boolean).join(" "), signals);
  return { ...metadataMatch, sentence: null };
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
      "Supports when the chunk shows a maintained written incident/cyber event response program, plan, policy, standard, or procedure with ownership, approval, review, roles, escalation, notice, evidence, remediation, or recovery responsibilities.",
    unauthorized_access_detection_escalation:
      "Supports when the chunk describes assessing the nature and scope of unauthorized access or use of customer information, identifying affected customer information systems or information types, escalating the incident, or taking containment and control steps.",
    customer_notification_unauthorized_access:
      "Supports when the chunk describes notifying affected customers, individuals, people, consumers, or clients after unauthorized access/use of sensitive customer information, especially with timing such as as soon as practicable or no later than 30 days and a substantial harm or inconvenience trigger.",
    customer_notification_content:
      "Supports when the chunk defines customer notice contents such as incident description, type of sensitive customer information, incident date or date range, contact information, account review, fraud alerts, credit reports, identity theft resources, or FTC/usa.gov guidance.",
    regulator_law_enforcement_notification:
      "This is supporting-control evidence, not a standalone Reg S-P customer-notice obligation. Supports when the chunk describes legal/compliance coordination for regulator, law enforcement, supervisory, contractual, Attorney General delay, public-safety, or national-security notification decisions.",
    vendor_incident_handling:
      "Supports when the chunk imposes service-provider, vendor, supplier, or third-party customer-information protection, due diligence, monitoring, breach notice to the firm, 72-hour reporting, cooperation, coordination, contract, investigation, remediation, or recovery obligations.",
    customer_information_safeguards:
      "Supports when the chunk describes administrative, technical, or physical safeguards protecting customer records and information, including authentication, encryption, monitoring, least privilege, access controls, vendor controls, or physical protections.",
    disposal_consumer_customer_information:
      "Supports when the chunk describes proper disposal, secure destruction, media sanitization, shredding, wiping, deletion, or disposal-vendor controls for consumer information or customer information.",
    written_compliance_records:
      "Supports when the chunk requires written records documenting safeguards or disposal compliance, incident-response determinations, customer-notice determinations, Attorney General delay documentation, copies of notices, policy versions, retention periods, or accessible storage.",
    evidence_log_preservation:
      "This is supporting-control evidence. Supports when the chunk describes collecting, preserving, retaining, or maintaining logs, evidence, incident records, forensic data, chain of custody, or investigation files.",
    remediation_recovery_validation:
      "Supports when the chunk describes recovery from unauthorized access or use, remediation tracking, corrective actions, validation, repeated testing, recovery assurance, restored asset verification, lessons learned, or post-incident review.",
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

export function classifyRequirementEvidenceHeuristically(
  input: RequirementEvidenceClassifierInput,
  provider: RequirementEvidenceClassifierProvider = "heuristic",
): RequirementEvidenceClassification {
  const { requirement, chunkContent } = input;
  const text = normalize([
    input.chunkMetadata.filename,
    input.chunkMetadata.sectionPath,
    input.chunkMetadata.evidenceReason,
    chunkContent,
  ].filter(Boolean).join(" "));
  const negativeEvidence = detectSentenceScopedNegativeEvidence(input);
  const direct = countSignalMatches(text, requirement.directSignals);
  const action = countSignalMatches(text, requirement.actionSignals);
  const partial = countSignalMatches(text, requirement.partialSignals);
  const background = countSignalMatches(text, requirement.backgroundSignals);
  const coverage = assessCoverageElements(requirement, text);
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
  const hasDirectSupportSignals = hasExplicitAction && hasVendorIncidentHandlingContext && direct.count >= 2;
  const positiveSupportQuote = positiveSupportSentence(input, [
    ...direct.matched,
    ...action.matched,
    ...partial.matched,
    ...background.matched,
    ...(requirement.coverageElements ?? []).flatMap((element) =>
      coverage.covered.includes(element.id) ? element.signals : []
    ),
  ]);

  if (negativeEvidence.isNegativeEvidence && coverage.covered.length > 0 && positiveSupportQuote) {
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
    return {
      relationship: "negative_evidence",
      confidence: "high",
      requirement_supported: false,
      control_absent_or_out_of_scope: true,
      covered_elements: coverage.covered,
      missing_elements: coverage.missingRequired,
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
  return chunkContent.includes(trimmed) ? trimmed : null;
}

function reasonIsSilenceBasedNegativeEvidence(reason: string) {
  return SILENCE_BASED_NEGATIVE_REASON_PATTERNS.some((pattern) => pattern.test(reason));
}

function reasonInfersAbsence(reason: string) {
  return INFERRED_ABSENCE_REASON_PATTERNS.some((pattern) => pattern.test(reason));
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
    return {
      relationship: "irrelevant",
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
  }

  if (
    parsed.relationship === "negative_evidence"
    && parsedCoveredElements.length > 0
    && (!supportingQuote || !detectNegativeEvidence(supportingQuote, input.requirement.directSignals).isNegativeEvidence)
  ) {
    return {
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
    };
  }

  const requiredMissing = (input.requirement.requiredElementsForCovered ?? []).filter(
    (elementId) => !parsedCoveredElements.includes(elementId),
  );
  const relationship = parsed.relationship === "supports" && requiredMissing.length > 0
    ? "partially_supports"
    : parsed.relationship;

  return {
    ...parsed,
    relationship,
    requirement_supported: relationship === "supports" && requiredMissing.length === 0
      ? parsed.requirement_supported
      : false,
    control_absent_or_out_of_scope: explicitAbsence
      ? parsed.control_absent_or_out_of_scope
      : false,
    covered_elements: parsedCoveredElements,
    missing_elements: uniqueStrings([...parsedMissingElements, ...requiredMissing]),
    vague_elements: parsedVagueElements,
    supporting_quote: supportingQuote,
  };
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
): RequirementEvidenceClassifier {
  const requestedProvider = (environment.REQUIREMENT_CLASSIFIER_PROVIDER ?? "heuristic")
    .trim()
    .toLowerCase();

  if (requestedProvider !== "openai") {
    return {
      provider: "heuristic",
      async classify(input) {
        return classifyRequirementEvidenceHeuristically(input, "heuristic");
      },
    };
  }

  if (!isExternalAiProcessingEnabled(environment) || !isExternalAiClassifierEnabled(environment)) {
    return {
      provider: "fallback",
      async classify(input) {
        const fallback = classifyRequirementEvidenceHeuristically(input, "fallback");
        return {
          ...fallback,
          reason:
            "LLM classifier was requested but external AI classification is disabled by server policy. " +
            fallback.reason,
        };
      },
    };
  }

  const model = environment.REQUIREMENT_CLASSIFIER_MODEL?.trim();
  const apiKey = environment.REQUIREMENT_CLASSIFIER_API_KEY?.trim()
    || environment.OPENAI_API_KEY?.trim();

  if (!model || !apiKey) {
    return {
      provider: "fallback",
      async classify(input) {
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

  return {
    provider: "openai",
    async classify(input) {
      const heuristicGuardrail = classifyRequirementEvidenceHeuristically(input, "heuristic");
      if (heuristicGuardrail.relationship === "negative_evidence") {
        return {
          ...heuristicGuardrail,
          classifier_provider: "heuristic",
          reason: `Heuristic negative-evidence guardrail applied before LLM classification. ${heuristicGuardrail.reason}`,
        };
      }

      const prompt = buildRequirementEvidenceClassifierPrompt(input);
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
          throw new Error(`Classifier provider returned status ${response.status}.`);
        }

        const parsed = postProcessOpenAiClassification(
          parseOpenAiClassification(await response.json(), input.requirement),
          input,
        );
        return {
          ...parsed,
          classifier_provider: "openai",
        };
      } catch {
        return {
          ...classifyRequirementEvidenceHeuristically(input, "fallback"),
          reason:
            "LLM classifier failed or returned invalid output; deterministic heuristic fallback was used.",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function classifierInputForChunk(
  requirement: RegSpRequirement,
  chunk: RetrievedChunk,
): RequirementEvidenceClassifierInput {
  return {
    requirement,
    evaluationGuidance: buildRequirementEvaluationGuidance(requirement),
    chunkContent: chunk.content_preview ?? "",
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
