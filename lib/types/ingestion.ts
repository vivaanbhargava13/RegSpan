export type JsonObject = Record<string, unknown>;

export type ProcessingStatus =
  | "Queued"
  | "Processing"
  | "Needs Review"
  | "Processed"
  | "Failed"
  | "Reprocessing";

export type ProcessingJob = {
  id: string;
  workspace_id: string;
  document_id: string;
  status: ProcessingStatus;
  step: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentChunk = {
  id: string;
  workspace_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: JsonObject;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  parent_heading: string | null;
  section_path: string | null;
  section_chunk_start: number | null;
  section_chunk_end: number | null;
  parent_chunk_start: number | null;
  parent_chunk_end: number | null;
  embedding: number[] | string | null;
  created_at: string;
};

export type DocumentHierarchy = {
  id: string;
  workspace_id: string;
  document_id: string;
  hierarchy_json: JsonObject;
  created_at: string;
  updated_at: string;
};

export type Finding = {
  id: string;
  workspace_id: string;
  control_id: string | null;
  document_id: string | null;
  severity: string | null;
  status: string;
  finding_text: string;
  evidence_text: string | null;
  remediation: string | null;
  created_at: string;
  updated_at: string;
};

export type FindingEvidence = {
  id: string;
  finding_id: string;
  document_id: string | null;
  chunk_id: string | null;
  page_start: number | null;
  page_end: number | null;
  evidence_quote: string | null;
  created_at: string;
};
