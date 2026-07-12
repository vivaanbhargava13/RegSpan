import type { GradedEvidenceChunk } from "./requirementMatching";
import type { RegSpRequirement, RegSpRequirementId } from "./regSpRequirements";

export type FindingStatus = "covered" | "partial" | "missing" | "conflicting" | "needs_review";
export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type FindingConfidence = "high" | "medium" | "low";
export type NegativeEvidenceScope = "organization_level_negative" | "document_scope_limitation";

export type GeneratedFindingEvidence = {
  chunk_id: string | null;
  document_id: string | null;
  relationship: GradedEvidenceChunk["evidence_relationship"];
  quote: string | null;
  evidence_quote?: string | null;
  source_quote?: string | null;
  reason: string;
  confidence: GradedEvidenceChunk["classifier_confidence"];
  filename: string | null;
  page_start: number | null;
  page_end: number | null;
  section_path: string | null;
  chunk_index: number | null;
};

export type GeneratedRequirementFinding = {
  requirement_id: RegSpRequirementId;
  requirement_name: string;
  status: FindingStatus;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  summary: string;
  remediation: string;
  rationale: string;
  evidence: GeneratedFindingEvidence[];
};

type ElementCoverageRelationship = "supports" | "partially_supports" | "negative_evidence" | "missing";

type ElementCoverageLedgerEntry = {
  required_element_id: string;
  relationship: ElementCoverageRelationship;
  supportChunk: GradedEvidenceChunk | null;
  negativeChunk: GradedEvidenceChunk | null;
  quote: string | null;
  chunk_id: string | null;
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
  confidence: FindingConfidence;
};

type TextSpan = {
  text: string;
  start: number;
  end: number;
};

const highImpactRequirements = new Set<RegSpRequirementId>([
  "written_incident_response_program",
  "incident_assessment_containment_control",
  "unauthorized_access_detection_escalation",
  "customer_notification_unauthorized_access",
  "customer_notification_content",
  "service_provider_incident_oversight_notice",
  "vendor_incident_handling",
  "safeguards_customer_information",
  "customer_information_safeguards",
  "disposal_consumer_customer_information",
  "written_compliance_records",
  "response_recovery_remediation_validation",
  "remediation_recovery_validation",
]);

const legacyRequirementIdsByControlKey: Partial<Record<RegSpRequirementId, RegSpRequirementId>> = {
  incident_assessment_containment_control: "unauthorized_access_detection_escalation",
  service_provider_incident_oversight_notice: "vendor_incident_handling",
  safeguards_customer_information: "customer_information_safeguards",
  incident_evidence_log_preservation: "evidence_log_preservation",
  regulator_law_enforcement_notification_coordination: "regulator_law_enforcement_notification",
  response_recovery_remediation_validation: "remediation_recovery_validation",
};

function copyRequirementId(requirement: RegSpRequirement): RegSpRequirementId {
  return legacyRequirementIdsByControlKey[requirement.id] ?? requirement.id;
}

function organizationEvidence(chunks: GradedEvidenceChunk[]) {
  return chunks.filter((chunk) => chunk.evidence_role === "organization_evidence");
}

function isDirectSupport(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "supports" && chunk.requirement_supported;
}

function isPartialSupport(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "partially_supports";
}

function isBackgroundContext(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "background_context";
}

function isExplicitNegativeEvidence(chunk: GradedEvidenceChunk) {
  return chunk.evidence_relationship === "negative_evidence"
    && chunk.control_absent_or_out_of_scope;
}

function quoteWordCount(value: string) {
  return value.match(/[A-Za-z0-9]+/g)?.length ?? 0;
}

function trimSpan(rawText: string, start: number, end: number): TextSpan | null {
  let trimmedStart = start;
  let trimmedEnd = end;
  while (trimmedStart < trimmedEnd && /\s/.test(rawText[trimmedStart])) trimmedStart += 1;
  while (trimmedEnd > trimmedStart && /\s/.test(rawText[trimmedEnd - 1])) trimmedEnd -= 1;
  const text = rawText.slice(trimmedStart, trimmedEnd);
  return text ? { text, start: trimmedStart, end: trimmedEnd } : null;
}

function sourceSentenceSpans(rawText: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const sentencePattern = /[^.!?]+[.!?]/g;
  for (const sentenceMatch of rawText.matchAll(sentencePattern)) {
    const sentenceStart = sentenceMatch.index ?? 0;
    const span = trimSpan(rawText, sentenceStart, sentenceStart + sentenceMatch[0].length);
    if (span) spans.push(trimHeadingBoundaryLines(span));
  }
  return spans;
}

