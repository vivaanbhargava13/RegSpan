# Corpus evaluation

`npm run eval:corpus` is a server-only, non-production corpus runner. It uses
the same upload transaction, processing queue, ingestion worker, analysis
generation, and evidence persistence services as RegSpan. It never deletes
evaluation resources automatically.
It does not expose an HTTP evaluation endpoint.

## Setup

1. Create or select a local non-production user account.
2. Set its UUID as `REGSPAN_EVAL_ACTOR_USER_ID`.
3. Set `REGSPAN_EVAL_WORKSPACE_PREFIX=regspan-eval-` explicitly.
4. Add the 12 locally approved PDFs named by
   `eval/corpora/regspan-v1/manifest.json` under `sources/` or `generated/`.
   No PDFs are committed by this repository.
5. Ensure the normal local ingestion configuration is working: Supabase server
   credentials, n8n webhook, worker bearer secret, and an enabled external AI
   embedding provider.

Run one isolated, run-specific workspace per case:

```sh
npm run eval:corpus -- --mode isolated --allow-external-ai
```

Run one combined workspace for all combined-enabled cases:

```sh
npm run eval:corpus -- --mode combined --allow-external-ai
```

Useful controls:

```sh
npm run eval:corpus -- --mode combined --allow-external-ai --timeout-ms 420000 --min-score 0.9
```

Every invocation receives a UUID run ID. The run ID is part of each workspace
name and result artifacts. The runner refuses to reuse an existing workspace,
never adopts earlier documents or jobs, and never resumes a prior invocation.
Failed or interrupted workspaces are left untouched for later manual cleanup.
A rerun always creates a new run ID and new workspace names.

`--timeout-ms` is a polling deadline for processing jobs and already-running
Analysis runs. Findings generation currently executes synchronously in the
application service and is not cancelled by this flag.

Analysis rate limits are respected. `--wait-on-rate-limit` is enabled by
default; it waits for the authoritative retry duration and rechecks for an
existing active or completed Analysis run before retrying. The total wait is
bounded by `--max-rate-limit-wait-ms` (default: `3600000`). Use
`--no-wait-on-rate-limit` to preserve fail-fast behavior. Waiting never
re-uploads a document, reprocesses it, or creates another workspace.

The runner requires `--allow-external-ai`. Before it creates a workspace, it
also verifies that the server-side external AI policy is enabled. When both
checks pass, only the new run-specific evaluation workspaces are created with
external AI processing consent. Existing and browser-managed workspaces are
never modified.

## Safety and assertions

The runner refuses production unless `REGSPAN_EVAL_ENABLED=true`, requires an
explicit `regspan-eval-` workspace prefix, and verifies the configured actor
before creating any workspace. Every workspace name is derived from the new run
ID, and creation fails if that name already exists. Operations remain scoped to
the newly created workspace. The runner does not print PDF text, quotes, tokens,
or secrets.

Each case hard-fails for a failed/stuck processing job or analysis run, a
covered/partial finding without primary evidence, an extra or missing snapshot
document, non-client/regulatory evidence, or evidence from another case
workspace. Isolated snapshots must contain exactly one planned case document;
combined snapshots must exactly match the selected corpus document set.
Expected status, concept, and forbidden-phrase assertions are scored;
forbidden matches fail the run and `--min-score` controls the expected-status
threshold.

When a processing job fails, the reports label it `failed` and include its
safe stored processing step and error message. Reports never include document
text, excerpts, request headers, or secrets.

Artifacts are written under ignored `eval-results/corpus-*/`:

- `summary.md`: aggregate and per-case status summary
- `results.json`: run status, safe IDs, timings, and assertion results
- `results.csv`: compact rows for local comparison

`results.json` starts with status `incomplete` and is replaced atomically at safe
lifecycle boundaries. A hard interruption may leave the last safe partial
report, still marked `incomplete`. Artifacts intentionally omit raw client
source excerpts. Use the stored run and workspace IDs for authorized local
debugging and manual cleanup.
