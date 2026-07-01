# Requirement matching evaluation

RegSpan’s requirement matching eval creates repeatable JSON and Markdown
reports for the canonical Reg S-P debug requirement set. It is an internal
evaluation harness only: it does not create findings, compliance scores,
reports, PDFs, or dashboard data.

## Run it

```bash
npm run eval:requirements -- --workspace-name "Vivaan's Workspace" --top-k 15
```

You can also pass a workspace id:

```bash
npm run eval:requirements -- --workspace-id <workspace-uuid> --top-k 15
```

To evaluate one requirement:

```bash
npm run eval:requirements -- --workspace-name "Vivaan's Workspace" --requirement-id customer_notification_unauthorized_access --top-k 15
```

## Options

- `--workspace-name <name>`: workspace name to evaluate.
- `--workspace-id <uuid>`: exact workspace id to evaluate.
- `--top-k <number>`: candidate chunks per requirement. Defaults to `15`.
- `--requirement-id <id>`: optional single requirement filter.
- `--out-dir <path>`: output directory. Defaults to `eval-results`.

## Required environment

The script uses the same server-side retrieval ingredients as the debug backend:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMBEDDING_PROVIDER=openai`
- `EMBEDDING_MODEL`
- `EMBEDDING_API_KEY`

Do not expose these values to client components.

## Output files

The latest local run writes:

- `eval-results/requirement-eval-latest.json`
- `eval-results/requirement-eval-latest.md`

`eval-results/` is gitignored so local evaluations are not committed
accidentally.

## Semantic score vs rerank score

Requirement matching now uses hybrid retrieval:

1. semantic pgvector retrieval gathers a larger pool of candidates;
2. keyword/metadata matching adds candidates using the requirement title,
   description, topic signals, action signals, and direct signals;
3. candidates are merged by `chunk_id`;
4. a lightweight reranker orders the merged pool for requirement review.

The report preserves both scores:

- `similarity` / semantic similarity: the original pgvector score from the
  embedding search path.
- `rerank_score`: a debug-only score that combines semantic similarity with
  direct signal matches, action/topic matches, section-path matches,
  `source_type`, `evidence_role`, and evidence-classifier hints.

Use semantic similarity to understand embedding retrieval behavior. Use
`rerank_score` and `rerank_reason` to understand why a candidate was promoted
or demoted for a specific requirement.

## Negative or absence evidence

The grader detects common absence phrases such as “does not define,” “does not
establish,” “does not require,” “does not impose,” “no formal,” “lacks,”
“missing,” and “reserved for another policy” when they occur near
requirement-specific terms. These chunks are marked with
`negative_evidence: true` and should not be read as positive support merely
because they contain words like “notification,” “vendor reporting,” or
“recovery validation.”

Negative evidence is useful during review because it may indicate a real gap,
but this debug harness still does not create final findings or compliance
conclusions.

## What to review

For each requirement, the report includes:

- requirement id, title, and description
- debug status and status reason
- top_k used
- candidate count
- direct, partial, background, and irrelevant counts
- negative evidence count
- organization evidence, requirement reference, and supporting context counts
- source type mix
- top evidence chunks with filename, page range, section path, chunk index,
  semantic similarity, rerank score, rerank reason, grade, grade reason, source
  type, evidence role, classifier reason, and content preview

The Markdown report includes manual reviewer fields:

- correct status?
- best evidence present?
- source role correct?
- grading issue?
- retrieval issue?
- chunking issue?
- notes

Use those fields to decide whether a weak result is caused by retrieval,
grading, source typing, or chunking before tuning the RAG stack.
