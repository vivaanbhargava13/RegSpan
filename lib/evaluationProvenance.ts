import { createHash } from "node:crypto";

type ProvenanceEnvironment = Record<string, string | undefined>;

type ProvenanceCandidate = {
  chunk_id: string;
  rank?: number | null;
  retrieval_rank?: number | null;
  retrieval_origin?: "semantic" | "keyword" | "merged" | null;
  similarity?: number | null;
  semantic_score?: number | null;
  keyword_score?: number | null;
  rerank_score?: number | null;
  page_start?: number | null;
  page_end?: number | null;
  section_path?: string | null;
  source_type?: string | null;
  evidence_role?: string | null;
  supporting_quote?: string | null;
  classifier_provider?: string | null;
  evidence_relationship?: string | null;
  covered_elements?: string[] | null;
  grade?: string | null;
};

type ProvenanceFinding = {
  status: string;
  evidence: Array<{ chunk_id: string | null; quote?: string | null }>;
};

export type EvaluationProvenanceCandidateRecord = {
  caseId: string | null;
  requirementId: string;
  candidateId: string;
  retrievalOrigin: "semantic" | "keyword" | "merged" | "unknown";
  retrievalRank: number | null;
  finalRank: number | null;
  semanticScore: number | null;
  keywordScore: number | null;
  rerankScore: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  sectionPath: string | null;
  sourceType: string | null;
  evidenceRole: string | null;
  organizationEvidenceEligible: boolean;
  filteringOutcome: "eligible" | "filtered_out";
  filteringReason: string | null;
  classifierProvider: string | null;
  classifierModel: string | null;
  classifierRelationship: string | null;
  supportedElementIds: string[];
  aggregationOutcome: "included" | "excluded" | "not_evaluated";
  aggregationReason: string | null;
  persistenceOutcome: "persisted" | "not_persisted" | "not_evaluated";
  persistenceReason: string | null;
  quoteHash: string | null;
};

export type EvaluationProvenanceRequirementRecord = {
  caseId: string | null;
  requirementId: string;
  finalStatus: string | null;
  candidates: EvaluationProvenanceCandidateRecord[];
};

export type EvaluationProvenanceRunConfig = {
  embeddingProvider: string | null;
  embeddingModel: string | null;
  classifierProvider: string | null;
  classifierModel: string | null;
  retrieval: {
    topK: number;
    semanticPoolSize: number;
    keywordPoolSize: number;
  };
  featureFlags: {
    enableEvalProvenance: true;
    enableExternalAiProcessing: boolean;
    enableExternalAiClassifier: boolean;
  };
};

export type EvaluationProvenanceRun = {
  schemaVersion: 1;
  runConfig: EvaluationProvenanceRunConfig;
  requirements: EvaluationProvenanceRequirementRecord[];
};

export type EvaluationProvenanceCollector = {
  recordRetrieved: (requirementId: string, candidates: ProvenanceCandidate[]) => void;
  recordClassified: (requirementId: string, candidates: ProvenanceCandidate[]) => void;
  recordAggregated: (requirementId: string, finding: ProvenanceFinding, candidates: ProvenanceCandidate[]) => void;
  recordPersistence: (requirementId: string, selectedChunkIds: Array<string | null>, persistedChunkIds: string[]) => void;
  snapshot: () => EvaluationProvenanceRun;
};

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function safeLabel(value: string | undefined | null) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 160) return null;
  return /^[A-Za-z0-9._:/-]+$/.test(normalized) ? normalized : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function quoteHash(value: string | null | undefined) {
  const quote = value?.trim();
  return quote ? createHash("sha256").update(quote).digest("hex") : null;
}

function sectionMetadata(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length <= 512 ? normalized : null;
}

function requirementKey(requirementId: string) {
  return requirementId.trim();
}

export function isEvaluationProvenanceEnabled(
  environment: ProvenanceEnvironment = process.env,
) {
  return enabled(environment.ENABLE_EVAL_PROVENANCE);
}

