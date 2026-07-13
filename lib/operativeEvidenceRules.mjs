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
    unauthorized_access_detection_escalation: "incident_assessment_containment_control",
    service_provider_incident_oversight_notice: "vendor_incident_handling",
    customer_information_safeguards: "safeguards_customer_information",
    incident_evidence_log_preservation: "evidence_log_preservation",
    response_recovery_remediation_validation: "remediation_recovery_validation",
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

function hasIncidentAssessmentContext(sentence) {
  return /\b(?:incident|security event|cyber(?:security)? event|unauthorized access|unauthorized use|breach)\b/.test(sentence);
}

function incidentAssessmentElementMatches(elementId, value) {
  const sourceSentences = sentences(value);
  const matches = (pattern) => sourceSentences.some((sentence) => pattern.test(sentence));

  switch (elementId) {
    case "assesses_scope":
      return matches(/\b(?:assess(?:es|ment)?|review(?:s|ed)?|triage|classif(?:y|ies|ied))\b[^.!?]{0,100}\b(?:nature|scope|impact|affected|unauthorized access|unauthorized use|incident)\b/)
        && sourceSentences.some(hasIncidentAssessmentContext);
    case "customer_information_systems":
      return matches(/\b(?:identif(?:y|ies|ied)|determin(?:e|es|ed)|assess(?:es|ment)?|affected|impacted)\b[^.!?]{0,120}\b(?:customer information systems?|customer data|customer information|information types?|data types?|systems?)\b/)
        && sourceSentences.some(hasIncidentAssessmentContext);
    case "containment_control":
      return matches(/\b(?:contain(?:ment)? (?:and )?control|isolate(?:s|d|ing)? (?:affected )?(?:systems?|assets?)|block(?:s|ed|ing)? (?:unauthorized )?access|disable(?:s|d|ing)? (?:affected )?(?:systems?|accounts?)|reset(?:s|ting)? credentials|(?:takes?|performs?) containment steps?)\b/)
        && sourceSentences.some(hasIncidentAssessmentContext);
    default:
      return null;
  }
}

function writtenIncidentProgramElementMatches(elementId, value) {
  const sourceSentences = sentences(value);
  const matches = (pattern) => sourceSentences.some((sentence) => pattern.test(sentence));

  switch (elementId) {
    case "written_program":
      return matches(/\b(?:maintains?|establishes?|adopts?|has)\b[^.!?]{0,100}\b(?:written|documented)\b[^.!?]{0,100}\b(?:incident response|cyber(?:security)? event response)\b[^.!?]{0,80}\b(?:program|plan|policy|standard|procedure)\b/);
    case "customer_information_scope":
      return matches(/\b(?:program|plan|policy|standard|procedure|workflow)\b[^.!?]{0,120}\b(?:customer information|customer records?|sensitive customer information|customer information systems?)\b|\b(?:customer information|customer records?|sensitive customer information|customer information systems?)\b[^.!?]{0,120}\b(?:program|plan|policy|standard|procedure|workflow)\b/);
    case "response_recovery_responsibilities":
      return matches(/\b(?:program|plan|policy|standard|procedure|workflow)\b[^.!?]{0,150}\b(?:detect(?:ion)?|respond|response)\b[^.!?]{0,150}\b(?:recover|recovery|restor(?:e|ation))\b|\b(?:detect(?:ion)?|respond|response)\b[^.!?]{0,150}\b(?:recover|recovery|restor(?:e|ation))\b[^.!?]{0,150}\b(?:program|plan|policy|standard|procedure|workflow)\b/);
    default:
      return null;
  }
}

