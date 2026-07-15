export const SEMANTIC_CANDIDATE_PREVIEW_MAX_CHARS = 1_200;
// Matches the classifier prompt's bounded source-text window.
export const CLASSIFIER_SOURCE_TEXT_MAX_CHARS = 6_000;

type CandidateWithPreview = {
  chunk_id: string;
  content_preview: string;
};

type StoredSourceTextRow = {
  id: unknown;
  content: unknown;
};

export type ClassifierSourceTextCache = Map<string, string | null>;

export function createClassifierSourceTextCache(): ClassifierSourceTextCache {
  return new Map();
}

export function classifierSourceTextCacheKey(workspaceId: string, chunkId: string) {
  return JSON.stringify([workspaceId, chunkId]);
}

function selectedUncachedChunkIds<T extends CandidateWithPreview>(
  workspaceId: string,
  candidates: T[],
  sourceTextCache: ReadonlyMap<string, string | null>,
) {
  const chunkIds = new Set<string>();
  for (const candidate of candidates) {
    const cacheKey = classifierSourceTextCacheKey(workspaceId, candidate.chunk_id);
    if (!sourceTextCache.has(cacheKey)) {
      chunkIds.add(candidate.chunk_id);
    }
  }
  return [...chunkIds];
}

function cacheSelectedSourceTextRows({
  workspaceId,
  chunkIds,
  rows,
  sourceTextCache,
}: {
  workspaceId: string;
  chunkIds: string[];
  rows: readonly StoredSourceTextRow[];
  sourceTextCache: ClassifierSourceTextCache;
}) {
  const requestedChunkIds = new Set(chunkIds);
  for (const chunkId of chunkIds) {
    sourceTextCache.set(classifierSourceTextCacheKey(workspaceId, chunkId), null);
  }

  for (const row of rows) {
    if (typeof row.id !== "string" || !requestedChunkIds.has(row.id)) continue;
    sourceTextCache.set(
      classifierSourceTextCacheKey(workspaceId, row.id),
      typeof row.content === "string" ? row.content : null,
    );
  }
}

function sourceTextByChunkIdFromCache<T extends CandidateWithPreview>(
  workspaceId: string,
  candidates: T[],
  sourceTextCache: ReadonlyMap<string, string | null>,
) {
  const sourceTextByChunkId = new Map<string, string>();
  for (const candidate of candidates) {
    const sourceText = sourceTextCache.get(
      classifierSourceTextCacheKey(workspaceId, candidate.chunk_id),
    );
    if (typeof sourceText === "string") {
      sourceTextByChunkId.set(candidate.chunk_id, sourceText);
    }
  }
  return sourceTextByChunkId;
}

export function hydrateSelectedCandidateSourceTexts<T extends CandidateWithPreview>(
  candidates: T[],
  storedSourceTextByChunkId: ReadonlyMap<string, string>,
): T[] {
  return candidates.map((candidate) => {
    const storedSourceText = storedSourceTextByChunkId.get(candidate.chunk_id);
    const preview = candidate.content_preview;
    const wasTruncated = Boolean(
      storedSourceText
      && storedSourceText.length > preview.length
      && storedSourceText.startsWith(preview),
    );
    if (!wasTruncated || !storedSourceText) return candidate;

    return {
      ...candidate,
      content_preview: storedSourceText.slice(0, CLASSIFIER_SOURCE_TEXT_MAX_CHARS),
    };
  });
}

export async function hydrateSelectedCandidateSourceTextsWithCache<T extends CandidateWithPreview>({
  workspaceId,
  candidates,
  sourceTextCache,
  loadSourceTextRows,
}: {
  workspaceId: string;
  candidates: T[];
  sourceTextCache: ClassifierSourceTextCache;
  loadSourceTextRows: (chunkIds: string[]) => Promise<readonly StoredSourceTextRow[]>;
}): Promise<T[]> {
  const uncachedChunkIds = selectedUncachedChunkIds(
    workspaceId,
    candidates,
    sourceTextCache,
  );
  if (uncachedChunkIds.length > 0) {
    const rows = await loadSourceTextRows(uncachedChunkIds);
    cacheSelectedSourceTextRows({
      workspaceId,
      chunkIds: uncachedChunkIds,
      rows,
      sourceTextCache,
    });
  }

  return hydrateSelectedCandidateSourceTexts(
    candidates,
    sourceTextByChunkIdFromCache(workspaceId, candidates, sourceTextCache),
  );
}
