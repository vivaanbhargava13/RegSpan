#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA,
  CLASSIFIER_CAPABILITY_EXPERIMENT_LIMITATION,
  classifierCapabilityFixtureSuiteHash,
  jsonHash,
  sha256,
  type ClassifierCapabilityCaseFixture,
  type ClassifierCapabilityFixtureSuite,
  type ClassifierCapabilityFieldProvenance,
} from "../lib/classifierCapabilityEval";
import { REG_SP_REQUIREMENTS, type RegSpRequirement, type RegSpRequirementId } from "../lib/regSpRequirements";

const OUTPUT_PATH = "eval-fixtures/classifier-capability/fixtures.v2.json";
const WORKSHEET_JSON_PATH = "eval-fixtures/classifier-capability/reviewer-worksheet.json";
const WORKSHEET_MARKDOWN_PATH = "eval-fixtures/classifier-capability/reviewer-worksheet.md";
const MULTI_CANDIDATE_CAPTURE_PATH = "eval-fixtures/classifier-capability/retrieval-capture.response-recovery-remediation-validation.json";
const AGGREGATION_PACK_PATH = "eval-fixtures/classifier-capability/frozen-aggregation-pack.response-recovery-remediation-validation.json";
const DIAGNOSTIC_MULTI_CANDIDATE_CASE_ID = "recovery-remediation-validation-multi-candidate-review";
const AGGREGATION_CASE_ID = "recovery-remediation-validation-cross-candidate-aggregation-review";
const DIAGNOSTIC_MULTI_REVIEWED_AT = "2026-07-21T03:31:43.000Z";
const AGGREGATION_REVIEWED_AT = "2026-07-21T03:48:51.000Z";
const FROZEN_BASELINE = "d59d1c914397206a7d72aa104edcf4aabcd04bfb";
const FROZEN_UNCOMMITTED_SOURCE_HASHES: Record<string, string> = {
  "eval-results/requirement-eval-latest.json": "2d9796e2710198cd96efccd83dd304e41f603f4da4d9cf47b28ec1173db47eed",
};
const MANUAL_REVIEWER_ID = "vivaan-bhargava";
const MANUAL_REVIEWED_AT = "2026-07-21T02:57:36.000Z";
const APPROVED_CASE_IDS = new Set([
  "assessment-full-operative-procedure",
  "assessment-incident-history-negative",
  "preservation-full-operative-procedure",
  "preservation-records-inventory-partial",
  "preservation-optional-language-negative",
  "recovery-full-operative-procedure",
  "recovery-corrective-ownership-negative",
  "recovery-appendix-inventory-negative",
  "recovery-restoration-monitoring-partial",
]);
const MULTI_CANDIDATE_ARTIFACTS_INSPECTED = [
  "eval-results/requirement-eval-latest.json",
  "eval-results/retrieval-eval-latest.json",
  "eval-results/classifier-capability/dry-run.json",
  "eval-results/corpus-regspan-v1-isolated-*/results.{json,csv}",
  "eval-results/corpus-regspan-v2-realistic-company-policies-isolated-*/results.{json,csv}",
  MULTI_CANDIDATE_CAPTURE_PATH,
  AGGREGATION_PACK_PATH,
];

type RetrievalCaptureCandidate = {
  candidate_id: string;
  original_position: number;
  workspace_id: string;
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  exact_stored_content: string;
  stored_content_sha256: string;
  independently_recomputed_sha256: string;
  stored_embedding_input_sha256: string;
  filename: string;
  page_start: number;
  page_end: number;
  section_heading: string | null;
  parent_heading: string | null;
  section_path: string | null;
  retrieval_selection_metadata: Record<string, unknown>;
  semantic_rank: number | null;
  keyword_rank: number | null;
  merged_rank: number | null;
  source_artifact_path: string;
  source_artifact_locator: string;
};

type SourceCompleteCandidatePack = {
  requirement_id: string;
  order_kind: "newly_captured_retrieval_order" | "deterministic_stored_chunk_index_order";
  ordering_method?: string;
  normalization_recipe: string;
  unconfirmed_review_aid: string;
  candidates: RetrievalCaptureCandidate[];
};

function normalizeCapturedText(value: string) {
  return value.replace(/\r\n?/g, "\n").normalize("NFC");
}

const requirementAliases: Array<[RegSpRequirementId, RegSpRequirementId]> = [
  ["incident_assessment_containment_control", "unauthorized_access_detection_escalation"],
  ["incident_evidence_log_preservation", "evidence_log_preservation"],
  ["response_recovery_remediation_validation", "remediation_recovery_validation"],
];

function frozenRequirements() {
  return requirementAliases.map(([canonicalId, fallbackId]) => {
    const requirement = REG_SP_REQUIREMENTS.find((item) => item.id === fallbackId);
    if (!requirement) throw new Error(`Missing source requirement ${fallbackId}.`);
    return { ...requirement, id: canonicalId } satisfies RegSpRequirement;
  });
}

