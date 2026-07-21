# Facts-only classifier evaluation prototype

## Why this prototype exists

The completed classifier capability A/B run used fixture suite
`2d867460a314063bef3aeec81d95952922476b4d8bbfa1b9bbe7a4ff8bffc73a` and
compared `gpt-4o-mini-2024-07-18` with `gpt-4.1-2025-04-14`. Both arms were
valid. The challenger produced no element-recall gain (both were 9/11), reduced
element precision from 90.0% to 81.8%, reduced status accuracy from 88.9% to
77.8%, and introduced one false-assurance result. The failure was architectural:
provider-contract corrective-action terminology was treated as incident-response
remediation tracking.

Model swapping stops at that result. This prototype freezes the planned model to
`gpt-4o-mini-2024-07-18` so a later run tests the facts-only architecture rather
than a simultaneous model change.

## Boundary

This code is evaluation-only and is not called by production analysis. It covers
only:

- incident assessment, containment, and control;
- incident evidence and log preservation;
- response recovery, remediation tracking, and validation.

It reads the nine independently confirmed scored cases from the existing
classifier-capability fixture. It does not change fixture labels, production
prompts, retrieval, ingestion, embeddings, quote rules, status rules, or the
production classifier.

The isolated paid path additionally requires
`CLASSIFIER_FACTS_PROTOTYPE_ENABLED=true`, the existing two external-AI flags, an
API key, and the literal paid confirmation `CLASSIFIER_FACTS_PROTOTYPE`.

## Pipeline

1. Candidate text is split deterministically into sentence or bullet units. A
   unit ID contains the candidate ID, ordinal, and the first 12 hexadecimal
   characters of the unit SHA-256.
2. The nine cases are grouped into exactly three requests: one request for all
   scored candidates associated with each requirement.
3. The structured-output schema permits atomic operational facts only. It has no
   status, relationship, support, element, or compliance-conclusion fields.
4. Response validation requires a real candidate, real contiguous ordered unit
   IDs, exact schema keys, controlled enums, and unique fact IDs. Quotes are
   reconstructed from frozen source offsets; there is no fuzzy quote recovery.
5. Valid facts form a cross-candidate ledger. The ledger records exact source
   units, reconstructed quote, mapped elements, and deterministic rejection
   reasons.
6. Code maps facts to atomic elements only when workflow, modality, action,
   object, and relevant detail fields satisfy a narrow rule.
7. Code derives `covered`, `partial`, or `missing` from required-element coverage.

Any provider, transport, parse, or validation failure is an extraction failure.
No fallback is produced or counted as model success. A failed extraction makes
the run invalid and suppresses aggregate metrics, while the raw provider exchange
and categorized outcome remain available for diagnosis.

## Deterministic rejection boundaries

- Only `incident_response` facts can map to these three requirements.
- `service_provider_oversight`, `contract_management`, `general_governance`,
  `records_inventory`, and `unrelated` facts are rejected with a workflow reason.
- Optional, descriptive, and unknown modality cannot satisfy an element.
- A records inventory or record-contents statement is not operational proof.
- Incident-history registration does not prove assessment or containment.
- Remediation tracking requires an incident-response remediation item, a tracking
  or assignment action, and at least one explicit tracking detail.
- Validation requires an incident-response validate/verify/test action, a scoped
  recovery object, and an explicit validation activity. Merely listing
  “validation results” is rejected.
- Preservation-process coverage requires a controlled preservation method; a
  fixed retention period can establish retained incident materials but not the
  complete preservation process.

## Fact record

Every model-returned fact must provide all fields, using explicit `null` where the
source does not ground a value:

- `fact_id`, `source_candidate_id`, `source_unit_ids`;
- `actor`, `action`, `object`, `workflow_scope`, `condition_or_trigger`,
  `modality`;
- `tracking_details`, `validation_activity`, `record_or_material`, and
  `preservation_method`.

The validator adds only deterministic fields: `reconstructed_quote` and the
selected source-unit hashes. Mapping then adds `mapped_elements` and
`deterministic_rejections` to the evaluation ledger.

## Commands

Serialize and inspect all three requests without provider access:

```bash
npm run eval:classifier-facts:dry
```

Regenerate a Markdown report from a stored result without provider access:

```bash
npm run eval:classifier-facts:report
```

The eventual paid command is intentionally separate and must not be run during
prototype construction:

```bash
CLASSIFIER_FACTS_PROTOTYPE_ENABLED=true npm run eval:classifier-facts -- \
  --confirm-paid CLASSIFIER_FACTS_PROTOTYPE
```

## Evaluation and limitations

The evaluator reports element precision/recall/F1, status accuracy, false
assurance, hard-negative rejection, exact source-unit validity, extraction
failures, deterministic rejection reasons, and each case’s fact ledger and final
derivation. Offline report regeneration revalidates raw model content and
recomputes facts, mapping, status, and metrics rather than trusting stored
aggregates.

The focused tests use explicitly constructed source-grounded fact responses to
exercise all nine reviewed derivations and the known false-positive patterns.
Those tests validate deterministic behavior; they are not model results. Actual
extraction quality, workflow-scope consistency, atomicity, and recall remain
unknown until the separately authorized paid run. The model can still attach an
incorrect controlled fact to a real unit; deterministic source-ID and quote
validation proves provenance, not semantic truth.
