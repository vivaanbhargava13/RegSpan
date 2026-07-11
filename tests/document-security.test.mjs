import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function importDocumentSecurity() {
  const source = (await readFile("lib/documentSecurity.ts", "utf8"))
    .replace(/^import "server-only";\n/, "")
    .replace(
      'import { getServerSupabaseAuthClient } from "@/lib/supabase/authServer";\n',
      "const getServerSupabaseAuthClient = undefined;\n",
    );
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: "lib/documentSecurity.ts",
  }).outputText;
  const outDir = await mkdtemp(join(tmpdir(), "regspan-document-security-test-"));
  const outPath = join(outDir, "documentSecurity.mjs");
  await writeFile(outPath, transpiled, "utf8");
  return import(pathToFileURL(outPath).href);
}

function pdfFile(contents, name = "policy.pdf", type = "application/pdf") {
  return new File([contents], name, { type });
}

test("PDF signature validation accepts only files beginning with the PDF signature", async () => {
  const { hasValidPdfSignature, validatePdfFile } = await importDocumentSecurity();
  const validPdf = pdfFile("%PDF-1.7\nminimal fixture");

  assert.equal(await hasValidPdfSignature(validPdf), true);
  assert.equal(await validatePdfFile(validPdf), validPdf);

  for (const file of [
    pdfFile("plain text renamed as a PDF"),
    pdfFile("not a PDF", "spoofed.pdf", "application/pdf"),
    pdfFile("%PD"),
  ]) {
    assert.equal(await hasValidPdfSignature(file), false);
    await assert.rejects(
      validatePdfFile(file),
      (error) =>
        error?.status === 400 &&
        error?.code === "invalid_pdf_signature" &&
        error?.publicMessage === "The selected file is not a valid PDF.",
    );
  }
});

test("empty files are rejected before PDF signature validation can accept them", async () => {
  const { validatePdfFile } = await importDocumentSecurity();

  await assert.rejects(
    validatePdfFile(pdfFile("")),
    (error) => error?.status === 400 && error?.code === "empty_file",
  );
});

test("upload and replacement routes validate the same PDF file before storage or processing", async () => {
  const [uploadRoute, replaceRoute, documentSecurity] = await Promise.all([
    readFile("app/api/documents/route.ts", "utf8"),
    readFile("app/api/documents/[id]/replace/route.ts", "utf8"),
    readFile("lib/documentSecurity.ts", "utf8"),
  ]);

  assert.match(documentSecurity, /file\.slice\(0, PDF_SIGNATURE_BYTES\.length\)/);
  assert.match(documentSecurity, /PDF_SIGNATURE_BYTES = \[0x25, 0x50, 0x44, 0x46, 0x2d\]/);

  for (const route of [uploadRoute, replaceRoute]) {
    const validation = route.indexOf('validatePdfFile(formData.get("file"))');
    const storageUpload = route.indexOf('.upload(');
    assert.ok(validation >= 0, "route should use the shared PDF validator");
    assert.ok(
      validation < storageUpload,
      "invalid files must be rejected before a Storage upload",
    );
  }

  assert.ok(
    uploadRoute.indexOf('validatePdfFile(formData.get("file"))') <
      uploadRoute.indexOf("queueDocumentProcessing({"),
    "invalid uploads must be rejected before processing work is created",
  );
});
