import { createHash } from "node:crypto";

const REQUIRED_PREPROCESSING_CACHE_FIELDS = [
  "pdfHash",
  "parserChunkerVersion",
  "sourceType",
  "embeddingModelInputVersion",
];

function normalizedCacheField(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Preprocessing reuse requires ${field}.`);
  }
  return value.trim();
}

/**
 * A development-only preprocessing identity. It deliberately excludes
 * retrieval, classification, and aggregation, which must be rerun even when
 * extraction, chunks, hierarchy, and embeddings are safely reusable.
 */
export function preprocessingReuseKey(input) {
  const components = Object.fromEntries(REQUIRED_PREPROCESSING_CACHE_FIELDS.map((field) => [
    field,
    normalizedCacheField(input?.[field], field),
  ]));
  return createHash("sha256").update(JSON.stringify(components)).digest("hex");
}

export function preprocessingCacheEntryIsReusable(entry, currentInput) {
  if (!entry || typeof entry !== "object" || typeof entry.key !== "string") return false;
  return entry.key === preprocessingReuseKey(currentInput);
}
