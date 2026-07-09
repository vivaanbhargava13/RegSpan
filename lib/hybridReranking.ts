import { detectNegativeEvidence } from "./negativeEvidence";

export type RerankableRequirement = {
  title: string;
  description: string;
  retrievalQuery?: string;
  directSignals?: string[];
  actionSignals?: string[];
  topicSignals?: string[];
  partialSignals?: string[];
  backgroundSignals?: string[];
  negativeSignals?: string[];
};

export type RerankableChunk = {
  chunk_id: string;
  rank?: number | null;
  filename: string | null;
  section_path: string | null;
  content_preview: string;
  similarity: number;
  evidence_reason: string | null;
  embedding_input?: string | null;
  source_type: string;
  evidence_role: string;
  rerank_score?: number | null;
  rerank_reason?: string | null;
  negative_evidence?: boolean;
  negative_evidence_reason?: string | null;
};

export type RequirementKeywordProfile = {
  directSignals: string[];
  actionSignals: string[];
  topicSignals: string[];
  negativeSignals: string[];
  keywordTerms: string[];
};

const STOP_WORDS = new Set([
  "and",
  "are",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "not",
  "the",
  "that",
  "this",
  "use",
  "uses",
  "what",
  "when",
  "where",
  "with",
]);

function normalize(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalize(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function titleDescriptionTerms(requirement: RerankableRequirement) {
  const text = normalize(`${requirement.title} ${requirement.description}`);
  return uniqueStrings(text
    .split(" ")
    .filter((term) => term.length >= 5 && !STOP_WORDS.has(term))
    .slice(0, 12));
}

export function buildRequirementKeywordProfile(
  requirement: RerankableRequirement,
): RequirementKeywordProfile {
  const directSignals = uniqueStrings(requirement.directSignals ?? []);
  const actionSignals = uniqueStrings(requirement.actionSignals ?? []);
  const topicSignals = uniqueStrings([
    ...(requirement.topicSignals ?? []),
    ...(requirement.partialSignals ?? []),
    ...(requirement.backgroundSignals ?? []),
    ...titleDescriptionTerms(requirement),
  ]);
  const negativeSignals = uniqueStrings(requirement.negativeSignals ?? [
    "table of contents",
    "copyright",
    "about this document",
    "acronym",
    "glossary",
    "references",
  ]);
  const keywordTerms = uniqueStrings([
    ...directSignals,
    ...actionSignals,
    ...topicSignals,
    ...(requirement.retrievalQuery ?? "").split(/\s+/),
  ])
    .filter((term) => term.length >= 4)
    .slice(0, 28);

  return {
    directSignals,
    actionSignals,
    topicSignals,
    negativeSignals,
    keywordTerms,
  };
}

function countMatches(text: string, signals: string[]) {
  const matched = signals.filter((signal) => text.includes(signal));
  return { count: matched.length, matched };
}

function chunkRerankText(chunk: RerankableChunk) {
  return normalize([
    chunk.filename,
    chunk.section_path,
    chunk.evidence_reason,
    chunk.embedding_input,
    chunk.content_preview,
  ].filter(Boolean).join(" "));
}

function sectionText(chunk: RerankableChunk) {
  return normalize(chunk.section_path);
}

function clampScore(score: number) {
  return Math.max(0, Math.round(score * 100) / 100);
}

export function rerankRequirementChunk<T extends RerankableChunk>(
  requirement: RerankableRequirement,
  chunk: T,
): T & {
  rerank_score: number;
  rerank_reason: string;
  negative_evidence: boolean;
  negative_evidence_reason: string | null;
} {
  const profile = buildRequirementKeywordProfile(requirement);
  const text = chunkRerankText(chunk);
  const section = sectionText(chunk);
  const semanticScore = Number.isFinite(chunk.similarity) ? chunk.similarity * 100 : 0;
  const direct = countMatches(text, profile.directSignals);
  const action = countMatches(text, profile.actionSignals);
  const topic = countMatches(text, profile.topicSignals);
  const negativeEvidence = detectNegativeEvidence(text, [
    ...profile.directSignals,
    ...profile.actionSignals,
    ...profile.topicSignals,
  ]);
  const sectionMatches = countMatches(section, [
    ...profile.directSignals,
    ...profile.actionSignals,
    ...profile.topicSignals,
  ]);
  const negative = countMatches(text, profile.negativeSignals);
  const evidenceReason = normalize(chunk.evidence_reason);

  let score = semanticScore;
  if (negativeEvidence.isNegativeEvidence) {
    score -= 40;
  } else {
    score += Math.min(direct.count, 5) * 9;
    score += Math.min(action.count, 4) * 6;
    score += Math.min(topic.count, 5) * 3;
    score += Math.min(sectionMatches.count, 3) * 5;
  }
  if (chunk.evidence_role === "organization_evidence") {
    score += 4;
  } else if (chunk.evidence_role === "requirement_reference") {
    score += 2;
  }
  if (evidenceReason.includes("substantive") || evidenceReason.includes("evidence")) {
    score += 4;
  }
  if (
    evidenceReason.includes("boilerplate")
    || evidenceReason.includes("front_matter")
    || evidenceReason.includes("table_fragment")
    || evidenceReason.includes("retrieval_excluded")
  ) {
    score -= 14;
  }
  score -= Math.min(negative.count, 3) * 7;

  const reasons = [
    `semantic ${semanticScore.toFixed(1)}`,
    direct.count > 0 ? `direct signals: ${direct.matched.slice(0, 3).join(", ")}` : null,
    action.count > 0 ? `action signals: ${action.matched.slice(0, 3).join(", ")}` : null,
    topic.count > 0 ? `topic signals: ${topic.matched.slice(0, 3).join(", ")}` : null,
    sectionMatches.count > 0 ? `section/path signals: ${sectionMatches.matched.slice(0, 2).join(", ")}` : null,
    chunk.evidence_role ? `role ${chunk.evidence_role}` : null,
    chunk.source_type ? `source ${chunk.source_type}` : null,
    evidenceReason ? `classifier ${evidenceReason}` : null,
    negativeEvidence.isNegativeEvidence
      ? `negative evidence: ${negativeEvidence.matchedPhrase} ${negativeEvidence.matchedSignal}`
      : null,
    negative.count > 0 ? `negative signals: ${negative.matched.slice(0, 2).join(", ")}` : null,
  ].filter(Boolean);

  return {
    ...chunk,
    rerank_score: clampScore(score),
    rerank_reason: reasons.join("; "),
    negative_evidence: negativeEvidence.isNegativeEvidence,
    negative_evidence_reason: negativeEvidence.isNegativeEvidence
      ? `${negativeEvidence.matchedPhrase} near ${negativeEvidence.matchedSignal}`
      : null,
  };
}

export function mergeHybridCandidates<T extends RerankableChunk>(
  semanticCandidates: T[],
  keywordCandidates: T[],
) {
  const candidatesById = new Map<string, T>();
  for (const candidate of semanticCandidates) {
    candidatesById.set(candidate.chunk_id, candidate);
  }

  for (const candidate of keywordCandidates) {
    const existing = candidatesById.get(candidate.chunk_id);
    if (!existing) {
      candidatesById.set(candidate.chunk_id, candidate);
      continue;
    }
    candidatesById.set(candidate.chunk_id, {
      ...candidate,
      ...existing,
      evidence_reason: existing.evidence_reason ?? candidate.evidence_reason,
      source_type: existing.source_type ?? candidate.source_type,
      evidence_role: existing.evidence_role ?? candidate.evidence_role,
      similarity: Number.isFinite(existing.similarity) ? existing.similarity : candidate.similarity,
    });
  }

  return Array.from(candidatesById.values());
}

export function rerankRequirementCandidates<T extends RerankableChunk>(
  requirement: RerankableRequirement,
  candidates: T[],
  topK: number,
) {
  const reranked = candidates
    .map((candidate) => rerankRequirementChunk(requirement, candidate))
    .sort((left, right) => {
      const rerankDelta = right.rerank_score - left.rerank_score;
      if (rerankDelta !== 0) return rerankDelta;
      return right.similarity - left.similarity;
    });

  const topCandidates = reranked.slice(0, topK);
  if (
    topK > 0
    && !topCandidates.some((candidate) => candidate.negative_evidence)
  ) {
    const negativeCandidate = reranked.find((candidate) => candidate.negative_evidence);
    if (negativeCandidate) {
      topCandidates.splice(Math.max(0, topK - 1), 1, negativeCandidate);
    }
  }

  return topCandidates.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
  }));
}
