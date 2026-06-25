# Retrieval-grade chunks and embeddings v1

Apply `supabase/migrations/015_create_chunk_embeddings.sql` in Supabase with
the SQL query name `015_create_chunk_embeddings` before enabling embedding
generation in the worker.

## Server configuration

These variables are server-only and must never use a `NEXT_PUBLIC_` prefix:

```dotenv
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=replace-with-a-server-secret
```

The provider adapter is isolated in `lib/embeddingCore.ts`; ingestion and
retrieval consume the provider interface rather than a vendor SDK. Retrieval v1
stores 1,536-dimensional vectors, so the configured model must support that
dimension. Chunk text is sent directly from the RegSpan worker to the configured
embedding provider. PDF bytes, signed URLs, Supabase credentials, and full
documents are never sent to n8n.

## Ingestion sequence

1. The existing authenticated worker downloads and extracts the private PDF.
2. Deterministic section-aware chunks preserve likely policy headings,
   paragraphs, short lists, page ranges, hierarchy, character offsets,
   approximate token counts, processing-job IDs, filenames, and hashes.
   Displayed `content` remains faithful extracted text. The embedding input is
   stored separately in metadata and enriches that content with filename,
   section path, parent heading, and citation page range.
   Before section detection, chunking v2 removes classification markings,
   repeated edge headers/footers, variable-number footer lines, bare page
   numbers, and numbered citation footnotes. Table-of-contents/navigation pages are
   excluded from evidence chunks entirely. Included chunks carry explicit
   `is_boilerplate`, `is_toc`, `is_footnote`, `retrieval_excluded`, and
   `retrieval_included` flags.
3. `store_ingestion_chunks_for_embedding_v1` upserts chunks by
   `(document_id, chunk_index)`, preserving stable chunk IDs where possible.
4. Changed content hashes remove stale embeddings; removed chunks cascade-delete
   their embeddings.
5. The worker checks `chunk_embeddings` for the configured model and skips every
   chunk whose stored retrieval-input hash still matches. A separate source
   content hash remains available for citation-integrity checks.
6. Missing or changed chunks are embedded in bounded batches and upserted by
   `(chunk_id, embedding_model)`.
7. `finalize_ingestion_embeddings_v1` marks the job and document `Processed`
   only after every active chunk has a matching embedding and content hash.

A retry during embedding safely resumes: stable chunks keep their IDs, completed
embeddings are skipped, and only missing vectors are generated. Existing
documents processed before migration 015 require one Reprocess run to receive
retrieval metadata and embeddings.

## Storage and access

`public.chunk_embeddings` stores:

- `chunk_id`, `workspace_id`, and `document_id`
- `embedding vector(1536)` and `embedding_model`
- `content_hash`
- creation and update timestamps

RLS is enabled. Browser roles receive no table-write privileges and the RPCs are
service-role-only. The service role remains confined to server code. Document
and chunk foreign keys cascade on deletion, while hash-change invalidation
prevents stale vectors from participating in retrieval.

## Retrieval contract

Server code calls `retrieveRelevantChunks` with a workspace ID, query text,
`topK` from 1 through 50, and an optional document ID. The helper embeds the
query with the configured model and calls `match_document_chunks_v1`.

The RPC always filters both the embedding and chunk rows by `workspace_id`,
optionally filters by document, requires matching model/content hashes, and
returns:

- chunk and document IDs
- filename
- page range and chunk index
- section path
- a bounded content preview
- cosine similarity score

This is retrieval infrastructure only. It does not perform Reg S-P requirement
matching, generate findings, make compliance judgments, or create reports.

## Manual verification

1. Apply migration 015 and configure the three server variables.
2. Restart Next.js so the server reads the new environment.
3. Reprocess a text-based PDF through the existing n8n workflow.
4. Confirm the document and job finish as `Processed`.
5. Confirm each `document_chunks` row has citation metadata and a content hash.
6. Confirm `chunk_embeddings` has one matching row per chunk for the configured
   model.
7. Reprocess the unchanged PDF and confirm embedding row IDs/counts stay stable.
8. Replace the PDF with changed text, reprocess, and confirm changed hashes get
   new vectors while removed chunks leave no embeddings.
9. Call `retrieveRelevantChunks` from server code and verify results contain only
   the requested workspace (and document, when supplied).
