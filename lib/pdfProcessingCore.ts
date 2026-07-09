import { createHash } from "node:crypto";

export const PDF_EXTRACTION_VERSION = "pdf-parse-v1";
export const MAX_PDF_PAGES = 500;
export const MAX_EXTRACTED_CHARACTERS = 5_000_000;
export const MIN_EXTRACTED_CHARACTERS = 20;
export const CHUNKING_VERSION = "section-aware-v3-evidence";
export const CHUNK_CONTEXT_VERSION = "chunk-context-v1";
export const CHUNK_ANNOTATION_VERSION = "chunk-synopsis-v1";
export const EVIDENCE_CLASSIFICATION_VERSION = "evidence-v2";
export const MIN_TARGET_CHUNK_TOKENS = 500;
export const TARGET_CHUNK_TOKENS = 450;
export const SOFT_MAX_CHUNK_TOKENS = 650;
export const HARD_MAX_CHUNK_TOKENS = 1_200;
export const CHUNK_OVERLAP_TOKENS = 125;
export const TARGET_CHUNK_CHARACTERS = TARGET_CHUNK_TOKENS * 4;
export const CHUNK_OVERLAP_CHARACTERS = CHUNK_OVERLAP_TOKENS * 4;
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
  filename: string;
  char_start: number;
  char_end: number;
  token_estimate: number;
  processing_job_id: string;
  content_hash: string;
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

type BlockType = "heading" | "paragraph" | "list";

export type EvidenceClassification =
  | "evidence"
  | "low_value_context"
  | "table_fragment"
  | "front_matter"
  | "back_matter"
  | "contact_block"
  | "acronym_glossary"
  | "references"
  | "boilerplate";

type TextBlock = {
  type: BlockType;
  content: string;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
};

type Section = {
  heading: string;
  parentHeading: string;
  parentPath: string | null;
  path: string;
  level: number;
  headingPage: number;
  blocks: TextBlock[];
};

type SectionGroup = {
  heading: string;
  parentHeading: string;
  parentPath: string | null;
  path: string;
  level: number;
  headingPage: number;
  blocks: TextBlock[];
  sourceSectionPaths: string[];
};

type ChunkDraft = {
  content: string;
  blocks: TextBlock[];
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  sectionHeading: string;
  parentHeading: string;
  parentPath: string | null;
  sectionPath: string;
  headingPage: number;
  sourceSectionPaths: string[];
};

type ClassifiedChunkDraft = ChunkDraft & {
  evidenceClass: EvidenceClassification;
  evidenceReason: string;
};

type PageLine = {
  content: string;
  localStart: number;
  localEnd: number;
};

type PreparedPage = {
  pageNumber: number;
  text: string;
  pageOffset: number;
  lines: PageLine[];
  isToc: boolean;
};

type CleanupStats = {
  boilerplateLinesRemoved: number;
  footnoteLinesRemoved: number;
  tocPagesExcluded: number[];
  excludedCandidates: Record<Exclude<EvidenceClassification, "evidence">, number>;
};

type HierarchyNode = {
  heading: string;
  section_path: string;
  page_start: number;
  page_end: number;
  chunk_start: number;
  chunk_end: number;
  children: HierarchyNode[];
};