type CandidateInput = {
  id: string;
  filename: string;
  section: string;
  page: number;
  text: string;
  relationship: "supports" | "partially_supports" | "negative_evidence" | "background_context" | "irrelevant";
  elements?: string[];
  direct?: boolean;
  hardNegative?: boolean;
  sourcePath: string;
  locator: string;
  sourceKind?: "committed_corpus" | "regression_diagnostic";
};

function candidate(input: CandidateInput) {
  return {
    chunk_id: input.id,
    document_id: `fixture-document-${input.id}`,
    filename: input.filename,
    page_start: input.page,
    page_end: input.page,
    chunk_index: 0,
    section_path: input.section,
    content_preview: input.text,
    similarity: 0.5,
    evidence_reason: "frozen_classifier_capability_fixture",
    embedding_input: null,
    source_type: "client_policy" as const,
    evidence_role: "organization_evidence" as const,
    rerank_score: 50,
    rerank_reason: "Frozen before classifier capability evaluation; order and count must not change.",
    expected_relationship: input.relationship,
    expected_covered_elements: input.elements ?? [],
    direct_support_recovery: input.direct ?? false,
    hard_negative: input.hardNegative ?? false,
    source: {
      kind: input.sourceKind ?? "committed_corpus" as const,
      path: input.sourcePath,
      locator: input.locator,
      content_sha256: sha256(input.text),
    },
  };
}

const corpusPath = "eval/corpora/regspan-v2-realistic-corpus/documents/northline_regulation_sp_policy.pdf";
const regressionPath = "tests/requirement-debug.test.mjs";

const assessmentDirect = [
  "For every suspected incident involving unauthorized access to or use of customer information, the response team assesses the nature and scope of the incident. The assessment identifies the date and method of access, affected accounts and users, duration, privileges obtained, systems involved, and whether data was viewed, copied, altered, transmitted, or destroyed.",
  "The assessment must identify each customer information system that may have been affected and the types of customer information stored or processed in those systems. The team records whether sensitive customer information may be involved and identifies affected individuals when reasonably possible.",
  "• isolate compromised hosts, accounts, applications, or network segments;\n• disable or reset credentials and rotate keys or tokens;\n• block malicious infrastructure and preserve monitoring;\n• search for additional affected systems and unauthorized persistence;\n• coordinate controlled shutdowns when needed to prevent further unauthorized access or use.",
].join("\n");

const preservationDirect = [
  "The incident manager maintains a contemporaneous incident file containing alerts, system and identity logs, relevant exports, screenshots, investigation notes, affected-system and data inventories, decisions, approvals, containment steps, customer-notice analysis, provider communications, recovery tests, and closure documentation.",
  "Relevant logs and volatile information are preserved promptly. Exports are stored in access-controlled case folders with source, collection time, custodian, and integrity information when material to the investigation. Routine log retention is not shortened while an incident, investigation, examination, or legal hold is open.",
].join("\n");

const recoveryDirect = [
  "Recovery begins after the response lead confirms that immediate containment is stable. System owners restore services from approved configurations and backups, reset or reissue credentials, apply patches or configuration changes, and verify that unauthorized access paths have been removed.",
  "Before returning a material customer information system to normal operation, the owner validates security logging, access permissions, data integrity, critical transactions, and required business functions. Remediation items are assigned owners and due dates and remain open until evidence of completion is reviewed.",
  "• document restored systems and data sources;\n• perform targeted monitoring for recurrence;\n• confirm customer-service and notice obligations remain on track;\n• complete a lessons-learned review and update procedures, safeguards, or service-provider requirements;\n• obtain closure approval from the incident lead and Compliance.",
].join("\n");