function noticeContentElementMatches(elementId, value) {
  const normalized = normalize(value);
  switch (elementId) {
    case "incident_description":
      return /\b(?:describ\w*|description of|what happened|incident details?)\b/.test(normalized);
    case "information_involved":
      return /\b(?:categories?|types?|sensitive customer information|information involved|data elements?)\b/.test(normalized)
        && /\b(?:information|data)\b/.test(normalized);
    case "protective_steps":
      return /\b(?:protective steps?|actions? (?:customers?|individuals?) can take to protect|monitor (?:their )?accounts?|suspicious activity|fraud alert|credit report|identity theft)\b/.test(normalized);
    case "contact_information":
      return /\b(?:toll[- ]free|telephone|phone|email|contact (?:information|the firm|us))\b/.test(normalized);
    case "fraud_credit_identity_resources":
      return /\bfraud alerts?\b/.test(normalized)
        && /\b(?:nationwide )?credit reports?|free (?:credit )?reports?\b/.test(normalized)
        && /\b(?:identity theft|federal trade commission|ftc)\b/.test(normalized);
    case "written_delivery_requirements":
      return /\b(?:clear and conspicuous|written notice|notice in writing)\b/.test(normalized)
        && /\b(?:deliver|delivery|mail|electronic mail|email|send)\b/.test(normalized);
    default:
      return null;
  }
}

function safeguardsElementMatches(elementId, value) {
  const sourceSentences = sentences(value);
  const matches = (pattern) => sourceSentences.some((sentence) => pattern.test(sentence));

  switch (elementId) {
    case "customer_information_scope":
      return matches(/\b(?:customer information|customer records?|customer data|customer information systems?)\b/);
    case "administrative_safeguards":
      return matches(/\b(?:administrative safeguards?|security training|employee confidentiality|confidentiality obligations?|access approval|access review|least privilege)\b/);
    case "technical_safeguards":
      return matches(/\b(?:technical safeguards?|encryption|authentication|passwords?|access restrictions?|multifactor|multi-factor)\b/);
    case "physical_safeguards":
      return matches(/\b(?:physical safeguards?|physical access|locked (?:facility|facilities|workspace|storage)|secure (?:workspace|facility|storage)|visitor access|device storage)\b/);
    case "safeguards_controls":
      return matches(/\b(?:safeguards?|access controls?|encryption|authentication)\b/);
    default:
      return null;
  }
}

function incidentEvidenceElementMatches(elementId, value) {
  const normalized = normalize(value);
  const hasPreservationAction = /\b(?:preserv\w*|retain\w*|maintain\w*)\b/.test(normalized);
  const hasIncidentMaterial = /\b(?:logs?|exports?|screenshots?|forensic (?:data|evidence)|investigation (?:materials?|records?|notes)|incident (?:materials?|records?|emails?|notes?|tickets?)|security[- ]console exports?|volatile information)\b/.test(normalized)
    || /\b(?:emails?|notes?)\b[^.!?]{0,100}\b(?:incidents?|security events?|breaches?)\b/.test(normalized);

  switch (elementId) {
    case "incident_materials":
      return hasPreservationAction && hasIncidentMaterial;
    case "preservation_process":
      return hasPreservationAction
        && hasIncidentMaterial
        && /\b(?:policy|procedure|program|standard|process|plan|record requires?|must|shall|for investigation|for compliance|chain of custody|retention period)\b/.test(normalized);
    case "integrity_or_chain_of_custody":
      return /\b(?:chain of custody|records integrity|provenance|custody)\b/.test(normalized);
    default:
      return null;
  }
}

