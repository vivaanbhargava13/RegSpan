function normalize(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentences(value) {
  return (value.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [value])
    .map((sentence) => normalize(sentence))
    .filter(Boolean);
}

function canonicalRequirementId(requirementId) {
  return {
    service_provider_incident_oversight_notice: "vendor_incident_handling",
    regulator_law_enforcement_notification_coordination: "regulator_law_enforcement_notification",
  }[requirementId] ?? requirementId;
}

function hasOperativeObligation(sentence) {
  // A mandatory clause remains operative even where it permits a separate action.
  // Bare discretionary, aspirational, or role-assignment language is not enough.
  return /\b(?:must|shall|will|requires?|required(?:\s+to)?|responsible for ensuring)\b/.test(sentence);
}

function hasCustomerNoticeObligation(sentence) {
  const mandatoryCustomerNotice = hasOperativeObligation(sentence)
    && /\b(?:notify|notifies|notified|notifying|notification|notice)\b/.test(sentence)
    && /\b(?:customers?|consumers?|individuals?|people|clients?)\b/.test(sentence);
  const noticeDecisionOrPresumption = /\b(?:notice|notification)\s+(?:is\s+)?(?:required|presumed)\b/.test(sentence)
    && /\b(?:customers?|consumers?|individuals?|sensitive customer information|customer information)\b/.test(sentence);
  return mandatoryCustomerNotice || noticeDecisionOrPresumption;
}

function customerNotificationTriggerElementMatches(elementId, value) {
  const normalized = normalize(value);
  if (!sentences(value).some(hasCustomerNoticeObligation)) return false;

  switch (elementId) {
    case "unauthorized_access_or_use":
      return /\b(?:unauthorized access|unauthorized use|breach)\b/.test(normalized)
        && /\b(?:sensitive customer information|customer information|customer records?|customer data)\b/.test(normalized);
    case "notice_trigger_standard":
      return /\b(?:substantial harm|substantial inconvenience|reasonably likely|determines? whether (?:notice|notification) is required|notice is required)\b/.test(normalized);
    case "notice_timing":
      return /\b(?:as soon as practicable|not later than 30 days|within 30 days|without unreasonable delay)\b/.test(normalized);
    default:
      return null;
  }
}

function hasServiceProviderActor(sentence) {
  return /\b(?:service[- ]providers?|vendors?|suppliers?|third[- ]part(?:y|ies))\b/.test(sentence);
}

function isRoleAssignmentOnly(sentence) {
  return /\b(?:owner|coordinator|liaison|contact|manager)\b[^.!?]{0,120}\b(?:coordinates?|serves?|owns?|handles?|prepares?)\b/.test(sentence);
}

function hasOperativeServiceProviderGovernance(sentence) {
  if (!hasServiceProviderActor(sentence) || isRoleAssignmentOnly(sentence)) return false;
  if (hasOperativeObligation(sentence)) return true;
  const firmGovernance = /\b(?:firm|company|organization|institution|procurement|compliance)\b[^.!?]{0,100}\b(?:conducts?|performs?|maintains?|monitors?|oversees?|requires?)\b[^.!?]{0,140}\b(?:service[- ]providers?|vendors?|suppliers?|third[- ]part(?:y|ies))\b/.test(sentence);
  const oversightEnsuresProviderAction = /\b(?:oversight|procedures?|contracts?|agreements?|requirements?)\b[^.!?]{0,100}\b(?:designed to ensure|ensure|requires?)\b[^.!?]{0,140}\b(?:service[- ]providers?|vendors?|suppliers?|third[- ]part(?:y|ies))\b[^.!?]{0,140}\b(?:protect|safeguards?|notify|report)\b/.test(sentence);
  return firmGovernance || oversightEnsuresProviderAction;
}

function serviceProviderElementMatchesFromOperativeText(elementId, value) {
  const governingSentences = sentences(value).filter(hasOperativeServiceProviderGovernance);
  if (governingSentences.length === 0) return false;
  const matches = (pattern) => governingSentences.some((sentence) => pattern.test(sentence));

  switch (elementId) {
    case "service_provider_scope":
      return matches(/\b(?:due diligence|monitor(?:ing|s|ed)?|oversight|handling customer information|customer information systems?)\b/);
    case "provider_safeguards":
      return matches(/\b(?:protect(?:ion|s|ed|ing)? (?:against )?unauthorized access(?: to| or use of)?|protect(?:ion|s|ed|ing)? customer information|safeguards? (?:for|to protect) customer information|appropriate measures to protect)\b/);
    case "notice_to_firm":
      return matches(/\b(?:notify|notification|notice|report|reporting)\b[^.!?]{0,100}\b(?:firm|institution|organization|company|security operations)\b|\b(?:notify|notification|notice|report|reporting|breach|incident)\b[^.!?]{0,100}\b(?:no later than )?72 hours?\b/);
    case "cooperation_remediation":
      return matches(/\b(?:cooperat(?:e|es|ed|ion)|coordinat(?:e|es|ed|ion)|investigat(?:e|es|ed|ion)|forensic|status updates?|remediat(?:e|es|ed|ion)|corrective actions?|recover(?:y|ies|ed|ing)|containment support)\b/);
    default:
      return null;
  }
}

function hasRelevantComplianceRecordScope(value) {
  return /\b(?:safeguards?|disposal|regulation s-?p|compliance(?: program)?|privacy program|incident response|customer[- ]?notice|notification determinations?|notice determinations?|attorney general delay)\b/.test(value);
}

function hasOperativeComplianceRecordScope(value) {
  const scopedRecordPattern = /\b(?:records?|documentation)\b[^.!?]{0,100}\b(?:demonstrating|documenting)\b[^.!?]{0,140}\b(?:implementation|compliance|safeguards?|disposal|regulation s-?p|compliance program|privacy program)\b/;
  const subjectMatterRecordPattern = /\b(?:safeguards?|disposal|regulation s-?p|compliance program|privacy program|incident response|customer[- ]?notice|notification determinations?|notice determinations?|attorney general delay)\b[^.!?]{0,140}\b(?:records?|documentation|register)\b|\b(?:records?|documentation|register)\b[^.!?]{0,140}\b(?:incident response|customer[- ]?notice|notification determinations?|notice determinations?|attorney general delay)\b/;
  return scopedRecordPattern.test(value) || subjectMatterRecordPattern.test(value);
}

function writtenComplianceRecordElementMatches(elementId, value) {
  const normalized = normalize(value);
  if (
    !hasRelevantComplianceRecordScope(normalized)
    || !hasOperativeComplianceRecordScope(normalized)
    || !/\b(?:must|shall|required|requires?|maintain(?:s|ed|ing)?|keep(?:s|ing)?|retain(?:s|ed|ing)?|make and maintain|records? (?:demonstrating|documenting))\b/.test(normalized)
  ) {
    return false;
  }

  const hasScopedRetentionSentence = sentences(value).some((sentence) => {
    const hasRetention = /\b(?:retain(?:s|ed|ing)?|preserv(?:e|es|ed|ing)|retention period|(?:one|two|three|four|five|six|\d+) years?|easily accessible place|accessible storage)\b/.test(sentence);
    const refersToRecords = /\b(?:(?:these|such|the|all)\s+records?|records?\s+(?:are|were|must be|shall be|remain))\b/.test(sentence);
    const genericOperationalContext = /\b(?:operational|department(?:al)?|business|administrative)\s+records?\b|\bdepartment practice\b/.test(sentence);
    const hasScopedRecordContext = hasRelevantComplianceRecordScope(sentence)
      && hasOperativeComplianceRecordScope(sentence);
    return hasRetention && !genericOperationalContext && (refersToRecords || hasScopedRecordContext);
  });

  switch (elementId) {
    case "compliance_record_scope":
      return /\b(?:records?|documentation)\b[^.!?]{0,100}\b(?:demonstrating|documenting)\b[^.!?]{0,140}\b(?:implementation|compliance|safeguards?|disposal|regulation s-?p|compliance program|privacy program)\b/.test(normalized)
        || /\b(?:safeguards?|disposal|regulation s-?p|compliance program|privacy program)\b[^.!?]{0,140}\b(?:records?|documentation)\b/.test(normalized);
    case "notice_determination_records":
      return /\b(?:notice|notification|incident response|attorney general delay)\b/.test(normalized)
        && /\b(?:determination|notice|notification|copy|record|document)\b/.test(normalized);
    case "retention_accessibility":
      return hasScopedRetentionSentence;
    default:
      return null;
  }
}

function externalNotificationCoordinationElementMatches(elementId, value) {
  const normalized = normalize(value);
  const attorneyGeneralCustomerNoticeDelay = /\bcustomer notice\b[^.!?]{0,120}\bdelay(?:ed)?\b/.test(normalized)
    && /\battorney general\b/.test(normalized)
    && /\b(?:securities and exchange commission|commission|sec)\b/.test(normalized);
  const incidentSpecificExternalNotification = (
    /\b(?:incident|breach|security event|unauthorized access|cyber(?:security)? event)\b/.test(normalized)
    || attorneyGeneralCustomerNoticeDelay
  )
    && /\b(?:regulator|regulatory|law enforcement|authorities|attorney general|external)\b/.test(normalized)
    && /\b(?:notify|notification|notice|report|reporting)\b/.test(normalized);
  if (!incidentSpecificExternalNotification) return false;

  switch (elementId) {
    case "external_notification_decisioning":
      return /\b(?:decide|decides|decision|determine|determines|determination|assess(?:es|ment)?|evaluate|evaluates|review(?:s)? whether|whether .*?(?:required|notify|report))\b/.test(normalized);
    case "legal_compliance_coordination":
      return /\b(?:coordinat(?:e|es|ed|ion)|legal|compliance|privacy counsel|general counsel)\b/.test(normalized)
        && /\b(?:decide|decides|decision|determine|determines|determination|review|assess|evaluate|coordinate|notification|reporting)\b/.test(normalized);
    default:
      return null;
  }
}

// These controls require an operative, scoped obligation; generic topics and role labels may aid retrieval only.
export function requirementSpecificElementMatch(requirementId, elementId, value) {
  switch (canonicalRequirementId(requirementId)) {
    case "customer_notification_unauthorized_access":
      return customerNotificationTriggerElementMatches(elementId, value);
    case "vendor_incident_handling":
      return serviceProviderElementMatchesFromOperativeText(elementId, value);
    case "written_compliance_records":
      return writtenComplianceRecordElementMatches(elementId, value);
    case "regulator_law_enforcement_notification":
      return externalNotificationCoordinationElementMatches(elementId, value);
    default:
      return null;
  }
}

export function usesCanonicalOperativeElementModel(requirementId, elementIds) {
  const requiredElementIds = {
    customer_notification_unauthorized_access: [
      "unauthorized_access_or_use",
      "notice_trigger_standard",
      "notice_timing",
    ],
    vendor_incident_handling: [
      "service_provider_scope",
      "provider_safeguards",
      "notice_to_firm",
    ],
    written_compliance_records: [
      "compliance_record_scope",
      "notice_determination_records",
      "retention_accessibility",
    ],
    regulator_law_enforcement_notification: [
      "external_notification_decisioning",
      "legal_compliance_coordination",
    ],
  }[canonicalRequirementId(requirementId)];
  return Boolean(requiredElementIds && requiredElementIds.every((elementId) => elementIds.includes(elementId)));
}

export function requiresOperativeElementSupport(requirementId, elementIds) {
  return usesCanonicalOperativeElementModel(requirementId, elementIds);
}