const caseDrafts = [
  {
    id: "assessment-full-operative-procedure",
    requirement_id: "incident_assessment_containment_control",
    category: "incident_assessment_containment",
    expected_status: "covered",
    notes: "Direct support present in the frozen candidate; capability target for prior undercalls.",
    candidates: [candidate({
      id: "assessment-full-1",
      filename: "northline_regulation_sp_policy.pdf",
      section: "5. Assessment, Containment, and Control",
      page: 3,
      text: assessmentDirect,
      relationship: "supports",
      elements: ["assesses_scope", "customer_information_systems", "containment_control"],
      direct: true,
      sourcePath: corpusPath,
      locator: "PDF page 3, section 5",
    })],
  },
  {
    id: "assessment-incident-history-negative",
    requirement_id: "incident_assessment_containment_control",
    category: "incident_assessment_containment",
    expected_status: "missing",
    notes: "Incident history in a register is not an assessment and containment procedure.",
    candidates: [candidate({
      id: "assessment-history-1",
      filename: "OakMeridia Evidence Register diagnostic",
      section: "Continuing service-company review",
      page: 1,
      text: "Rule 121 - Continuing service-company review. Assurance reports, material changes, remediation, and incident history are entered in OakMeridia Evidence Register.",
      relationship: "irrelevant",
      hardNegative: true,
      sourcePath: regressionPath,
      locator: "negative fixture near line 349",
      sourceKind: "regression_diagnostic",
    })],
  },
  {
    id: "assessment-monitoring-escalation-partial",
    requirement_id: "incident_assessment_containment_control",
    category: "incident_assessment_containment",
    expected_status: "partial",
    notes: "Monitoring and escalation do not establish all assessment and containment elements.",
    candidates: [candidate({
      id: "assessment-partial-1",
      filename: "Northstar_Partial_Client_Information_Security_Procedure.pdf",
      section: "2. Security Monitoring and Internal Escalation",
      page: 1,
      text: "Security alerts from endpoint, firewall, authentication, and cloud systems are reviewed by IT Operations. Potential unauthorized access is escalated internally to the IT Manager and Compliance mailbox when customer information may be involved. The IT Manager may open an incident ticket and request help from Legal or Compliance when the event appears material. Incident tickets should include affected systems, dates, owner, and current status.",
      relationship: "partially_supports",
      elements: ["customer_information_systems"],
      sourcePath: "eval-results/requirement-eval-latest.json",
      locator: "unauthorized_access_detection_escalation candidate chunk 1",
      sourceKind: "regression_diagnostic",
    })],
  },
  {
    id: "preservation-full-operative-procedure",
    requirement_id: "incident_evidence_log_preservation",
    category: "incident_evidence_log_preservation",
    expected_status: "covered",
    notes: "Direct support present in the frozen candidate; capability target for prior quote undercalls.",
    candidates: [candidate({
      id: "preservation-full-1",
      filename: "northline_regulation_sp_policy.pdf",
      section: "12. Logging and Investigation Records",
      page: 6,
      text: preservationDirect,
      relationship: "supports",
      elements: ["incident_materials", "integrity_or_chain_of_custody", "preservation_process"],
      direct: true,
      sourcePath: corpusPath,
      locator: "PDF page 6, section 12",
    })],
  },
  {
    id: "preservation-log-procedure",
    requirement_id: "incident_evidence_log_preservation",
    category: "incident_evidence_log_preservation",
    expected_status: "covered",
    notes: "A narrower mandatory incident-log preservation procedure without a full forensic program.",
    candidates: [candidate({
      id: "preservation-log-1",
      filename: "Northstar_Partial_Client_Information_Security_Procedure.pdf",
      section: "4. Log Retention and Investigation Support",
      page: 2,
      text: "System logs, authentication logs, and cloud audit records are retained for investigation support. IT Operations preserves relevant logs when an incident ticket is opened and may export copies for review by Compliance or outside investigators. The procedure does not define a full forensic chain-of-custody process, but incident owners should document where evidence was collected and who handled it.",
      relationship: "supports",
      elements: ["incident_materials", "preservation_process"],
      sourcePath: "eval-results/requirement-eval-latest.json",
      locator: "evidence_log_preservation candidate chunk 3",
      sourceKind: "regression_diagnostic",
    })],
  },
  {
    id: "preservation-records-inventory-partial",
    requirement_id: "incident_evidence_log_preservation",
    category: "incident_evidence_log_preservation",
    expected_status: "partial",
    notes: "The passage requires five-year preservation of notification-investigation records, but does not define an operational preservation process.",
    candidates: [candidate({
      id: "preservation-inventory-1",
      filename: "Books and records diagnostic",
      section: "Books and records",
      page: 1,
      text: "Books and records include notification investigations, determinations, supporting facts, and the basis for any no-notice decision.\n• The file also includes written documentation from the Attorney General concerning any delay in notice.\n• These records are preserved for five years.",
      relationship: "partially_supports",
      elements: ["incident_materials"],
      sourcePath: "tests/findings-generation.test.mjs",
      locator: "records inventory fixture near line 1227",
      sourceKind: "regression_diagnostic",
    })],
  },
  {
    id: "preservation-optional-language-negative",
    requirement_id: "incident_evidence_log_preservation",
    category: "incident_evidence_log_preservation",
    expected_status: "missing",
    notes: "Optional language is not a mandatory preservation obligation.",
    candidates: [candidate({
      id: "preservation-optional-1",
      filename: "Incident briefing diagnostic",
      section: "Incident briefing",
      page: 1,
      text: "The incident briefing may discuss logs and communications, and a shared folder can be used by personnel. The duty manager controls access to the folder and may ask Technology to retain a log source.",
      relationship: "background_context",
      hardNegative: true,
      sourcePath: regressionPath,
      locator: "negative fixtures near lines 352-360",
      sourceKind: "regression_diagnostic",
    })],
  },
  {
    id: "recovery-full-operative-procedure",
    requirement_id: "response_recovery_remediation_validation",
    category: "recovery_remediation_validation",
    expected_status: "covered",
    notes: "Direct support present in the frozen candidate; capability target for prior quote undercalls.",
    candidates: [candidate({
      id: "recovery-full-1",
      filename: "northline_regulation_sp_policy.pdf",
      section: "14. Recovery, Remediation, and Validation",
      page: 6,
      text: recoveryDirect,
      relationship: "supports",
      elements: ["recovery_steps", "remediation_tracking", "validation_testing"],
      direct: true,
      sourcePath: corpusPath,
      locator: "PDF page 6, section 14",
    })],
  },
  {
    id: "recovery-corrective-ownership-negative",
    requirement_id: "response_recovery_remediation_validation",
    category: "recovery_remediation_validation",
    expected_status: "missing",
    notes: "Corrective-action ownership for vendor performance is not recovery validation.",
    candidates: [candidate({
      id: "recovery-ownership-1",
      filename: "lakeshore_regulation_sp_compliance_program.pdf",
      section: "8. Third-Party Security and Breach Escalation",
      page: 3,
      text: "Vendors are expected to comply with applicable law and the terms of their agreements. Business owners contact Procurement when vendor performance is unsatisfactory. Procurement records contract issues and coordinates corrective action with the business owner.",
      relationship: "irrelevant",
      hardNegative: true,
      sourcePath: "eval/corpora/regspan-v2-realistic-corpus/documents/lakeshore_regulation_sp_compliance_program.pdf",
      locator: "PDF page 3, section 8",
    })],
  },
  {
    id: "recovery-appendix-inventory-negative",
    requirement_id: "response_recovery_remediation_validation",
    category: "recovery_remediation_validation",
    expected_status: "missing",
    notes: "An appendix record-category list is not a recovery procedure.",
    candidates: [candidate({
      id: "recovery-inventory-1",
      filename: "Incident file appendix diagnostic",
      section: "Appendix A - Incident File Minimum Contents",
      page: 1,
      text: "Appendix A - Incident File Minimum Contents: investigation timeline, containment actions, recovery steps, corrective actions, validation results, and closure approval.",
      relationship: "background_context",
      hardNegative: true,
      sourcePath: "tests/operative-evidence-elements.test.mjs",
      locator: "inventory fixture near line 174",
      sourceKind: "regression_diagnostic",
    })],
  },
  {
    id: "recovery-restoration-monitoring-partial",
    requirement_id: "response_recovery_remediation_validation",
    category: "recovery_remediation_validation",
    expected_status: "partial",
    notes: "Restoration and recurrence monitoring omit remediation tracking and formal validation.",
    candidates: [candidate({
      id: "recovery-partial-1",
      filename: "stonehaven_privacy_cybersecurity_practices.pdf",
      section: "14. Corrective Action and Post-Incident Review",
      page: 5,
      text: "After containment, the firm returns systems to service and monitors for recurring issues. Technology monitors the restored environment for recurring problems during the next business cycle.",
      relationship: "partially_supports",
      elements: ["recovery_steps"],
      sourcePath: "eval/corpora/regspan-v2-realistic-corpus/documents/stonehaven_privacy_cybersecurity_practices.pdf",
      locator: "PDF page 5, section 14",
    })],
  },
];

