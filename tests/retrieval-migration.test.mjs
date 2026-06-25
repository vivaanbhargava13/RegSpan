import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("migration 015 keeps embeddings server-owned and retrieval workspace-scoped", async () => {
  const migration = await readFile(
    "supabase/migrations/015_create_chunk_embeddings.sql",
    "utf8",
  );

  assert.match(migration, /Query name: 015_create_chunk_embeddings/);
  assert.match(migration, /alter table public\.chunk_embeddings enable row level security/i);
  assert.match(migration, /revoke all on public\.chunk_embeddings from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on public\.chunk_embeddings to service_role/i);
  assert.match(migration, /where ce\.workspace_id = p_workspace_id/i);
  assert.match(migration, /and dc\.workspace_id = p_workspace_id/i);
  assert.match(migration, /and ce\.content_hash = dc\.content_hash/i);
  assert.match(migration, /references public\.document_chunks\(id, workspace_id\) on delete cascade/i);
});
