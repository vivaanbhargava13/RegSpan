import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { REG_SP_SOURCE_KEY } from "../lib/regulatoryControlFramework";

type ExtractedPage = {
  pageNumber: number;
  text: string;
};

type RegulatoryChunkDraft = {
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  heading: string | null;
  parentHeading: string | null;
  sectionPath: string | null;
  chunkKind: string;
  content: string;
  synopsis: string;
  metadata: Record<string, unknown>;
};

const TARGET_CHARS = 4_000;
const OVERLAP_CHARS = 500;

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeText(value: string) {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPages(pdfPath: string): Promise<ExtractedPage[]> {
  const data = await readFile(pdfPath);
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText({ pageJoiner: "" });
    return result.pages.map((page) => ({
      pageNumber: page.num,
      text: normalizeText(page.text),
    })).filter((page) => page.text.length > 0);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function lineLooksLikeHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 130) return false;
  if (/^\d{1,4}$/.test(trimmed)) return false;
  if (/\.{2,}\s*\d{1,4}$/.test(trimmed)) return false;
  if (/^(table of contents|contents)$/i.test(trimmed)) return true;
  if (/^(introduction|background|discussion|final rule|economic analysis|statutory authority|compliance period)$/i.test(trimmed)) return true;
  if (/^(?:[IVXLCDM]+\.|[A-Z]\.|\d+(?:\.\d+)*)\s+[A-Z]/.test(trimmed)) return true;
  const words = trimmed.split(/\s+/);
  const titleWords = words.filter((word) => /^[A-Z][A-Za-z0-9(),'-]*$/.test(word));
  return words.length >= 2 && words.length <= 12 && titleWords.length / words.length >= 0.7;
}

function classifyChunkKind(text: string, heading: string | null): string {
  const haystack = `${heading ?? ""}\n${text}`.toLowerCase();
  if (/\beconomic analysis\b|\bcosts?\b.*\bbenefits?\b/.test(haystack)) return "economic_analysis";
  if (/\bcompliance (?:period|date)\b|\beffective date\b/.test(haystack)) return "compliance_date";
  if (/\bcommenters?\b|\bcomment letters?\b|\bcommenter stated\b/.test(haystack)) return "commenter_position";
  if (/\balternative\b|\bdeclin(?:e|ed|ing) to\b|\breject(?:s|ed)?\b/.test(haystack)) return "rejected_alternative";
  if (/\bexcept(?:ion|ions)?\b|\bunless\b/.test(haystack)) return "exception";
  if (/\bdefinition\b|\bmeans\b|\bdefined as\b/.test(haystack)) return "definition";
  if (/\b17\s+cfr\b|\b§\s*248\.30\b|\bshall\b|\bmust\b|\brequired to\b/.test(haystack)) return "direct_rule_requirement";
  if (/\bcommission\b|\bsec\b|\bwe are adopting\b|\bfinal rule\b/.test(haystack)) return "sec_explanation";
  return "background_context";
}

function synopsisFor(content: string) {
  const sentence = content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .find((part) => part.length >= 40);
  return (sentence ?? content.replace(/\s+/g, " ")).slice(0, 500);
}

function chunkPages(pages: ExtractedPage[]): RegulatoryChunkDraft[] {
  const drafts: RegulatoryChunkDraft[] = [];
  let currentHeading: string | null = null;
  let currentParentHeading: string | null = null;
  let buffer = "";
  let pageStart = pages[0]?.pageNumber ?? 1;
  let pageEnd = pageStart;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    drafts.push({
      chunkIndex: drafts.length,
      pageStart,
      pageEnd,
      heading: currentHeading,
      parentHeading: currentParentHeading,
      sectionPath: [currentParentHeading, currentHeading].filter(Boolean).join(" > ") || null,
      chunkKind: classifyChunkKind(content, currentHeading),
      content,
      synopsis: synopsisFor(content),
      metadata: {
        source_type: "regulatory_reference",
        evidence_role: "requirement_reference",
        import_version: "sec-regsp-import-v1",
      },
    });
  };

  for (const page of pages) {
    const lines = page.text.split("\n").map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (lineLooksLikeHeading(line)) {
        if (buffer.length >= 800) {
          flush();
          buffer = "";
          pageStart = page.pageNumber;
        }
        if (/^(?:[IVXLCDM]+\.|\d+\.)\s+/.test(line) || /^(introduction|background|discussion|final rule|economic analysis|statutory authority|compliance period)$/i.test(line)) {
          currentParentHeading = line.replace(/^(?:[IVXLCDM]+\.|\d+\.)\s+/, "");
        }
        currentHeading = line.replace(/^(?:[A-Z]\.|\d+(?:\.\d+)*)\s+/, "");
      }

      if (buffer.length > TARGET_CHARS) {
        flush();
        buffer = buffer.slice(Math.max(0, buffer.length - OVERLAP_CHARS));
        pageStart = page.pageNumber;
      }

      buffer += `${line}\n`;
      pageEnd = page.pageNumber;
    }
  }
  flush();

  return drafts.map((draft, index) => ({ ...draft, chunkIndex: index }));
}

async function main() {
  const pdfPath = process.argv[2] ?? process.env.SEC_REGSP_PDF_PATH;
  if (!pdfPath) {
    throw new Error("Pass a local SEC PDF path as the first CLI argument or set SEC_REGSP_PDF_PATH.");
  }

  const resolvedPdfPath = resolve(pdfPath);
  const pages = await extractPages(resolvedPdfPath);
  if (pages.length === 0) {
    throw new Error("No extractable text was found in the SEC PDF.");
  }

  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  const { data: source, error: sourceError } = await supabase
    .from("regulatory_sources")
    .upsert({
      source_key: REG_SP_SOURCE_KEY,
      title: "Regulation S-P: Privacy of Consumer Financial Information and Safeguarding Customer Information",
      regulator: "SEC",
      release_number: "34-100155",
      regulation: "Regulation S-P",
      source_type: "sec_final_rule",
      effective_date: "2024-08-02",
      compliance_date: "Tiered compliance period; see final rule compliance period discussion.",
      version: "2024-final-rule",
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "source_key" })
    .select("id")
    .single();

  if (sourceError || !source) {
    throw new Error(`Unable to upsert regulatory source: ${sourceError?.message ?? "missing row"}`);
  }

  const chunks = chunkPages(pages).map((chunk) => ({
    source_id: source.id,
    chunk_index: chunk.chunkIndex,
    page_start: chunk.pageStart,
    page_end: chunk.pageEnd,
    heading: chunk.heading,
    parent_heading: chunk.parentHeading,
    section_path: chunk.sectionPath,
    chunk_kind: chunk.chunkKind,
    content: chunk.content,
    synopsis: chunk.synopsis,
    metadata: {
      ...chunk.metadata,
      source_pdf_filename: basename(resolvedPdfPath),
      source_pdf_path: resolvedPdfPath,
      regulatory_reference: true,
      organization_evidence: false,
    },
    updated_at: new Date().toISOString(),
  }));

  const { error: chunksError } = await supabase
    .from("regulatory_source_chunks")
    .upsert(chunks, { onConflict: "source_id,chunk_index" });

  if (chunksError) {
    throw new Error(`Unable to import regulatory source chunks: ${chunksError.message}`);
  }

  console.info(`Imported ${chunks.length} regulatory reference chunks from ${resolvedPdfPath}.`);
  console.info("No workspace documents, document_chunks, embeddings, or storage uploads were created.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
