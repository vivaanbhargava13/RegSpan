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
   The separate V2 realistic-company corpus keeps its fixture PDFs under its
   own `documents/` directory. No generated V1 PDFs are committed by this
   repository.
5. Ensure the normal local ingestion configuration is working: Supabase server
   credentials, n8n webhook, worker bearer secret, and an enabled external AI
   embedding provider.

Run one isolated, run-specific workspace per case:

```sh
npm run eval:corpus -- --mode isolated --allow-external-ai
```

V1 remains the default. Select another corpus explicitly by directory name or
path. V2 cases represent separate fictional companies and are intentionally
available only in isolated mode:

```sh
npm run eval:corpus -- \
  --corpus regspan-v2-realistic-corpus \
  --mode isolated \
  --allow-external-ai \
  --case harborview-asset-advisors
```

A three-case V2 smoke test uses the same command shape:

```sh
npm run eval:corpus -- \
  --corpus regspan-v2-realistic-corpus \
  --mode isolated \
  --allow-external-ai \
  --case harborview-asset-advisors \
  --case meridian-transfer-trust \
  --case westbridge-securities
```

Before creating an evaluation workspace, the runner validates the selected
corpus directory, manifest version and unique IDs, canonical requirement IDs,
source classifications, all enabled PDF fixtures, and `inventory.csv` byte and
SHA-256 values when an inventory is present. Unknown corpus and case IDs fail
before uploads or workspace creation.

Run one or more targeted cases without creating workspaces for the rest of the
corpus:

```sh
npm run eval:corpus -- --mode isolated --allow-external-ai \
  --case partial-evidence-preservation \
  --case adversarial-scaffolding
```

`--case` may be repeated. Requested IDs are deduplicated, validated against the
loaded manifest before any workspace or upload is created, and executed in
manifest order. An unknown ID fails with the full valid-ID list. Omitting
`--case` preserves the full enabled-corpus run for the chosen mode.

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

Corpus evaluations use the separate durable `findings_generate_eval` action,
which defaults to 25 Analysis starts per hour. This prevents a 12-case isolated
evaluation from consuming or waiting on the browser-facing
`findings_generate` quota. The evaluator action is available only after the
runner's production safeguards pass and only for verified owner-created
`regspan-eval-` workspaces. It remains rate limited and uses the same durable
backend as browser traffic.

Corpus uploads similarly use the separate durable `document_upload_eval`
action, defaulting to 50 uploads per hour and configurable with
`REGSPAN_RATE_LIMIT_EVAL_DOCUMENT_UPLOADS_PER_HOUR`. It prevents repeated
evaluation runs from consuming the browser `document_upload` bucket. The
workspace document-count and byte quotas still apply to every evaluator upload.

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
Expected status, concept, canonical-element, and forbidden-phrase assertions are scored;
forbidden matches fail the run and `--min-score` controls the expected-status
threshold.

`expectedEvidenceElements` uses canonical IDs from the active Reg S-P
requirement definitions. The runner validates IDs before creating workspaces
and evaluates them only from final persisted `supports` or `partially_supports`
quotes. It does not use negative evidence, classifier reasons, or broader
retrieval chunks for an element assertion. `expectedEvidenceConcepts` remains
available for fixtures that intentionally require literal wording.

Each manifest case declares `sourceType` as `client_policy`,
`client_procedure`, or `client_standard`. The evaluator carries that explicit
classification through the normal document upload notes, and verifies the
stored chunk metadata before Analysis. Non-adversarial fixtures must persist as
`organization_evidence`; a classification mismatch fails the case before it
can produce a misleading Analysis result.

When a processing job fails, the reports label it `failed` and include its
safe stored processing step and error message. Reports never include document
text, excerpts, request headers, or secrets.

Artifacts are written under ignored `eval-results/corpus-*/`:

- `summary.md`: aggregate and per-case status and element summary, including corpus ID, version, path, selected cases, and expected/actual status totals
- `results.json`: run status, corpus and selected-case metadata, safe IDs, timings, aggregate status totals, and assertion results
- `results.csv`: compact rows including corpus metadata, selected-case metadata, expected/actual requirement statuses, and expected, matched, and missing element IDs

`results.json` starts with status `incomplete` and is replaced atomically at safe
lifecycle boundaries. A hard interruption may leave the last safe partial
report, still marked `incomplete`. Artifacts intentionally omit raw client
source excerpts. Use the stored run and workspace IDs for authorized local
debugging and manual cleanup.
