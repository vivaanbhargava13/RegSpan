import "server-only";

export {
  createEmbeddingProvider,
  EMBEDDING_DIMENSIONS,
  embedTextsInBatches,
  EmbeddingProcessingError,
  MAX_EMBEDDING_BATCH_SIZE,
  planEmbeddingUpdates,
  type EmbeddableChunk,
  type EmbeddingProvider,
  type ExistingChunkEmbedding,
} from "@/lib/embeddingCore";