export function createEvaluationProvenanceCollector({
  caseId,
  environment = process.env,
  embeddingProvider,
  embeddingModel,
  classifierProvider,
  classifierModel,
  topK,
  semanticPoolSize,
  keywordPoolSize,
}: {
  caseId: string | null;
  environment?: ProvenanceEnvironment;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  classifierProvider: string | null;
  classifierModel: string | null;
  topK: number;
  semanticPoolSize: number;
  keywordPoolSize: number;
}): EvaluationProvenanceCollector | null {
  if (!isEvaluationProvenanceEnabled(environment)) return null;

  const requirements = new Map<string, EvaluationProvenanceRequirementRecord>();
  const candidatesByRequirement = new Map<string, Map<string, EvaluationProvenanceCandidateRecord>>();
  const runConfig: EvaluationProvenanceRunConfig = {
    embeddingProvider: safeLabel(embeddingProvider),
    embeddingModel: safeLabel(embeddingModel),
    classifierProvider: safeLabel(classifierProvider),
    classifierModel: safeLabel(classifierModel),
    retrieval: { topK, semanticPoolSize, keywordPoolSize },
    featureFlags: {
      enableEvalProvenance: true,
      enableExternalAiProcessing: enabled(environment.ENABLE_EXTERNAL_AI_PROCESSING),
      enableExternalAiClassifier: enabled(environment.ENABLE_EXTERNAL_AI_CLASSIFIER),
    },
  };

  function recordsFor(requirementId: string) {
    const key = requirementKey(requirementId);
    if (!requirements.has(key)) {
      requirements.set(key, {
        caseId,
        requirementId: key,
        finalStatus: null,
        candidates: [],
      });
      candidatesByRequirement.set(key, new Map());
    }
    return {
      requirement: requirements.get(key)!,
      candidates: candidatesByRequirement.get(key)!,
    };
  }

  function candidateRecord(
    requirementId: string,
    candidate: ProvenanceCandidate,
  ): EvaluationProvenanceCandidateRecord {
    const organizationEvidenceEligible = candidate.evidence_role === "organization_evidence";
    return {
      caseId,
      requirementId,
      candidateId: candidate.chunk_id,
      retrievalOrigin: candidate.retrieval_origin ?? "unknown",
      retrievalRank: nonNegativeInteger(candidate.retrieval_rank),
      finalRank: nonNegativeInteger(candidate.rank),
      semanticScore: finiteNumber(candidate.semantic_score ?? candidate.similarity),
      keywordScore: finiteNumber(candidate.keyword_score),
      rerankScore: finiteNumber(candidate.rerank_score),
      pageStart: nonNegativeInteger(candidate.page_start),
      pageEnd: nonNegativeInteger(candidate.page_end),
      sectionPath: sectionMetadata(candidate.section_path),
      sourceType: safeLabel(candidate.source_type),
      evidenceRole: safeLabel(candidate.evidence_role),
      organizationEvidenceEligible,
      filteringOutcome: organizationEvidenceEligible ? "eligible" : "filtered_out",
      filteringReason: organizationEvidenceEligible ? null : "evidence_role_not_organization_evidence",
      classifierProvider: null,
      classifierModel: null,
      classifierRelationship: null,
      supportedElementIds: [],
      aggregationOutcome: "not_evaluated",
      aggregationReason: null,
      persistenceOutcome: "not_evaluated",
      persistenceReason: null,
      quoteHash: null,
    };
  }

  function findRecord(requirementId: string, candidateId: string) {
    return recordsFor(requirementId).candidates.get(candidateId) ?? null;
  }

  return {
    recordRetrieved(requirementId, candidates) {
      const { requirement, candidates: records } = recordsFor(requirementId);
      for (const candidate of candidates) {
        if (records.has(candidate.chunk_id)) continue;
        const record = candidateRecord(requirement.requirementId, candidate);
        records.set(record.candidateId, record);
        requirement.candidates.push(record);
      }
    },
    recordClassified(requirementId, candidates) {
      for (const candidate of candidates) {
        const record = findRecord(requirementId, candidate.chunk_id);
        if (!record) continue;
        record.classifierProvider = safeLabel(candidate.classifier_provider);
        record.classifierModel = candidate.classifier_provider === "openai"
          ? runConfig.classifierModel
          : null;
        record.classifierRelationship = safeLabel(candidate.evidence_relationship);
        record.supportedElementIds = Array.isArray(candidate.covered_elements)
          ? [...new Set(candidate.covered_elements.filter((element): element is string => typeof element === "string"))].sort()
          : [];
        record.quoteHash = quoteHash(candidate.supporting_quote);
      }
    },
    recordAggregated(requirementId, finding, candidates) {
      const { requirement } = recordsFor(requirementId);
      requirement.finalStatus = finding.status;
      const selectedEvidenceByChunkId = new Map(
        finding.evidence
          .filter((evidence): evidence is { chunk_id: string; quote?: string | null } => Boolean(evidence.chunk_id))
          .map((evidence) => [evidence.chunk_id, evidence]),
      );
      for (const candidate of candidates) {
        const record = findRecord(requirementId, candidate.chunk_id);
        if (!record) continue;
        const selectedEvidence = selectedEvidenceByChunkId.get(candidate.chunk_id);
        if (selectedEvidence) {
          record.aggregationOutcome = "included";
          record.aggregationReason = "curated_final_evidence";
          record.quoteHash = quoteHash(selectedEvidence.quote) ?? record.quoteHash;
        } else if (!record.organizationEvidenceEligible) {
          record.aggregationOutcome = "excluded";
          record.aggregationReason = "filtered_before_classification";
        } else if (!record.classifierRelationship) {
          record.aggregationOutcome = "excluded";
          record.aggregationReason = "not_classified";
        } else if (record.classifierRelationship === "irrelevant") {
          record.aggregationOutcome = "excluded";
          record.aggregationReason = "classifier_irrelevant";
        } else if (record.classifierRelationship === "background_context") {
          record.aggregationOutcome = "excluded";
          record.aggregationReason = "classifier_background_context";
        } else {
          record.aggregationOutcome = "excluded";
          record.aggregationReason = "not_selected_by_evidence_curation";
        }
      }
    },
    recordPersistence(requirementId, selectedChunkIds, persistedChunkIds) {
      const selected = new Set(selectedChunkIds.filter((id): id is string => Boolean(id)));
      const persisted = new Set(persistedChunkIds);
      const { requirement } = recordsFor(requirementId);
      for (const record of requirement.candidates) {
        if (persisted.has(record.candidateId)) {
          record.persistenceOutcome = "persisted";
          record.persistenceReason = "finding_evidence_inserted";
        } else if (selected.has(record.candidateId)) {
          record.persistenceOutcome = "not_persisted";
          record.persistenceReason = "selected_evidence_not_primary_persistence_eligible";
        } else {
          record.persistenceOutcome = "not_persisted";
          record.persistenceReason = "not_selected_for_persistence";
        }
      }
    },
    snapshot() {
      return {
        schemaVersion: 1,
        runConfig,
        requirements: [...requirements.values()]
          .map((requirement) => ({
            ...requirement,
            candidates: [...requirement.candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
          }))
          .sort((left, right) => left.requirementId.localeCompare(right.requirementId)),
      };
    },
  };
}