async function main() {
  const requirements = frozenRequirements();
  const retrievalCapture = JSON.parse(
    await readFile(resolve(MULTI_CANDIDATE_CAPTURE_PATH), "utf8"),
  ) as SourceCompleteCandidatePack;
  const aggregationPack = JSON.parse(
    await readFile(resolve(AGGREGATION_PACK_PATH), "utf8"),
  ) as SourceCompleteCandidatePack;
  const sourcePaths = new Set([
    ...caseDrafts.flatMap((item) => item.candidates.map((candidate) => candidate.source.path)),
    MULTI_CANDIDATE_CAPTURE_PATH,
    AGGREGATION_PACK_PATH,
  ]);
  const sourceHashes = new Map<string, string>();
  for (const path of sourcePaths) {
    try {
      sourceHashes.set(path, createHash("sha256").update(await readFile(resolve(path))).digest("hex"));
    } catch (error) {
      const frozenHash = FROZEN_UNCOMMITTED_SOURCE_HASHES[path];
      if (!frozenHash) throw error;
      sourceHashes.set(path, frozenHash);
    }
  }

  const inferred = (path: string, locator: string, sourceType: ClassifierCapabilityFieldProvenance["source_type"] = "implementation_inference"): ClassifierCapabilityFieldProvenance => ({
    confirmed: false,
    source_type: sourceType,
    reviewer_id: null,
    reviewed_at: null,
    source_path: path,
    source_locator: locator,
    source_hash: sourceHashes.get(path)!,
    normalization_recipe: null,
  });
  const manual = (
    path: string,
    locator: string,
    normalizationRecipe: string | null,
    reviewedAt = MANUAL_REVIEWED_AT,
  ): ClassifierCapabilityFieldProvenance => ({
    confirmed: true,
    source_type: "manual_adjudication",
    reviewer_id: MANUAL_REVIEWER_ID,
    reviewed_at: reviewedAt,
    source_path: path,
    source_locator: locator,
    source_hash: sourceHashes.get(path)!,
    normalization_recipe: normalizationRecipe,
  });
  const cases: ClassifierCapabilityCaseFixture[] = caseDrafts.map((draft) => {
    const diagnosticOnly = draft.id === "assessment-monitoring-escalation-partial"
      || draft.id === "preservation-log-procedure";
    const approved = APPROVED_CASE_IDS.has(draft.id);
    const primarySource = draft.candidates[0].source;
    const primaryNormalizationRecipe = primarySource.path.includes("requirement-eval-latest")
      ? "Removed the section heading and bullets; joined source line wraps with spaces."
      : draft.candidates[0].chunk_id === "preservation-optional-1"
        ? "Concatenated the two adjacent diagnostic literals in source order with one space."
        : null;
    const statusProvenance = approved
      ? manual(primarySource.path, primarySource.locator, primaryNormalizationRecipe)
      : inferred(primarySource.path, primarySource.locator,
        primarySource.path.includes("requirement-eval-latest") ? "diagnostic_artifact" : "implementation_inference");
    return {
      ...draft,
      evaluation_role: diagnosticOnly ? "diagnostic_only" as const : approved ? "scored" as const : "unresolved" as const,
      expected_status: { value: draft.expected_status, provenance: statusProvenance },
      expected_supported_elements: {
        value: [...new Set(draft.candidates.flatMap((candidate) => candidate.expected_covered_elements))],
        provenance: approved
          ? manual(primarySource.path, primarySource.locator, primaryNormalizationRecipe)
          : inferred(primarySource.path, primarySource.locator),
      },
      candidates: draft.candidates.map((candidate) => {
        const labelSourceType = candidate.source.path.includes("requirement-eval-latest")
          ? "diagnostic_artifact" as const
          : candidate.source.kind === "regression_diagnostic"
            ? "diagnostic_artifact" as const
            : "implementation_inference" as const;
        const normalizationRecipe = candidate.source.path.includes("requirement-eval-latest")
          ? "Removed the section heading and bullets; joined source line wraps with spaces."
          : candidate.chunk_id === "preservation-optional-1"
            ? "Concatenated the two adjacent diagnostic literals in source order with one space."
            : null;
        const provenance = () => approved
          ? manual(candidate.source.path, candidate.source.locator, normalizationRecipe)
          : {
            ...inferred(candidate.source.path, candidate.source.locator, labelSourceType),
            normalization_recipe: normalizationRecipe,
          };
        return {
          ...candidate,
          expected_relationship: { value: candidate.expected_relationship, provenance: provenance() },
          expected_covered_elements: { value: candidate.expected_covered_elements, provenance: provenance() },
          direct_support_recovery: { value: candidate.direct_support_recovery, provenance: provenance() },
          hard_negative: { value: candidate.hard_negative, provenance: provenance() },
          source: { ...candidate.source, normalization_recipe: normalizationRecipe },
        };
      }),
    } as ClassifierCapabilityCaseFixture;
  });

  const validatePack = (
    pack: SourceCompleteCandidatePack,
    expectedOrder: SourceCompleteCandidatePack["order_kind"],
  ) => {
    if (pack.requirement_id !== "response_recovery_remediation_validation"
      || pack.order_kind !== expectedOrder || pack.candidates.length < 3) {
      throw new Error("A multi-candidate source pack is incomplete or has the wrong requirement.");
    }
    const ids = new Set<string>();
    for (const [index, captured] of pack.candidates.entries()) {
      const ordered = captured.original_position === index + 1
        && (expectedOrder !== "newly_captured_retrieval_order" || captured.merged_rank === index + 1)
        && (expectedOrder !== "deterministic_stored_chunk_index_order"
          || index === 0 || pack.candidates[index - 1].chunk_index < captured.chunk_index);
      if (!ordered) throw new Error("A multi-candidate source-pack order changed.");
      if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(captured.chunk_id)
        || captured.candidate_id !== captured.chunk_id || ids.has(captured.chunk_id)) {
        throw new Error("A multi-candidate source pack has a duplicate or invalid stored chunk id.");
      }
      ids.add(captured.chunk_id);
      const recomputed = sha256(captured.exact_stored_content);
      if (captured.stored_content_sha256 !== recomputed
        || captured.independently_recomputed_sha256 !== recomputed
        || normalizeCapturedText(captured.exact_stored_content) !== captured.exact_stored_content) {
        throw new Error(`Stored content verification failed for ${captured.chunk_id}.`);
      }
    }
  };
  validatePack(retrievalCapture, "newly_captured_retrieval_order");
  validatePack(aggregationPack, "deterministic_stored_chunk_index_order");

  const sourceCandidate = (
    captured: RetrievalCaptureCandidate,
    pack: SourceCompleteCandidatePack,
  ) => ({
    chunk_id: captured.chunk_id,
    rank: captured.merged_rank,
    document_id: captured.document_id,
    filename: captured.filename,
    page_start: captured.page_start,
    page_end: captured.page_end,
    chunk_index: captured.chunk_index,
    section_path: captured.section_path,
    content_preview: captured.exact_stored_content,
    similarity: typeof captured.retrieval_selection_metadata.similarity === "number"
      ? captured.retrieval_selection_metadata.similarity : 0,
    evidence_reason: typeof captured.retrieval_selection_metadata.evidence_reason === "string"
      ? captured.retrieval_selection_metadata.evidence_reason : "frozen_evaluation_pack",
    embedding_input: null,
    source_type: "client_policy" as const,
    evidence_role: "organization_evidence" as const,
    rerank_score: typeof captured.retrieval_selection_metadata.rerank_score === "number"
      ? captured.retrieval_selection_metadata.rerank_score : null,
    rerank_reason: typeof captured.retrieval_selection_metadata.rerank_reason === "string"
      ? captured.retrieval_selection_metadata.rerank_reason : pack.ordering_method ?? null,
    source: {
      kind: pack.order_kind === "newly_captured_retrieval_order"
        ? "retrieval_capture" as const : "frozen_evaluation_pack" as const,
      path: captured.source_artifact_path,
      locator: captured.source_artifact_locator,
      content_sha256: captured.stored_content_sha256,
      normalization_recipe: pack.normalization_recipe,
    },
    stored_provenance: {
      original_position: captured.original_position,
      workspace_id: captured.workspace_id,
      document_id: captured.document_id,
      chunk_id: captured.chunk_id,
      chunk_index: captured.chunk_index,
      filename: captured.filename,
      page_start: captured.page_start,
      page_end: captured.page_end,
      section_path: captured.section_path,
      stored_content_sha256: captured.stored_content_sha256,
      independently_recomputed_sha256: captured.independently_recomputed_sha256,
      stored_embedding_input_sha256: captured.stored_embedding_input_sha256,
      section_heading: captured.section_heading,
      parent_heading: captured.parent_heading,
      retrieval_selection_metadata: captured.retrieval_selection_metadata,
      semantic_rank: captured.semantic_rank,
      keyword_rank: captured.keyword_rank,
      merged_rank: captured.merged_rank,
      source_artifact_path: captured.source_artifact_path,
      source_artifact_locator: captured.source_artifact_locator,
      normalization_recipe: pack.normalization_recipe,
    },
  });

  const diagnosticDecisions = [
    { relationship: "supports" as const, elements: ["recovery_steps", "remediation_tracking", "validation_testing"], direct: true, hardNegative: false },
    { relationship: "background_context" as const, elements: [], direct: false, hardNegative: true },
    { relationship: "partially_supports" as const, elements: ["recovery_steps", "validation_testing"], direct: false, hardNegative: false },
    { relationship: "background_context" as const, elements: [], direct: false, hardNegative: true },
    { relationship: "background_context" as const, elements: [], direct: false, hardNegative: true },
  ];
  const diagnosticCandidates = retrievalCapture.candidates.map((captured, index) => {
    const provenance = manual(
      captured.source_artifact_path,
      captured.source_artifact_locator,
      retrievalCapture.normalization_recipe,
      DIAGNOSTIC_MULTI_REVIEWED_AT,
    );
    const decision = diagnosticDecisions[index];
    return {
      ...sourceCandidate(captured, retrievalCapture),
      expected_relationship: { value: decision.relationship, provenance },
      expected_covered_elements: { value: decision.elements, provenance },
      direct_support_recovery: { value: decision.direct, provenance },
      hard_negative: { value: decision.hardNegative, provenance },
    };
  });
  const diagnosticCaseProvenance = manual(
    retrievalCapture.candidates[0].source_artifact_path,
    retrievalCapture.candidates[0].source_artifact_locator,
    retrievalCapture.normalization_recipe,
    DIAGNOSTIC_MULTI_REVIEWED_AT,
  );
  cases.push({
    id: DIAGNOSTIC_MULTI_CANDIDATE_CASE_ID,
    requirement_id: retrievalCapture.requirement_id,
    category: "recovery_remediation_validation",
    evaluation_role: "diagnostic_only",
    expected_status: { value: "covered", provenance: diagnosticCaseProvenance },
    expected_supported_elements: {
      value: ["recovery_steps", "remediation_tracking", "validation_testing"],
      provenance: diagnosticCaseProvenance,
    },
    notes: "Diagnostic only: Candidate 1 alone covers all required elements, and its own stored embedding was used as the retrieval query vector. This case does not provide evidence about cross-candidate aggregation.",
    candidates: diagnosticCandidates,
  });

  const aggregationDecisions = [
    {
      relationship: "partially_supports" as const,
      elements: ["recovery_steps", "validation_testing"],
      direct: false,
      hardNegative: false,
      note: "The passage defines restoration, root-cause remediation, control/access validation, and post-incident review, but does not define remediation tracking.",
    },
    {
      relationship: "background_context" as const,
      elements: [],
      direct: false,
      hardNegative: true,
      note: "Provider oversight and tracking provider risks/remediation do not establish incident recovery remediation tracking.",
    },
    {
      relationship: "background_context" as const,
      elements: [],
      direct: false,
      hardNegative: true,
      note: "An incident-file contents inventory does not require the listed recovery or validation actions to occur.",
    },
  ];
  const aggregationCandidates = aggregationPack.candidates.map((captured, index) => {
    const provenance = manual(
      captured.source_artifact_path,
      captured.source_artifact_locator,
      aggregationPack.normalization_recipe,
      AGGREGATION_REVIEWED_AT,
    );
    const decision = aggregationDecisions[index];
    return {
      ...sourceCandidate(captured, aggregationPack),
      expected_relationship: { value: decision.relationship, provenance },
      expected_covered_elements: { value: decision.elements, provenance },
      direct_support_recovery: { value: decision.direct, provenance },
      hard_negative: { value: decision.hardNegative, provenance },
      adjudication_note: decision.note,
    };
  });
  const aggregationCaseProvenance = aggregationCandidates[0].expected_relationship.provenance;
  cases.push({
    id: AGGREGATION_CASE_ID,
    requirement_id: aggregationPack.requirement_id,
    category: "recovery_remediation_validation",
    evaluation_role: "diagnostic_only",
    expected_status: { value: "partial", provenance: aggregationCaseProvenance },
    expected_supported_elements: {
      value: ["recovery_steps", "validation_testing"],
      provenance: aggregationCaseProvenance,
    },
    notes: "Diagnostic only: the provider-oversight passage does not establish incident recovery remediation tracking, so this pack does not test complementary aggregation.",
    candidates: aggregationCandidates,
  });
  const suiteWithoutHash: Omit<ClassifierCapabilityFixtureSuite, "suite_hash"> = {
    schema_version: CLASSIFIER_CAPABILITY_FIXTURE_SCHEMA,
    fixture_version: "v2",
    frozen_baseline_commit: FROZEN_BASELINE,
    source_diagnostic_artifact: "eval-results/requirement-eval-latest.json (local/ignored) plus committed corpus and regression diagnostics",
    requirements,
    requirement_sha256: Object.fromEntries(requirements.map((requirement) => [requirement.id, jsonHash(requirement)])),
    multi_candidate_review: {
      status: "diagnostic_only",
      case_id: null,
      blocker: null,
      limitation: CLASSIFIER_CAPABILITY_EXPERIMENT_LIMITATION,
    },
    cases,
  };
  const suite: ClassifierCapabilityFixtureSuite = {
    ...suiteWithoutHash,
    suite_hash: classifierCapabilityFixtureSuiteHash(suiteWithoutHash),
  };
  const outputPath = resolve(process.argv[2] ?? OUTPUT_PATH);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(suite, null, 2)}\n`, "utf8");

  const worksheetCases = cases.map((fixtureCase) => {
    const requirement = requirements.find((item) => item.id === fixtureCase.requirement_id)!;
    return {
      case_id: fixtureCase.id,
      evaluation_role: fixtureCase.evaluation_role,
      requirement: {
        id: requirement.id,
        title: requirement.title,
        description: requirement.description,
        element_definitions: requirement.coverageElements,
      },
      proposed_expected_status: fixtureCase.expected_status,
      proposed_expected_supported_elements: fixtureCase.expected_supported_elements,
      reviewer_decisions: { expected_status: null, expected_supported_elements: null, reviewer_id: null, reviewed_at: null, notes: null },
      candidates: fixtureCase.candidates.map((candidate, index) => ({
        order: candidate.stored_provenance?.original_position ?? index + 1,
        candidate_id: candidate.chunk_id,
        exact_candidate_text: candidate.content_preview,
        proposed_expected_relationship: candidate.expected_relationship,
        proposed_expected_elements: candidate.expected_covered_elements,
        proposed_direct_support: candidate.direct_support_recovery,
        proposed_hard_negative: candidate.hard_negative,
        adjudication_note: candidate.adjudication_note ?? null,
        source: candidate.source,
        ...(candidate.stored_provenance ? { stored_provenance: candidate.stored_provenance } : {}),
        reviewer_decisions: {
          expected_relationship: null,
          expected_elements: null,
          direct_support: null,
          hard_negative: null,
          reviewer_id: null,
          reviewed_at: null,
          notes: null,
        },
      })),
    };
  });
  const worksheet = {
    schema_version: "classifier-capability-reviewer-worksheet/v1",
    fixture_suite_hash: suite.suite_hash,
    paid_readiness_blocker: null,
    experiment_limitation: CLASSIFIER_CAPABILITY_EXPERIMENT_LIMITATION,
    multi_candidate_artifacts_inspected: MULTI_CANDIDATE_ARTIFACTS_INSPECTED,
    multi_candidate_review_case: null,
    cases: worksheetCases,
  };
  await writeFile(resolve(WORKSHEET_JSON_PATH), `${JSON.stringify(worksheet, null, 2)}\n`, "utf8");
  const markdown = [
    "# Classifier capability reviewer worksheet",
    "",
    `Fixture suite hash: \`${suite.suite_hash}\``,
    "",
    "## Experiment scope and limitation",
    "",
    CLASSIFIER_CAPABILITY_EXPERIMENT_LIMITATION,
    "",
    "Artifacts inspected:",
    "",
    ...MULTI_CANDIDATE_ARTIFACTS_INSPECTED.map((path) => `- \`${path}\``),
    "",
    ...worksheet.cases.flatMap((fixtureCase) => [
      `## ${fixtureCase.case_id}`,
      "",
      `Role: \`${fixtureCase.evaluation_role}\``,
      `Requirement: **${fixtureCase.requirement.title}** (\`${fixtureCase.requirement.id}\`)`,
      fixtureCase.requirement.description,
      "",
      `Proposed final status: \`${fixtureCase.proposed_expected_status.value}\``,
      `Proposed supported elements: \`${fixtureCase.proposed_expected_supported_elements.value?.join(", ") || "none"}\``,
      "",
      "Reviewer final status: ____________________",
      "Reviewer case-supported elements: ____________________",
      "Reviewer ID: ____________________",
      "Reviewed at: ____________________",
      "",
      ...fixtureCase.candidates.flatMap((candidate) => [
        `### Candidate ${candidate.order}: ${candidate.candidate_id}`,
        "",
        "```text",
        candidate.exact_candidate_text,
        "```",
        "",
        `Proposed: relationship \`${candidate.proposed_expected_relationship.value}\`; elements \`${candidate.proposed_expected_elements.value?.join(", ") || "none"}\`; direct-support \`${candidate.proposed_direct_support.value}\`; hard-negative \`${candidate.proposed_hard_negative.value}\`.`,
        ...(candidate.adjudication_note ? [`Adjudication note: ${candidate.adjudication_note}`, ""] : [""]),
        `Provenance: \`${candidate.proposed_expected_relationship.provenance.source_type}\`, ${candidate.proposed_expected_relationship.provenance.source_path}, ${candidate.proposed_expected_relationship.provenance.source_locator}.`,
        ...(candidate.stored_provenance ? [
          `Stored row: workspace \`${candidate.stored_provenance.workspace_id}\`; document \`${candidate.stored_provenance.document_id}\`; chunk \`${candidate.stored_provenance.chunk_id}\`; index \`${candidate.stored_provenance.chunk_index}\`; original position \`${candidate.stored_provenance.original_position}\`.`,
          `Citation: ${candidate.stored_provenance.filename}, pages ${candidate.stored_provenance.page_start}-${candidate.stored_provenance.page_end}; section \`${candidate.stored_provenance.section_heading}\`; parent \`${candidate.stored_provenance.parent_heading}\`; path \`${candidate.stored_provenance.section_path}\`.`,
          `Hashes: stored source \`${candidate.stored_provenance.stored_content_sha256}\`; recomputed \`${candidate.stored_provenance.independently_recomputed_sha256}\`; stored embedding input \`${candidate.stored_provenance.stored_embedding_input_sha256}\`.`,
          `Ranks: semantic \`${candidate.stored_provenance.semantic_rank ?? "unavailable"}\`; keyword \`${candidate.stored_provenance.keyword_rank ?? "unavailable"}\`; merged \`${candidate.stored_provenance.merged_rank ?? "unavailable"}\`. Retrieval selection: \`${JSON.stringify(candidate.stored_provenance.retrieval_selection_metadata)}\`.`,
          `Normalization: ${candidate.stored_provenance.normalization_recipe}`,
          "",
        ] : []),
        "",
        "Reviewer relationship: ____________________",
        "Reviewer elements: ____________________",
        "Reviewer direct-support designation: ____________________",
        "Reviewer hard-negative designation: ____________________",
        "Reviewer notes: ____________________",
        "",
      ]),
    ]),
  ].join("\n");
  await writeFile(resolve(WORKSHEET_MARKDOWN_PATH), `${markdown}\n`, "utf8");
  console.log(`Wrote ${cases.length} classifier capability fixtures and reviewer worksheets.`);
}

await main();
