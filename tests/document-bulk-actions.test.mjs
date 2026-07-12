import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("documents page exposes select mode with row and select-all checkboxes", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /setIsSelectMode\(true\)/);
  assert.match(client, /toggleDocumentSelection/);
  assert.match(client, /toggleSelectAll/);
  assert.match(client, /aria-label="Select all documents"/);
  assert.match(client, /aria-label=\{`Select \$\{document\.name\}`\}/);
  assert.match(client, /selectedDocumentIds\.has\(document\.id\)/);
});

test("documents page updates selected counts and disables empty selected actions", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /const selectedCount = selectedDocumentIds\.size/);
  assert.match(client, /`Delete selected \(\$\{selectedCount\}\)`/);
  assert.match(client, /`Reprocess selected \(\$\{selectedCount\}\)`/);
  assert.match(client, /disabled=\{selectedCount === 0 \|\| isBulkBusy\}/);
  assert.match(client, /\{selectedCount\} of \{documents\.length\} selected/);
});

test("documents page keeps global bulk actions outside select mode", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");
  const selectModeStart = client.indexOf("{isSelectMode ? (");
  const selectModeEnd = client.indexOf("{isUploadOpen ? (");
  const headerSource = client.slice(0, selectModeStart);
  const selectModeSource = client.slice(selectModeStart, selectModeEnd);

  assert.match(headerSource, /Upload document/);
  assert.match(headerSource, /Select documents/);
  assert.match(headerSource, /Reprocess all/);
  assert.match(headerSource, /Delete all/);
  assert.match(headerSource, /runBulkAction\("process", "all"\)/);
  assert.match(headerSource, /runBulkAction\("delete", "all"\)/);
  assert.match(selectModeSource, /`Reprocess selected \(\$\{selectedCount\}\)`/);
  assert.match(selectModeSource, /`Delete selected \(\$\{selectedCount\}\)`/);
  assert.match(selectModeSource, /Cancel/);
  assert.doesNotMatch(selectModeSource, /Reprocess all|Prepare all|Delete all/);
});

test("documents page renders clear lifecycle labels and next steps", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /Preparing source text/);
  assert.match(client, /Source text preparation starts automatically after upload/);
  assert.match(client, /Ready for Analysis/);
  assert.match(client, /Source text preparation failed/);
  assert.match(client, /Needs reviewer confirmation/);
  assert.match(client, /Reprocess or replace this document/);
  assert.match(client, /Source excerpts/);
  assert.match(client, /prepare source text for evidence review/i);
  assert.doesNotMatch(client, /begin secure extraction, chunking/);
});

test("documents upload form is file-first and hides optional metadata fields", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /Upload document/);
  assert.match(client, /DEFAULT_DOCUMENT_TYPE = "Information Security"/);
  assert.match(client, /formData\.set\("file", selectedFile\)/);
  assert.doesNotMatch(client, /documentTypes\.map/);
  assert.doesNotMatch(client, /Select document type/);
  assert.doesNotMatch(client, /Optional review context/);
});

test("documents upload field uses the full upload-card width after metadata removal", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");
  const uploadForm = client.slice(
    client.indexOf('<form className="mt-6 grid'),
    client.indexOf('</form>', client.indexOf('<form className="mt-6 grid')),
  );

  assert.match(uploadForm, /<form className="mt-6 grid gap-5"/);
  assert.match(uploadForm, /className="app-field mt-2 block w-full/);
  assert.match(uploadForm, /max-w-full text-xs/);
  assert.doesNotMatch(uploadForm, /max-w-(?!full\b)|grid-cols-|col-span-|w-1\/2|w-1\/3|w-2\/3/);
});

test("document upload API defaults type and starts source preparation", async () => {
  const [route, uploadService, processing] = await Promise.all([
    readFile("app/api/documents/route.ts", "utf8"),
    readFile("lib/documentUpload.ts", "utf8"),
    readFile("lib/documentProcessing.ts", "utf8"),
  ]);

  assert.match(route, /uploadDocumentForWorkspace/);
  assert.match(uploadService, /DEFAULT_DOCUMENT_TYPE = "Information Security"/);
  assert.match(uploadService, /queueDocumentProcessing/);
  assert.match(route, /processingQueued/);
  assert.doesNotMatch(uploadService, /invalid_document_type/);
  assert.match(processing, /start_processing_job/);
  assert.match(processing, /triggerN8nIngestion/);
});

test("document and finding filename surfaces allow long-word wrapping", async () => {
  const [documentsClient, detailClient, findingsClient, pageHeader] = await Promise.all([
    readFile("components/DocumentsClient.tsx", "utf8"),
    readFile("components/DocumentDetailClient.tsx", "utf8"),
    readFile("components/FindingsClient.tsx", "utf8"),
    readFile("components/PageHeader.tsx", "utf8"),
  ]);

  for (const source of [documentsClient, detailClient, findingsClient, pageHeader]) {
    assert.match(source, /\[overflow-wrap:anywhere\]/);
  }
  assert.doesNotMatch(documentsClient, /max-w-\[280px\] truncate/);
});

test("documents page sends selected and all bulk actions to the bulk API", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /fetch\("\/api\/documents\/bulk"/);
  assert.match(client, /action,\s*\n\s*scope,\s*\n\s*documentIds: isSelectedScope \? selectedDocumentList : \[\]/);
  assert.match(client, /runBulkAction\("delete", "selected"\)/);
  assert.match(client, /runBulkAction\("process", "selected"\)/);
  assert.match(client, /runBulkAction\("delete", "all"\)/);
  assert.match(client, /runBulkAction\("process", "all"\)/);
});

test("delete all and delete selected require confirmation", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /window\.confirm/);
  assert.match(client, /Delete all documents in this workspace\? This cannot be undone\./);
  assert.match(client, /Delete \$\{targetCount\} selected document/);
  assert.match(client, /This cannot be undone/);
});

test("bulk API enforces authenticated workspace scope", async () => {
  const route = await readFile("app/api/documents/bulk/route.ts", "utf8");

  assert.match(route, /authenticateRequest/);
  assert.match(route, /getActorWorkspaceId/);
  assert.match(route, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(route, /scope === "selected" && documents\.length !== documentIds\.length/);
  assert.match(route, /throw new DocumentRequestError\("Document not found\."/);
  assert.doesNotMatch(route, /workspaceId.*=.*payload/);
});

test("bulk API reuses safe delete and n8n processing patterns", async () => {
  const route = await readFile("app/api/documents/bulk/route.ts", "utf8");

  assert.match(route, /delete_document_and_derived/);
  assert.match(route, /\.storage\s*\n\s*\.from\("documents"\)\s*\n\s*\.remove/);
  assert.match(route, /start_processing_job/);
  assert.match(route, /triggerN8nIngestion/);
  assert.match(route, /jobId: result\.job_id/);
  assert.match(route, /documentId: document\.id/);
  assert.match(route, /workspaceId: document\.workspace_id/);
  assert.doesNotMatch(route, /signedUrl|signed_url|service_role|SUPABASE_SERVICE_ROLE_KEY|embedding/i);
});
