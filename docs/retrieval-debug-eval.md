# Retrieval debug evaluation

RegSpan’s retrieval debug page is available at `/retrieval-debug` for signed-in
users. It is an internal inspection tool for retrieval quality only; it does
not generate Reg S-P findings, judgments, remediation, or reports.

## How the debug flow works

1. The browser sends the query, `top_k`, and optional document filter to
   `POST /api/retrieval-debug` with the user’s Supabase access token.
2. The API route validates the authenticated user and resolves the user’s
   default workspace.
3. If a document filter is supplied, the route verifies that the document belongs
   to the same workspace.
4. Server-side retrieval creates a query embedding with the configured embedding
   provider and calls `match_document_chunks_v1`.
5. Results are enriched with chunk metadata such as `evidence_reason` and
   `embedding_input` before being returned to the page.

The browser never receives the Supabase service-role key, embedding API key, or
embedding provider configuration. n8n is not involved in debug searches.

## Manual test queries

Use `top_k = 5` first. If results are sparse, remove the document filter and
confirm the relevant documents have been reprocessed after embeddings were
enabled.

| # | Query | A good result should roughly include |
|---|---|---|
| 1 | What procedures exist for notifying affected customers after unauthorized access? | Customer notification, breach notification, unauthorized access, affected customers, timing/escalation, or communication procedures. |
| 2 | How does the organization classify or escalate major incidents? | Incident severity, escalation criteria, major incident definitions, triage, or decision authority. |
| 3 | What does the policy say about incident containment? | Containment procedures, isolation, eradication handoff, response phases, or immediate mitigation steps. |
| 4 | What does the policy say about preserving logs or evidence? | Log retention, evidence preservation, chain-of-custody, forensic collection, or incident records. |
| 5 | What does the policy say about notifying regulators or law enforcement? | Regulator notice, law enforcement contact, legal/compliance escalation, reporting timelines, or notification ownership. |
| 6 | What does the policy say about vendor or third-party breach notification? | Vendor incident notice, third-party notification obligations, service provider escalation, or contractual reporting requirements. |
| 7 | What safeguards protect customer information? | Access controls, encryption, monitoring, administrative/technical safeguards, customer information protection, or privacy controls. |
| 8 | How are recovery activities validated or tested? | Recovery validation, restoration checks, lessons learned, post-incident testing, business continuity, or recovery verification. |
| 9 | What roles are responsible during incident response? | Incident commander, response team, legal/compliance, communications, IT/security operations, or role/responsibility matrices. |
| 10 | How are vulnerabilities remediated and tracked? | Vulnerability remediation, tracking, prioritization, patching, closure validation, or remediation ownership. |

## Automated local eval harness

Run the same query set without relying on screenshots:

```bash
npm run eval:retrieval -- --workspace-id <workspace-uuid> --top-k 10
```

If your local database has exactly one workspace, `--workspace-id` can be
omitted. If there are multiple workspaces, pass the workspace ID explicitly or
set `RETRIEVAL_EVAL_WORKSPACE_ID` in your local shell. You can also use a unique
workspace name:

```bash
npm run eval:retrieval -- --workspace-name "Vivaan's Workspace" --top-k 10
```

You can optionally scope the run to one document:

```bash
npm run eval:retrieval -- --workspace-id <workspace-uuid> --document-id <document-uuid> --top-k 15
```

The runner uses existing server-side configuration from `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_MODEL`
- `EMBEDDING_API_KEY`

It writes local, gitignored outputs:

- `eval-results/retrieval-eval-latest.json`
- `eval-results/retrieval-eval-latest.md`

The Markdown report includes a summary table, average similarity per query, top
result filename/page/section, all top-k results, content previews, embedding
input previews, and manual reviewer fields for pass/weak/fail grading.

## What to inspect in each result

- Filename and page range should point to a plausible source document.
- Section path should describe a meaningful policy area, not front matter,
  table-of-contents text, footers, acronyms, or generic references.
- Similarity should generally rank the most on-topic chunk first, but exact
  scores will vary by corpus and embedding model.
- Evidence reason should explain why the chunk was classified as evidence.
- Content preview should be source-faithful and suitable for later citation.
- The expandable embedding input should include filename, section path, page
  range, and the source chunk content.

## Red flags to log for later chunking/retrieval work

- Top results come from another workspace.
- Results are dominated by front matter, contact blocks, acronyms, references,
  table fragments, or running headers.
- A document filter returns chunks from a different document.
- Section paths are missing or generic when the PDF visibly has headings.
- Useful chunks exist on the document detail page but do not appear in retrieval,
  which may indicate missing or stale embeddings.
