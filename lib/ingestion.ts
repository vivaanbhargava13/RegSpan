import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveDocumentSource,
} from "./documentSource";
import {
  buildChunkEmbeddingInput,
  CHUNK_CONTEXT_VERSION,
  hashChunkContent,
} from "./pdfProcessingCore";

export type IngestionDocument = {
  id: string;
  workspace_id: string;
  filename: string;
  status: string | null;
  document_type?: string | null;
  notes?: string | null;
};

export async function getIngestionDocument(
  supabase: SupabaseClient,
  documentId: string,
  workspaceId: string,
) {
  return supabase
    .from("documents")
    .select("id, workspace_id, filename, status, document_type, notes")
    .eq("id", documentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle<IngestionDocument>();
}

export function createMockChunks(document: IngestionDocument) {
  const { sourceType, evidenceRole } = resolveDocumentSource({
    filename: document.filename,
    documentType: document.document_type,
    notes: document.notes,
    sectionPath: null,
    contentPreview: null,
    evidenceReason: "substantive_requirement_or_procedure",
  });
  const baseMetadata = {
    document_id: document.id,
    workspace_id: document.workspace_id,
    filename: document.filename,
    document_type: document.document_type ?? null,
    source_type: sourceType,
    evidence_role: evidenceRole,
    parent_heading: "Incident Response",
    section_start_page: 1,
    heading_page: 1,
    parent_chunk_start: 0,
    parent_chunk_end: 4,
    evidence_class: "evidence",
    evidence_reason: "substantive_requirement_or_procedure",
    chunk_context_version: CHUNK_CONTEXT_VERSION,
    chunk_annotation_version: null,
    retrieval_excluded: false,
    retrieval_included: true,
  };

  const chunks = [
    {
      content:
        "Following confirmation of unauthorized access to customer information, the incident response lead will assess the scope of affected records and determine whether customer notification is required.",
      page_start: 1,
      page_end: 2,
      section_heading: "Customer Notification",
      section_path: "Incident Response > Customer Notification",
      section_chunk_start: 0,
      section_chunk_end: 2,
    },
    {
      content:
        "Customer notices will describe the nature and date of the incident, the information involved, actions taken to protect affected individuals, and a point of contact for questions.",
      page_start: 2,
      page_end: 2,
      section_heading: "Customer Notification",
      section_path: "Incident Response > Customer Notification",
      section_chunk_start: 0,
      section_chunk_end: 2,
    },
    {
      content:
        "Legal, Privacy, and Communications must approve notification language and delivery timing. Notices should be issued as soon as practicable after containment and required investigation steps.",
      page_start: 2,
      page_end: 3,
      section_heading: "Customer Notification",
      section_path: "Incident Response > Customer Notification",
      section_chunk_start: 0,
      section_chunk_end: 2,
    },
    {
      content:
        "Service providers must promptly escalate suspected customer information incidents to the incident response lead and preserve relevant logs, communications, and forensic evidence.",
      page_start: 4,
      page_end: 5,
      section_heading: "Service Provider Escalation",
      section_path: "Incident Response > Service Provider Escalation",
      section_chunk_start: 3,
      section_chunk_end: 3,
    },
    {
      content:
        "After recovery, the response team will document lessons learned, assign corrective actions, and track updates to safeguards, procedures, and vendor oversight through completion.",
      page_start: 6,
      page_end: 6,
      section_heading: "Post-Incident Review",
      section_path: "Incident Response > Post-Incident Review",
      section_chunk_start: 4,
      section_chunk_end: 4,
    },
  ];

  return chunks.map((chunk, chunkIndex) => {
    const embeddingInput = buildChunkEmbeddingInput({
      filename: document.filename,
      documentType: document.document_type ?? null,
      sourceType,
      evidenceRole,
      sectionPath: chunk.section_path,
      sectionHeading: chunk.section_heading,
      parentHeading: baseMetadata.parent_heading,
      headingPage: baseMetadata.heading_page,
      pageStart: chunk.page_start,
      pageEnd: chunk.page_end,
      content: chunk.content,
    });
    const sourceContentHash = hashChunkContent(chunk.content);
    const contentHash = hashChunkContent(embeddingInput);

    return {
      workspace_id: document.workspace_id,
      document_id: document.id,
      chunk_index: chunkIndex,
      content: chunk.content,
      metadata: {
        ...baseMetadata,
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        section_heading: chunk.section_heading,
        section_path: chunk.section_path,
        deterministic_retrieval_context: [
          document.filename,
          document.document_type ?? null,
          sourceType,
          evidenceRole,
          chunk.section_path,
          chunk.section_heading,
          baseMetadata.parent_heading,
          `pages ${chunk.page_start}-${chunk.page_end}`,
        ].filter(Boolean).join(" | "),
        chunk_index: chunkIndex,
        section_chunk_start: chunk.section_chunk_start,
        section_chunk_end: chunk.section_chunk_end,
        char_start: 0,
        char_end: chunk.content.length,
        token_estimate: Math.max(1, Math.ceil(chunk.content.length / 4)),
        source_content_hash: sourceContentHash,
        content_hash: contentHash,
        embedding_input: embeddingInput,
      },
      page_start: chunk.page_start,
      page_end: chunk.page_end,
      section_heading: chunk.section_heading,
      parent_heading: baseMetadata.parent_heading,
      section_path: chunk.section_path,
      section_chunk_start: chunk.section_chunk_start,
      section_chunk_end: chunk.section_chunk_end,
      parent_chunk_start: baseMetadata.parent_chunk_start,
      parent_chunk_end: baseMetadata.parent_chunk_end,
      content_hash: contentHash,
    };
  });
}

export function createMockHierarchy(document: IngestionDocument) {
  return {
    workspace_id: document.workspace_id,
    document_id: document.id,
    hierarchy_json: {
      document_id: document.id,
      filename: document.filename,
      headings: [
        {
          heading: "Incident Response",
          section_path: "Incident Response",
          page_start: 1,
          page_end: 6,
          chunk_start: 0,
          chunk_end: 4,
          children: [
            {
              heading: "Customer Notification",
              section_path: "Incident Response > Customer Notification",
              page_start: 1,
              page_end: 3,
              chunk_start: 0,
              chunk_end: 2,
            },
            {
              heading: "Service Provider Escalation",
              section_path: "Incident Response > Service Provider Escalation",
              page_start: 4,
              page_end: 5,
              chunk_start: 3,
              chunk_end: 3,
            },
            {
              heading: "Post-Incident Review",
              section_path: "Incident Response > Post-Incident Review",
              page_start: 6,
              page_end: 6,
              chunk_start: 4,
              chunk_end: 4,
            },
          ],
        },
      ],
    },
  };
}
