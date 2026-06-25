export const DEFAULT_RETRIEVAL_DEBUG_TOP_K = 5;
export const MAX_RETRIEVAL_DEBUG_TOP_K = 20;
export const MAX_RETRIEVAL_DEBUG_QUERY_LENGTH = 8_000;

export type RetrievalDebugRequest = {
  query: string;
  topK: number;
  documentId: string | null;
};

export class RetrievalDebugValidationError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly code: string,
  ) {
    super(publicMessage);
    this.name = "RetrievalDebugValidationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parseTopK(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_RETRIEVAL_DEBUG_TOP_K;
  }

  const numericValue = typeof value === "number" ? value : Number(value);
  if (
    !Number.isInteger(numericValue) ||
    numericValue < 1 ||
    numericValue > MAX_RETRIEVAL_DEBUG_TOP_K
  ) {
    throw new RetrievalDebugValidationError(
      `Choose a top_k value from 1 to ${MAX_RETRIEVAL_DEBUG_TOP_K}.`,
      "invalid_top_k",
    );
  }

  return numericValue;
}

export function parseRetrievalDebugRequest(body: unknown): RetrievalDebugRequest {
  if (!isPlainObject(body)) {
    throw new RetrievalDebugValidationError(
      "Send a JSON object with a query.",
      "invalid_request_body",
    );
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    throw new RetrievalDebugValidationError(
      "Enter a retrieval query before searching.",
      "missing_query",
    );
  }
  if (query.length > MAX_RETRIEVAL_DEBUG_QUERY_LENGTH) {
    throw new RetrievalDebugValidationError(
      "Retrieval queries cannot exceed 8,000 characters.",
      "query_too_long",
    );
  }

  const documentId = typeof body.documentId === "string"
    ? body.documentId.trim()
    : "";
  if (documentId && !isUuid(documentId)) {
    throw new RetrievalDebugValidationError(
      "Choose a valid document filter.",
      "invalid_document_filter",
    );
  }

  return {
    query,
    topK: parseTopK(body.topK),
    documentId: documentId || null,
  };
}