const HEADING_MAX_CHARACTERS = 110;
const HEADING_MAX_WORDS = 14;
const SHORT_SECTION_MERGE_TOKENS = 220;
const SHORT_SECTION_COMBINED_TOKENS = 500;
const MAX_CHUNK_PAGE_SPAN = 2;
const SOFT_MAX_CHUNK_CHARACTERS = SOFT_MAX_CHUNK_TOKENS * 4;
const HARD_MAX_CHUNK_CHARACTERS = HARD_MAX_CHUNK_TOKENS * 4;
const LIST_PATTERN = /^(?:[-*•]|(?:\d+|[A-Za-z])[.)])\s+\S/;
const NUMBERED_HEADING_PATTERN = /^(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[IVXLCDM]+\.)\s+\S/i;
const MAJOR_PLAYBOOK_HEADING_PATTERN = /^(?:incident response playbook|vulnerability response playbook|appendix\s+[a-z](?:\b.*)?)$/i;
const PHASE_HEADING_PATTERN = /^(?:preparation activities|detection\s*(?:&|and)\s*analysis|containment|eradication\s*(?:&|and)\s*recovery|coordination|remediation)$/i;
const PLAYBOOK_SUBSECTION_HEADING_PATTERN = /^(?:policies and procedures|cyber threat intelligence|communications and logistics)$/i;
const TOP_LEVEL_POLICY_HEADING_PATTERN = /^(?:purpose|scope|definitions|governance|incident response|information security(?: program)?|vendor (?:management|oversight)|privacy|data retention|customer information|customer notification|safeguards(?: program)?|administrative safeguards|technical safeguards|physical safeguards|access control(?:s)?|access management|encryption|records?(?: retention| management)?|policy statement|roles and responsibilities)$/i;
const CHILD_POLICY_HEADING_PATTERN = /^(?:customer notification|notification timing|notice content|escalation|reporting|testing|training|monitoring|oversight procedures|response procedures|containment|recovery|exceptions|enforcement|access approval|access reviews?|periodic access reviews?|encryption requirements?|vendor notification|service provider notice)$/i;
const COMPLIANCE_HEADING_KEYWORD_PATTERN = /\b(?:customer|consumer|incident|response|notification|notice|safeguards?|access|encryption|authentication|vendor|service provider|records?|retention|disposal|remediation|recovery|evidence|logs?|privacy|security|compliance)\b/i;
const COMPLIANCE_SENTENCE_HEADING_KEYWORD_PATTERN = /\b(?:customer|consumer|incident|response|unauthorized access|notification|notice|safeguards?|access|privileged access|monitoring|logging|alert|encryption|authentication|vendor|service provider|records?|retention|disposal|remediation|recovery|investigation|law enforcement|regulator|testing|tabletop|quality|privacy|security|compliance|policy)\b/i;
const COMPLIANCE_SENTENCE_HEADING_NOUN_PATTERN = /\b(?:program|assessment|standard|requirements?|expectations?|support|management|review|reviews|logging|monitoring|disposal|procedures?|coordination|maintenance|oversight|notification|content|access|remediation|investigation|cooperation|lessons learned|exercises?|tabletop|quality)\b/i;
const POLICY_SENTENCE_VERB_PATTERN = /\b(?:must|shall|should|will|may|is|are|was|were|be|been|being|has|have|had|maintains?|requires?|defines?|describes?|identifies?|includes?|provides?|ensures?|notifies?|assesses?|documents?|records?|retains?|protects?|applies?|covers?|addresses?|coordinates?|approves?|encrypts?)\b/i;
const MERGEABLE_SHORT_HEADING_PATTERN = /^(?:document overview|overview|purpose|scope|objectives?|applicability|definitions|roles|responsibilities)$/i;
const CLASSIFICATION_MARKING_PATTERNS = [
  /^TLP\s*:\s*[A-Z+ -]{3,24}$/i,
  /^(?:UNCLASSIFIED|PUBLIC|RESTRICTED|CONFIDENTIAL)(?:\s*[-:/]\s*(?:INTERNAL|EXTERNAL|OFFICIAL|LIMITED|USE ONLY).*)?$/i,
];
const BARE_PAGE_NUMBER_PATTERN = /^(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?$/i;
const NUMBERED_REFERENCE_PREFIX_PATTERN = /^(?:\d{1,3}|\[\d{1,3}\])\s+/;
const CITATION_SIGNAL_PATTERN = /(?:https?:\/\/|www\.|doi:|§|\b(?:see(?: also)?|supra|infra|available at|accessed|retrieved)\b|\b(?:cf|et al|vol|no|pp?)\.|\b(?:U\.S\.C\.|C\.F\.R\.)|\b[A-Z]{2,}\s+(?:SP|IR|PUB(?:LICATION)?|GUIDE)\s*[-\d])/i;
const TOC_HEADING_PATTERN = /^(?:table of contents|contents)$/i;
const TOC_DOT_LEADER_PATTERN = /^.{3,100}\.{2,}\s*\d{1,4}$/;
const TOC_TRAILING_PAGE_PATTERN = /^(?:\d+(?:\.\d+)*\.?\s+)?[A-Z][^.!?]{2,90}\s+\d{1,4}$/;
const CHECKBOX_PREFIX_PATTERN = /^(?:(?:0|O|□|☐|☑|○|◯|\[\s*[xX]?\s*\])\s+){1,4}(?=[A-Za-z])/;
const GUIDANCE_VERB_PATTERN = /\b(?:must|shall|should|required?|requires|ensure|maintain|establish|implement|review|assess|document|notify|report|monitor|protect|prohibit|verify|remediate|respond|perform|configure|encrypt|retain|test|approve|restrict|identify|evaluate|escalate|preserve|validate)\b/i;
const MODAL_GUIDANCE_PATTERN = /\b(?:must|shall|should|required to|is required to|are required to)\b/i;
const POLICY_ACTOR_GUIDANCE_PATTERN = /(?:^|[.!?]\s+|\n+|[-*•]\s+)(?:the\s+)?(?:organization|institution|company|firm|agency|entity|personnel|employees?|staff|administrators?|reviewers?|response team|management|board|service providers?|users?)\b[^.!?\n]{0,160}\b(?:ensure(?:s|d|ing)?|maintain(?:s|ed|ing)?|establish(?:es|ed|ing)?|implement(?:s|ed|ing)?|review(?:s|ed|ing)?|assess(?:es|ed|ing)?|document(?:s|ed|ing)?|notif(?:y|ies|ied|ying)|report(?:s|ed|ing)?|monitor(?:s|ed|ing)?|protect(?:s|ed|ing)?|prohibit(?:s|ed|ing)?|verif(?:y|ies|ied|ying)|remediat(?:e|es|ed|ing)|respond(?:s|ed|ing)?|perform(?:s|ed|ing)?|configur(?:e|es|ed|ing)|encrypt(?:s|ed|ing)?|retain(?:s|ed|ing)?|test(?:s|ed|ing)?|approve(?:s|d|ing)?|restrict(?:s|ed|ing)?|identif(?:y|ies|ied|ying)|evaluat(?:e|es|ed|ing)|escalat(?:e|es|ed|ing)|preserv(?:e|es|ed|ing)|validat(?:e|es|ed|ing))\b/im;
const CONTROL_CODE_ONLY_PATTERN = /^(?:[A-Z]{1,5}[-.]?\d{1,4}(?:\.\d+)?(?:\s*[-–/]\s*[A-Z]?\d{1,4})?[,;]?\s*)+$/;
const RISK_COLUMN_PATTERN = /^(?:(?:very\s+)?(?:low|moderate|medium|high|critical|not applicable|n\/a|yes|no|partial|complete|initial|repeatable|defined|managed|optimized)[\s|,/;-]*){2,}$/i;
const FRAGMENTED_PARENTHETICAL_PATTERN = /^(?=.{1,70}\)$)(?:[^.!?]*\b(?:\d+(?:\.\d+)?%?|\d+\s*[-–]\s*\d+)\b[^.!?]*)\)$/;
const TABLE_DELIMITER_PATTERN = /(?:\s{2,}|\t|\|)/;
const NOTIFICATION_PROCEDURE_PATTERN = /\b(?:incident|breach|security event|unauthorized access|customer|regulator|law enforcement)\b[\s\S]{0,180}\b(?:notify|report|contact|escalate)\b|\b(?:notify|report|contact|escalate)\b[\s\S]{0,180}\b(?:incident|breach|security event|unauthorized access|customer|regulator|law enforcement)\b/i;
const BACK_MATTER_HEADING_PATTERN = /^(?:acknowledg(?:e)?ments?|about the authors?|index|additional resources|revision history|endnotes?|bibliography|works cited|sources?)$/i;
const REFERENCE_HEADING_PATTERN = /^(?:references?|bibliography|works cited|sources?|endnotes?|citations?)$/i;
const ACRONYM_HEADING_PATTERN = /^(?:acronyms?|abbreviations?|glossary|terms and definitions)$/i;
const DEFINITION_LINE_PATTERN = /^(?:[A-Z][A-Z0-9/&.-]{1,14})\s*(?:[-–—:=]|means\b)\s*[A-Za-z][^.!?]{2,120}[.!]?$/;
const URL_ONLY_PATTERN = /^(?:(?:available at|see|source:)\s+)?(?:https?:\/\/|www\.)\S+[.,;)]?$/i;
const PUBLICATION_IDENTIFIER_PATTERN = /^(?=.*\d)[A-Z][A-Z0-9]{1,15}(?:[._/-][A-Z0-9]{1,15}){1,6}$/i;
const SHORT_UNBALANCED_PARENTHETICAL_PATTERN = /^(?=.{1,70}\)$)[^()]+\)$/;

