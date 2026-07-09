import { isExternalAiProcessingEnabled } from "./aiProcessingPolicy";
import {
  buildChunkEmbeddingInput,
  CHUNK_ANNOTATION_VERSION,
  hashChunkContent,
  type StoredDocumentChunk,
} from "./pdfProcessingCore";

type ChunkContextEnvironment = Record<string, string | undefined>;

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const CHUNK_SYNOPSIS_TIMEOUT_MS = 20_000;

function normalizeSynopsis(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 90)
    .join(" ");
}

function shouldAnnotateChunk(chunk: StoredDocumentChunk) {
  return chunk.metadata.evidence_class === "evidence"
    && chunk.metadata.retrieval_included !== false
    && chunk.metadata.retrieval_excluded !== true
    && chunk.metadata.evidence_role === "organization_evidence";
}

function deterministicRetrievalContext(chunk: StoredDocumentChunk) {
  return [
    chunk.filename,
    chunk.metadata.document_type,
    chunk.metadata.source_type,
    chunk.metadata.evidence_role,
    chunk.section_path,
    chunk.section_heading,
    chunk.parent_heading,
    `pages ${chunk.page_start}-${chunk.page_end}`,
  ].filter(Boolean).join(" | ");
}

async function fetchChunkSynopsis({
  chunk,
  model,
  apiKey,
  fetchImplementation,
}: {
  chunk: StoredDocumentChunk;
  model: string;
  apiKey: string;
  fetchImplementation: typeof fetch;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHUNK_SYNOPSIS_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(OPENAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              "Summarize one client policy excerpt for retrieval only. Do not add facts not present in the excerpt. Return 50-80 words with no bullets.",
          },
          {
            role: "user",
            content: [
              `Filename: ${chunk.filename}`,
              `Document type: ${chunk.metadata.document_type ?? "unknown"}`,
              `Section heading: ${chunk.section_heading}`,
              `Parent heading: ${chunk.parent_heading}`,
              `Section path: ${chunk.section_path}`,
              `Pages: ${chunk.page_start}-${chunk.page_end}`,
              "",
              "Identify the policy/procedure topic, concrete obligations or procedures mentioned, explicit limitations or exclusions, and whether the excerpt appears supportive, partial, negative, or background.",
              "",
              "Raw excerpt:",
              chunk.content.slice(0, 5000),
            ].join("\n"),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;
    const body = await response.json() as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim()
      ? normalizeSynopsis(content)
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function rebuildChunkEmbeddingInput(
  chunk: StoredDocumentChunk,
  synopsis: string | null,
) {
  return buildChunkEmbeddingInput({
    filename: chunk.filename,
    documentType: typeof chunk.metadata.document_type === "string"
      ? chunk.metadata.document_type
      : null,
    sourceType: typeof chunk.metadata.source_type === "string"
      ? chunk.metadata.source_type
      : null,
    evidenceRole: typeof chunk.metadata.evidence_role === "string"
      ? chunk.metadata.evidence_role
      : null,
    sectionPath: chunk.section_path,
    sectionHeading: chunk.section_heading,
    parentHeading: chunk.parent_heading,
    headingPage: typeof chunk.metadata.heading_page === "number"
      ? chunk.metadata.heading_page
      : null,
    pageStart: chunk.page_start,
    pageEnd: chunk.page_end,
    synopsis,
    content: chunk.content,
  });
}

export async function addOptionalChunkSynopses(input: {
  chunks: StoredDocumentChunk[];
  environment?: ChunkContextEnvironment;
  fetchImplementation?: typeof fetch;
}) {
  const environment = input.environment ?? process.env;
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const model = environment.CHUNK_SYNOPSIS_MODEL?.trim()
    || environment.REQUIREMENT_CLASSIFIER_MODEL?.trim();
  const apiKey = environment.CHUNK_SYNOPSIS_API_KEY?.trim()
    || environment.REQUIREMENT_CLASSIFIER_API_KEY?.trim()
    || environment.OPENAI_API_KEY?.trim();
  const canUseExternalAi = isExternalAiProcessingEnabled(environment) && Boolean(model && apiKey);

  const annotated: StoredDocumentChunk[] = [];
  for (const chunk of input.chunks) {
    const canAnnotate = canUseExternalAi && shouldAnnotateChunk(chunk);
    const synopsis = canAnnotate
      ? await fetchChunkSynopsis({
        chunk,
        model: model!,
        apiKey: apiKey!,
        fetchImplementation,
      })
      : null;
    const embeddingInput = rebuildChunkEmbeddingInput(chunk, synopsis);
    const contentHash = hashChunkContent(embeddingInput);

    annotated.push({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        deterministic_retrieval_context: deterministicRetrievalContext(chunk),
        embedding_input: embeddingInput,
        chunk_synopsis: synopsis,
        chunk_annotation_version: synopsis ? CHUNK_ANNOTATION_VERSION : null,
        content_hash: contentHash,
      },
      content_hash: contentHash,
    });
  }

  return annotated;
}
