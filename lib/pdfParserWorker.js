export async function isolatedPdfParserWorkerMain() {
const { parentPort, workerData } = process.getBuiltinModule("node:worker_threads");

const ACTIVE_CONTENT_MESSAGE = "This PDF contains unsupported active or embedded content.";
const MALFORMED_MESSAGE = "This PDF could not be processed safely.";
const MIN_EXTRACTED_CHARACTERS = 20;

class SafePdfWorkerError extends Error {
  constructor(code, safeMessage, status = 422, safeMetadata = {}) {
    super(safeMessage);
    this.code = code;
    this.safeMessage = safeMessage;
    this.status = status;
    this.safeMetadata = safeMetadata;
  }
}

function normalizeExtractedText(text) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function isExecutableActionTarget(value) {
  if (typeof value !== "string") return false;
  const target = value.trim();
  if (!target) return false;
  if (/^(?:https?:|mailto:|tel:)/i.test(target)) return false;
  return (
    /^(?:file:|javascript:|data:|vbscript:|shell:|ms-[a-z0-9-]+:)/i.test(target) ||
    /(?:^|[\\/])[^?#]+\.(?:app|bat|cmd|com|dmg|exe|msi|ps1|sh)(?:[?#]|$)/i.test(target)
  );
}

function outlineContainsExecutableAction(nodes) {
  if (!Array.isArray(nodes)) return false;
  for (const node of nodes) {
    if (isExecutableActionTarget(node?.unsafeUrl) || outlineContainsExecutableAction(node?.items)) {
      return true;
    }
  }
  return false;
}

function annotationContainsActiveContent(annotation) {
  return (
    annotation?.subtype === "FileAttachment" ||
    Boolean(annotation?.file) ||
    hasEntries(annotation?.actions) ||
    typeof annotation?.action === "string" ||
    isExecutableActionTarget(annotation?.unsafeUrl)
  );
}

function pushPageTextPart(parts, part, state, limit) {
  if (!part) return;
  state.characters += part.length;
  if (state.characters > limit) {
    throw new SafePdfWorkerError(
      "pdf_page_text_limit_exceeded",
      "A page in this PDF contains more text than RegSpan can safely process.",
      422,
      { limit_name: "max_pdf_page_text_chars", limit_value: limit },
    );
  }
  parts.push(part);
}

async function extractPageText(page, maxPageTextChars) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({
    includeMarkedContent: false,
    disableNormalization: false,
  });
  const parts = [];
  const state = { characters: 0 };
  let previousX;
  let previousY;
  let previousHeight = 0;

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const transform = item.transform;
    const [x, y] = viewport.convertToViewportPoint(transform[4], transform[5]);
    let value = item.str;

    if (previousY !== undefined && Math.abs(previousY - y) > 4.6) {
      const previous = parts.length > 0 ? parts.at(-1) : undefined;
      const naturallyEmpty = value.startsWith("\n") || (value.trim() === "" && item.hasEOL);
      if (previous?.endsWith("\n") === false && !naturallyEmpty) {
        if (Math.abs(previousY - y) - 1 > previousHeight) {
          pushPageTextPart(parts, "\n", state, maxPageTextChars);
        }
      }
    }

    if (
      previousY !== undefined &&
      Math.abs(previousY - y) < 4.6 &&
      previousX !== undefined &&
      Math.abs(previousX - x) > 7
    ) {
      value = `\t${value}`;
    }

    pushPageTextPart(parts, value, state, maxPageTextChars);
    previousX = x + item.width;
    previousY = y;
    previousHeight = Math.max(previousHeight, item.height);
    if (item.hasEOL) pushPageTextPart(parts, "\n", state, maxPageTextChars);
    if (item.hasEOL || value.endsWith("\n")) previousHeight = 0;
  }

  const text = normalizeExtractedText(parts.join(""));
  if (text.length > maxPageTextChars) {
    throw new SafePdfWorkerError(
      "pdf_page_text_limit_exceeded",
      "A page in this PDF contains more text than RegSpan can safely process.",
      422,
      { limit_name: "max_pdf_page_text_chars", limit_value: maxPageTextChars },
    );
  }
  return text;
}

