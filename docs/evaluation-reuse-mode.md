# Evaluation preprocessing modes

`benchmark-fresh` is the official end-to-end evaluation mode. It always parses
the PDF, builds chunks and hierarchy, creates embeddings, then runs retrieval,
classification, and aggregation in newly isolated evaluation workspaces.

For local development only, a future `development-reuse` executor may reuse
preprocessing artifacts (extraction, chunks, hierarchy, and embeddings) only
when the cache key exactly matches all of these values:

- PDF SHA-256;
- parser/chunker version;
- declared source type; and
- embedding model and embedding-input version.

The reusable key is defined in `scripts/evaluationReuseCore.mjs`. A mismatch
in any component rejects the cache entry. Development reuse must still rerun
retrieval, classifier calls, aggregation, persistence, and scoring; it is not
valid for benchmark reporting. The corpus runner continues to use
`benchmark-fresh` exclusively.