export function hashChunkContent(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function estimateChunkTokens(content: string) {
  return Math.max(1, Math.ceil(content.length / 4));
}

function stripHeadingPrefix(value: string) {
  return value.replace(/^(?:\d+(?:\.\d+)*\.?|[A-Z]\.|[IVXLCDM]+\.)\s+/i, "").trim();
}

export function normalizeHeadingArtifacts(value: string) {
  return value.replace(CHECKBOX_PREFIX_PATTERN, "").replace(/\s+/g, " ").trim();
}

function normalizedLineKey(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizedVariableFooterKey(value: string) {
  const normalized = value
    .replace(/(?:\s+|[-|]\s*)(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return normalized.length >= 20 && wordCount >= 3 ? normalized : null;
}

function normalizedHeading(value: string) {
  return stripHeadingPrefix(normalizeHeadingArtifacts(value))
    .replace(/:$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(value: string) {
  return value.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
}

function hasSubstantiveGuidance(value: string) {
  const words = getWords(value);
  return words.length >= 7
    && (MODAL_GUIDANCE_PATTERN.test(value) || POLICY_ACTOR_GUIDANCE_PATTERN.test(value));
}

function looksLikeTableFragment(value: string) {
  const line = value.trim();
  if (!line) return false;
  if (CONTROL_CODE_ONLY_PATTERN.test(line) || RISK_COLUMN_PATTERN.test(line)) return true;
  if (
    FRAGMENTED_PARENTHETICAL_PATTERN.test(line)
    || (SHORT_UNBALANCED_PARENTHETICAL_PATTERN.test(line) && getWords(line).length <= 8)
  ) return true;

  const lines = line.split("\n").map((item) => item.trim()).filter(Boolean);
  const words = getWords(line);
  const numericTokens = line.match(/(?:\b\d+(?:\.\d+)?%?\b|\b\d+\s*[-–]\s*\d+\b)/g) ?? [];
  const shortLineCount = lines.filter((item) => getWords(item).length <= 6).length;
  const numericHeavy = numericTokens.length >= 2
    && numericTokens.length / Math.max(1, numericTokens.length + words.length) >= 0.28;
  const brokenRowLayout = lines.length >= 3
    && shortLineCount / lines.length >= 0.65
    && !GUIDANCE_VERB_PATTERN.test(line);
  const delimitedRow = TABLE_DELIMITER_PATTERN.test(line)
    && (numericTokens.length >= 2 || words.length <= 8)
    && !GUIDANCE_VERB_PATTERN.test(line);

  return numericHeavy || brokenRowLayout || delimitedRow;
}

function isMajorPlaybookHeading(value: string) {
  return MAJOR_PLAYBOOK_HEADING_PATTERN.test(normalizedHeading(value));
}

function isProtectedEvidenceHeading(value: string) {
  const heading = normalizedHeading(value);
  return MAJOR_PLAYBOOK_HEADING_PATTERN.test(heading)
    || PHASE_HEADING_PATTERN.test(heading)
    || PLAYBOOK_SUBSECTION_HEADING_PATTERN.test(heading)
    || TOP_LEVEL_POLICY_HEADING_PATTERN.test(heading)
    || CHILD_POLICY_HEADING_PATTERN.test(heading);
}

function isFootnoteStart(value: string) {
  const line = value.trim();
  return NUMBERED_REFERENCE_PREFIX_PATTERN.test(line)
    && CITATION_SIGNAL_PATTERN.test(line.replace(NUMBERED_REFERENCE_PREFIX_PATTERN, ""));
}

function isExplicitBoilerplate(value: string) {
  const line = value.trim();
  return CLASSIFICATION_MARKING_PATTERNS.some((pattern) => pattern.test(line))
    || BARE_PAGE_NUMBER_PATTERN.test(line);
}

function isTocNavigationLine(value: string) {
  const line = value.trim();
  return TOC_DOT_LEADER_PATTERN.test(line) || TOC_TRAILING_PAGE_PATTERN.test(line);
}

function isTitleCaseHeading(value: string) {
  const words = stripHeadingPrefix(value)
    .split(/\s+/)
    .filter((word) => /[A-Za-z]/.test(word));
  if (words.length === 0) return false;

  const connectiveWords = new Set(["and", "or", "of", "for", "the", "to", "in", "on"]);
  const titleWords = words.filter((word) => {
    const normalized = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
    return connectiveWords.has(normalized.toLowerCase()) || /^[A-Z][A-Za-z'-]*$/.test(normalized);
  });
  return titleWords.length / words.length >= 0.75;
}

function isSentenceCaseComplianceHeading(value: string, precededByBlankLine: boolean) {
  if (!precededByBlankLine) return false;

  const line = normalizeHeadingArtifacts(value);
  const stripped = normalizedHeading(line);
  const words = getWords(stripped);
  if (
    !stripped
    || words.length < 2
    || words.length > 10
    || /[.!?;:]$/.test(line)
    || !/^[A-Z][A-Za-z0-9(]/.test(stripped)
    || isTitleCaseHeading(line)
    || POLICY_SENTENCE_VERB_PATTERN.test(stripped)
  ) {
    return false;
  }

  return COMPLIANCE_SENTENCE_HEADING_KEYWORD_PATTERN.test(stripped)
    && COMPLIANCE_SENTENCE_HEADING_NOUN_PATTERN.test(stripped);
}

export function isLikelyPolicyHeading(value: string, precededByBlankLine = true) {
  const rawLine = value.trim();
  const line = normalizeHeadingArtifacts(rawLine);
  const words = line.split(/\s+/);
  if (
    !line
    || line.length > HEADING_MAX_CHARACTERS
    || words.length > HEADING_MAX_WORDS
    || /^[-*•]\s+/.test(line)
    || isExplicitBoilerplate(line)
    || isFootnoteStart(line)
    || isTocNavigationLine(line)
    || PUBLICATION_IDENTIFIER_PATTERN.test(line)
    || (line === rawLine && looksLikeTableFragment(rawLine))
  ) {
    return false;
  }

  const stripped = normalizedHeading(line);
  const letters = stripped.replace(/[^A-Za-z]/g, "");
  const isUppercase = letters.length >= 3 && letters === letters.toUpperCase();
  const isKnownPolicyHeading = MAJOR_PLAYBOOK_HEADING_PATTERN.test(stripped)
    || PHASE_HEADING_PATTERN.test(stripped)
    || PLAYBOOK_SUBSECTION_HEADING_PATTERN.test(stripped)
    || TOP_LEVEL_POLICY_HEADING_PATTERN.test(stripped)
    || CHILD_POLICY_HEADING_PATTERN.test(stripped);
  const isNumberedHeading = NUMBERED_HEADING_PATTERN.test(line)
    && !/[.!?;]$/.test(stripped);
  const isShortColonHeading = line.endsWith(":")
    && words.length <= 8
    && isTitleCaseHeading(line.slice(0, -1));
  const isTitleHeading = precededByBlankLine
    && !/[.!?;]$/.test(line)
    && isTitleCaseHeading(line);
  const isComplianceKeywordHeading = precededByBlankLine
    && !/[.!?;]$/.test(line)
    && words.length <= 8
    && isTitleCaseHeading(line)
    && COMPLIANCE_HEADING_KEYWORD_PATTERN.test(stripped);
  const isSentenceComplianceHeading = isSentenceCaseComplianceHeading(line, precededByBlankLine);

  return isKnownPolicyHeading
    || isUppercase
    || isNumberedHeading
    || isShortColonHeading
    || isTitleHeading
    || isComplianceKeywordHeading
    || isSentenceComplianceHeading;
}

function inferHeadingLevel(
  value: string,
  headingStack: Array<{ heading: string; level: number }>,
) {
  const decimalMatch = value.match(/^(\d+(?:\.\d+)*)\.?\s+/);
  if (decimalMatch) return decimalMatch[1].split(".").length;

  if (/^[IVXLCDM]+\.\s+/.test(value)) return 1;
  if (/^[A-Z]\.\s+/.test(value)) return headingStack.length > 0 ? 2 : 1;

  const stripped = normalizedHeading(value);
  if (MAJOR_PLAYBOOK_HEADING_PATTERN.test(stripped)) return 1;
  if (PHASE_HEADING_PATTERN.test(stripped)) {
    return headingStack.some((heading) => isMajorPlaybookHeading(heading.heading)) ? 2 : 1;
  }
  if (PLAYBOOK_SUBSECTION_HEADING_PATTERN.test(stripped)) {
    if (headingStack.some((heading) => PHASE_HEADING_PATTERN.test(normalizedHeading(heading.heading)))) {
      return 3;
    }
    return headingStack.some((heading) => isMajorPlaybookHeading(heading.heading)) ? 2 : 1;
  }
  if (CHILD_POLICY_HEADING_PATTERN.test(stripped) && headingStack.length > 0) return 2;
  if (TOP_LEVEL_POLICY_HEADING_PATTERN.test(stripped)) return 1;
  if (CHILD_POLICY_HEADING_PATTERN.test(stripped)) return 1;

  const letters = stripped.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 3 && letters === letters.toUpperCase()) return 1;
  return 1;
}

function getPageLines(text: string) {
  const lines: PageLine[] = [];
  let cursor = 0;

  for (const rawLine of text.split("\n")) {
    const leadingWhitespace = rawLine.length - rawLine.trimStart().length;
    const trailingWhitespace = rawLine.length - rawLine.trimEnd().length;
    lines.push({
      content: rawLine.trim(),
      localStart: cursor + leadingWhitespace,
      localEnd: cursor + rawLine.length - trailingWhitespace,
    });
    cursor += rawLine.length + 1;
  }
  return lines;
}

function isTableOfContentsPage(lines: PageLine[]) {
  const nonEmptyLines = lines.filter((line) => line.content);
  if (nonEmptyLines.some((line) => TOC_HEADING_PATTERN.test(line.content))) return true;

  const navigationLines = nonEmptyLines.filter((line) => isTocNavigationLine(line.content));
  return navigationLines.length >= 4
    && navigationLines.length / Math.max(1, nonEmptyLines.length) >= 0.4;
}

function getPageEdgeIndexes(lines: PageLine[]) {
  const nonEmptyIndexes = lines
    .map((line, index) => line.content ? index : -1)
    .filter((index) => index >= 0);
  const top = new Set(nonEmptyIndexes.slice(0, 3));
  const bottom = new Set(nonEmptyIndexes.slice(-3));
  return { top, bottom, all: new Set([...top, ...bottom]) };
}

type PageEdgeCandidate = {
  indexes: number[];
  position: "top" | "bottom";
  content: string;
};

function getPageEdgeCandidates(lines: PageLine[]) {
  const edgeIndexes = getPageEdgeIndexes(lines);
  const candidates: PageEdgeCandidate[] = [];
  for (const [position, indexes] of [
    ["top", [...edgeIndexes.top].sort((a, b) => a - b)],
    ["bottom", [...edgeIndexes.bottom].sort((a, b) => a - b)],
  ] as const) {
    for (const index of indexes) {
      candidates.push({ indexes: [index], position, content: lines[index].content });
    }
    for (let index = 0; index < indexes.length - 1; index += 1) {
      const pair = indexes.slice(index, index + 2);
      candidates.push({
        indexes: pair,
        position,
        content: pair.map((lineIndex) => lines[lineIndex].content).join(" "),
      });
    }
  }
  return candidates;
}

function getEdgeFingerprintKeys(value: string) {
  const normalized = (normalizedVariableFooterKey(value) ?? normalizedLineKey(value))
    .replace(/(?:\s+|[-|]\s*)(?:PAGE\s+)?\d{1,4}(?:\s+OF\s+\d{1,4})?\s*$/i, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const letterCount = (normalized.match(/[A-Z]/g) ?? []).length;
  if (normalized.length < 5 || normalized.length > HEADING_MAX_CHARACTERS * 2) return [];

  const keys = [`edge:${normalized}`];
  if (normalized.length >= 16 && letterCount >= 10) {
    // Pairing the full value with its one-character suffix catches common PDF
    // extraction damage where a repeated footer loses its first glyph.
    keys.push(`edge:${normalized.slice(1)}`);
  }
  return keys;
}

function preparePagesForChunking(pages: ExtractedPdfPage[]) {
  let documentOffset = 0;
  const prepared = pages.map((page) => {
    const pageOffset = documentOffset;
    documentOffset += page.text.length + 2;
    const lines = getPageLines(page.text);
    return {
      pageNumber: page.pageNumber,
      text: page.text,
      pageOffset,
      lines,
      isToc: isTableOfContentsPage(lines),
    } satisfies PreparedPage;
  });

  const repeatedEdgeLines = new Map<string, Set<number>>();
  for (const page of prepared) {
    if (page.isToc) continue;
    for (const candidate of getPageEdgeCandidates(page.lines)) {
      if (
        !candidate.content
        || candidate.indexes.some((index) => isProtectedEvidenceHeading(page.lines[index].content))
      ) {
        continue;
      }
      for (const key of getEdgeFingerprintKeys(candidate.content)) {
        const pageNumbers = repeatedEdgeLines.get(key) ?? new Set<number>();
        pageNumbers.add(page.pageNumber);
        repeatedEdgeLines.set(key, pageNumbers);
      }
    }
  }
  const repeatedKeys = new Map<string, number>(
    [...repeatedEdgeLines.entries()]
      .filter(([, pageNumbers]) => pageNumbers.size >= 2)
      .map(([key, pageNumbers]) => [key, Math.min(...pageNumbers)] as const),
  );

  const stats: CleanupStats = {
    boilerplateLinesRemoved: 0,
    footnoteLinesRemoved: 0,
    tocPagesExcluded: [],
    excludedCandidates: {
      low_value_context: 0,
      table_fragment: 0,
      front_matter: 0,
      back_matter: 0,
      contact_block: 0,
      acronym_glossary: 0,
      references: 0,
      boilerplate: 0,
    },
  };

  const cleanedPages = prepared.map((page) => {
    if (page.isToc) {
      stats.tocPagesExcluded.push(page.pageNumber);
      return page;
    }

    const candidates = getPageEdgeCandidates(page.lines);
    const preservedFirstTitleIndexes = new Set<number>();
    const repeatedLineIndexes = new Set<number>();
    for (const candidate of candidates) {
      const repeatedKey = getEdgeFingerprintKeys(candidate.content)
        .find((key) => repeatedKeys.has(key));
      if (!repeatedKey) continue;

      if (
        candidate.indexes.length === 1
        && candidate.position === "top"
        && repeatedKeys.get(repeatedKey) === page.pageNumber
        && isLikelyPolicyHeading(candidate.content, true)
        && !PUBLICATION_IDENTIFIER_PATTERN.test(candidate.content)
      ) {
        preservedFirstTitleIndexes.add(candidate.indexes[0]);
        continue;
      }
      for (const index of candidate.indexes) repeatedLineIndexes.add(index);
    }
    for (const index of preservedFirstTitleIndexes) repeatedLineIndexes.delete(index);

    let insideFootnote = false;
    const lines = page.lines.map((line, lineIndex) => {
      if (!line.content) {
        insideFootnote = false;
        return line;
      }

      if (isFootnoteStart(line.content)) insideFootnote = true;
      if (insideFootnote) {
        stats.footnoteLinesRemoved += 1;
        return { ...line, content: "" };
      }

      if (isExplicitBoilerplate(line.content) || repeatedLineIndexes.has(lineIndex)) {
        stats.boilerplateLinesRemoved += 1;
        return { ...line, content: "" };
      }
      return line;
    });

    return { ...page, lines };
  });

  return { pages: cleanedPages, stats };
}

function getOrderedListMarker(value: string) {
  const match = value.match(/^(\d+|[A-Za-z])[.)]\s+/);
  if (!match) return null;
  if (/^\d+$/.test(match[1])) {
    return { kind: "number", ordinal: Number(match[1]) } as const;
  }
  return { kind: "letter", ordinal: match[1].toUpperCase().charCodeAt(0) } as const;
}

function isSequentialListLine(lines: PageLine[], index: number) {
  const current = getOrderedListMarker(lines[index].content);
  if (!current) return false;

  const adjacentIndexes = [index - 1, index + 1];
  for (const adjacentIndex of adjacentIndexes) {
    if (adjacentIndex < 0 || adjacentIndex >= lines.length) continue;
    const adjacent = getOrderedListMarker(lines[adjacentIndex].content);
    if (
      adjacent
      && adjacent.kind === current.kind
      && Math.abs(adjacent.ordinal - current.ordinal) === 1
    ) {
      return true;
    }
  }
  return false;
}

function createBlock(
  pageText: string,
  pageNumber: number,
  pageOffset: number,
  lines: PageLine[],
  type: BlockType,
): TextBlock | null {
  if (lines.length === 0) return null;
  const first = lines[0];
  const last = lines.at(-1)!;
  const content = pageText.slice(first.localStart, last.localEnd).trim();
  if (!content) return null;

  return {
    type,
    content,
    pageStart: pageNumber,
    pageEnd: pageNumber,
    charStart: pageOffset + first.localStart,
    charEnd: pageOffset + last.localEnd,
  };
}

function parseSections(pages: PreparedPage[]) {
  const sections: Section[] = [];
  const headingStack: Array<{ heading: string; path: string; level: number }> = [];
  let currentSection: Section | null = null;

  const ensureSection = () => {
    if (!currentSection) {
      currentSection = {
        heading: "Document Overview",
        parentHeading: "Document",
        parentPath: null,
        path: "Document Overview",
        level: 1,
        headingPage: pages.find((page) => !page.isToc)?.pageNumber ?? 1,
        blocks: [],
      };
      sections.push(currentSection);
    }
    return currentSection;
  };

  for (const page of pages) {
    if (page.isToc) continue;
    const { pageOffset, lines } = page;
    let paragraphLines: PageLine[] = [];
    let listLines: PageLine[] = [];
    let precededByBlankLine = true;

    const flushParagraph = () => {
      const block = createBlock(page.text, page.pageNumber, pageOffset, paragraphLines, "paragraph");
      if (block) ensureSection().blocks.push(block);
      paragraphLines = [];
    };
    const flushList = () => {
      const block = createBlock(page.text, page.pageNumber, pageOffset, listLines, "list");
      if (block) ensureSection().blocks.push(block);
      listLines = [];
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line.content) {
        flushParagraph();
        flushList();
        precededByBlankLine = true;
        continue;
      }

      const isListLine = /^[-*•]\s+/.test(line.content)
        || isSequentialListLine(lines, lineIndex)
        || (LIST_PATTERN.test(line.content) && /[.!?;]$/.test(line.content));

      if (!isListLine && isLikelyPolicyHeading(line.content, precededByBlankLine)) {
        flushParagraph();
        flushList();
        const headingText = normalizeHeadingArtifacts(line.content);
        const duplicateActiveHeading = headingStack.some(
          (heading) => normalizedHeading(heading.heading) === normalizedHeading(headingText),
        );
        if (duplicateActiveHeading) {
          precededByBlankLine = false;
          continue;
        }
        const level = inferHeadingLevel(headingText, headingStack);
        while (headingStack.length > 0 && headingStack.at(-1)!.level >= level) {
          headingStack.pop();
        }
        const parent = headingStack.at(-1) ?? null;
        const path = [...headingStack.map((heading) => heading.heading), headingText].join(" > ");
        currentSection = {
          heading: headingText,
          parentHeading: parent?.heading ?? "Document",
          parentPath: parent?.path ?? null,
          path,
          level,
          headingPage: page.pageNumber,
          blocks: [],
        };
        sections.push(currentSection);
        headingStack.push({ heading: headingText, path, level });
        const headingBlock = createBlock(
          page.text,
          page.pageNumber,
          pageOffset,
          [line],
          "heading",
        );
        if (headingBlock) currentSection.blocks.push(headingBlock);
        precededByBlankLine = false;
        continue;
      }

      if (isListLine) {
        flushParagraph();
        listLines.push(line);
      } else if (listLines.length > 0) {
        listLines.push(line);
      } else {
        paragraphLines.push(line);
      }
      precededByBlankLine = false;
    }

    flushParagraph();
    flushList();
  }

  return sections.filter((section) => section.blocks.length > 0);
}

function sectionTokenEstimate(section: Pick<SectionGroup, "blocks">) {
  return estimateChunkTokens(section.blocks.map((block) => block.content).join("\n\n"));
}

function mergeShortSiblingSections(sections: Section[]): SectionGroup[] {
  const evidenceSections = sections.filter(
    (section) => section.blocks.some((block) => block.type !== "heading"),
  );
  const initialGroups: SectionGroup[] = [];

  for (let index = 0; index < evidenceSections.length; index += 1) {
    const section = evidenceSections[index];
    const following = evidenceSections[index + 1];
    if (
      following
      && following.parentPath === section.path
      && sectionTokenEstimate({ blocks: section.blocks }) <= 100
    ) {
      initialGroups.push({
        ...following,
        blocks: [...section.blocks, ...following.blocks],
        sourceSectionPaths: [section.path, following.path],
      });
      index += 1;
      continue;
    }

    initialGroups.push({
      ...section,
      sourceSectionPaths: [section.path],
    });
  }

  const groups: SectionGroup[] = [];

  for (const nextGroup of initialGroups) {
    const previous = groups.at(-1);
    const canMerge = previous
      && previous.parentPath === nextGroup.parentPath
      && sectionTokenEstimate(previous) <= SHORT_SECTION_MERGE_TOKENS
      && sectionTokenEstimate(nextGroup) <= SHORT_SECTION_MERGE_TOKENS
      && sectionTokenEstimate({ blocks: [...previous.blocks, ...nextGroup.blocks] }) <= SHORT_SECTION_COMBINED_TOKENS
      && MERGEABLE_SHORT_HEADING_PATTERN.test(stripHeadingPrefix(previous.heading))
      && MERGEABLE_SHORT_HEADING_PATTERN.test(stripHeadingPrefix(nextGroup.heading));

    if (!canMerge || !previous) {
      groups.push(nextGroup);
      continue;
    }

    previous.heading = `${previous.heading} / ${nextGroup.heading}`;
    previous.path = previous.parentPath
      ? `${previous.parentPath} > ${previous.heading}`
      : previous.heading;
    previous.blocks.push(...nextGroup.blocks);
    previous.sourceSectionPaths.push(...nextGroup.sourceSectionPaths);
  }

  return groups;
}

function splitTextBlock(block: TextBlock) {
  if (block.content.length <= SOFT_MAX_CHUNK_CHARACTERS) return [block];

  if (block.type === "list") {
    const listParts: TextBlock[] = [];
    const lines = getPageLines(block.content);
    let currentLines: PageLine[] = [];
    const flush = () => {
      if (currentLines.length === 0) return;
      const first = currentLines[0];
      const last = currentLines.at(-1)!;
      listParts.push({
        ...block,
        content: block.content.slice(first.localStart, last.localEnd).trim(),
        charStart: block.charStart + first.localStart,
        charEnd: block.charStart + last.localEnd,
      });
      currentLines = [];
    };

    for (const line of lines) {
      if (
        currentLines.length > 0
        && line.localEnd - currentLines[0].localStart > SOFT_MAX_CHUNK_CHARACTERS
      ) {
        flush();
      }
      currentLines.push(line);
    }
    flush();
    if (listParts.every((part) => part.content.length <= HARD_MAX_CHUNK_CHARACTERS)) {
      return listParts;
    }
  }

  const parts: TextBlock[] = [];
  let start = 0;
  while (start < block.content.length) {
    let end = Math.min(start + TARGET_CHUNK_CHARACTERS, block.content.length);
    if (end < block.content.length) {
      const minimumBreak = start + Math.floor(TARGET_CHUNK_CHARACTERS * 0.65);
      const candidates = [
        block.content.lastIndexOf("\n\n", end),
        block.content.lastIndexOf(". ", end),
        block.content.lastIndexOf("; ", end),
        block.content.lastIndexOf(" ", end),
      ];
      const preferredBreak = candidates.find((candidate) => candidate >= minimumBreak);
      if (preferredBreak !== undefined) end = preferredBreak + 1;
    }

    const rawContent = block.content.slice(start, end);
    const leadingWhitespace = rawContent.length - rawContent.trimStart().length;
    const trailingWhitespace = rawContent.length - rawContent.trimEnd().length;
    const content = rawContent.trim();
    if (content) {
      parts.push({
        ...block,
        type: block.type === "heading" ? "paragraph" : block.type,
        content,
        charStart: block.charStart + start + leadingWhitespace,
        charEnd: block.charStart + end - trailingWhitespace,
      });
    }
    if (end >= block.content.length) break;

    let nextStart = Math.max(start + 1, end - CHUNK_OVERLAP_CHARACTERS);
    const nextBoundary = block.content.indexOf(" ", nextStart);
    if (nextBoundary >= nextStart && nextBoundary <= nextStart + 80) {
      nextStart = nextBoundary + 1;
    }
    start = nextStart;
  }
  return parts;
}

function getOverlapBlocks(blocks: TextBlock[]) {
  const overlap: TextBlock[] = [];
  let overlapCharacters = 0;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.type !== "paragraph") break;
    if (overlapCharacters + block.content.length > CHUNK_OVERLAP_CHARACTERS) break;
    overlap.unshift(block);
    overlapCharacters += block.content.length;
  }

  return overlap.length === blocks.length ? [] : overlap;
}

function buildChunkDrafts(groups: SectionGroup[]) {
  const drafts: ChunkDraft[] = [];

  for (const group of groups) {
    const blocks = group.blocks.flatMap(splitTextBlock);
    let current: TextBlock[] = [];
    let hasNewContent = false;

    const emitCurrent = () => {
      if (current.length === 0 || !hasNewContent) return;
      const content = current.map((block) => block.content).join("\n\n");
      drafts.push({
        content,
        blocks: [...current],
        pageStart: Math.min(...current.map((block) => block.pageStart)),
        pageEnd: Math.max(...current.map((block) => block.pageEnd)),
        charStart: current[0].charStart,
        charEnd: current.at(-1)!.charEnd,
        sectionHeading: group.heading,
        parentHeading: group.parentHeading,
        parentPath: group.parentPath,
        sectionPath: group.path,
        headingPage: group.headingPage,
        sourceSectionPaths: group.sourceSectionPaths,
      });
      current = getOverlapBlocks(current);
      hasNewContent = false;
    };

    for (const block of blocks) {
      let combinedContent = [...current, block].map((item) => item.content).join("\n\n");
      const currentTokens = current.length > 0
        ? estimateChunkTokens(current.map((item) => item.content).join("\n\n"))
        : 0;
      const combinedPageSpan = current.length > 0
        ? Math.max(block.pageEnd, ...current.map((item) => item.pageEnd))
          - Math.min(block.pageStart, ...current.map((item) => item.pageStart))
          + 1
        : block.pageEnd - block.pageStart + 1;
      const shouldSplit = current.length > 0 && (
        combinedContent.length > HARD_MAX_CHUNK_CHARACTERS
        || combinedPageSpan > MAX_CHUNK_PAGE_SPAN
        || (currentTokens >= MIN_TARGET_CHUNK_TOKENS && combinedContent.length > SOFT_MAX_CHUNK_CHARACTERS)
      );

      if (shouldSplit) {
        emitCurrent();
        combinedContent = [...current, block].map((item) => item.content).join("\n\n");
        if (
          !hasNewContent
          && (
            combinedContent.length > HARD_MAX_CHUNK_CHARACTERS
            || combinedPageSpan > MAX_CHUNK_PAGE_SPAN
          )
        ) {
          current = [];
        }
      }

      current.push(block);
      hasNewContent = true;
    }
    emitCurrent();
  }

  return drafts;
}

function countMatches(value: string, pattern: RegExp) {
  return (value.match(pattern) ?? []).length;
}

function hasNotificationProcedure(value: string) {
  return GUIDANCE_VERB_PATTERN.test(value) && NOTIFICATION_PROCEDURE_PATTERN.test(value);
}

function classifyChunkDraft(
  draft: ChunkDraft,
  pageBounds: { first: number; last: number },
): Pick<ClassifiedChunkDraft, "evidenceClass" | "evidenceReason"> {
  const decision = (evidenceClass: EvidenceClassification, evidenceReason: string) => ({
    evidenceClass,
    evidenceReason,
  });
  const content = draft.content.trim();
  const sectionLabel = normalizedHeading(draft.sectionHeading);
  const pathLabel = draft.sectionPath
    .split(" > ")
    .map(normalizedHeading)
    .join(" > ");
  const substantive = hasSubstantiveGuidance(content);
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const bodyLines = draft.blocks
    .filter((block) => block.type !== "heading")
    .flatMap((block) => block.content.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 0 && lines.every(isExplicitBoilerplate)) {
    return decision("boilerplate", "explicit_or_repeated_page_boilerplate");
  }

  const contactSignals = countMatches(
    content,
    /(?:\b(?:contact us|telephone|phone|fax|email|mailing address|street address|suite|floor|building|avenue|boulevard|road|highway|postal code|zip code)\b|\bP\.?O\.?\s+Box\b|\b\d{3}[-.)\s]\d{3}[-.\s]\d{4}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/gi,
  );
  if (contactSignals >= 2 && !hasNotificationProcedure(content)) {
    return decision("contact_block", "contact_or_address_information_without_procedure");
  }

  const citationLines = lines.filter((line) => CITATION_SIGNAL_PATTERN.test(line)).length;
  const urlOnlyBody = bodyLines.length > 0 && bodyLines.every((line) => URL_ONLY_PATTERN.test(line));
  if (
    (REFERENCE_HEADING_PATTERN.test(sectionLabel)
      || pathLabel.split(" > ").some((part) => REFERENCE_HEADING_PATTERN.test(part))
      || urlOnlyBody
      || (lines.length >= 3 && citationLines / lines.length >= 0.5))
    && !substantive
  ) {
    return decision("references", urlOnlyBody ? "standalone_reference_link" : "reference_material_without_guidance");
  }

  const definitionLines = bodyLines.filter((line) => DEFINITION_LINE_PATTERN.test(line)).length;
  const acronymOnlyBody = bodyLines.length > 0 && definitionLines === bodyLines.length;
  if (
    (ACRONYM_HEADING_PATTERN.test(sectionLabel)
      || pathLabel.split(" > ").some((part) => ACRONYM_HEADING_PATTERN.test(part))
      || acronymOnlyBody)
    && !substantive
  ) {
    return decision("acronym_glossary", "acronym_or_glossary_entry_without_guidance");
  }

  const nearFront = draft.pageStart <= pageBounds.first + 2;
  const frontMatterSignals = countMatches(
    content,
    /\b(?:published|publication date|prepared by|authored by|version|revision date|effective date|document id|catalog(?:ue)? no|isbn|all rights reserved|copyright|available (?:from|at)|distribution statement|legal notice|disclaimer)\b/gi,
  );
  if (
    nearFront
    && (frontMatterSignals >= 2 || (frontMatterSignals >= 1 && getWords(content).length <= 45))
    && !substantive
  ) {
    return decision("front_matter", "publication_or_document_metadata");
  }

  const nearBack = draft.pageEnd >= pageBounds.last - 2;
  if (
    nearBack
    && (BACK_MATTER_HEADING_PATTERN.test(sectionLabel)
      || pathLabel.split(" > ").some((part) => BACK_MATTER_HEADING_PATTERN.test(part)))
    && !substantive
  ) {
    return decision("back_matter", "back_matter_navigation_or_attribution");
  }

  const nonHeadingContent = draft.blocks
    .filter((block) => block.type !== "heading")
    .map((block) => block.content)
    .join("\n");
  if (looksLikeTableFragment(nonHeadingContent || content) && !substantive) {
    return decision("table_fragment", "layout_fragment_without_substantive_guidance");
  }

  const wordCount = getWords(content).length;
  if (wordCount <= 4 && !substantive) {
    return decision("low_value_context", "insufficient_standalone_evidence_context");
  }

  return decision(
    "evidence",
    substantive ? "substantive_requirement_or_procedure" : "meaningful_policy_context",
  );
}

function filterEvidenceDrafts(
  drafts: ChunkDraft[],
  pages: ExtractedPdfPage[],
  stats: CleanupStats,
): ClassifiedChunkDraft[] {
  const pageNumbers = pages.map((page) => page.pageNumber);
  const pageBounds = {
    first: Math.min(...pageNumbers),
    last: Math.max(...pageNumbers),
  };

  const evidenceDrafts: ClassifiedChunkDraft[] = [];
  for (const draft of drafts) {
    const classification = classifyChunkDraft(draft, pageBounds);
    if (classification.evidenceClass === "evidence") {
      evidenceDrafts.push({ ...draft, ...classification });
      continue;
    }
    stats.excludedCandidates[classification.evidenceClass] += 1;
  }
  return evidenceDrafts;
}

export function buildChunkEmbeddingInput(input: {
  filename: string;
  documentType?: string | null;
  sourceType?: string | null;
  evidenceRole?: string | null;
  sectionPath: string;
  sectionHeading?: string | null;
  parentHeading: string;
  headingPage?: number | null;
  pageStart: number;
  pageEnd: number;
  content: string;
  synopsis?: string | null;
}) {
  const pageLabel = input.pageStart === input.pageEnd
    ? `Page ${input.pageStart}`
    : `Pages ${input.pageStart}-${input.pageEnd}`;
  const context = [
    `Filename: ${input.filename}`,
    input.documentType ? `Document type: ${input.documentType}` : null,
    input.sourceType ? `Source type: ${input.sourceType}` : null,
    input.evidenceRole ? `Evidence role: ${input.evidenceRole}` : null,
    `Section: ${input.sectionPath}`,
    input.sectionHeading ? `Section heading: ${input.sectionHeading}` : null,
    `Parent heading: ${input.parentHeading}`,
    input.headingPage ? `Heading page: ${input.headingPage}` : null,
    `Citation: ${pageLabel}`,
    input.synopsis ? `Retrieval synopsis: ${input.synopsis}` : null,
    "",
    input.content,
  ];
  return context.filter((line): line is string => line !== null).join("\n");
}

function buildHierarchy(sections: Section[], drafts: ChunkDraft[]) {
  const nodes = new Map<string, HierarchyNode & { parentPath: string | null }>();

  for (const section of sections) {
    const chunkIndexes = drafts
      .map((draft, index) => draft.sourceSectionPaths.some(
        (sourcePath) => sourcePath === section.path || sourcePath.startsWith(`${section.path} > `),
      ) ? index : -1)
      .filter((index) => index >= 0);
    if (chunkIndexes.length === 0) continue;
    const matchingBlocks = section.blocks;
    nodes.set(section.path, {
      heading: section.heading,
      section_path: section.path,
      page_start: Math.min(...matchingBlocks.map((block) => block.pageStart)),
      page_end: Math.max(...matchingBlocks.map((block) => block.pageEnd)),
      chunk_start: Math.min(...chunkIndexes),
      chunk_end: Math.max(...chunkIndexes),
      parentPath: section.parentPath,
      children: [],
    });
  }

  const roots: Array<HierarchyNode & { parentPath: string | null }> = [];
  for (const node of nodes.values()) {
    const parent = node.parentPath ? nodes.get(node.parentPath) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const rollUpBounds = (node: HierarchyNode): HierarchyNode => {
    node.children = node.children.map(rollUpBounds);
    if (node.children.length > 0) {
      node.page_start = Math.min(node.page_start, ...node.children.map((child) => child.page_start));
      node.page_end = Math.max(node.page_end, ...node.children.map((child) => child.page_end));
      node.chunk_start = Math.min(node.chunk_start, ...node.children.map((child) => child.chunk_start));
      node.chunk_end = Math.max(node.chunk_end, ...node.children.map((child) => child.chunk_end));
    }
    return node;
  };

  const toPublicNode = (node: HierarchyNode): HierarchyNode => ({
    heading: node.heading,
    section_path: node.section_path,
    page_start: node.page_start,
    page_end: node.page_end,
    chunk_start: node.chunk_start,
    chunk_end: node.chunk_end,
    children: node.children.map(toPublicNode),
  });

  return roots.map(rollUpBounds).map(toPublicNode);
}

export function buildDeterministicChunks(input: {
  pages: ExtractedPdfPage[];
  documentId: string;
  workspaceId: string;
  jobId: string;
  filename: string;
  documentType?: string | null;
  sourceType?: string | null;
  evidenceRole?: string | null;
}) {
  const prepared = preparePagesForChunking(input.pages);
  const sections = parseSections(prepared.pages);
  const groups = mergeShortSiblingSections(sections);
  const candidateDrafts = buildChunkDrafts(groups);
  const drafts = filterEvidenceDrafts(candidateDrafts, input.pages, prepared.stats);

  if (drafts.length === 0) {
    throw new PdfProcessingError(
      "insufficient_pdf_text",
      "The PDF does not contain enough extractable text.",
      422,
    );
  }

  if (drafts.length > MAX_DOCUMENT_CHUNKS) {
    throw new PdfProcessingError(
      "pdf_chunk_limit_exceeded",
      "The PDF produced too many text chunks.",
      422,
    );
  }

  const sectionBounds = new Map<string, { start: number; end: number }>();
  const parentBounds = new Map<string, { start: number; end: number }>();
  drafts.forEach((draft, index) => {
    const sectionBound = sectionBounds.get(draft.sectionPath);
    sectionBounds.set(draft.sectionPath, { start: sectionBound?.start ?? index, end: index });
    const parentKey = draft.parentPath ?? draft.parentHeading;
    const parentBound = parentBounds.get(parentKey);
    parentBounds.set(parentKey, { start: parentBound?.start ?? index, end: index });
  });

  const chunks: StoredDocumentChunk[] = drafts.map((draft, chunkIndex) => {
    const sectionBound = sectionBounds.get(draft.sectionPath)!;
    const parentBound = parentBounds.get(draft.parentPath ?? draft.parentHeading)!;
    const tokenEstimate = estimateChunkTokens(draft.content);
    const sourceType = input.sourceType ?? "client_policy";
    const evidenceRole = input.evidenceRole ?? "organization_evidence";
    const embeddingInput = buildChunkEmbeddingInput({
      filename: input.filename,
      documentType: input.documentType ?? null,
      sourceType,
      evidenceRole,
      sectionPath: draft.sectionPath,
      sectionHeading: draft.sectionHeading,
      parentHeading: draft.parentHeading,
      headingPage: draft.headingPage,
      pageStart: draft.pageStart,
      pageEnd: draft.pageEnd,
      content: draft.content,
    });
    const sourceContentHash = hashChunkContent(draft.content);
    const contentHash = hashChunkContent(embeddingInput);

    return {
      chunk_index: chunkIndex,
      content: draft.content,
      metadata: {
        document_id: input.documentId,
        workspace_id: input.workspaceId,
        job_id: input.jobId,
        processing_job_id: input.jobId,
        filename: input.filename,
        document_type: input.documentType ?? null,
        source_type: sourceType,
        evidence_role: evidenceRole,
        page_start: draft.pageStart,
        page_end: draft.pageEnd,
        section_heading: draft.sectionHeading,
        parent_heading: draft.parentHeading,
        section_path: draft.sectionPath,
        section_start_page: draft.headingPage,
        heading_page: draft.headingPage,
        deterministic_retrieval_context: [
          input.filename,
          input.documentType ?? null,
          sourceType,
          evidenceRole,
          draft.sectionPath,
          draft.sectionHeading,
          draft.parentHeading,
          `pages ${draft.pageStart}-${draft.pageEnd}`,
        ].filter(Boolean).join(" | "),
        chunk_index: chunkIndex,
        section_chunk_start: sectionBound.start,
        section_chunk_end: sectionBound.end,
        parent_chunk_start: parentBound.start,
        parent_chunk_end: parentBound.end,
        char_start: draft.charStart,
        char_end: draft.charEnd,
        token_estimate: tokenEstimate,
        content_hash: contentHash,
        source_content_hash: sourceContentHash,
        embedding_input: embeddingInput,
        evidence_class: draft.evidenceClass,
        evidence_reason: draft.evidenceReason,
        classification_version: EVIDENCE_CLASSIFICATION_VERSION,
        is_boilerplate: false,
        is_toc: false,
        is_footnote: false,
        retrieval_excluded: false,
        retrieval_included: true,
        chunking_version: CHUNKING_VERSION,
        chunk_context_version: CHUNK_CONTEXT_VERSION,
        chunk_annotation_version: null,
        extraction_version: PDF_EXTRACTION_VERSION,
      },
      page_start: draft.pageStart,
      page_end: draft.pageEnd,
      section_heading: draft.sectionHeading,
      parent_heading: draft.parentHeading,
      section_path: draft.sectionPath,
      section_chunk_start: sectionBound.start,
      section_chunk_end: sectionBound.end,
      parent_chunk_start: parentBound.start,
      parent_chunk_end: parentBound.end,
      filename: input.filename,
      char_start: draft.charStart,
      char_end: draft.charEnd,
      token_estimate: tokenEstimate,
      processing_job_id: input.jobId,
      content_hash: contentHash,
    };
  });

  const hierarchy = {
    document_id: input.documentId,
    filename: input.filename,
    extraction_version: PDF_EXTRACTION_VERSION,
    chunking_version: CHUNKING_VERSION,
    cleanup: {
      boilerplate_lines_removed: prepared.stats.boilerplateLinesRemoved,
      footnote_lines_removed: prepared.stats.footnoteLinesRemoved,
      toc_pages_excluded: prepared.stats.tocPagesExcluded,
      excluded_candidates: prepared.stats.excludedCandidates,
    },
    headings: buildHierarchy(sections, drafts),
  };

  return { chunks, hierarchy };
}
