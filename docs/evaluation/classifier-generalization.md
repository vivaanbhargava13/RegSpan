# Frozen classifier generalization evaluation

This evaluation compares the current per-candidate classifier with the frozen V4.1 facts-only classifier on identical evidence. It is evaluation-only: it does not alter production classification, retrieval, ingestion, embeddings, prompts, schemas, ontologies, mapping rules, or status rules.

## Holdout boundary

The 13 classifier-capability fixtures under `eval-fixtures/classifier-capability` remain development canaries. Their nine scored cases are never included in the generalization denominator. The holdout is the 12 fictional policies in `regspan-v2-realistic-corpus`, crossed with the three supported requirement families, for 36 requirement/document pairs.

Candidate evidence is frozen from the repository PDF bytes. The builder verifies each PDF against `inventory.csv`, runs the existing deterministic PDF extraction and chunking implementation without persistence, retains only chunks already marked retrieval-eligible by that implementation, and preserves source order. It does not query retrieval, create embeddings, ingest documents, or modify source text. Stable local candidate identities derive from document hash, chunk index, and chunk content hash. Stable source-unit identities use the frozen V4.1 sentence/bullet segmenter. The fixture hash commits to every identity, order, exact text, unit, and provenance field.

This is a newly frozen source-order snapshot, not a reconstruction of historical retrieval ranking. The existing corpus runs do not persist their full candidate packs locally.

## A/B execution

Arm A serializes the frozen current-classifier request for each candidate and applies its existing parser and post-processing. Arm B uses the frozen V4.1 prompt, fact ontology, exact-unit Structured Outputs schema, fact quarantine, mapper, and deterministic status derivation. V4.1 makes one isolated request for each document-requirement case: 36 requests, each containing only that document's frozen candidate set. Both plans are generated from the same canonical candidate sets, and the dry run verifies candidate cardinality across arms.

Paid artifacts preserve complete request bodies, raw response bodies, parsed transport JSON, request hashes, response metadata, latency, usage, and provider outcomes. Replay makes no network calls. Any non-model-success candidate invalidates the corresponding Arm A case; a failed requirement-group request invalidates every affected Arm B case. Invalid paired arms suppress comparative quality conclusions rather than becoming `missing` predictions.

Reports include overall and paired element precision/recall/F1, status accuracy, false assurance, hard-negative rejection, partial accuracy, direct recovery, source validity, invalid rate, facts, calls, latency, token usage, and estimated cost when provider pricing metadata is supplied. They break down requirement family, reviewed support kind, candidate-set size, evidence shape, and hard-negative category.

## Gate and failure policy

V4.1 advances only with zero false assurance, 100% exact source-unit validity, at least 90% element precision, 80% element recall, 85% status accuracy, 95% hard-negative rejection, recall and status no worse than Arm A, and no material invalid-request regression. Diagnostics, `no_fact` reasons, headings, inventories, and lexical hints never create evidence.

Failures are assigned to one architecture layer: source evidence absent; present but not extracted; extracted fact rejected incorrectly; accepted fact mapped incorrectly; deterministic status incorrect; or schema/provider failure. A failed gate does not authorize case-specific prompt or mapper repairs. The frozen V4.1 behavior is now consumed by the separately gated production-shadow adapter; this harness remains evaluation-only.

## Commands

```bash
npm run eval:classifier-generalization:fixtures
npm run eval:classifier-generalization:dry
npm run eval:classifier-generalization:readiness
npm run eval:classifier-generalization:replay -- --input /path/to/paid-results.json
```

The frozen case-isolated harness and its scoring rules remain available for offline replay. No generalization paid run is planned.
