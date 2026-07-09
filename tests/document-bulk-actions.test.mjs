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
  assert.match(client, /`Prepare selected \(\$\{selectedCount\}\)`/);
  assert.match(client, /disabled=\{selectedCount === 0 \|\| isBulkBusy\}/);
  assert.match(client, /\{selectedCount\} of \{documents\.length\} selected/);
});

test("documents page renders clear lifecycle labels and next steps", async () => {
  const client = await readFile("components/DocumentsClient.tsx", "utf8");

  assert.match(client, /Preparing source text/);
  assert.match(client, /Prepare this document before running analysis/);
  assert.match(client, /Ready for analysis/);
  assert.match(client, /Source text preparation failed/);
  assert.match(client, /Needs reviewer confirmation/);
  assert.match(client, /Reprocess or replace this document/);
  assert.match(client, /Source excerpts/);
  assert.match(client, /prepare source text for evidence review/);
  assert.doesNotMatch(client, /begin secure extraction, chunking/);
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
