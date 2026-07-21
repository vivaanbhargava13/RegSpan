# Classifier capability A/B evaluation

This evaluation-only harness compares frozen classifier requests when only the
model identifier changes. It reuses production request construction,
classification, quote and element post-processing, requirement matching, and
finding aggregation. It does not run ingestion, retrieval, or database work.

This experiment measures per-candidate classifier capability within the current
architecture. It does not evaluate cross-candidate element aggregation,
retrieval quality, ingestion, or the proposed facts-only redesign. The paid run
is intentionally narrow: it asks whether a stronger model materially improves
classification of each frozen candidate passed through the existing pipeline.

## Frozen fixture and review state

The current suite is
`eval-fixtures/classifier-capability/fixtures.v2.json`, schema
`classifier-capability-fixtures/v2`. Its canonical suite hash covers the schema,
baseline, requirements and hashes, ordered cases and candidates, exact text and
text hashes, proposed labels, field-level provenance, and scoring eligibility.
The hash detects accidental or inconsistent changes; it is not protection
against an actor who deliberately rewrites both fixtures and results.

Every expected status, relationship, element set, direct-support designation,
and hard-negative designation records confirmation, provenance source, reviewer
metadata where applicable, source path/locator/hash, and normalization recipe.
Only confirmed `reviewer_answer_key` or `manual_adjudication` fields may be
scored. Nine approved single-candidate cases are confirmed through manual
adjudication and scored. The two cases derived from prior OpenAI diagnostics
remain `diagnostic_only`; their provider-derived provenance was not converted.
Both attempted multi-candidate recovery cases are also `diagnostic_only`. They
are retained for transparency but do not enter headline capability metrics.

The blank review artifacts are:

- `eval-fixtures/classifier-capability/reviewer-worksheet.md`
- `eval-fixtures/classifier-capability/reviewer-worksheet.json`

They contain requirement text, element definitions, exact candidate text and
order, proposed labels, provenance, and blank reviewer fields. No valid
complementary aggregation case is available. That is an explicit experiment
limitation, not a paid-run blocker.

Regenerate normalized fixtures and worksheets after an intentional source
review with:

```bash
npm run eval:classifier-capability:fixtures
```

The builder copies/imports existing artifacts. It does not adjudicate or confirm
inferred labels.

## Dry mode

```bash
npm run eval:classifier-capability:dry -- \
  --baseline-model baseline-model-id \
  --challenger-model challenger-model-id
```

Dry mode validates the suite hash and provenance, builds both serialized
requests with the production helper, verifies they differ only by model, writes
an ignored plan, and makes no network call.

## Paid gate

Before any provider access, paid mode requires:

- a valid fixture suite and suite hash;
- distinct non-empty model identifiers and dry request equivalence;
- every scored field to be independently confirmed;
- at least eight independently confirmed scored cases;
- at least three confirmed direct-support positives;
- at least three confirmed hard negatives;
- at least one confirmed partial case;
- no scored field derived from provider output;
- literal paid confirmation and both external-AI flags;
- an API key.

Run the no-provider readiness audit with:

```bash
npm run eval:classifier-capability:readiness -- \
  --baseline-model baseline-model-id \
  --challenger-model challenger-model-id \
  --confirm-paid CLASSIFIER_CAPABILITY_AB
```

The audit validates every paid precondition and prints `READY` without making a
provider call. The lack of a valid aggregation case remains a report limitation.

## Candidate outcomes and arm validity

Each candidate persists exactly one outcome:

- `model_success`
- `deterministic_guardrail`
- `provider_http_error`
- `provider_rate_limit`
- `provider_timeout`
- `provider_network_error`
- `malformed_transport_json`
- `classifier_parse_error`
- `post_processing_error`
- `fallback`

Diagnostics include HTTP status, retry count, category/message, raw response
text when available, parsed transport JSON, parsed classification, and
post-processed classification. Evaluation-observer exceptions are isolated and
cannot alter classifier behavior.

Only `model_success` candidates with independently confirmed expected fields
enter capability metrics. Every scored candidate must be `model_success` for an
arm to be valid. An invalid arm produces results and diagnostics, suppresses
comparative quality conclusions, displays an invalid-run warning, and exits
nonzero.

## Metrics

Reports recompute metrics from candidate outputs rather than trusting stored
aggregates. They report numerator and denominator for direct-support recovery,
element precision/recall/F1, requirement-status accuracy, hard-negative
rejection, and exact-quote success. Quote success uses both a fixed confirmed
expected-positive denominator and a positive-prediction denominator.

False assurance is computed at case status level using
`missing < partial < covered`. `needs_review` and `conflicting` are excluded
unless a future fixture schema explicitly supplies a comparison rule. Excluded
candidates and reasons are listed.

## Offline reporting and integrity

```bash
npm run eval:classifier-capability:report -- \
  --fixtures eval-fixtures/classifier-capability/fixtures.v2.json \
  --input eval-results/classifier-capability/results.json \
  --output eval-results/classifier-capability/report.md
```

Offline mode makes no provider call. It reloads and validates the selected
fixture, requires the stored suite hash, enforces exact ordered and unique case
and candidate identities, compares normalized text and requirement inputs,
checks request and invariant hashes, checks arm alignment and candidate models,
recomputes arm validity, and recomputes all metrics.
