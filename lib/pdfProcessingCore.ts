export const PDF_EXTRACTION_VERSION = "pdf-parse-v1";
export const MAX_PDF_PAGES = 500;
export const MAX_EXTRACTED_CHARACTERS = 5_000_000;
export const MIN_EXTRACTED_CHARACTERS = 20;
export const TARGET_CHUNK_CHARACTERS = 1_800;
export const CHUNK_OVERLAP_CHARACTERS = 200;
export const MAX_DOCUMENT_CHUNKS = 5_000;

const PDF_PARSE_TIMEOUT_MS = 30_000;

export type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
};

export type StoredDocumentChunk = {
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  page_start: number;
  page_end: number;
  section_heading: string;
  parent_heading: string;
  section_path: string;
  section_chunk_start: number;
  section_chunk_end: number;
  parent_chunk_start: number;
  parent_chunk_end: number;
};

export class PdfProcessingError extends Error {
  readonly code: string;
  readonly safeMessage: string;
  readonly status: number;

  constructor(
    code: string,
    safeMessage: string,
    status: number,
  ) {
    super(safeMessage);
    this.name = "PdfProcessingError";
    this.code = code;
    this.safeMessage = safeMessage;
    this.status = status;
  }
}

function normalizeExtractedText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assertSupportedPdf(filename: string, mimeType: string | null) {
  if (mimeType !== "application/pdf" || !filename.toLowerCase().endsWith(".pdf")) {
    throw new PdfProcessingError(
      "unsupported_file_type",
      "Only PDF documents can be processed.",
      415,
    );
  }
}

export async function extractPdfPages(data: Uint8Array): Promise<ExtractedPdfPage[]> {
  if (data.byteLength === 0) {
    throw new PdfProcessingError("empty_pdf", "The PDF file is empty.", 422);
  }

  // Keep pdf.js out of Next's transformed module graph. The package is also
  // listed in serverExternalPackages so Node loads its native ESM build.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data });
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      parser.getText({ pageJoiner: "" }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(
            new PdfProcessingError(
              "pdf_extraction_timeout",
              "PDF text extraction timed out.",
              422,
            ),
          ),
          PDF_PARSE_TIMEOUT_MS,
        );
      }),
    ]);

    if (result.total > MAX_PDF_PAGES) {
      throw new PdfProcessingError(
        "pdf_page_limit_exceeded",
        `PDF documents cannot exceed ${MAX_PDF_PAGES} pages.`,
        422,
      );
    }

    const pages = result.pages.map((page) => ({
      pageNumber: page.num,
      text: normalizeExtractedText(page.text),
    }));
    const totalCharacters = pages.reduce((sum, page) => sum + page.text.length, 0);

    if (totalCharacters < MIN_EXTRACTED_CHARACTERS) {
      throw new PdfProcessingError(
        "insufficient_pdf_text",
        "The PDF does not contain enough extractable text.",
        422,
      );
    }

    if (totalCharacters > MAX_EXTRACTED_CHARACTERS) {
      throw new PdfProcessingError(
        "pdf_text_limit_exceeded",
        "The PDF contains too much extractable text.",
        422,
      );
    }

    return pages;
  } catch (error) {
    if (error instanceof PdfProcessingError) throw error;
    throw new PdfProcessingError(
      "pdf_extraction_failed",
      "PDF text extraction failed.",
      422,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    await parser.destroy().catch(() => undefined);
  }
}

function splitPageText(text: string) {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + TARGET_CHUNK_CHARACTERS, text.length);

    if (end < text.length) {
      const minimumBreak = start + Math.floor(TARGET_CHUNK_CHARACTERS * 0.6);
      const paragraphBreak = text.lastIndexOf("\n\n", end);
      const sentenceBreak = text.lastIndexOf(". ", end);
      const whitespaceBreak = text.lastIndexOf(" ", end);
      const preferredBreak = [paragraphBreak, sentenceBreak, whitespaceBreak]
        .find((candidate) => candidate >= minimumBreak);
      if (preferredBreak !== undefined) {
        end = preferredBreak + (preferredBreak === sentenceBreak ? 1 : 0);
      }
    }

    const content = text.slice(start, end).trim();
    if (content) chunks.push(content);
    if (end >= text.length) break;

    const nextStart = Math.max(0, end - CHUNK_OVERLAP_CHARACTERS);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

export function buildDeterministicChunks(input: {
  pages: ExtractedPdfPage[];
  documentId: string;
  workspaceId: string;
  jobId: string;
  filename: string;
}) {
  const pieces = input.pages.flatMap((page) =>
    splitPageText(page.text).map((content) => ({
      content,
      pageNumber: page.pageNumber,
    })),
  );

  if (pieces.length === 0) {
    throw new PdfProcessingError(
      "insufficient_pdf_text",
      "The PDF does not contain enough extractable text.",
      422,
    );
  }

  if (pieces.length > MAX_DOCUMENT_CHUNKS) {
    throw new PdfProcessingError(
      "pdf_chunk_limit_exceeded",
      "The PDF produced too many text chunks.",
      422,
    );
  }

  const pageBounds = new Map<number, { start: number; end: number }>();
  pieces.forEach((piece, index) => {
    const existing = pageBounds.get(piece.pageNumber);
    pageBounds.set(piece.pageNumber, {
      start: existing?.start ?? index,
      end: index,
    });
  });

  const parentEnd = pieces.length - 1;
  const chunks: StoredDocumentChunk[] = pieces.map((piece, chunkIndex) => {
    const bounds = pageBounds.get(piece.pageNumber)!;
    const sectionHeading = `Page ${piece.pageNumber}`;
    const sectionPath = `Extracted PDF > ${sectionHeading}`;

    return {
      chunk_index: chunkIndex,
      content: piece.content,
      metadata: {
        document_id: input.documentId,
        workspace_id: input.workspaceId,
        job_id: input.jobId,
        filename: input.filename,
        page_start: piece.pageNumber,
        page_end: piece.pageNumber,
        section_heading: sectionHeading,
        parent_heading: "Extracted PDF",
        section_path: sectionPath,
        chunk_index: chunkIndex,
        section_chunk_start: bounds.start,
        section_chunk_end: bounds.end,
        parent_chunk_start: 0,
        parent_chunk_end: parentEnd,
        extraction_version: PDF_EXTRACTION_VERSION,
      },
      page_start: piece.pageNumber,
      page_end: piece.pageNumber,
      section_heading: sectionHeading,
      parent_heading: "Extracted PDF",
      section_path: sectionPath,
      section_chunk_start: bounds.start,
      section_chunk_end: bounds.end,
      parent_chunk_start: 0,
      parent_chunk_end: parentEnd,
    };
  });

  const populatedPages = [...pageBounds.entries()].map(([pageNumber, bounds]) => ({
    heading: `Page ${pageNumber}`,
    section_path: `Extracted PDF > Page ${pageNumber}`,
    page_start: pageNumber,
    page_end: pageNumber,
    chunk_start: bounds.start,
    chunk_end: bounds.end,
  }));

  const hierarchy = {
    document_id: input.documentId,
    filename: input.filename,
    extraction_version: PDF_EXTRACTION_VERSION,
    headings: [
      {
        heading: "Extracted PDF",
        section_path: "Extracted PDF",
        page_start: input.pages[0]?.pageNumber ?? 1,
        page_end: input.pages.at(-1)?.pageNumber ?? 1,
        chunk_start: 0,
        chunk_end: parentEnd,
        children: populatedPages,
      },
    ],
  };

  return { chunks, hierarchy };
}
