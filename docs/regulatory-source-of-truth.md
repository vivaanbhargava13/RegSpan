# RegSpan Regulatory Source Of Truth

RegSpan keeps SEC source material separate from customer evidence.

## Model

Global regulatory source material:

SEC Release No. 34-100155 -> `regulatory_sources` -> `regulatory_source_chunks` -> `controls` -> `control_elements` -> `control_citations`

Workspace evidence:

Customer uploads -> `documents` -> `document_chunks` -> `chunk_embeddings` -> findings evidence

`regulatory_source_chunks` are never organization evidence. They support requirement basis citations only. Findings status must be based on workspace-specific customer evidence from `document_chunks`.

## Migrate

Run the Supabase migrations through:

```bash
supabase db push
```

The framework migration is:

```text
supabase/migrations/017_create_regulatory_source_controls_framework.sql
```

It creates `regulatory_sources`, `regulatory_source_chunks`, `control_elements`, and `control_citations`, and extends the existing `controls` table with DB-backed source-of-truth fields.

## Seed Curated Controls

Seed the SEC source record, the first curated citation chunks, and the 11 Reg S-P controls:

```bash
npx tsx scripts/seed-regsp-regulatory-source.ts
```

Required server-only environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The seed uses the current 11-control RegSpan framework as the first curated control set. The manually seeded page ranges are initial citation anchors for local/product development; the full PDF importer can replace or enrich them later.

## Import SEC PDF Chunks

Place the SEC Release No. 34-100155 PDF anywhere local and run:

```bash
npx tsx scripts/import-sec-regsp-source.ts /absolute/path/to/sec-release-34-100155.pdf
```

or:

```bash
SEC_REGSP_PDF_PATH=/absolute/path/to/sec-release-34-100155.pdf npx tsx scripts/import-sec-regsp-source.ts
```

The importer extracts text, chunks by deterministic heading heuristics where possible, classifies `chunk_kind`, and upserts rows into `regulatory_source_chunks`. It does not create workspace `documents`, does not create `document_chunks`, does not upload to document storage, and does not create organization evidence.

## Refresh Controls

When the framework changes:

1. Update `lib/regSpRequirements.ts` for fallback behavior and matching metadata.
2. Update `scripts/seed-regsp-regulatory-source.ts` if control keys, elements, or citations change.
3. Run the seed script again. It upserts controls and refreshes elements/citations for the seeded controls.
4. Re-run findings for affected workspaces so analyses use the latest active DB-backed controls.

Normal users should not edit canonical controls unless an admin system is added. The current migration grants authenticated users read access only; service role is required for writes.