function normalizeWorkerError(error) {
  if (error instanceof SafePdfWorkerError) return error;
  if (error?.name === "PasswordException") {
    return new SafePdfWorkerError(
      "pdf_password_protected",
      "Password-protected PDFs are not supported.",
    );
  }
  if (error?.name === "InvalidPDFException" || error?.name === "FormatError") {
    return new SafePdfWorkerError("pdf_malformed", MALFORMED_MESSAGE);
  }
  return new SafePdfWorkerError("pdf_processing_failed", MALFORMED_MESSAGE);
}

async function processPdf() {
  const limits = workerData?.limits;
  const source = workerData?.data;
  if (!(source instanceof ArrayBuffer) || !limits) {
    throw new SafePdfWorkerError("pdf_processing_failed", MALFORMED_MESSAGE);
  }

  const importModule = new Function("specifier", "return import(specifier)");
  const { getDocument, VerbosityLevel } = await importModule(
    "pdfjs-dist/legacy/build/pdf.mjs",
  );
  const loadingTask = getDocument({
    data: new Uint8Array(source),
    verbosity: VerbosityLevel.ERRORS,
    isEvalSupported: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    disableRange: true,
    disableStream: true,
    stopAtErrors: true,
    enableXfa: false,
    useSystemFonts: false,
  });
  let document;

  try {
    document = await loadingTask.promise;
    if (document.numPages > limits.maxPdfPages) {
      throw new SafePdfWorkerError(
        "pdf_page_limit_exceeded",
        "This PDF exceeds the supported page limit.",
        422,
        { limit_name: "max_pdf_pages", limit_value: limits.maxPdfPages },
      );
    }

    const { info } = await document.getMetadata();
    if (info?.IsXFAPresent === true) {
      throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
    }

    const attachments = await document.getAttachments();
    if (hasEntries(attachments)) {
      throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
    }

    const documentActions = await document.getJSActions();
    if (hasEntries(documentActions) || await document.hasJSActions()) {
      throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
    }

    const openAction = await document.getOpenAction();
    if (openAction && typeof openAction === "object" && "action" in openAction) {
      throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
    }

    const calculationOrder = await document.getCalculationOrderIds();
    if (Array.isArray(calculationOrder) && calculationOrder.length > 0) {
      throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
    }

    const outline = await document.getOutline();
    if (outlineContainsExecutableAction(outline)) {
      throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
    }

    const pages = [];
    let totalCharacters = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        if (hasEntries(await page.getJSActions())) {
          throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
        }
        const annotations = await page.getAnnotations({ intent: "display" });
        if (annotations.some(annotationContainsActiveContent)) {
          throw new SafePdfWorkerError("pdf_unsupported_active_content", ACTIVE_CONTENT_MESSAGE);
        }

        const text = await extractPageText(page, limits.maxPdfPageTextChars);
        totalCharacters += text.length;
        if (totalCharacters > limits.maxExtractedTextChars) {
          throw new SafePdfWorkerError(
            "pdf_text_limit_exceeded",
            "This PDF contains more text than RegSpan can safely process.",
            422,
            {
              limit_name: "max_extracted_text_chars",
              limit_value: limits.maxExtractedTextChars,
            },
          );
        }
        pages.push({ pageNumber, text });
      } finally {
        page.cleanup();
      }
    }

    if (totalCharacters < MIN_EXTRACTED_CHARACTERS) {
      throw new SafePdfWorkerError(
        "insufficient_pdf_text",
        "The PDF does not contain enough extractable text.",
      );
    }

    return { ok: true, pages };
  } finally {
    await document?.cleanup().catch(() => undefined);
    await loadingTask.destroy().catch(() => undefined);
  }
}

let result;
try {
  result = await processPdf();
} catch (error) {
  const safeError = normalizeWorkerError(error);
  result = {
    ok: false,
    code: safeError.code,
    safeMessage: safeError.safeMessage,
    status: safeError.status,
    safeMetadata: safeError.safeMetadata,
  };
}

parentPort?.postMessage({ ...result, cleanupCompleted: true });
}