function recoveryElementMatches(elementId, value) {
  const normalized = normalize(value);
  const appendixInventory = /\b(?:appendix|incident file minimum contents?|record categories?|minimum contents?)\b/.test(normalized);
  if (appendixInventory) {
    return elementId === "recovery_steps" && /\brecovery steps?\b/.test(normalized);
  }

  switch (elementId) {
    case "recovery_steps":
      return /\b(?:restor\w*|recover\w*|return(?:s|ed|ing)? (?:systems?|services?) to (?:normal )?operation)\b/.test(normalized)
        && /\b(?:owners?|teams?|firm|organization|procedure|program|plan|must|shall|will|requires?|recovery activities? include)\b/.test(normalized);
    case "remediation_tracking":
      return /\b(?:remediation|corrective actions?)\b/.test(normalized)
        && /\b(?:assign(?:s|ed|ment)?|owner|due date|track(?:s|ed|ing)?|remain open|evidence of completion|closure|confirm(?:s|ed|ing)? remediation tasks?)\b/.test(normalized);
    case "validation_testing":
      return /\b(?:validat(?:e|es|ed|ing|ion)|verif(?:y|ies|ied|ying)|confirm(?:s|ed|ing))\b/.test(normalized)
        && /\b(?:restor(?:ed|ation|e)|recovery|access|logging|network connectivity|data integrity|transactions?|business functions?|remediation)\b/.test(normalized);
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
    const hasScopedRecordCategory = /\b(?:notification|notice|incident response|attorney general delay)\b[^.!?]{0,120}\b(?:determinations?|copies?|records?|documentation|supporting facts?)\b/.test(sentence);
    const genericOperationalContext = /\b(?:operational|department(?:al)?|business|administrative)\s+records?\b|\bdepartment practice\b/.test(sentence);
    const hasScopedRecordContext = hasRelevantComplianceRecordScope(sentence)
      && hasOperativeComplianceRecordScope(sentence);
    return hasRetention
      && !genericOperationalContext
      && (refersToRecords || hasScopedRecordContext || hasScopedRecordCategory);
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
  const incidentSpecificDelayResumptionProcedure = /\b(?:incidents?|breaches?|security events?|unauthorized access|cyber(?:security)? events?)\b/.test(normalized)
    && /\b(?:regulator|regulatory|law[- ]enforcement|authorities|attorney general|external)\b/.test(normalized)
    && /\b(?:legal|compliance|privacy counsel|general counsel)\b/.test(normalized)
    && /\b(?:customer|external) communications?\b/.test(normalized)
    && /\b(?:delay(?:ed|s|ing)?|postpon(?:e|ed|ement|ing)|withhold(?:s|ing|held)?|resum(?:e|es|ed|ing|ption)|releas(?:e|es|ed|ing))\b/.test(normalized)
    && /\b(?:request(?:s|ed|ing)?|record(?:s|ed|ing)?|document(?:s|ed|ing)?|advis(?:e|es|ed|ing)|coordinat(?:e|es|ed|ing)|evaluat(?:e|es|ed|ing))\b/.test(normalized);

  switch (elementId) {
    case "external_notification_decisioning":
      return incidentSpecificExternalNotification
        && /\b(?:decide|decides|decision|determine|determines|determination|assess(?:es|ment)?|evaluate|evaluates|review(?:s)? whether|whether .*?(?:required|notify|report))\b/.test(normalized);
    case "legal_compliance_coordination":
      return incidentSpecificDelayResumptionProcedure
        || (incidentSpecificExternalNotification
          && /\b(?:coordinat(?:e|es|ed|ion)|legal|compliance|privacy counsel|general counsel)\b/.test(normalized)
          && /\b(?:decide|decides|decision|determine|determines|determination|review|assess|evaluate|coordinate|notification|reporting)\b/.test(normalized));
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
    case "incident_assessment_containment_control":
      return incidentAssessmentElementMatches(elementId, value);
    case "written_incident_response_program":
      return writtenIncidentProgramElementMatches(elementId, value);
    case "customer_notification_content":
      return noticeContentElementMatches(elementId, value);
    case "safeguards_customer_information":
      return safeguardsElementMatches(elementId, value);
    case "evidence_log_preservation":
      return incidentEvidenceElementMatches(elementId, value);
    case "remediation_recovery_validation":
      return recoveryElementMatches(elementId, value);
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
    incident_assessment_containment_control: [
      "assesses_scope",
      "customer_information_systems",
      "containment_control",
    ],
    written_incident_response_program: [
      "written_program",
      "customer_information_scope",
      "response_recovery_responsibilities",
    ],
    customer_notification_content: [
      "incident_description",
      "information_involved",
      "protective_steps",
      "contact_information",
      "fraud_credit_identity_resources",
      "written_delivery_requirements",
    ],
    safeguards_customer_information: [
      "customer_information_scope",
      "administrative_safeguards",
      "technical_safeguards",
      "physical_safeguards",
    ],
    evidence_log_preservation: [
      "incident_materials",
      "preservation_process",
    ],
    remediation_recovery_validation: [
      "recovery_steps",
      "remediation_tracking",
      "validation_testing",
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
