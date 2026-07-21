# Frozen V4.1 production shadow

The facts-only classifier runs asynchronously as a server-only, fail-open observer. The current classifier remains the sole source for findings, evidence, reports, dashboard metrics, and user-visible status.

Shadow execution requires workspace external-AI consent plus all three server gates: `ENABLE_EXTERNAL_AI_PROCESSING=true`, `ENABLE_EXTERNAL_AI_CLASSIFIER=true`, and `CLASSIFIER_FACTS_SHADOW_ENABLED=true`. `CLASSIFIER_FACTS_SHADOW_REQUIREMENTS` must explicitly list supported requirement IDs. The default is disabled.

For a supported requirement, the user-facing pipeline reuses the hydrated organization-evidence candidates already classified by the current path, freezes exact candidate text, provenance, source units, current evidence, and identities, and performs one bounded queue upsert. It does not construct a V4.1 request or contact a provider. Unsupported requirements enqueue nothing.

The internal worker atomically claims jobs and issues one frozen V4.1 request per document/requirement from the queued snapshot. It never reruns retrieval or reloads mutable candidate text. V4.1 model, prompts, unit-accountable schema, segmentation, semantic validation, quarantine, mapper, and status derivation remain frozen. Failed jobs remain failed unless `--retry-failed true` is explicitly supplied.

Jobs are stored in `classifier_facts_shadow_jobs`; results remain in `classifier_facts_shadow_results`. Both have row-level security enabled and grant no access to authenticated clients. Neither is joined into findings or evidence. Queue, provider, transport, schema, validation, and persistence errors are isolated from production completion.

## Local bounded verification

This uses frozen generalization documents and synthetic schema-valid `no_fact` responses. It makes no network or database calls:

```bash
npm run classifier:facts-shadow:worker:mock -- --limit 3 --concurrency 1
```

The real worker additionally requires `CLASSIFIER_FACTS_SHADOW_WORKER_ENABLED=true`:

```bash
npm run classifier:facts-shadow:worker -- --limit 3 --concurrency 1
```

## Internal disagreement report

The report is bounded to one workspace and analysis run and never calls a model:

```bash
npm run classifier:facts-shadow:report -- --workspace-id <uuid> --analysis-run-id <uuid> --output eval-results/classifier-facts-shadow/report.json
```
