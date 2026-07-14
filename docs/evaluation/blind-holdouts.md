# Blind Holdout Evaluation

Blind holdouts estimate accuracy on policies that have not influenced RegSpan
matching changes. They are deliberately separate from the known regression
suites:

- **V1** is a known targeted regression suite.
- **V2** is a known realistic-company regression suite.
- **Blind holdouts** are accuracy-estimation corpora. Their answer keys are not
  present when the engine uploads, processes, or analyzes documents.

## Execution

A blind corpus manifest is stored with the PDFs and inventory metadata, but it
must declare `blindExecution: true` and must not contain expected statuses,
elements, rationales, evidence spans, or alternates. It has this structural
shape:

```json
{
  "version": 1,
  "id": "example-holdout",
  "blindExecution": true,
  "cases": [
    {
      "id": "example-policy",
      "filename": "example-policy.pdf",
      "tier": "holdout",
      "sourceType": "client_policy",
      "include": { "isolated": true }
    }
  ]
}
```

Blind execution ignores any free-form manifest notes and supplies only the
server-generated source-type marker needed by the existing ingestion path.

Run blind execution only in isolated mode. It uses the normal server-side
upload, processing, Analysis, quota, source-classification, provenance, and
snapshot safeguards, but never loads an answer key:

```sh
npm run eval:corpus -- \
  --corpus /secure/path/to/blind-corpus \
  --mode isolated \
  --blind \
  --allow-external-ai
```

The ignored `eval-results/blind-holdout-*/results.json` artifact contains only
stable run, workspace, document, finding, chunk, and evidence IDs; actual
finding statuses; evidence relationships; final canonical element IDs; and
SHA-256 hashes and lengths of final quotes. It contains no expected statuses,
answer-key spans, rationales, reviewer labels, or raw source excerpts.

## Answer Key

Keep the versioned answer key outside the execution corpus and outside source
control when it is intended to remain blind. Its JSON shape is:

```json
{
  "schemaVersion": 1,
  "corpusId": "example-holdout",
  "corpusVersion": 1,
  "expectations": [
    {
      "caseId": "example-policy",
      "requirementId": "requirement_identifier",
      "primaryExpectedStatus": "partial",
      "supportedElements": ["canonical_element"],
      "missingElements": ["another_canonical_element"],
      "validEvidenceSpans": [
        { "spanId": "reviewer-managed-span-id", "location": "reviewer reference" }
      ],
      "rationale": "Reviewer rationale retained with the answer key.",
      "reviewerLabels": [{ "reviewerId": "reviewer-id", "label": "partial" }],
      "adjudicatedLabel": "partial",
      "ambiguityNotes": ""
    }
  ]
}
```

`validEvidenceSpans` may be empty only when the primary expected status is
`missing`. The `supportedElements` and `missingElements` lists define the
adjudicated element boundary for the requirement. The scorer does not infer
that a quote is valid from lexical overlap; evidence validity is a reviewer
decision.

## Scoring

Score one or more completed blind execution directories without rerunning
Analysis. The answer-key path may be anywhere on the local filesystem.

```sh
npm run eval:score-holdout -- \
  --run eval-results/blind-holdout-example-isolated-run-a \
  --answer-key /secure/path/to/example-holdout-answer-key.json \
  --output-dir eval-results/holdout-score-example-a \
  --seed accuracy-baseline-2026
```

Use at least three independent completed runs to measure repeatability:

```sh
npm run eval:score-holdout -- \
  --run /secure/runs/run-a \
  --run /secure/runs/run-b \
  --run /secure/runs/run-c \
  --answer-key /secure/path/to/example-holdout-answer-key.json \
  --review /secure/path/to/example-holdout-evidence-review.json \
  --bootstrap-samples 2000 \
  --confidence-level 0.95 \
  --seed holdout-repeatability-v1
```

Optional reviewer adjudication has `schemaVersion: 1`, an optional `corpusId`,
and `reviews` rows keyed by `runId`, `caseId`, `requirementId`, and `evidenceId`.
Allowed labels are `supported`, `unsupported`, `partially_supported`,
`wrong_source`, `negated`, `topic_only`, and `unrelated_span_combination`.

## Metrics and Artifacts

Scoring writes these files to the chosen output directory:

- `summary.md`: high-level accuracy, false-assurance, evidence, and
  repeatability metrics.
- `metrics.json`: complete machine-readable status, element, grounding,
  bootstrap, and repeatability metrics.
- `status-confusion.csv`: expected-versus-actual status confusion matrix.
- `per-requirement.csv`: accuracy, macro metrics, and false-assurance metrics
  by requirement.
- `per-document.csv`: per-run document accuracy and exact match results.
- `element-metrics.csv`: true positives, false positives, false negatives,
  precision, recall, and F1 overall and by requirement.
- `repeatability.csv`: status agreement, final element-ledger agreement,
  final evidence-selection agreement, and instability by case and requirement.
- `evidence-review.csv`: a reviewer worksheet keyed by engine evidence IDs and
  answer-key span IDs; it does not include source text.

Status metrics include overall accuracy, a confusion matrix, macro precision,
recall, and F1, class-specific metrics, per-requirement metrics, per-document
accuracy, and document-level exact match. **False assurance** means an answer
key expects `partial` or `missing` while RegSpan outputs `covered`.

Element metrics compare the final persisted positive evidence ledger to the
adjudicated supported and missing element lists. Evidence-grounding metrics use
reviewer labels and report the unsupported grounded-claim rate only among
reviewed positive evidence. Unreviewed evidence remains explicitly counted.

For repeatability, the scorer compares all pairs of at least three runs. Status
agreement is exact status agreement; element-ledger and evidence-selection
agreement require equal final element or quote-hash sets. Per-case and
per-requirement instability is one minus status agreement.

Confidence intervals use a percentile bootstrap that resamples whole documents
with replacement, keeping each document's requirement rows together. The seed,
sample count, and confidence level are recorded in `metrics.json` so a score is
reproducible.
