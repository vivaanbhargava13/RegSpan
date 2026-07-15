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

function proceduralUnitGroups(value) {
  // Preserve ordinary wrapped prose while treating each PDF list item as its own
  // semantic group. A records inventory must not combine signals across bullets.
  return String(value ?? "")
    .split(/\n\s*(?=(?:[\u2022*-]|\d+[.)])\s+)/)
    .map((unit) => sentences(unit));
}

function proceduralUnits(value) {
  return proceduralUnitGroups(value).flat();
}

function contiguousProcedureWindows(value, maxUnits = 3) {
  const windows = [];
  for (const units of proceduralUnitGroups(value)) {
    for (let start = 0; start < units.length; start += 1) {
      for (let size = 1; size <= maxUnits && start + size <= units.length; size += 1) {
        windows.push(units.slice(start, start + size).join(" "));
      }
    }
  }
  return windows;
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

function hasSubstantiveCustomerNoticeEvaluation(value) {
  const normalized = normalize(value);
  const hasIncidentAndCustomerContext = /\b(?:unauthorized access|unauthorized use|breach|security incident|incident)\b/.test(normalized)
    && /\b(?:sensitive customer information|customer information|customer records?|affected customers?|affected individuals?)\b/.test(normalized);
  const hasEvaluationOrTimingProcedure = sentences(value).some((sentence) =>
    /\b(?:legal|compliance|privacy|firm|organization)\b[^.!?]{0,80}\b(?:evaluat(?:e|es|ed|ing)|assess(?:es|ed|ment)?|determin(?:e|es|ed|ing)|review(?:s|ed|ing)?)\b[^.!?]{0,100}\b(?:customer )?(?:notice|notification)\b/.test(sentence)
      || /\b(?:customer )?(?:notice|notification)\b[^.!?]{0,120}\b(?:as soon as practic(?:able|al)|within 30 days|30 days|without unreasonable delay)\b/.test(sentence));
  return hasIncidentAndCustomerContext && hasEvaluationOrTimingProcedure;
}

function customerNotificationTriggerElementMatches(elementId, value) {
  const normalized = normalize(value);
  const hasFormalNoticeObligation = sentences(value).some(hasCustomerNoticeObligation);
  const hasSubstantiveEvaluation = hasSubstantiveCustomerNoticeEvaluation(value);
  if (!hasFormalNoticeObligation && !hasSubstantiveEvaluation) return false;

  switch (elementId) {
    case "unauthorized_access_or_use":
      return /\b(?:unauthorized access|unauthorized use|breach)\b/.test(normalized)
        && /\b(?:sensitive customer information|customer information|customer records?|customer data)\b/.test(normalized)
        && (hasSubstantiveEvaluation || hasFormalNoticeObligation);
    case "notice_trigger_standard":
      return hasFormalNoticeObligation
        && /\b(?:substantial harm|substantial inconvenience|reasonably likely|determines? whether (?:notice|notification) is required|notice is required)\b/.test(normalized);
    case "notice_timing":
      return (hasSubstantiveEvaluation || (
        hasFormalNoticeObligation
        && /\b(?:unauthorized access|unauthorized use|breach)\b/.test(normalized)
        && /\b(?:sensitive customer information|customer information|customer records?|customer data)\b/.test(normalized)
      ))
        && /\b(?:as soon as practic(?:able|al)|not later than 30 days|within 30 days|30 days|without unreasonable delay)\b/.test(normalized);
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
  const provider = "(?:service[- ]providers?|vendors?|suppliers?|third[- ]part(?:y|ies))";
  const firmGovernance = new RegExp(
    `\\b(?:firm|company|organization|institution|procurement|compliance|business owners?)\\b[^.!?]{0,80}\\b(?:conducts?|performs?|maintains?|oversees?|requires?)\\b[^.!?]{0,100}\\b${provider}\\b`,
  ).test(sentence);
  const oversightEnsuresProviderAction = /\b(?:oversight|procedures?|contracts?|agreements?|requirements?)\b[^.!?]{0,100}\b(?:designed to ensure|ensure|requires?)\b[^.!?]{0,140}\b(?:service[- ]providers?|vendors?|suppliers?|third[- ]part(?:y|ies))\b[^.!?]{0,140}\b(?:protect|safeguards?|notify|report)\b/.test(sentence);
  const discretionaryProviderPractice = /\b(?:should|may|can|plans? to|expects? to|intends? to)\b/.test(sentence);
  const directOperationalOversight = !discretionaryProviderPractice && (
    new RegExp(`\\b(?:review(?:s|ed|ing)?|monitor(?:s|ed|ing)?)\\b\\s+(?:(?:critical|important|selected|covered|material|third[- ]party)\\s+){0,3}${provider}\\b`).test(sentence)
    || new RegExp(`\\b${provider}\\b\\s+(?:are|is|were|was|must be|shall be|will be)?\\s*(?:review(?:s|ed|ing)?|monitor(?:s|ed|ing)?)\\b[^.!?]{0,80}\\b(?:before engagement|periodic(?:ally)?|ongoing|renewal|annual(?:ly)?)\\b`).test(sentence)
    || new RegExp(`\\b(?:conduct(?:s|ed|ing)?|perform(?:s|ed|ing)?|complete(?:s|d|ing)?)\\b[^.!?]{0,50}\\b(?:annual|periodic(?:ally)?|ongoing)?\\s*reviews?\\s+of\\s+${provider}\\b`).test(sentence)
    || new RegExp(`\\b(?:obtain(?:s|ed|ing)?|collect(?:s|ed|ing)?)\\b[^.!?]{0,80}\\b(?:security questionnaires?|assurance reports?)\\b[^.!?]{0,80}\\b(?:from|of)\\s+${provider}\\b`).test(sentence)
  );
  return firmGovernance || oversightEnsuresProviderAction || directOperationalOversight;
}

function serviceProviderElementMatchesFromOperativeText(elementId, value) {
  const governingSentences = sentences(value).filter(hasOperativeServiceProviderGovernance);
  if (governingSentences.length === 0) return false;
  const matches = (pattern) => governingSentences.some((sentence) => pattern.test(sentence));

  switch (elementId) {
    case "service_provider_scope":
      return matches(/\b(?:due diligence|monitor(?:ing|s|ed)?|oversight|handling customer information|customer information systems?|security questionnaires?|assurance reports?|review(?:s|ed|ing)? (?:before engagement|periodically|during contract renewal))\b/);
    case "provider_safeguards":
      return matches(/\b(?:protect(?:ion|s|ed|ing)? (?:against )?unauthorized access(?: to| or use of)?|protect(?:ion|s|ed|ing)? customer information|safeguards? (?:for|to protect) customer information|appropriate measures to protect)\b/);
    case "notice_to_firm":
      return matches(/\b(?:notify|notification|notice|report|reporting)\b[^.!?]{0,100}\b(?:firm|institution|organization|company|security operations)\b|\b(?:notify|notification|notice|report|reporting|breach|incident)\b[^.!?]{0,100}\b(?:no later than )?72 hours?\b|\b(?:vendors?|service[- ]providers?|suppliers?|third[- ]part(?:y|ies))\b[^.!?]{0,80}\b(?:must|shall|required(?: to)?)\b[^.!?]{0,80}\b(?:notify|report)\b[^.!?]{0,80}\b(?:incidents?|breaches?)\b/);
    case "cooperation_remediation":
      return matches(/\b(?:cooperat(?:e|es|ed|ion)|coordinat(?:e|es|ed|ion)|investigat(?:e|es|ed|ion)|forensic|status updates?|remediat(?:e|es|ed|ion)|corrective actions?|recover(?:y|ies|ed|ing)|containment support)\b/);
    default:
      return null;
  }
}

function hasIncidentAssessmentContext(sentence) {
  return /\b(?:incident|security event|cyber(?:security)? event|unauthorized access|unauthorized use|breach)\b/.test(sentence);
}

function hasDirectResponseActor(sentence) {
  return /\b(?:incident|response|security|technology|technical|operations?)\s+(?:team|staff|coordinator|lead|manager)\b/.test(sentence);
}

function hasConcreteAssessmentContext(sourceSentences) {
  return sourceSentences.some(hasIncidentAssessmentContext)
    || sourceSentences.some((sentence) =>
      hasDirectResponseActor(sentence)
      && /\b(?:alerts?|events?|systems?|credentials?|monitoring)\b/.test(sentence));
}

function incidentAssessmentElementMatches(elementId, value) {
  const sourceSentences = sentences(value);
  const matches = (pattern) => sourceSentences.some((sentence) => pattern.test(sentence));
  const hasConcreteContext = hasConcreteAssessmentContext(sourceSentences);

  switch (elementId) {
    case "assesses_scope":
      return matches(/\b(?:assess(?:es|ment)?|review(?:s|ed)?|triage|classif(?:y|ies|ied))\b[^.!?]{0,100}\b(?:nature|scope|impact|affected|unauthorized access|unauthorized use|incident|event)\b/)
        && hasConcreteContext;
    case "customer_information_systems":
      return matches(/\b(?:identif(?:y|ies|ied)|determin(?:e|es|ed)|assess(?:es|ment)?|affected|impacted)\b[^.!?]{0,120}\b(?:customer information systems?|customer data|customer information|information types?|data types?)\b/)
        && hasConcreteContext;
    case "containment_control":
      return matches(/\b(?:contain(?:ment)? (?:and )?control|isolate(?:s|d|ing)? (?:affected )?(?:systems?|assets?)|block(?:s|ed|ing)? (?:unauthorized )?access|disable(?:s|d|ing)? (?:affected )?(?:systems?|accounts?)|reset(?:s|ting)? credentials|(?:takes?|performs?) containment steps?|take(?:s|n)? (?:affected )?systems? offline|increase(?:s|d|ing)? monitoring)\b/)
        && hasConcreteContext;
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
  const sourceSentences = sentences(value);
  const hasPreservationAction = /\b(?:preserv\w*|retain\w*|maintain\w*)\b/.test(normalized);
  const hasIncidentMaterial = /\b(?:logs?|exports?|screenshots?|forensic (?:data|evidence)|investigation (?:materials?|records?|notes)|incident (?:materials?|records?|emails?|notes?|tickets?)|security[- ]console exports?|volatile information)\b/.test(normalized)
    || /\b(?:emails?|notes?)\b[^.!?]{0,100}\b(?:incidents?|security events?|breaches?)\b/.test(normalized);
  const hasConcreteIncidentCapture = /\b(?:incident (?:ticket|record|file)|response)\b/.test(normalized)
    && /\b(?:record(?:s|ed|ing)?|attach(?:es|ed|ing)?)\b/.test(normalized)
    && /\b(?:screenshots?|system reports?|attachments?|major (?:response )?actions?|decisions?)\b/.test(normalized);
  const hasAccountableEvidenceHandling = sourceSentences.some((sentence) =>
    /\b(?:incident|response|security|technology|technical)\s+(?:manager|lead|team|staff|coordinator)\b[^.!?]{0,120}\b(?:maintain(?:s|ed|ing)?|collect(?:s|ed|ing)?|preserv(?:e|es|ed|ing)?|retain(?:s|ed|ing)?|stor(?:e|es|ed|ing)?|protect(?:s|ed|ing)?)\b[^.!?]{0,160}\b(?:incident file|case file|evidence|logs?|exports?|screenshots?|investigation (?:materials?|records?|notes))\b/.test(sentence)
      || /\b(?:incident file|case file|evidence[- ]?(?:handling|preservation)|preservation (?:process|procedure))\b[^.!?]{0,140}\b(?:must|shall|required|requires?|maintain(?:s|ed|ing)?|collect(?:s|ed|ing)?|preserv(?:e|es|ed|ing)?|retain(?:s|ed|ing)?|stor(?:e|es|ed|ing)?)\b/.test(sentence));
  const hasProcessQualityIndicator = /\b(?:access[- ]controlled(?: case)? folders?|controlled (?:case )?folders?|collection time|custodian|integrity information|for investigation|for compliance|examination|legal hold|retention (?:is )?not shortened|chain of custody|records integrity|provenance)\b/.test(normalized);
  const hasAccountablePreservationRequest = sourceSentences.some((sentence) =>
    /\b(?:counsel|legal|compliance|incident|response|security|technology|technical)\b[^.!?]{0,120}\b(?:requests?|directs?|requires?|instructs?)\b[^.!?]{0,100}\bpreserv\w*\b[^.!?]{0,120}\b(?:logs?|communications?|evidence|records?)\b/.test(sentence),
  );
  const hasNonDiscretionaryLogCapture = sourceSentences.some((sentence) =>
    /\b(?:save|capture|attach)\b[^.!?]{0,100}\b(?:available|relevant)?\s*(?:logs?|communications?|correspondence|evidence)\b/.test(sentence)
      && !/\b(?:may|can|should|plans?|expects?|intends?)\b[^.!?]{0,80}\b(?:save|capture|attach)\b/.test(sentence),
  );
  const hasRestrictedCaseFolder = /\b(?:case|incident)\s+folder\b[^.!?]{0,100}\b(?:assigned|authorized)\s+personnel\b|\b(?:case|incident)\s+folder\b[^.!?]{0,100}\b(?:access[- ]controlled|restricted access)\b/.test(normalized);

  switch (elementId) {
    case "incident_materials":
      return (hasPreservationAction && hasIncidentMaterial)
        || hasConcreteIncidentCapture
        || hasNonDiscretionaryLogCapture;
    case "preservation_process":
      return hasPreservationAction
        && hasIncidentMaterial
        && (
          /\b(?:policy|procedure|program|standard|process|plan|record requires?|must|shall|for investigation|for compliance|chain of custody|retention period)\b/.test(normalized)
          || (hasAccountableEvidenceHandling && hasProcessQualityIndicator)
        )
        || hasAccountablePreservationRequest
        || (hasNonDiscretionaryLogCapture && hasRestrictedCaseFolder);
    case "integrity_or_chain_of_custody":
      return /\b(?:chain of custody|records integrity|provenance|custody)\b/.test(normalized)
        || hasRestrictedCaseFolder;
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
      return (
        /\b(?:restor\w*|recover\w*|return(?:s|ed|ing)? (?:systems?|services?) to (?:normal )?operation)\b/.test(normalized)
        && /\b(?:owners?|teams?|firm|organization|procedure|program|plan|must|shall|will|requires?|recovery activities? include)\b/.test(normalized)
      ) || (
        /\brepair(?:s|ed|ing)? (?:affected )?systems?\b/.test(normalized)
        && /\bresum(?:e|es|ed|ing|ption) operations?\b/.test(normalized)
        && /\b(?:technology|technical|it|information technology|management|response team)\b/.test(normalized)
      );
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

function hasScopedOperationalRecordPractice(value) {
  return sentences(value).some((sentence) => {
    const hasRecordOperation = /\b(?:maintain(?:s|ed|ing)?|keep(?:s|ing)?|retain(?:s|ed|ing)?|stor(?:e|es|ed|ing)?|preserv(?:e|es|ed|ing)?)\b/.test(sentence);
    const compliancePractice = /\bcompliance\b[^.!?]{0,140}\b(?:maintain(?:s|ed|ing)?|keep(?:s|ing)?|retain(?:s|ed|ing)?|stor(?:e|es|ed|ing)?)\b[^.!?]{0,140}\b(?:current policy|annual reviews?|records? of (?:significant )?incidents?)\b/.test(sentence);
    const mandatoryIncidentOrVendorRecords = /\b(?:incident|vendor)\b[^.!?]{0,40}\brecords?\b[^.!?]{0,100}\b(?:must|shall|required|retain(?:s|ed|ing)?|stor(?:e|es|ed|ing)?)\b/.test(sentence);
    const genericOperationalContext = /\b(?:operational|department(?:al)?|business|administrative)\s+records?\b|\bdepartment practice\b/.test(sentence);
    return hasRecordOperation
      && !genericOperationalContext
      && (compliancePractice || mandatoryIncidentOrVendorRecords);
  });
}

function hasComplianceArchiveInventory(value) {
  const normalized = normalize(value);
  const hasArchiveOperation = /\b(?:maintain(?:s|ed|ing)?|keep(?:s|ing)?|retain(?:s|ed|ing)?|preserv(?:e|es|ed|ing)?)\b/.test(normalized)
    && /\b(?:archive|archives|archival|current (?:and|or) superseded procedures?|superseded procedures?)\b/.test(normalized);
  const categories = [
    /\bsafeguards?(?: versions?)?\b/,
    /\b(?:security episodes?|incident response|response and restoration)\b/,
    /\binvestigation (?:results?|records?|materials?)\b/,
    /\b(?:customer|security|notice|notification)[- ]?(?:security )?(?:messages?|notices?|notifications?)\b[^.!?]{0,100}\b(?:determinations?|copies?|samples?|records?|documentation)\b/,
    /\b(?:attorney general|government)[- ]?(?:requested )?delay\b/,
    /\b(?:service|hosted platform|provider|vendor)\b[^.!?]{0,100}\b(?:oversight|diligence|monitoring|agreements?)\b/,
    /\b(?:disposal|destruction)\b[^.!?]{0,100}\b(?:procedures?|records?|archives?)\b/,
  ].filter((pattern) => pattern.test(normalized));
  return hasArchiveOperation && categories.length >= 2;
}

function writtenComplianceRecordElementMatches(elementId, value) {
  const normalized = normalize(value);
  const hasArchiveInventory = hasComplianceArchiveInventory(value);
  const hasCompleteScope = hasRelevantComplianceRecordScope(normalized)
    && hasOperativeComplianceRecordScope(normalized)
    || hasArchiveInventory;
  const hasScopedPartialPractice = hasScopedOperationalRecordPractice(value);
  if (
    (!hasCompleteScope && !hasScopedPartialPractice)
    || !/\b(?:must|shall|required|requires?|maintain(?:s|ed|ing)?|keep(?:s|ing)?|retain(?:s|ed|ing)?|make and maintain|records? (?:demonstrating|documenting))\b/.test(normalized)
  ) {
    return false;
  }

  const hasScopedRetentionSentence = sentences(value).some((sentence) => {
    const hasRetention = /\b(?:retain(?:s|ed|ing)?|preserv(?:e|es|ed|ing)|retention period|(?:one|two|three|four|five|six|\d+) years?|easily accessible place|accessible storage)\b/.test(sentence);
    const refersToRecords = /\b(?:(?:these|such|the|all)\s+(?:records?|archives?|(?:program )?archive set)|(?:records?|archives?|(?:program )?archive set)\s+(?:are|were|must be|shall be|remain))\b/.test(sentence);
    const hasScopedRecordCategory = /\b(?:notification|notice|incident response|attorney general delay)\b[^.!?]{0,120}\b(?:determinations?|copies?|records?|documentation|supporting facts?)\b/.test(sentence);
    const genericOperationalContext = /\b(?:operational|department(?:al)?|business|administrative)\s+records?\b|\bdepartment practice\b/.test(sentence);
    const hasScopedRecordContext = (
      hasRelevantComplianceRecordScope(sentence)
      && hasOperativeComplianceRecordScope(sentence)
    ) || hasScopedOperationalRecordPractice(sentence);
    return hasRetention
      && !genericOperationalContext
      && (hasScopedRecordContext || ((hasCompleteScope || hasScopedPartialPractice || hasArchiveInventory) && refersToRecords) || hasScopedRecordCategory);
  });

  switch (elementId) {
    case "compliance_record_scope":
      return /\b(?:records?|documentation)\b[^.!?]{0,100}\b(?:demonstrating|documenting)\b[^.!?]{0,140}\b(?:implementation|compliance|safeguards?|disposal|regulation s-?p|compliance program|privacy program)\b/.test(normalized)
        || /\b(?:safeguards?|disposal|regulation s-?p|compliance program|privacy program)\b[^.!?]{0,140}\b(?:records?|documentation)\b/.test(normalized)
        || hasScopedPartialPractice
        || hasArchiveInventory;
    case "notice_determination_records":
      return /\b(?:notice|notification|incident response|attorney general delay)\b/.test(normalized)
          && /\b(?:determination|notice|notification|copy|record|document)\b/.test(normalized)
        || hasArchiveInventory
          && /\b(?:customer|security|notice|notification)[- ]?(?:security )?(?:messages?|notices?|notifications?)\b[^.!?]{0,100}\b(?:determinations?|copies?|samples?|records?|documentation)\b/.test(normalized);
    case "retention_accessibility":
      return hasScopedRetentionSentence;
    default:
      return null;
  }
}

function disposalElementMatches(elementId, value) {
  const disposalVerb = /\b(?:dispose(?:s|d|ing)?|destroy(?:s|ed|ing)?|shred(?:s|ded|ding)?|wipe(?:s|d|ing)?|saniti[sz](?:e|es|ed|ing|ation)|delete(?:s|d|ing)?)\b/;
  const coveredInformation = /\b(?:consumer information|customer information|customer records?|consumer report information|covered information)\b/;
  const secureMethod = /\b(?:proper(?:ly)?|secure(?:ly)?|approved|cross[- ]cut|cryptographic erasure|media sanitization|saniti[sz](?:e|ation)|verified|confirm(?:ed|ation)?)\b/;
  const materialObject = /\b(?:information|records?|files?|paper|media|devices?|backups?|data)\b/;
  const incidentOutcome = /\b(?:whether|was|were)\b[^.!?]{0,80}\b(?:data|information)\b[^.!?]{0,80}\b(?:viewed|copied|altered|transmitted|destroyed|deleted)\b|\b(?:data|information)\b[^.!?]{0,40}\b(?:was|were)\b[^.!?]{0,40}\b(?:destroyed|deleted)\b|\b(?:ransomware|attacker|unauthorized (?:party|actor|access|use)|incident impact)\b[^.!?]{0,100}\b(?:destroyed|deleted)\b/;
  const inventoryOnly = /\b(?:records?|documentation|inventory|list|categories?)\b\s+(?:of|including|include|contains?|contents?|categories?)\b[^.!?]{0,100}\b(?:disposal|destruction)\b/.test(value);
  const units = proceduralUnits(value).filter((unit) => !incidentOutcome.test(unit));
  const operationalUnits = units.filter((unit) =>
    disposalVerb.test(unit)
    && materialObject.test(unit)
    && !/\b(?:may|can|should|plans? to|expects? to|intends? to)\b[^.!?]{0,80}\b(?:dispose(?:s|d|ing)?|destroy(?:s|ed|ing)?|shred(?:s|ded|ding)?|wipe(?:s|d|ing)?|saniti[sz](?:e|es|ed|ing|ation)|delete(?:s|d|ing)?)\b/.test(unit)
    && !/\b(?:may request|may be removed|decide when|records? of disposal|destruction activities)\b/.test(unit),
  );
  const hasScopedOperation = operationalUnits.some((unit) => coveredInformation.test(unit))
    || (!inventoryOnly && coveredInformation.test(value) && operationalUnits.length > 0);
  const scopeInventoryItems = value.match(/\b(?:copies?|extracts?|reports?|screenshots?|recordings?|backups?|replicas?)\b/gi) ?? [];
  const hasScopedInformationInventory = scopeInventoryItems.length >= 2
    && /\b(?:remain|are|is)\s+within\s+scope\b/i.test(value)
    && /\b(?:linked|related|attributable)\s+to\b[^.!?]{0,80}\b(?:securityholders?|consumers?|customers?)\b/i.test(value);
  const hasSecureMethod = operationalUnits.some((unit) =>
    secureMethod.test(unit)
    || /\b(?:properly|securely)\s+(?:dispose|destroy|delete)\b/.test(unit)
    || /\b(?:shred(?:s|ded|ding)?|wipe(?:s|d|ing)?|saniti[sz](?:e|es|ed|ing|ation))\b/.test(unit),
  );

  switch (elementId) {
    case "disposal_scope":
      return hasScopedOperation || hasScopedInformationInventory;
    case "secure_disposal_method":
      return !inventoryOnly && hasSecureMethod;
    default:
      return null;
  }
}

function hasIncidentContext(value) {
  return /\b(?:incidents?|breaches?|security events?|unauthorized access|cyber(?:security)? events?)\b/.test(value);
}

function hasExternalAuthority(value) {
  return /\b(?:regulator|regulatory|law[- ]enforcement|authorities|attorney general|securities and exchange commission|commission|sec|external)\b/.test(value);
}

function hasLegalComplianceAction(value) {
  return /\b(?:legal(?:\s+(?:team|counsel|department))?|compliance(?:\s+(?:team|department))?|privacy counsel|general counsel)\b[^.!?]{0,100}\b(?:coordinat(?:e|es|ed|ing|ion)|review(?:s|ed|ing)?|assess(?:es|ed|ing|ment)?|evaluat(?:e|es|ed|ing)|determin(?:e|es|ed|ing|ation)|decid(?:e|es|ed|ing|ion)|record(?:s|ed|ing)?|advis(?:e|es|ed|ing))\b/.test(value);
}

function hasAccurateAttorneyGeneralDelay(value) {
  return /\bcustomer notice\b[^.!?]{0,160}\bdelay(?:ed|s|ing)?\b/.test(value)
    && /\b(?:united states )?attorney general\b/.test(value)
    && /\b(?:securities and exchange commission|commission|sec)\b/.test(value)
    && /\b(?:national security|public safety)\b/.test(value);
}

function externalNotificationCoordinationElementMatches(elementId, value) {
  const units = contiguousProcedureWindows(value);
  const directDecision = units.some((unit) =>
    (hasIncidentContext(unit) || hasAccurateAttorneyGeneralDelay(unit))
    && hasExternalAuthority(unit)
    && /\b(?:legal|compliance|privacy counsel|general counsel|firm|organization|institution|company|management|incident lead|response lead)\b[^.!?]{0,100}\b(?:determin(?:e|es|ed|ing)|decid(?:e|es|ed|ing)|assess(?:es|ed|ing|ment)?|evaluat(?:e|es|ed|ing)|review(?:s|ed|ing)?)\b[^.!?]{0,140}\b(?:whether|if)\b[^.!?]{0,140}\b(?:notify|notification|report|reporting|contact|communication|required)\b/.test(unit),
  );
  const incidentSpecificDelayResumptionProcedure = units.some((unit) =>
    hasIncidentContext(unit)
    && hasExternalAuthority(unit)
    && hasLegalComplianceAction(unit)
    && /\b(?:customer|external) communications?\b/.test(unit)
    && /\b(?:delay(?:ed|s|ing)?|postpon(?:e|ed|ement|ing)|withhold(?:s|ing|held)?|resum(?:e|es|ed|ing|ption)|releas(?:e|es|ed|ing))\b/.test(unit)
    && /\b(?:request(?:s|ed|ing)?|record(?:s|ed|ing)?|document(?:s|ed|ing)?|advis(?:e|es|ed|ing)|coordinat(?:e|es|ed|ing)|evaluat(?:e|es|ed|ing))\b/.test(unit),
  );

  switch (elementId) {
    case "external_notification_decisioning":
      return directDecision;
    case "legal_compliance_coordination":
      return (directDecision && units.some((unit) => hasLegalComplianceAction(unit)))
        || incidentSpecificDelayResumptionProcedure;
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
    case "disposal_consumer_customer_information":
      return disposalElementMatches(elementId, value);
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
    disposal_consumer_customer_information: [
      "disposal_scope",
      "secure_disposal_method",
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