function trimHeadingBoundaryLines(span: TextSpan): TextSpan {
  const linePattern = /[^\n]+/g;
  const lines = [...span.text.matchAll(linePattern)]
    .map((lineMatch) => {
      const start = span.start + (lineMatch.index ?? 0);
      return trimSpan(span.text, lineMatch.index ?? 0, (lineMatch.index ?? 0) + lineMatch[0].length)
        ? {
          text: lineMatch[0].trim(),
          start,
          end: start + lineMatch[0].length,
        }
        : null;
    })
    .filter((line): line is TextSpan => Boolean(line));

  let first = 0;
  let last = lines.length - 1;
  while (first <= last && looksLikeHeadingOnly(lines[first].text)) {
    const nextLine = lines[first + 1]?.text ?? "";
    const wrapsIntoNextLine = !endsAtSentenceBoundary(lines[first].text)
      && Boolean(nextLine)
      && (/\b(?:a|an|the|and|or|to|of|for|with|in|on|at|by|from|during|after|before|unless|where|when)$/i.test(lines[first].text)
        || /^[a-z]/.test(nextLine));
    if (wrapsIntoNextLine) break;
    first += 1;
  }
  while (last >= first && looksLikeHeadingOnly(lines[last].text)) last -= 1;
  if (first > last) return span;
  return trimSpan(span.text, lines[first].start - span.start, lines[last].end - span.start)
    ? {
      text: span.text.slice(lines[first].start - span.start, lines[last].end - span.start).trim(),
      start: lines[first].start,
      end: lines[last].end,
    }
    : span;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sourceSpanForQuote(rawText: string, quote: string | null | undefined): TextSpan | null {
  const trimmed = quote?.trim();
  if (!trimmed) return null;
  const exactStart = rawText.indexOf(trimmed);
  if (exactStart >= 0) {
    return trimSpan(rawText, exactStart, exactStart + trimmed.length);
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const normalizedWhitespacePattern = new RegExp(tokens.map(escapeRegExp).join("\\s+"));
  const match = normalizedWhitespacePattern.exec(rawText);
  if (!match || match.index === undefined) return null;
  return trimSpan(rawText, match.index, match.index + match[0].length);
}

function expandedSentenceSpan(rawText: string, span: TextSpan): TextSpan {
  const sentences = sourceSentenceSpans(rawText);
  const overlapping = sentences.filter((sentence) =>
    sentence.start < span.end && sentence.end > span.start
  );
  if (overlapping.length === 0) return span;
  const first = overlapping[0];
  const last = overlapping[overlapping.length - 1];
  return trimSpan(rawText, first.start, last.end) ?? span;
}

function sourceSpanBetween(rawText: string, first: TextSpan, last: TextSpan) {
  return trimSpan(rawText, first.start, last.end);
}

function looksLikeHeadingOnly(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/[.!?]$/.test(trimmed)) return false;
  if (/[;:!?]/.test(trimmed)) return false;
  if (trimmed.includes("\n")) return false;
  if (/\b(?:does not|doesn['’]?t|do not|outside the scope|out of scope|lacks?|missing|defined in|established in|handled in|covered in|addressed in|documented in|specified in|reserved for)\b/i.test(trimmed)) {
    return false;
  }
  const hasOperativeVerb = /\b(?:must|shall|should|will|may|maintains?|requires?|defines?|defined|describes?|assigns?|applies?|includes?|provides?|protects?|notifies?|records?|retains?|validates?|confirms?|tracks?|restores?|reviews?|approves?|encrypts?|monitors?|preserves?|collects?|identifies?|assesses?|contains?)\b/i.test(trimmed);
  return !hasOperativeVerb && (quoteWordCount(trimmed) <= 10 || trimmed.includes("/"));
}

function hasDanglingEnding(value: string) {
  return /\b(?:and|or|but|with|including|such as|assigns|requires|defines|includes|provides|for|of|to|approved)\s*$/i.test(value.trim());
}

function hasAbsenceLanguage(value: string) {
  return /\b(?:does not|doesn['’]?t|do not|does not fully|does not establish|does not define|does not state|does not list|does not require|does not address|does not include|without\s+(?:formal\s+|documented\s+|written\s+|clear\s+|specific\s+)?(?:program|plan|procedure|policy|standard|requirement|notification|reporting|validation|preservation|process|timeline|timing|details)|lacks?|missing|excluded|outside the scope|out of scope|reserved for|delegated to|not intended|incomplete|not standardized)\b/i.test(value);
}

function startsWithContinuationFragment(value: string) {
  return /^(?:and|or|but|while|when|where|because|including|such as|with|to|for|of|as)\b/.test(value.trim());
}

function startsWithLowercaseFragment(value: string) {
  return /^[a-z]/.test(value.trim());
}

function endsAtSentenceBoundary(value: string) {
  return /[.!?]["')\]]?$/.test(value.trim());
}

function substantiveQuoteText(value: string) {
  const lines = value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return value;
  const substantiveLines = lines.filter((line, index) => {
    const nextLine = lines[index + 1] ?? "";
    const wrapsIntoNextLine = !endsAtSentenceBoundary(line)
      && Boolean(nextLine)
      && (/\b(?:a|an|the|and|or|to|of|for|with|in|on|at|by|from|during|after|before|unless|where|when)$/i.test(line)
        || /^[a-z]/.test(nextLine));
    return (!looksLikeHeadingOnly(line) || wrapsIntoNextLine) && !isScaffoldingQuote(line);
  });
  return (substantiveLines.length > 0 ? substantiveLines : lines).join(" ");
}

function isScaffoldingQuote(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (/^(?:current\s+)?page\s+focus\s*:/i.test(text)) return true;
  if (/^(?:current\s+)?(?:section|topic|heading|document\s+section|page\s+topic)\s*:/i.test(text)) return true;
  if (/^(?:table of contents|contents|index|appendix|references)\b/i.test(text)) return true;
  return false;
}

function hasScaffoldingLine(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .some(isScaffoldingQuote);
}

function isOrphanFragmentLine(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (!endsAtSentenceBoundary(text)) return false;
  if (startsWithContinuationFragment(text) || startsWithLowercaseFragment(text)) return true;
  if (/^(?:systems|information|types|records|scripts|resources|materials|actions|platforms|repositories)\b/i.test(text)
    && quoteWordCount(text) <= 6) {
    return true;
  }
  return false;
}

function hasInternalNonEvidenceLine(value: string) {
  const lines = value.split("\n");
  const nonEmptyCount = lines.filter((line) => line.trim()).length;
  if (nonEmptyCount <= 1) return false;
  return lines.some((line, index) => {
    const text = line.trim();
    if (!text) return false;
    const nextLine = lines[index + 1]?.trim() ?? "";
    const wrapsIntoNextLine = !endsAtSentenceBoundary(text)
      && Boolean(nextLine)
      && (/\b(?:a|an|the|and|or|to|of|for|with|in|on|at|by|from|during|after|before|unless|where|when)$/i.test(text)
        || /^[a-z]/.test(nextLine));
    if ((looksLikeHeadingOnly(text) && !wrapsIntoNextLine) || isScaffoldingQuote(text)) return true;
    const previousLine = lines[index - 1]?.trim() ?? "";
    return isOrphanFragmentLine(text) && (!previousLine || index === 0);
  });
}

function hasSubstantiveQuoteShape(value: string) {
  const substantiveText = substantiveQuoteText(value);
  return quoteWordCount(substantiveText) >= 5
    && endsAtSentenceBoundary(substantiveText)
    && !looksLikeHeadingOnly(substantiveText)
    && !isScaffoldingQuote(substantiveText)
    && !hasScaffoldingLine(value)
    && !hasInternalNonEvidenceLine(value)
    && !hasDanglingEnding(substantiveText)
    && !startsWithContinuationFragment(substantiveText)
    && !startsWithLowercaseFragment(substantiveText)
    && !isAdministrativeMetadataOnlyQuote(substantiveText);
}

function isAdministrativeMetadataOnlyQuote(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return true;
  const administrativeMarker = /\b(?:revision history|version history|change log|release notes?|document control|effective date|policy code|approved initial release|draft circulated|updated (?:ownership|terminology|responsibilities|metadata|formatting)|version\s+\d+(?:\.\d+)?|date\s+change\s+approved by)\b/i;
  const operativeAction = /\b(?:must|shall|will|is required to|are required to|maintains?|requires?|assigns?|responsible for|reviews?|retains?|preserves?|collects?|notifies?|protects?|implements?|approves?)\b/i;
  return administrativeMarker.test(text) && !operativeAction.test(text);
}

const additionalElementSignals: Partial<Record<RegSpRequirementId, Record<string, string[]>>> = {
  incident_assessment_containment_control: {
    assesses_scope: [
      "assess unauthorized access",
      "assessment of unauthorized access",
      "assesses unauthorized access",
      "assess the nature and scope",
    ],
    customer_information_systems: [
      "affected customer information",
      "affected systems",
      "information types",
      "customer information repositories",
    ],
    containment_control: [
      "containment",
      "contain and control",
      "contain the incident",
      "control the incident",
    ],
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: [
      "assess unauthorized access",
      "assessment of unauthorized access",
      "assesses unauthorized access",
      "assess the nature and scope",
    ],
    customer_information_systems: [
      "affected customer information",
      "affected systems",
      "information types",
      "customer information repositories",
    ],
    containment_control: [
      "containment",
      "contain and control",
      "contain the incident",
      "control the incident",
    ],
  },
  evidence_log_preservation: {
    incident_materials: [
      "preserving relevant logs",
      "preserve relevant logs",
      "logs and evidence",
      "relevant logs and evidence",
      "preserving logs",
      "preserving evidence",
      "investigation materials",
      "preserve investigation materials",
      "retain investigation materials",
      "retaining investigation materials",
      "incident records retained",
      "retain incident records",
      "recordkeeping for evidence",
    ],
  },
  incident_evidence_log_preservation: {
    incident_materials: [
      "preserving relevant logs",
      "preserve relevant logs",
      "logs and evidence",
      "relevant logs and evidence",
      "preserving logs",
      "preserving evidence",
      "investigation materials",
      "investigation materials retained",
      "preserve investigation materials",
      "retain investigation materials",
      "retaining investigation materials",
      "incident records retained",
      "retain incident records",
      "recordkeeping for evidence",
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
      "failed authentication",
      "unusual downloads",
      "high-risk transfers",
      "encryption in transit",
      "encryption at rest",
      "encrypted",
      "encryption",
    ],
  },
  safeguards_customer_information: {
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
      "failed authentication",
      "unusual downloads",
      "high-risk transfers",
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
  customer_notification_unauthorized_access: {
    notice_trigger: [
      "notify customers",
      "notify affected customers",
      "may notify customers",
      "customer notice",
    ],
    notice_trigger_standard: [
      "notify customers",
      "notify affected customers",
      "may notify customers",
      "customer notice",
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
  response_recovery_remediation_validation: {
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
  written_compliance_records: {
    compliance_record_scope: [
      "written compliance records",
      "records documenting compliance",
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
};

function elementSignals(requirement: RegSpRequirement, elementId: string) {
  const element = requirement.coverageElements.find((candidate) => candidate.id === elementId);
  const requirementId = copyRequirementId(requirement);
  return uniqueStrings([
    ...(element?.signals ?? []),
    ...(additionalElementSignals[requirement.id]?.[elementId] ?? []),
    ...(additionalElementSignals[requirementId]?.[elementId] ?? []),
  ]);
}

function evidencePreservationElementMatches(text: string) {
  const hasSpecificIncidentMaterial =
    /\b(?:logs?|forensic|investigation materials?|incident records?|recordkeeping|chain of custody|security[- ]console exports?)\b/.test(text);
  const hasPreservationAction =
    /\b(?:preserv\w*|retain\w*|retention|recordkeeping|maintain\w*)\b/.test(text);
  const hasDedicatedEvidencePreservation =
    /\b(?:preserve|preserves|preserving|preserved)\s+(?:relevant\s+)?evidence\b/.test(text)
    && !/\bwhile\s+preserv(?:e|es|ing|ed)\s+(?:relevant\s+)?evidence\b/.test(text);

  return (hasSpecificIncidentMaterial && hasPreservationAction) || hasDedicatedEvidencePreservation;
}

function hasDisposalAlignedLanguage(text: string) {
  return /\b(?:dispos(?:al|e|es|ed|ing)|destruct(?:ion)?|destroy(?:s|ed|ing)?|shredd?(?:ing|ed|s)?|wip(?:e|es|ed|ing)|saniti[zs](?:e|es|ed|ing|ation)|media disposal|backup disposal|device return|disposal attestation|records disposal)\b/.test(text);
}

function hasServiceProviderActor(text: string) {
  return /\b(?:service[- ]providers?|vendors?|suppliers?|third[- ]part(?:y|ies))\b/.test(text);
}

function serviceProviderElementMatches(elementId: string, text: string) {
  if (!hasServiceProviderActor(text)) return false;

  switch (elementId) {
    case "service_provider_scope":
      return /\b(?:incidents?|breaches?|security events?|cybersecurity|customer information systems?|protect(?:ion|s|ed|ing)?|safeguards?|contracts?|contractual|oversight|due diligence|monitor(?:ing|s|ed)?)\b/.test(text);
    case "notice_to_firm":
      return /\b(?:notify|notifies|notification|notice|report|reports|reporting|escalat(?:e|es|ed|ion)|deadline|timing|hours?)\b/.test(text);
    case "cooperation_remediation":
      return /\b(?:cooperat(?:e|es|ed|ion)|coordinat(?:e|es|ed|ion)|investigat(?:e|es|ed|ion)|forensic|status updates?|remediat(?:e|es|ed|ion)|corrective actions?|recover(?:y|ies|ed|ing)|containment support)\b/.test(text);
    default:
      return false;
  }
}

function serviceProviderNegativeElementMatches(elementId: string, text: string) {
  if (!hasServiceProviderActor(text)) return false;

  switch (elementId) {
    case "service_provider_scope":
      return /\b(?:oversight|due diligence|monitor(?:ing|s|ed)?|contracts?|contractual|customer information protection|cybersecurity requirements?|safeguards?)\b/.test(text);
    case "notice_to_firm":
      return /\b(?:notify|notification|notice|report|reporting|escalation|deadline|timing|hours?)\b/.test(text);
    case "cooperation_remediation":
      return /\b(?:cooperat(?:e|ion)|coordinat(?:e|ion)|investigation support|forensic support|status updates?|remediation plans?|corrective actions?|recovery support)\b/.test(text);
    default:
      return false;
  }
}

function elementSignalMatches(requirement: RegSpRequirement, elementId: string, text: string) {
  const signals = elementSignals(requirement, elementId);
  if (copyRequirementId(requirement) === "vendor_incident_handling") {
    return serviceProviderElementMatches(elementId, text);
  }

  if (copyRequirementId(requirement) === "evidence_log_preservation" && elementId === "incident_materials") {
    const signalMatch = signals.some((signal) => {
      const normalizedSignal = normalize(signal);
      return normalizedSignal && text.includes(normalizedSignal);
    });
    return (signalMatch || /\bsecurity[- ]console exports?\b/.test(text))
      && evidencePreservationElementMatches(text);
  }

  if (copyRequirementId(requirement) === "disposal_consumer_customer_information" && !hasDisposalAlignedLanguage(text)) {
    return false;
  }

  if (copyRequirementId(requirement) === "disposal_consumer_customer_information" && elementId === "secure_disposal_method") {
    return signals.some((signal) => {
      const normalizedSignal = normalize(signal);
      if (!normalizedSignal || normalizedSignal === "disposal") return false;
      return text.includes(normalizedSignal);
    });
  }

  return signals.some((signal) => {
    const normalizedSignal = normalize(signal);
    return normalizedSignal && text.includes(normalizedSignal);
  });
}

function elementSignalMatchesText(requirement: RegSpRequirement, elementId: string, text: string) {
  return elementSignalMatches(requirement, elementId, normalize(text));
}

function baseSupportedElementIdsForText(requirement: RegSpRequirement, text: string) {
  return (requirement.coverageElements ?? [])
    .filter((element) => requirement.requiredElementsForCovered.includes(element.id))
    .filter((element) => elementSignalMatchesText(requirement, element.id, text))
    .map((element) => element.id);
}

function supportedElementIdsForQuote(requirement: RegSpRequirement, quote: string) {
  const substantiveText = substantiveQuoteText(quote);
  if (isScaffoldingQuote(substantiveText)) return [];

  const sentenceTexts = sourceSentenceSpans(quote).map((span) => span.text);
  if (hasAbsenceLanguage(substantiveText)) {
    return uniqueStrings(
      sentenceTexts
        .filter((sentence) => !hasAbsenceLanguage(sentence) && !isScaffoldingQuote(sentence))
        .flatMap((sentence) => baseSupportedElementIdsForText(requirement, sentence)),
    );
  }

  return baseSupportedElementIdsForText(requirement, substantiveText);
}

function isWeakNegativeSignal(signal: string) {
  const normalized = normalize(signal);
  return [
    "customer information",
    "sensitive customer information",
    "consumer information",
    "customer records",
    "customer data",
    "information",
  ].includes(normalized);
}

function negativeElementSignalMatches(requirement: RegSpRequirement, elementId: string, text: string) {
  const normalizedText = normalize(text);
  if (copyRequirementId(requirement) === "vendor_incident_handling") {
    return serviceProviderNegativeElementMatches(elementId, normalizedText);
  }

  const signals = elementSignals(requirement, elementId)
    .map(normalize)
    .filter((signal) => signal.length >= 4 && !isWeakNegativeSignal(signal));
  return signals.some((signal) => normalizedText.includes(signal));
}

function negativelyScopedElementIdsForQuote(
  requirement: RegSpRequirement,
  chunk: GradedEvidenceChunk,
  quote: string,
) {
  const substantiveText = substantiveQuoteText(quote);
  const scopedReference = referencesUnavailablePolicy({
    ...chunk,
    supporting_quote: quote,
  });
  if (isScaffoldingQuote(substantiveText) || (!hasAbsenceLanguage(substantiveText) && !scopedReference)) return [];

  return (requirement.coverageElements ?? [])
    .filter((element) => requirement.requiredElementsForCovered.includes(element.id))
    .filter((element) => negativeElementSignalMatches(requirement, element.id, substantiveText))
    .map((element) => element.id);
}

function optionalNegativeElementIdsForQuote(
  requirement: RegSpRequirement,
  chunk: GradedEvidenceChunk,
  quote: string,
) {
  const substantiveText = substantiveQuoteText(quote);
  const scopedReference = referencesUnavailablePolicy({
    ...chunk,
    supporting_quote: quote,
  });
  if (isScaffoldingQuote(substantiveText) || (!hasAbsenceLanguage(substantiveText) && !scopedReference)) return [];

  const required = new Set(requirement.requiredElementsForCovered);
  return (requirement.coverageElements ?? [])
    .filter((element) => !required.has(element.id))
    .filter((element) => negativeElementSignalMatches(requirement, element.id, substantiveText))
    .map((element) => element.id);
}

function evidenceElementIdsForQuote(requirement: RegSpRequirement, chunk: GradedEvidenceChunk, quote: string) {
  return chunk.evidence_relationship === "negative_evidence"
    ? negativelyScopedElementIdsForQuote(requirement, chunk, quote)
    : supportedElementIdsForQuote(requirement, quote);
}

function quoteQualityScore(quote: string) {
  let score = 0;
  const substantiveText = substantiveQuoteText(quote);
  if (hasSubstantiveQuoteShape(quote)) score += 40;
  if (quote.includes("\n") && quote.split(/\n+/).some((line) => looksLikeHeadingOnly(line.trim()))) {
    score -= 35;
  }
  if (startsWithContinuationFragment(quote)) score -= 60;
  if (startsWithLowercaseFragment(substantiveText)) score -= 60;
  if (hasDanglingEnding(quote)) score -= 50;
  if (!endsAtSentenceBoundary(substantiveText)) score -= 80;
  if (looksLikeHeadingOnly(substantiveText)) score -= 80;
  return score;
}

function finalQuoteCandidateScore(requirement: RegSpRequirement, chunk: GradedEvidenceChunk, quote: string) {
  const supportedElements = chunk.evidence_relationship === "negative_evidence"
    ? uniqueStrings([
      ...evidenceElementIdsForQuote(requirement, chunk, quote),
      ...optionalNegativeElementIdsForQuote(requirement, chunk, quote),
    ])
    : evidenceElementIdsForQuote(requirement, chunk, quote);
  return {
    quote,
    supportedElements,
    score: supportedElements.length * 100 + quoteQualityScore(quote),
  };
}

function candidateQuoteSpans(chunk: GradedEvidenceChunk) {
  const rawText = chunk.content_preview;
  const candidates: TextSpan[] = [];
  const seen = new Set<string>();
  const addCandidate = (span: TextSpan | null) => {
    if (!span || !rawText.includes(span.text) || seen.has(span.text)) return;
    seen.add(span.text);
    candidates.push(span);
  };

  const sourceQuoteSpan = sourceSpanForQuote(rawText, chunk.supporting_quote);
  if (!sourceQuoteSpan) return candidates;
  if (sourceQuoteSpan) {
    addCandidate(expandedSentenceSpan(rawText, sourceQuoteSpan));
  }

  const sentences = sourceSentenceSpans(rawText);
  for (let index = 0; index < sentences.length; index += 1) {
    for (let windowSize = 1; windowSize <= 3; windowSize += 1) {
      const last = sentences[index + windowSize - 1];
      if (!last) continue;
      addCandidate(sourceSpanBetween(rawText, sentences[index], last));
    }
  }

  return candidates;
}

function finalizedSourceQuote(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const ranked = candidateQuoteSpans(chunk)
    .map((candidate) => finalQuoteCandidateScore(requirement, chunk, candidate.text))
    .filter((candidate) =>
      candidate.supportedElements.length > 0
      && chunk.content_preview.includes(candidate.quote)
      && hasSubstantiveQuoteShape(candidate.quote)
    )
    .sort((left, right) => {
      const supportDelta = right.supportedElements.length - left.supportedElements.length;
      if (supportDelta !== 0) return supportDelta;
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.quote.length - right.quote.length;
    });

  return ranked[0]?.quote ?? null;
}

function hasSubstantiveExactSourceQuote(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  return Boolean(finalizedSourceQuote(requirement, chunk));
}

function quoteSupportedElementIds(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const quote = finalizedSourceQuote(requirement, chunk);
  return quote ? supportedElementIdsForQuote(requirement, quote) : [];
}

function finalizedEvidenceElementIds(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const quote = finalizedSourceQuote(requirement, chunk);
  return quote ? evidenceElementIdsForQuote(requirement, chunk, quote) : [];
}

function finalizedOptionalNegativeElementIds(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const quote = finalizedSourceQuote(requirement, chunk);
  return quote && chunk.evidence_relationship === "negative_evidence"
    ? optionalNegativeElementIdsForQuote(requirement, chunk, quote)
    : [];
}

function finalizedEvidenceRelationship(
  requirement: RegSpRequirement,
  chunk: GradedEvidenceChunk,
): GradedEvidenceChunk["evidence_relationship"] {
  if (chunk.evidence_relationship === "supports") {
    return quoteSupportedElementIds(requirement, chunk).length > 0
      ? "supports"
      : "background_context";
  }
  if (chunk.evidence_relationship !== "partially_supports") {
    return chunk.evidence_relationship;
  }
  const supportedElements = quoteSupportedElementIds(requirement, chunk);
  if (supportedElements.length === 0) return "background_context";
  return requirement.requiredElementsForCovered.every((elementId) => supportedElements.includes(elementId))
    ? "supports"
    : "partially_supports";
}

function finalSupportRelationship(
  requirement: RegSpRequirement,
  chunk: GradedEvidenceChunk,
): ElementCoverageRelationship {
  if (chunk.evidence_relationship === "supports") {
    return quoteSupportedElementIds(requirement, chunk).length > 0 ? "supports" : "missing";
  }
  if (chunk.evidence_relationship !== "partially_supports") {
    return chunk.evidence_relationship === "negative_evidence" ? "negative_evidence" : "missing";
  }
  const supportedElements = quoteSupportedElementIds(requirement, chunk);
  if (supportedElements.length === 0) return "missing";
  return requirement.requiredElementsForCovered.every((elementId) => supportedElements.includes(elementId))
    ? "supports"
    : "partially_supports";
}

function isSourceGroundedDirectSupport(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  return isDirectSupport(chunk)
    && hasSubstantiveExactSourceQuote(requirement, chunk)
    && quoteSupportedElementIds(requirement, chunk).length > 0;
}

function isSourceGroundedPartialSupport(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  return isPartialSupport(chunk) && hasSubstantiveExactSourceQuote(requirement, chunk);
}

function isSourceGroundedNegativeEvidence(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  return isExplicitNegativeEvidence(chunk)
    && hasSubstantiveExactSourceQuote(requirement, chunk);
}

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkInterpretationText(chunk: GradedEvidenceChunk) {
  return normalize([
    chunk.supporting_quote,
    chunk.negative_evidence_reason,
    chunk.grade_reason,
    chunk.content_preview,
    chunk.section_path,
    chunk.filename,
  ].filter(Boolean).join(" "));
}

export function classifyNegativeEvidenceScope(
  chunk: GradedEvidenceChunk,
): NegativeEvidenceScope {
  const text = chunkInterpretationText(chunk);
  const filename = normalize(chunk.filename);
  const sectionPath = normalize(chunk.section_path);
  const documentScopePatterns = [
    /\bthis\s+(policy|procedure|document|standard|addendum|guide|checklist|section|runbook)\b.{0,120}\b(does not|doesn t|do not|does not fully|does not establish|does not define|does not address|does not authorize|does not require|does not replace|is not intended|not intended)\b/,
    /\b(outside|out of)\s+the\s+scope\s+of\s+this\s+(policy|procedure|document|standard|addendum|guide|checklist|section|runbook)\b/,
    /\b(this|the)\s+(policy|procedure|document|standard|addendum|guide|checklist|section|runbook)\b.{0,120}\b(scope|scoped|limited|limitation)\b/,
    /\b(reserved for|handled in|addressed in)\s+(a\s+)?(separate|another|other)\s+(policy|procedure|document|standard|governance document)\b/,
  ];
  const organizationNegativePatterns = [
    /\b(the\s+)?(firm|organization|company|enterprise)\s+(does not|doesn t|do not|has not|hasn t|will not|does not maintain|does not perform|does not require|has not established)\b/,
    /\bno\s+(formal\s+)?(process|procedure|program|policy|control|standard|customer notification procedure|incident response program)\s+(exists|exist|has been established|is maintained|is required)\b/,
    /\bthere\s+is\s+no\s+(formal\s+)?(process|procedure|program|policy|control|standard)\b/,
    /\bmanagement\s+has\s+not\s+assigned\s+responsibility\b/,
    /\bthe\s+control\s+is\s+not\s+required\s+by\s+the\s+(firm|organization|company|enterprise)\b/,
  ];

  if (referencesUnavailablePolicy(chunk)) {
    return "document_scope_limitation";
  }

  if (organizationNegativePatterns.some((pattern) => pattern.test(text))) {
    return "organization_level_negative";
  }

  if (
    documentScopePatterns.some((pattern) => pattern.test(text)) ||
    (filename.includes("acceptable use") && text.includes("does not")) ||
    (filename.includes("procedure") && (text.includes("does not define") || text.includes("does not establish"))) ||
    (sectionPath.includes("scope") && text.includes("does not"))
  ) {
    return "document_scope_limitation";
  }

  return "organization_level_negative";
}

function referencesUnavailablePolicy(chunk: GradedEvidenceChunk) {
  const text = chunkInterpretationText(chunk);
  const referencedDocumentPattern =
    /\b(?:handled|covered|defined|established|addressed|documented|specified|maintained|reserved|set\s+forth|described)\s+(?:in|by|under|within|for)\s+(?:a\s+|an\s+|the\s+|another\s+|separate\s+|other\s+)?[a-z0-9\s-]{0,80}\b(?:policy|procedure|standard|program|plan|manual|playbook|runbook|matrix|governance\s+document)\b/;
  const explicitReferencePattern =
    /\b(?:refer(?:s|red)?\s+to|see|pursuant\s+to|according\s+to|as\s+described\s+in|as\s+set\s+forth\s+in|as\s+specified\s+in)\s+(?:a\s+|an\s+|the\s+)?[a-z0-9\s-]{0,80}\b(?:policy|procedure|standard|program|plan|manual|playbook|runbook|matrix|governance\s+document)\b/;
  const separateDocumentPattern =
    /\b(?:separate|another|other)\s+(?:policy|procedure|standard|program|plan|manual|playbook|runbook|matrix|governance\s+document)\b/;

  return referencedDocumentPattern.test(text)
    || explicitReferencePattern.test(text)
    || separateDocumentPattern.test(text);
}

function hasUnclearApplicability(chunk: GradedEvidenceChunk) {
  const text = chunkInterpretationText(chunk);
  const applicabilityPatterns = [
    /\bunclear\s+(?:whether|if|when|how)\b/,
    /\b(?:if|where|when)\s+applicable\b/,
    /\bas\s+applicable\b/,
    /\b(?:applicability|scope)\s+(?:matrix|review|determination|assessment)\b/,
    /\b(?:applies|applicable)\s+only\s+(?:if|when|where|to)\b/,
    /\bdepends\s+on\s+(?:applicability|business\s+unit|entity|account|customer|client|product|service)\b/,
  ];

  return applicabilityPatterns.some((pattern) => pattern.test(text));
}

function hasTrueAmbiguity({
  documentScopeLimitations,
  background,
}: {
  documentScopeLimitations: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
}) {
  return documentScopeLimitations.some(referencesUnavailablePolicy)
    || background.some(hasUnclearApplicability);
}

function textForWeighting(chunk: GradedEvidenceChunk) {
  return normalize([
    chunk.filename,
    chunk.section_path,
    chunk.supporting_quote,
    chunk.grade_reason,
    chunk.content_preview,
  ].filter(Boolean).join(" "));
}

function signalWeight(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const text = textForWeighting(chunk);
  const signals = [
    ...(requirement.directSignals ?? []),
    ...(requirement.actionSignals ?? []),
    ...(requirement.topicSignals ?? []),
  ].map(normalize).filter(Boolean);
  return signals.filter((signal) => text.includes(signal)).length;
}

function requirementSectionPreferences(requirement: RegSpRequirement) {
  switch (copyRequirementId(requirement)) {
    case "customer_notification_content":
      return {
        preferred: [
          "customer notification content requirements",
          "customer notification decision standard",
          "customer notification timing and approval path",
        ],
        disfavored: ["vendor", "service provider", "supplier", "third party"],
      };
    case "customer_notification_unauthorized_access":
      return {
        preferred: [
          "customer notification decision standard",
          "customer notification timing and approval path",
          "customer notification content requirements",
        ],
        disfavored: ["vendor", "service provider", "supplier", "third party"],
      };
    case "unauthorized_access_detection_escalation":
      return {
        preferred: [
          "written incident response program",
          "incident intake",
          "incident triage",
          "triage",
          "assessment of unauthorized access or use",
          "assessment",
          "nature and scope",
          "affected systems",
          "affected information",
          "containment",
          "control",
        ],
        disfavored: ["vendor", "service provider", "supplier", "third party", "customer notification"],
      };
    case "evidence_log_preservation":
      return {
        preferred: [
          "written incident response program",
          "monitoring logging and alert review",
          "post-incident review and lessons learned",
        ],
        disfavored: ["vendor", "service provider", "supplier", "third party"],
      };
    case "customer_information_safeguards":
      return {
        preferred: [
          "access management and privileged access review",
          "monitoring logging and alert review",
          "encryption",
          "transmission",
          "storage safeguards",
        ],
        disfavored: ["incident response", "disposal"],
      };
    case "disposal_consumer_customer_information":
      return {
        preferred: [
          "disposal of consumer and customer information",
          "electronic media and backup disposal procedures",
        ],
        disfavored: ["incident response", "vendor", "service provider", "supplier"],
      };
    case "remediation_recovery_validation":
      return {
        preferred: [
          "incident recovery and remediation validation",
          "incident recovery",
          "recovery",
          "remediation validation",
          "remediation",
          "validation",
          "corrective action",
          "corrective-action",
          "closure",
          "restoration",
          "restore affected services",
          "post-incident review",
          "post-incident review and lessons learned",
        ],
        disfavored: ["vendor", "service provider", "supplier", "third party", "customer notification"],
      };
    case "written_compliance_records":
      return {
        preferred: [
          "records",
          "recordkeeping",
          "retention",
          "register",
          "documentation",
          "evidence",
          "worksheet",
          "review",
          "approval",
          "notice records",
          "incident records",
          "compliance records",
        ],
        disfavored: ["vendor", "service provider", "supplier", "third party"],
      };
    case "vendor_incident_handling":
      return {
        preferred: [
          "service provider oversight expectations",
          "vendor cooperation investigation and remediation support",
        ],
        disfavored: [],
      };
    default:
      return { preferred: [], disfavored: [] };
  }
}

function sectionPreferenceWeight(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const text = normalize([
    chunk.section_path,
    chunk.filename,
  ].filter(Boolean).join(" "));
  const preferences = requirementSectionPreferences(requirement);
  const preferredHits = preferences.preferred.filter((section) => text.includes(normalize(section))).length;
  const disfavoredHits = preferences.disfavored.filter((section) => text.includes(normalize(section))).length;
  return preferredHits * 45 - disfavoredHits * 35;
}

function vendorAdjacentPenalty(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const requirementId = copyRequirementId(requirement);
  if (requirementId === "vendor_incident_handling") return 0;
  const text = textForWeighting(chunk);
  const vendorHits = [
    "vendor",
    "service provider",
    "supplier",
    "third party",
    "third-party",
    "questionnaire",
  ].filter((signal) => text.includes(signal)).length;
  if (vendorHits === 0) return 0;
  return -70 - Math.min(vendorHits, 3) * 20;
}

function evidenceWeight(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  const text = textForWeighting(chunk);
  let weight = chunk.rerank_score ?? 0;
  if (isDirectSupport(chunk)) weight += 120;
  if (isPartialSupport(chunk)) weight += 70;
  if (isBackgroundContext(chunk)) weight += 20;
  if (isExplicitNegativeEvidence(chunk)) {
    weight += classifyNegativeEvidenceScope(chunk) === "organization_level_negative" ? 90 : 25;
  }
  weight += signalWeight(requirement, chunk) * 8;
  weight += quoteSupportedElementIds(requirement, chunk).length * 80;
  weight += sectionPreferenceWeight(requirement, chunk);
  weight += vendorAdjacentPenalty(requirement, chunk);
  if (chunk.classifier_confidence === "high") weight += 10;
  if (text.includes("incident response policy") || text.includes("response standard")) weight += 18;
  if (text.includes("privacy policy") || text.includes("safeguards program")) weight += 12;
  if (text.includes("acceptable use")) weight -= 25;
  if (text.includes("scope") || text.includes("limitation")) weight -= 8;
  const quote = finalizedSourceQuote(requirement, chunk);
  if (quote) weight += operativeQuoteWeight(quote);
  return weight;
}

function sortByEvidenceWeight(requirement: RegSpRequirement, chunks: GradedEvidenceChunk[]) {
  return [...chunks].sort(
    (left, right) => evidenceWeight(requirement, right) - evidenceWeight(requirement, left),
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function elementLabel(requirement: RegSpRequirement, elementId: string) {
  return requirement.coverageElements.find((element) => element.id === elementId)?.label ?? elementId;
}

function sentenceList(values: string[]) {
  if (values.length === 0) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

const foundElementCopy: Partial<Record<RegSpRequirementId, Record<string, string>>> = {
  written_incident_response_program: {
    written_program: "maintains a written incident response program or equivalent standard",
    customer_information_scope: "applies the response process to customer information",
    response_recovery_responsibilities: "defines response and recovery responsibilities",
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: "requires assessment of the nature and scope of unauthorized access or use",
    customer_information_systems: "addresses affected customer information systems or information types",
    containment_control: "requires containment or control steps",
  },
  customer_notification_unauthorized_access: {
    unauthorized_access_or_use: "addresses unauthorized access to or use of sensitive customer information",
    notice_trigger: "defines when customer notice is required",
    notice_trigger_standard: "defines when customer notice is required",
    notice_timing: "defines the timing for customer notice",
  },
  customer_notification_content: {
    incident_description: "describes what happened",
    information_involved: "identifies the sensitive customer information involved",
    protective_steps: "includes protective steps for affected individuals",
    contact_information: "provides contact information for questions",
  },
  vendor_incident_handling: {
    service_provider_scope: "applies to service providers or vendors handling customer information",
    notice_to_firm: "requires vendors or service providers to notify the firm",
    cooperation_remediation: "requires cooperation with investigation, remediation, or recovery",
  },
  customer_information_safeguards: {
    customer_information_scope: "applies safeguards to customer information",
    safeguards_controls: "describes safeguards or access controls",
  },
  disposal_consumer_customer_information: {
    disposal_scope: "applies disposal requirements to consumer or customer information",
    secure_disposal_method: "defines secure disposal or destruction methods",
  },
  written_compliance_records: {
    compliance_record_scope: "requires written compliance records",
    notice_determination_records: "documents incident or notification decisions and notices",
    retention_accessibility: "defines retention or accessible storage",
  },
  evidence_log_preservation: {
    incident_materials: "preserves incident logs, evidence, or investigation records",
    integrity_or_chain_of_custody: "maintains evidence integrity or chain of custody",
  },
  remediation_recovery_validation: {
    recovery_steps: "defines recovery steps",
    remediation_tracking: "tracks remediation or corrective actions",
    validation_testing: "validates recovery or remediation",
  },
  regulator_law_enforcement_notification: {
    external_notification_decisioning: "defines external notification decisioning",
    legal_compliance_owner: "assigns legal or compliance ownership",
  },
};

const missingElementCopy: Partial<Record<RegSpRequirementId, Record<string, string>>> = {
  written_incident_response_program: {
    written_program: "a maintained written incident response program or equivalent policy",
    customer_information_scope: "that the program applies to customer information",
    response_recovery_responsibilities: "response and recovery responsibilities",
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: "how the firm assesses the nature and scope of unauthorized access or use",
    customer_information_systems: "how affected customer information systems or information types are identified",
    containment_control: "required containment or control steps",
  },
  customer_notification_unauthorized_access: {
    unauthorized_access_or_use: "language tying notice to unauthorized access or use of sensitive customer information",
    notice_trigger: "the decision standard for when notice is required, including substantial harm or inconvenience",
    notice_trigger_standard: "the decision standard for when notice is required, including substantial harm or inconvenience",
    notice_timing: "the required timing for notice",
  },
  customer_notification_content: {
    incident_description: "notice language describing what happened",
    information_involved: "notice language identifying the sensitive customer information involved",
    protective_steps: "protective steps or resources for affected individuals",
    contact_information: "required contact information for questions",
  },
  vendor_incident_handling: {
    service_provider_scope: "coverage for service providers or vendors handling customer information",
    notice_to_firm: "vendor or service-provider notice to the firm",
    cooperation_remediation: "vendor cooperation with investigation, remediation, or recovery",
  },
  customer_information_safeguards: {
    customer_information_scope: "that the safeguards apply to customer information",
    safeguards_controls: "administrative, technical, or physical safeguards",
  },
  disposal_consumer_customer_information: {
    disposal_scope: "consumer or customer information disposal scope",
    secure_disposal_method: "secure disposal, destruction, shredding, wiping, or sanitization methods",
  },
  written_compliance_records: {
    compliance_record_scope: "written records documenting Reg S-P compliance",
    notice_determination_records: "incident or notification determinations and notice records",
    retention_accessibility: "retention period or accessible storage requirements",
  },
  evidence_log_preservation: {
    incident_materials: "how logs, evidence, or investigation records must be preserved",
    integrity_or_chain_of_custody: "evidence integrity or chain-of-custody requirements",
  },
  remediation_recovery_validation: {
    recovery_steps: "required recovery steps",
    remediation_tracking: "remediation or corrective-action tracking",
    validation_testing: "how recovery or remediation must be validated",
  },
  regulator_law_enforcement_notification: {
    external_notification_decisioning: "who decides when external notification is required",
    legal_compliance_owner: "legal or compliance ownership for external notification decisions",
  },
};

type ElementPhraseMode = "found" | "missing" | "partial";

const partialElementCopy: Partial<Record<RegSpRequirementId, Record<string, string>>> = {
  written_incident_response_program: {
    written_program: "a written incident response program or equivalent standard",
    customer_information_scope: "customer-information scope",
    response_recovery_responsibilities: "response and recovery responsibilities",
  },
  unauthorized_access_detection_escalation: {
    assesses_scope: "incident assessment",
    customer_information_systems: "affected customer information systems or information types",
    containment_control: "containment or control steps",
  },
  customer_notification_unauthorized_access: {
    unauthorized_access_or_use: "customer notification after unauthorized access or use",
    notice_trigger: "customer-notice decisioning",
    notice_trigger_standard: "customer-notice decisioning",
    notice_timing: "customer-notice timing",
  },
  customer_notification_content: {
    incident_description: "incident-description content",
    information_involved: "identification of affected sensitive customer information",
    protective_steps: "protective steps for affected individuals",
    contact_information: "contact information for questions",
  },
  vendor_incident_handling: {
    service_provider_scope: "service-provider or vendor incident scope",
    notice_to_firm: "vendor or service-provider notice to the firm",
    cooperation_remediation: "vendor cooperation with investigation, remediation, or recovery",
  },
  customer_information_safeguards: {
    customer_information_scope: "safeguards for customer information",
    safeguards_controls: "administrative, technical, or physical safeguards",
  },
  disposal_consumer_customer_information: {
    disposal_scope: "consumer or customer information disposal scope",
    secure_disposal_method: "secure disposal or destruction methods",
  },
  written_compliance_records: {
    compliance_record_scope: "written compliance records",
    notice_determination_records: "incident or notification decision records",
    retention_accessibility: "record retention or accessible storage",
  },
  evidence_log_preservation: {
    incident_materials: "evidence and log preservation",
    integrity_or_chain_of_custody: "evidence integrity or chain of custody",
  },
  remediation_recovery_validation: {
    recovery_steps: "recovery steps",
    remediation_tracking: "remediation or corrective-action tracking",
    validation_testing: "recovery or remediation validation",
  },
  regulator_law_enforcement_notification: {
    external_notification_decisioning: "external notification decisioning",
    legal_compliance_owner: "legal or compliance ownership",
  },
};

function elementPhrase(requirement: RegSpRequirement, elementId: string, mode: ElementPhraseMode) {
  const map = mode === "found"
    ? foundElementCopy
    : mode === "partial"
      ? partialElementCopy
      : missingElementCopy;
  const requirementId = copyRequirementId(requirement);
  return map[requirementId]?.[elementId]
    ?? foundElementCopy[requirementId]?.[elementId]
    ?? elementLabel(requirement, elementId).replace(/^(Defines|Requires|Applies|Identifies|Includes|Provides)\s+/i, "").toLowerCase();
}

function renderedElementList(
  requirement: RegSpRequirement,
  elementIds: string[],
  mode: ElementPhraseMode,
) {
  return sentenceList(elementIds.map((elementId) => elementPhrase(requirement, elementId, mode)));
}

function coveredFindingSentence(requirement: RegSpRequirement, coveredRequired: string[]) {
  const elements = renderedElementList(requirement, coveredRequired, "found");
  if (!elements) return "The reviewed policy defines the main elements of this requirement.";

  switch (copyRequirementId(requirement)) {
    case "customer_information_safeguards":
      return `The reviewed policy ${elements}.`;
    case "vendor_incident_handling":
      return `The reviewed policy ${elements}.`;
    case "written_compliance_records":
      return `The reviewed policy ${elements}.`;
    case "customer_notification_content":
      return `The reviewed policy defines notice-content requirements that ${elements}.`;
    case "disposal_consumer_customer_information":
      return `The reviewed policy ${elements}.`;
    default:
      return `The reviewed policy defines the main elements of this requirement and ${elements}.`;
  }
}

function partialMissingSentence(requirement: RegSpRequirement, missingRequired: string[]) {
  const elements = renderedElementList(requirement, missingRequired, "missing");
  if (!elements) return "Some required details are still unclear.";

  switch (copyRequirementId(requirement)) {
    case "customer_notification_content":
      return `RegSpan did not find clear language requiring the notice to include ${elements}.`;
    case "customer_notification_unauthorized_access":
      return `RegSpan did not find clear language defining ${elements}.`;
    case "disposal_consumer_customer_information":
      return `RegSpan did not find clear disposal language covering ${elements}.`;
    case "written_compliance_records":
      return `RegSpan did not find clear recordkeeping language covering ${elements}.`;
    case "vendor_incident_handling":
      return `RegSpan did not find clear service-provider language covering ${elements}.`;
    default:
      return `RegSpan did not find clear language covering ${elements}.`;
  }
}

function needsReviewDetailForRequirement(requirement: RegSpRequirement, missingRequired: string[]) {
  const missing = renderedElementList(requirement, missingRequired, "missing");
  if (missing) return missing;

  switch (copyRequirementId(requirement)) {
    case "customer_notification_content":
      return "required customer-notice content, including affected information, protective steps, and contact information";
    case "customer_notification_unauthorized_access":
      return "the customer-notification trigger, substantial-harm analysis, and timing standard";
    case "disposal_consumer_customer_information":
      return "secure disposal requirements for consumer or customer information";
    case "written_compliance_records":
      return "written compliance records, retention, and accessibility requirements";
    case "vendor_incident_handling":
      return "vendor or service-provider notice, cooperation, remediation, and recovery obligations";
    case "customer_information_safeguards":
      return "safeguards and access controls for customer information";
    case "evidence_log_preservation":
      return "incident log, evidence preservation, and chain-of-custody requirements";
    case "remediation_recovery_validation":
      return "remediation tracking, recovery steps, and validation requirements";
    case "regulator_law_enforcement_notification":
      return "regulator, law-enforcement, or external notification decisioning and ownership";
    default:
      return requirement.description;
  }
}

function partialRemediationForRequirement(requirement: RegSpRequirement, missingRequired: string[]) {
  const missing = renderedElementList(requirement, missingRequired, "missing");
  if (missing) {
    return `The reviewed documents mention this area, but they do not clearly define ${missing}. Add or update the relevant policy or procedure so those missing details are explicit.`;
  }

  switch (copyRequirementId(requirement)) {
    case "customer_notification_content":
      return "The reviewed documents mention this area, but they do not clearly define notice-content requirements. Add requirements covering what happened, what information was involved, what the firm is doing, how affected individuals can get help, protective steps, and required contact information.";
    case "customer_notification_unauthorized_access":
      return "The reviewed documents mention this area, but they do not clearly define the full notification trigger and timing. Clarify the decision standard for when notice is required, including sensitive customer information, substantial harm or inconvenience, and required timing.";
    case "disposal_consumer_customer_information":
      return "The reviewed documents mention this area, but they do not clearly define disposal requirements. Define how consumer and customer information must be securely disposed of, who owns the process, and what records or vendor handoffs are required.";
    case "written_compliance_records":
      return "The reviewed documents mention this area, but they do not clearly define required compliance records. Define what records must be retained, who owns them, how long they are retained, and where they remain accessible.";
    case "vendor_incident_handling":
      return "The reviewed documents mention this area, but they do not clearly define service-provider incident obligations. Add vendor notice, cooperation, investigation, remediation, recovery, and timing requirements.";
    default:
      return `The reviewed documents mention this area, but they do not clearly define all required elements. Add the missing details described in the finding and identify the owner, timing, approvals, escalation, handoffs, and records where applicable.`;
  }
}

function confidenceFromChunk(chunk: GradedEvidenceChunk | null): FindingConfidence {
  if (chunk?.classifier_confidence === "high") return "high";
  if (chunk?.classifier_confidence === "medium") return "medium";
  return "low";
}

function buildElementCoverageLedger(
  requirement: RegSpRequirement,
  supportChunks: GradedEvidenceChunk[],
  organizationNegative: GradedEvidenceChunk[],
): ElementCoverageLedgerEntry[] {
  const sortedSupport = sortByEvidenceWeight(requirement, supportChunks)
    .filter((chunk) => quoteSupportedElementIds(requirement, chunk).length > 0);
  const sortedNegative = sortByEvidenceWeight(requirement, organizationNegative)
    .filter((chunk) => finalizedEvidenceElementIds(requirement, chunk).length > 0);

  return requirement.requiredElementsForCovered.map((elementId) => {
    const supportChunk = sortedSupport.find((chunk) => quoteSupportedElementIds(requirement, chunk).includes(elementId)) ?? null;
    const negativeChunk = sortedNegative.find((chunk) =>
      finalizedEvidenceElementIds(requirement, chunk).includes(elementId)
    ) ?? null;
    let relationship: ElementCoverageRelationship = "missing";
    if (supportChunk) {
      relationship = finalSupportRelationship(requirement, supportChunk);
    } else if (negativeChunk) {
      relationship = "negative_evidence";
    }

    return {
      required_element_id: elementId,
      relationship,
      supportChunk,
      negativeChunk,
      quote: supportChunk
        ? finalizedSourceQuote(requirement, supportChunk)
        : negativeChunk
          ? finalizedSourceQuote(requirement, negativeChunk)
          : null,
      chunk_id: supportChunk?.chunk_id ?? negativeChunk?.chunk_id ?? null,
      section_path: supportChunk?.section_path ?? negativeChunk?.section_path ?? null,
      page_start: supportChunk?.page_start ?? negativeChunk?.page_start ?? null,
      page_end: supportChunk?.page_end ?? negativeChunk?.page_end ?? null,
      confidence: confidenceFromChunk(supportChunk ?? negativeChunk),
    };
  });
}

function supportedRequiredElementsFromLedger(ledger: ElementCoverageLedgerEntry[]) {
  return ledger
    .filter((entry) => entry.supportChunk)
    .map((entry) => entry.required_element_id);
}

function fullySupportedRequiredElementsFromLedger(ledger: ElementCoverageLedgerEntry[]) {
  return ledger
    .filter((entry) => entry.relationship === "supports")
    .map((entry) => entry.required_element_id);
}

function contradictedRequiredElementsFromLedger(ledger: ElementCoverageLedgerEntry[]) {
  return ledger
    .filter((entry) => entry.supportChunk && entry.negativeChunk)
    .map((entry) => entry.required_element_id);
}

function addUniqueChunk(
  selected: GradedEvidenceChunk[],
  chunk: GradedEvidenceChunk | null | undefined,
) {
  if (!chunk || selected.some((candidate) => candidate.chunk_id === chunk.chunk_id)) return;
  selected.push(chunk);
}

function curationWeight(requirement: RegSpRequirement, chunk: GradedEvidenceChunk) {
  let weight = evidenceWeight(requirement, chunk);
  const quote = finalizedSourceQuote(requirement, chunk);
  if (quote) {
    weight += Math.min(quoteWordCount(quote), 80) * 0.5;
    weight += operativeQuoteWeight(quote);
  }
  if (hasSubstantiveExactSourceQuote(requirement, chunk)) weight += 25;
  if (looksLikeHeadingOnly(quote ?? "")) weight -= 200;
  return weight;
}

function operativeQuoteWeight(quote: string) {
  const text = normalize(quote);
  const operativeHits = [
    "must",
    "shall",
    "requires",
    "require",
    "selects",
    "takes",
    "follows",
    "restores",
    "restoring",
    "validates",
    "validating",
    "confirms",
    "records",
    "assigns",
  ].filter((signal) => text.includes(signal)).length;
  let weight = Math.min(operativeHits, 3) * 24;
  if (/\b(?:the organization|the firm) applies a risk-based approach to\b/.test(text)) weight -= 85;
  if (/\bthe depth of review depends on\b/.test(text)) weight -= 85;
  if (/\b(?:manages?|coordinates?) .{0,80}\bthrough documented ownership\b/.test(text)) weight -= 70;
  return weight;
}

function curateEvidenceChunks({
  requirement,
  status,
  ledger,
  organizationNegative,
  documentScopeLimitations,
  background,
}: {
  requirement: RegSpRequirement;
  status: FindingStatus;
  ledger: ElementCoverageLedgerEntry[];
  organizationNegative: GradedEvidenceChunk[];
  documentScopeLimitations: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
}) {
  const selected: GradedEvidenceChunk[] = [];
  if (status === "conflicting") {
    const contradictedEntries = [...ledger]
      .filter((entry) => entry.supportChunk && entry.negativeChunk)
      .sort((left, right) => {
        const leftChunk = left.supportChunk;
        const rightChunk = right.supportChunk;
        if (!leftChunk || !rightChunk) return 0;
        return curationWeight(requirement, rightChunk) - curationWeight(requirement, leftChunk);
      });
    for (const entry of contradictedEntries) {
      addUniqueChunk(selected, entry.supportChunk);
      addUniqueChunk(selected, entry.negativeChunk);
      if (selected.length >= 3) return selected.slice(0, 3);
    }
  }

  const supportedEntries = [...ledger]
    .filter((entry) => entry.supportChunk)
    .sort((left, right) => {
      const leftChunk = left.supportChunk;
      const rightChunk = right.supportChunk;
      if (!leftChunk || !rightChunk) return 0;
      return curationWeight(requirement, rightChunk) - curationWeight(requirement, leftChunk);
    });

  const selectedSupportElements = new Set<string>();
  for (const entry of supportedEntries) {
    const supportChunk = entry.supportChunk;
    const supportedElements = supportChunk ? quoteSupportedElementIds(requirement, supportChunk) : [];
    const addsRequiredElement = supportedElements.some((elementId) => !selectedSupportElements.has(elementId));
    if (addsRequiredElement) {
      addUniqueChunk(selected, supportChunk);
      for (const elementId of supportedElements) {
        selectedSupportElements.add(elementId);
      }
    }
    if (selected.length >= 3) return selected;
  }

  if (status === "partial" && selected.length < 3) {
    const relevantLimitations = sortByEvidenceWeight(
      requirement,
      [...organizationNegative, ...documentScopeLimitations],
    ).filter((chunk) => {
      const requiredElements = finalizedEvidenceElementIds(requirement, chunk);
      const optionalElements = finalizedOptionalNegativeElementIds(requirement, chunk);
      return requiredElements.length > 0 || optionalElements.length > 0;
    });
    const selectedLimitationElements = new Set<string>();
    for (const chunk of relevantLimitations) {
      const limitationElements = uniqueStrings([
        ...finalizedEvidenceElementIds(requirement, chunk),
        ...finalizedOptionalNegativeElementIds(requirement, chunk),
      ]);
      if (!limitationElements.some((elementId) => !selectedLimitationElements.has(elementId))) continue;
      addUniqueChunk(selected, chunk);
      for (const elementId of limitationElements) selectedLimitationElements.add(elementId);
      if (selected.length >= 3) return selected;
    }
  }

  if (status === "missing") {
    const selectedNegativeElements = new Set<string>();
    for (const chunk of sortByEvidenceWeight(requirement, organizationNegative)) {
      const negativeElements = finalizedEvidenceElementIds(requirement, chunk);
      if (!negativeElements.some((elementId) => !selectedNegativeElements.has(elementId))) continue;
      addUniqueChunk(selected, chunk);
      for (const elementId of negativeElements) selectedNegativeElements.add(elementId);
      if (selected.length >= 3) return selected;
    }
    const contextualCandidates = sortByEvidenceWeight(requirement, background)
      .filter((chunk) => sectionPreferenceWeight(requirement, chunk) > 0 || signalWeight(requirement, chunk) > 0);
    for (const chunk of contextualCandidates) {
      addUniqueChunk(selected, chunk);
      if (selected.length >= 3) return selected;
    }
  }

  if (status === "needs_review") {
    for (const chunk of sortByEvidenceWeight(requirement, [...documentScopeLimitations, ...background])) {
      addUniqueChunk(selected, chunk);
      if (selected.length >= 3) return selected;
    }
  }

  return selected.slice(0, 3);
}

function confidenceForStatus(status: FindingStatus, evidence: GradedEvidenceChunk[]): FindingConfidence {
  const hasHighConfidenceEvidence = evidence.some(
    (chunk) => chunk.classifier_confidence === "high",
  );
  const hasMediumConfidenceEvidence = evidence.some(
    (chunk) => chunk.classifier_confidence === "medium",
  );

  if (status === "missing" && evidence.length === 0) return "medium";
  if (status === "needs_review") return "low";
  if (hasHighConfidenceEvidence) return "high";
  if (hasMediumConfidenceEvidence || evidence.length > 0) return "medium";
  return "low";
}

function severityForRequirement(requirement: RegSpRequirement): FindingSeverity {
  if (requirement.riskSeverity) {
    return requirement.riskSeverity;
  }

  return highImpactRequirements.has(requirement.id) ? "high" : "medium";
}

function statusSummary(_requirement: RegSpRequirement, status: FindingStatus) {
  switch (status) {
    case "covered":
      return "Appears covered based on reviewed documents.";
    case "partial":
      return "Partially covered based on reviewed documents.";
    case "missing":
      return "RegSpan did not find client policy evidence for this requirement.";
    case "conflicting":
      return "Reviewed documents appear to conflict on whether this requirement is addressed.";
    case "needs_review":
      return "RegSpan found related policy language, but not enough detail to confirm full coverage.";
  }
}

export function remediationForFinding(
  requirement: RegSpRequirement,
  status: FindingStatus,
  missingRequired: string[] = [],
) {
  if (status === "covered") {
    return "Keep this procedure current and confirm related procedures point to it during the next review.";
  }

  const base = `Update the organization’s documentation to clearly address this requirement: ${requirement.description}`;
  if (status === "conflicting") {
    return `${base} Resolve the contradiction between the documents and identify which policy or procedure is authoritative.`;
  }
  if (status === "partial") {
    return partialRemediationForRequirement(requirement, missingRequired);
  }
  if (status === "needs_review") {
    return `Add or point to the procedure that defines ${needsReviewDetailForRequirement(requirement, missingRequired)}. A reviewer should confirm whether another policy already contains this detail.`;
  }
  return `Add or point to written procedures that define ${needsReviewDetailForRequirement(requirement, missingRequired)}. Include responsibility, timing, required steps, handoffs, approvals, and records to retain where applicable.`;
}

function reviewedDocumentLabel(chunk: GradedEvidenceChunk | undefined) {
  return chunk?.filename ? `The reviewed document ${chunk.filename}` : "A reviewed document";
}

function quoteSummary(requirement: RegSpRequirement, chunk: GradedEvidenceChunk | undefined) {
  const quote = chunk ? finalizedSourceQuote(requirement, chunk)?.trim() : null;
  if (!quote) return null;
  return quote.length > 180 ? `${quote.slice(0, 177).trim()}…` : quote;
}

function whatWeFoundForFinding({
  requirement,
  status,
  direct,
  partial,
  background,
  organizationNegative,
  documentScopeLimitations,
  ignoredReferenceCount,
  coveredRequired,
  missingRequired,
  vagueRequired,
}: {
  requirement: RegSpRequirement;
  status: FindingStatus;
  direct: GradedEvidenceChunk[];
  partial: GradedEvidenceChunk[];
  background: GradedEvidenceChunk[];
  organizationNegative: GradedEvidenceChunk[];
  documentScopeLimitations: GradedEvidenceChunk[];
  ignoredReferenceCount: number;
  coveredRequired: string[];
  missingRequired: string[];
  vagueRequired: string[];
}) {
  const strongestSupport = direct[0] ?? partial[0];
  const strongestLimitation = documentScopeLimitations[0];
  const strongestOrganizationNegative = organizationNegative[0];
  const supportQuote = quoteSummary(requirement, strongestSupport);
  const limitationQuote = quoteSummary(requirement, strongestLimitation);
  const organizationNegativeQuote = quoteSummary(requirement, strongestOrganizationNegative);
  const supportDocument = reviewedDocumentLabel(strongestSupport);
  const limitationDocument = reviewedDocumentLabel(strongestLimitation);
  const negativeDocument = reviewedDocumentLabel(strongestOrganizationNegative);
  const coveredSummary = coveredFindingSentence(requirement, coveredRequired);
  const missingSummary = partialMissingSentence(requirement, missingRequired);
  const vagueSummary = partialMissingSentence(requirement, vagueRequired);
  const parts: string[] = [];

  if (status === "covered") {
    if (supportQuote) {
      parts.push(`${supportDocument} states: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} defines the main elements of this requirement.`);
    }
    if (coveredRequired.length > 0) {
      parts.push(coveredSummary);
    }
  }

  if (status === "partial") {
    if (supportQuote) {
      parts.push(`${supportDocument} mentions this area: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} mentions this area, but the reviewed evidence does not clearly define the full process.`);
    }
    if (coveredRequired.length > 0) {
      parts.push(coveredSummary);
    }
    if (missingRequired.length > 0) {
      parts.push(missingSummary);
    } else if (vagueRequired.length > 0) {
      parts.push(vagueSummary);
    } else {
      parts.push("Important details such as ownership, timing, approvals, escalation, or follow-up may still need to be documented.");
    }
    if (documentScopeLimitations.length > 0) {
      parts.push("Some related documents limit their own scope, so they should not be treated as organization-wide contradictions by themselves.");
    }
  }

  if (status === "conflicting") {
    if (supportQuote) {
      parts.push(`${supportDocument} appears to address this requirement: “${supportQuote}”`);
    } else {
      parts.push(`${supportDocument} appears to address this requirement.`);
    }
    if (organizationNegativeQuote) {
      parts.push(`${negativeDocument} appears to contradict that support: “${organizationNegativeQuote}”`);
    } else {
      parts.push(`${negativeDocument} appears to say the firm does not address this requirement.`);
    }
    parts.push("A reviewer should confirm which document is authoritative.");
  }

  if (status === "missing") {
    if (organizationNegativeQuote) {
      parts.push(`${negativeDocument} states: “${organizationNegativeQuote}”`);
      parts.push("RegSpan did not find stronger reviewed policy evidence showing this requirement is addressed.");
    } else {
      parts.push("RegSpan did not find clear policy or procedure language in the reviewed documents that addresses this requirement.");
    }
  }

  if (status === "needs_review") {
    if (documentScopeLimitations.some(referencesUnavailablePolicy) && !strongestSupport) {
      if (limitationQuote) {
        parts.push(`${limitationDocument} points to another policy or procedure for this requirement: “${limitationQuote}”`);
      } else {
        parts.push(`${limitationDocument} points to another policy or procedure for this requirement.`);
      }
      parts.push("A reviewer should confirm whether that referenced document is available and addresses the required elements.");
    } else if (background.some(hasUnclearApplicability)) {
      const applicabilityChunk = background.find(hasUnclearApplicability);
      const applicabilityQuote = quoteSummary(requirement, applicabilityChunk);
      const applicabilityDocument = reviewedDocumentLabel(applicabilityChunk);
      if (applicabilityQuote) {
        parts.push(`${applicabilityDocument} raises an applicability question: “${applicabilityQuote}”`);
      } else {
        parts.push(`${applicabilityDocument} raises an applicability question for this requirement.`);
      }
      parts.push("A reviewer should confirm whether the requirement applies to the reviewed business, product, or customer information.");
    } else if (background.length > 0) {
      parts.push("RegSpan found related policy language, but not enough detail to confirm full coverage.");
    } else {
      parts.push("A reviewer should confirm whether this requirement is addressed in another policy or procedure.");
    }
  }

  if (ignoredReferenceCount > 0) {
    parts.push("Public guidance or other reference material was not treated as proof that the firm addresses this requirement.");
  }

  return parts.join(" ");
}

function evidenceReasonForStorage(
  requirement: RegSpRequirement,
  chunk: GradedEvidenceChunk,
  relationship: GeneratedFindingEvidence["relationship"],
  quoteCovered: string[],
  negativeScopeByChunkId: Map<string, NegativeEvidenceScope>,
) {
  const reason = chunk.grade_reason
    .replace(/\bthe chunk\b/gi, "the cited text")
    .replace(/\bchunk\b/gi, "cited text")
    .replace(/\bthe cited text explicitly\b/gi, "the excerpt")
    .replace(/\bthe cited text\b/gi, "the excerpt")
    .trim();
  const negativeScope = negativeScopeByChunkId.get(chunk.chunk_id);
  if (relationship === "negative_evidence") {
    const limited = renderedElementList(requirement, quoteCovered, "missing");
    return limited
      ? `The cited section explicitly limits ${limited}.`
      : "The selected quote describes a limitation but does not negate a required element.";
  }
  if (negativeScope === "organization_level_negative") {
    return `The reviewed document appears to say this requirement is not addressed: ${reason}`;
  }
  if (negativeScope === "document_scope_limitation") {
    return referencesUnavailablePolicy(chunk)
      ? `This document points to another policy or procedure for this requirement. ${reason}`
      : `This document limits what it covers for this requirement. RegSpan does not treat that as a contradiction by itself. ${reason}`;
  }
  if (relationship === "supports") {
    const covered = renderedElementList(requirement, quoteCovered, "found");
    const quoteMissing = requirement.requiredElementsForCovered.filter((elementId) => !quoteCovered.includes(elementId));
    if (covered.length > 0 && quoteMissing.length === 0) {
      return `The cited section ${covered}.`;
    }
    if (covered.length > 0) {
      return "The cited section discusses " + covered
        + ", but additional required elements are not proven by this quote.";
    }
    return "The selected quote is related to the requirement but does not prove a required element.";
  }
  if (relationship === "partially_supports") {
    const covered = renderedElementList(requirement, quoteCovered, "partial");
    const quoteMissing = requirement.requiredElementsForCovered.filter((elementId) => !quoteCovered.includes(elementId));
    return [
      covered.length > 0
        ? `The cited section discusses ${covered}.`
        : "The cited section is related to this requirement.",
      quoteMissing.length > 0 ? "Additional required elements are not proven by this quote." : null,
    ].filter(Boolean).join(" ");
  }
  if (chunk.evidence_relationship === "background_context") {
    return `Related context: ${reason}`;
  }
  return reason;
}

function evidenceForStorage(
  requirement: RegSpRequirement,
  chunks: GradedEvidenceChunk[],
  negativeScopeByChunkId: Map<string, NegativeEvidenceScope>,
): GeneratedFindingEvidence[] {
  return chunks
    .filter((chunk) => chunk.evidence_relationship === "background_context" || hasSubstantiveExactSourceQuote(requirement, chunk))
    .slice(0, 3)
    .map((chunk) => {
      const quote = hasSubstantiveExactSourceQuote(requirement, chunk)
        ? finalizedSourceQuote(requirement, chunk)
        : null;
      const relationship = finalizedEvidenceRelationship(requirement, chunk);
      const quoteCovered = quote
        ? relationship === "negative_evidence"
          ? uniqueStrings([
            ...evidenceElementIdsForQuote(requirement, chunk, quote),
            ...optionalNegativeElementIdsForQuote(requirement, chunk, quote),
          ])
          : evidenceElementIdsForQuote(requirement, chunk, quote)
        : [];
      return {
        chunk_id: chunk.chunk_id,
        document_id: chunk.document_id,
        relationship,
        quote,
        reason: evidenceReasonForStorage(
          requirement,
          chunk,
          relationship,
          quoteCovered,
          negativeScopeByChunkId,
        ),
        confidence: chunk.classifier_confidence,
        filename: chunk.filename,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        section_path: chunk.section_path,
        chunk_index: chunk.chunk_index,
      };
    });
}

export function aggregateFindingForRequirement(
  requirement: RegSpRequirement,
  gradedChunks: GradedEvidenceChunk[],
): GeneratedRequirementFinding {
  const organizationChunks = organizationEvidence(gradedChunks);
  const direct = organizationChunks.filter((chunk) => isSourceGroundedDirectSupport(requirement, chunk));
  const partial = organizationChunks.filter((chunk) => isSourceGroundedPartialSupport(requirement, chunk));
  const background = organizationChunks.filter(isBackgroundContext);
  const negative = organizationChunks.filter((chunk) => isSourceGroundedNegativeEvidence(requirement, chunk));
  const negativeScopeByChunkId = new Map(
    negative.map((chunk) => [chunk.chunk_id, classifyNegativeEvidenceScope(chunk)]),
  );
  const organizationNegative = negative.filter(
    (chunk) => negativeScopeByChunkId.get(chunk.chunk_id) === "organization_level_negative",
  );
  const documentScopeLimitations = negative.filter(
    (chunk) => negativeScopeByChunkId.get(chunk.chunk_id) === "document_scope_limitation",
  );
  const ignoredReferenceCount = gradedChunks.length - organizationChunks.length;
  const strongestDirect = sortByEvidenceWeight(requirement, direct);
  const strongestPartial = sortByEvidenceWeight(requirement, partial);
  const strongestOrganizationNegative = sortByEvidenceWeight(requirement, organizationNegative);
  const strongestDocumentScopeLimitations = sortByEvidenceWeight(requirement, documentScopeLimitations);
  const strongestBackground = sortByEvidenceWeight(requirement, background);
  const supportingEvidence = [...strongestDirect, ...strongestPartial];
  const ledger = buildElementCoverageLedger(
    requirement,
    supportingEvidence,
    strongestOrganizationNegative,
  );
  const coveredRequired = supportedRequiredElementsFromLedger(ledger);
  const fullyCoveredRequired = fullySupportedRequiredElementsFromLedger(ledger);
  const incompleteRequired = requirement.requiredElementsForCovered.filter(
    (elementId) => !fullyCoveredRequired.includes(elementId),
  );
  const contradictedElements = contradictedRequiredElementsFromLedger(ledger);
  const hasOptionalNegativeLimitation = [...strongestOrganizationNegative, ...strongestDocumentScopeLimitations].some(
    (chunk) => finalizedOptionalNegativeElementIds(requirement, chunk).length > 0,
  );
  const vagueRequired = uniqueStrings(supportingEvidence.flatMap((chunk) => chunk.vague_elements ?? []))
    .filter((elementId) => requirement.requiredElementsForCovered.includes(elementId));
  const hasFullRequiredCoverage = fullyCoveredRequired.length === requirement.requiredElementsForCovered.length;
  const hasMeaningfulElementSupport = coveredRequired.length > 0;
  const hasAmbiguousEvidence = hasTrueAmbiguity({
    documentScopeLimitations: strongestDocumentScopeLimitations,
    background: strongestBackground,
  });

  let status: FindingStatus;
  if (hasFullRequiredCoverage && contradictedElements.length > 0) {
    status = "conflicting";
  } else if (hasFullRequiredCoverage && hasOptionalNegativeLimitation) {
    status = "partial";
  } else if (hasFullRequiredCoverage) {
    status = "covered";
  } else if (hasMeaningfulElementSupport) {
    status = "partial";
  } else if (strongestOrganizationNegative.length > 0) {
    status = "missing";
  } else if (hasAmbiguousEvidence) {
    status = "needs_review";
  } else {
    status = "missing";
  }

  const evidence = [
    ...strongestDirect,
    ...strongestPartial,
    ...strongestOrganizationNegative,
    ...strongestDocumentScopeLimitations,
    ...strongestBackground,
  ];
  const curatedEvidence = curateEvidenceChunks({
    requirement,
    status,
    ledger,
    organizationNegative: strongestOrganizationNegative,
    documentScopeLimitations: strongestDocumentScopeLimitations,
    background: strongestBackground,
  });
  const curatedDirect = curatedEvidence.filter((chunk) => isSourceGroundedDirectSupport(requirement, chunk));
  const curatedPartial = curatedEvidence.filter((chunk) => isSourceGroundedPartialSupport(requirement, chunk));
  const curatedBackground = curatedEvidence.filter(isBackgroundContext);
  const curatedOrganizationNegative = curatedEvidence.filter(
    (chunk) => negativeScopeByChunkId.get(chunk.chunk_id) === "organization_level_negative",
  );
  const curatedDocumentScopeLimitations = curatedEvidence.filter(
    (chunk) => negativeScopeByChunkId.get(chunk.chunk_id) === "document_scope_limitation",
  );
  return {
    requirement_id: requirement.id,
    requirement_name: requirement.title,
    status,
    severity: severityForRequirement(requirement),
    confidence: confidenceForStatus(status, curatedEvidence.length > 0 ? curatedEvidence : evidence),
    summary: statusSummary(requirement, status),
    remediation: remediationForFinding(requirement, status, status === "covered" ? [] : incompleteRequired),
    rationale: whatWeFoundForFinding({
      requirement,
      status,
      direct: curatedDirect,
      partial: curatedPartial,
      background: curatedBackground.length > 0 ? curatedBackground : strongestBackground,
      organizationNegative: curatedOrganizationNegative,
      documentScopeLimitations: curatedDocumentScopeLimitations,
      ignoredReferenceCount,
      coveredRequired,
      missingRequired: status === "covered" ? [] : incompleteRequired,
      vagueRequired,
    }),
    evidence: evidenceForStorage(requirement, curatedEvidence, negativeScopeByChunkId),
  };
}
