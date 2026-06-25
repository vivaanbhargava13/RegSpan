export const EMBEDDING_DIMENSIONS = 1536;
export const MAX_EMBEDDING_BATCH_SIZE = 32;
const EMBEDDING_REQUEST_TIMEOUT_MS = 30_000;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

type EmbeddingEnvironment = Record<string, string | undefined>;

export type EmbeddableChunk = {
  id: string;
  content: string;
  content_hash: string;
};

export type ExistingChunkEmbedding = {
  chunk_id: string;
  content_hash: string;
  embedding_model: string;
};

export type EmbeddingProvider = {
  provider: string;
  model: string;
  dimensions: number;
  embedTexts: (texts: string[]) => Promise<number[][]>;
};

export class EmbeddingProcessingError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly status: number;

  constructor(code: string, safeMessage: string, status: number) {
    super(safeMessage);
    this.name = "EmbeddingProcessingError";
    this.code = code;
    this.safeMessage = safeMessage;
    this.status = status;
  }
}

function requireEnvironmentValue(environment: EmbeddingEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new EmbeddingProcessingError(
      "embedding_not_configured",
      `Missing required server environment variable: ${name}.`,
      500,
    );
  }
  return value;
}

function validateEmbeddingVector(vector: unknown): vector is number[] {
  return Array.isArray(vector)
    && vector.length === EMBEDDING_DIMENSIONS
    && vector.every((value) => typeof value === "number" && Number.isFinite(value));
}

export function planEmbeddingUpdates(
  chunks: EmbeddableChunk[],
  existingEmbeddings: ExistingChunkEmbedding[],
  embeddingModel: string,
) {
  const currentHashes = new Map(
    existingEmbeddings
      .filter((embedding) => embedding.embedding_model === embeddingModel)
      .map((embedding) => [embedding.chunk_id, embedding.content_hash]),
  );

  return chunks.filter(
    (chunk) => currentHashes.get(chunk.id) !== chunk.content_hash,
  );
}

export function createEmbeddingProvider(
  environment: EmbeddingEnvironment = process.env,
  fetchImplementation: typeof fetch = fetch,
): EmbeddingProvider {
  const provider = requireEnvironmentValue(environment, "EMBEDDING_PROVIDER").toLowerCase();
  const model = requireEnvironmentValue(environment, "EMBEDDING_MODEL");
  const apiKey = requireEnvironmentValue(environment, "EMBEDDING_API_KEY");

  if (provider !== "openai") {
    throw new EmbeddingProcessingError(
      "unsupported_embedding_provider",
      "The configured embedding provider is not supported.",
      500,
    );
  }

  return {
    provider,
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    async embedTexts(texts) {
      if (texts.length === 0) return [];
      if (texts.length > MAX_EMBEDDING_BATCH_SIZE) {
        throw new EmbeddingProcessingError(
          "embedding_batch_too_large",
          "The embedding batch is too large.",
          500,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), EMBEDDING_REQUEST_TIMEOUT_MS);

      try {
        const response = await fetchImplementation(OPENAI_EMBEDDINGS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            input: texts,
            model,
            dimensions: EMBEDDING_DIMENSIONS,
            encoding_format: "float",
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new EmbeddingProcessingError(
            "embedding_provider_failed",
            "The embedding provider could not process the document chunks.",
            502,
          );
        }

        const body = await response.json() as {
          data?: Array<{ embedding?: unknown; index?: number }>;
        };
        const ordered = [...(body.data ?? [])].sort(
          (left, right) => (left.index ?? 0) - (right.index ?? 0),
        );
        const vectors = ordered.map((item) => item.embedding);

        if (vectors.length !== texts.length || !vectors.every(validateEmbeddingVector)) {
          throw new EmbeddingProcessingError(
            "invalid_embedding_response",
            "The embedding provider returned an invalid response.",
            502,
          );
        }

        return vectors as number[][];
      } catch (error) {
        if (error instanceof EmbeddingProcessingError) throw error;
        throw new EmbeddingProcessingError(
          "embedding_provider_failed",
          "The embedding provider could not process the document chunks.",
          502,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export async function embedTextsInBatches(
  provider: EmbeddingProvider,
  texts: string[],
) {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += MAX_EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + MAX_EMBEDDING_BATCH_SIZE);
    vectors.push(...await provider.embedTexts(batch));
  }
  return vectors;
}
