# Frozen V4.1 production shadow

The facts-only classifier runs as a server-only, fail-open observer beside the current requirement classifier. The current classifier remains the sole source for findings, evidence, reports, dashboard metrics, and user-visible status.

Shadow execution requires workspace external-AI consent plus all three server gates: `ENABLE_EXTERNAL_AI_PROCESSING=true`, `ENABLE_EXTERNAL_AI_CLASSIFIER=true`, and `CLASSIFIER_FACTS_SHADOW_ENABLED=true`. `CLASSIFIER_FACTS_SHADOW_REQUIREMENTS` must explicitly list supported requirement IDs. The default is disabled.

For a supported requirement, the pipeline reuses the hydrated organization-evidence candidates already classified by the current path. It preserves candidate order, groups by document, and issues one frozen V4.1 request per document/requirement. Unsupported requirements make no shadow request. V4.1 model, prompts, unit-accountable schema, segmentation, semantic validation, quarantine, mapper, and status derivation remain frozen.

Results are written only to `classifier_facts_shadow_results`, which has row-level security enabled and grants no access to authenticated clients. It is not joined into findings or evidence. Provider, transport, schema, validation, and persistence errors are logged and isolated from production completion.

## Local bounded verification

This uses frozen generalization documents and synthetic schema-valid `no_fact` responses. It makes no network or database calls:

```bash
npm run classifier:facts-shadow:mock -- --limit 3
```

## Internal disagreement report

The report is bounded to one workspace and analysis run and never calls a model:

```bash
npm run classifier:facts-shadow:report -- --workspace-id <uuid> --analysis-run-id <uuid> --output eval-results/classifier-facts-shadow/report.json
```
