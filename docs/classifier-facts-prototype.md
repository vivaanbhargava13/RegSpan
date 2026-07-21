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

## Version history and preserved v1 result

The first paid facts-only run is preserved under
`eval-results/classifier-facts-prototype/runs/20260721-010647/` and remains
comparable with later v2 output. It used result schema
`classifier-facts-prototype-results/v1`, the same model and fixture hash, and
reported 100% element precision, 36.4% element recall, 55.6% status accuracy,
0/9 false assurance, 4/4 hard-negative rejection, and 24/24 exact source-unit
validity.

The tracked `eval-fixtures/classifier-facts-prototype/v1-paid-baseline.json`
records those metrics, exact result/report hashes, source paths, and the v1
implementation commit (`7cf010b`). This keeps the ignored raw exchanges intact
locally while making their comparison identity reproducible.

Its raw facts confirmed four ontology failures: present-tense operative recovery
language was marked optional; compound operations were under-extracted; closure
approval and containment confirmation received unsupported validation semantics;
and preservation facts were dropped when an auxiliary material field was null.
V2 changes only the extraction ontology, semantic grounding, and deterministic
mapping described below. V1 run JSON and Markdown are not overwritten; v2 uses a
separate `eval-results/classifier-facts-prototype/v2/` directory and `/v2`
schemas.

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

The isolated v2 paid path additionally requires
`CLASSIFIER_FACTS_PROTOTYPE_V2_ENABLED=true`, the existing two external-AI flags,
an API key, and the literal paid confirmation `CLASSIFIER_FACTS_PROTOTYPE_V2`.

## Pipeline

1. Candidate text is split deterministically into sentence or bullet units. A
   unit ID contains the candidate ID, ordinal, and the first 12 hexadecimal
   characters of the unit SHA-256.
2. The nine cases are grouped into exactly three requests: one request for all
   scored candidates associated with each requirement.
3. The structured-output schema permits atomic operational facts only. It has no
   status, relationship, support, element, or compliance-conclusion fields.
   Multiple distinct facts may cite the same unit, and the prompt requires one
   fact per actor-action-object operation.
4. Response validation requires a real candidate, real contiguous ordered unit
   IDs, exact schema keys, controlled enums, unique fact IDs, and exact
   `action_text`/`object_text` substrings. Quotes are
   reconstructed from frozen source offsets; there is no fuzzy quote recovery.
5. Valid facts form a cross-candidate ledger. The ledger records exact source
   units, reconstructed quote, mapped elements, and deterministic rejection
   reasons.
6. Code maps facts to atomic elements only when workflow, modality, action,
   object, and relevant detail fields satisfy a narrow rule.
7. Code derives `covered`, `partial`, or `missing` from required-element coverage.

Any provider, transport, parse, top-level, or source-isolation failure is an
extraction failure. No fallback is produced or counted as model success. A failed extraction makes
the run invalid and suppresses aggregate metrics, while the raw provider exchange
and categorized outcome remain available for diagnosis.

Request validity and fact validity are separate. Provider/transport failure,
malformed model JSON, a top-level response that prevents enumerating `facts`, an
unknown or cross-requirement candidate reference, a cross-candidate unit
reference, or deterministic replay corruption is request-fatal. Once facts can
be safely enumerated within the request’s source boundary, each fact is validated
independently. Fact-local schema, source-unit, exact-text, semantic-family,
workflow, and modality failures create rejected ledger entries and do not erase
valid sibling facts. These rejections measure extraction quality, not operational
availability, so a request containing rejected facts can remain `model_success`
and the run can remain valid and scored.

## Deterministic rejection boundaries

- Only `incident_response` facts can map to these three requirements.
- `service_provider_oversight`, `contract_management`, `general_governance`,
  `records_inventory`, and `unrelated` facts are rejected with a workflow reason.
- Optional, descriptive, and unknown modality cannot satisfy an element.
- Required, operative present-tense, and conditional-operative facts are eligible
  to map. Lack of `must` or `shall` does not imply optionality.
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
- Every mapped action must have exact cited `action_text` matching an approved
  generic verb family. Thus approval cannot masquerade as validation and review
  cannot masquerade as assessment.

V2 modalities are:

- `required`: explicit must, shall, required, or equivalent obligation;
- `operative`: present-tense policy/procedure language stating an actor performs
  an action;
- `conditional_operative`: an action established when, after, before, or upon a
  trigger;
- `optional`: may, can, at discretion, when appropriate, if feasible, or
  equivalent discretion;
- `descriptive`: purpose, capability, background, inventory, or design language
  that does not itself establish an action;
- `unknown`: modality cannot be grounded.

## Fact record

Every model-returned fact must provide all fields, using explicit `null` where the
source does not ground a value:

- `fact_id`, `source_candidate_id`, `source_unit_ids`;
- `actor`, `action`, `action_text`, `object`, `object_text`, `workflow_scope`, `condition_or_trigger`,
  `modality`;
- `tracking_details`, `validation_activity`, `record_or_material`, and
  `preservation_method`.

The validator adds only deterministic fields: `reconstructed_quote` and selected
source-unit hashes for accepted facts, or staged rejection codes for rejected
facts. Mapping then adds `mapped_elements` and `deterministic_rejections` to the
accepted-fact evaluation ledger.

`action` and `object` are normalized controlled ontology values. `action_text`
and `object_text` are exact source phrases, not alternate ontology fields. For
example, normalized object `remediation_item` may use exact source text
`Remediation items`; returning literal `remediation_item` as `object_text` is
invalid unless that underscore-delimited text actually appears in the source.
The validator never case-folds, normalizes, or silently repairs these fields.

Rejected facts retain the original model object, resolvable source units and
quote, rejection stage/codes, an explicit pre-mapping exclusion flag, and a raw
provider-response index. Rejected facts cannot map to elements.

## Commands

Serialize and inspect all three requests without provider access:

```bash
npm run eval:classifier-facts:v2:dry
```

Regenerate a Markdown report from a stored result without provider access:

```bash
npm run eval:classifier-facts:v2:report
```

Replay the preserved paid v2 provider exchanges without network access or
overwriting the original artifact:

```bash
npm run eval:classifier-facts:v2:replay
```

The eventual paid command is intentionally separate and must not be run during
prototype construction:

```bash
CLASSIFIER_FACTS_PROTOTYPE_V2_ENABLED=true npm run eval:classifier-facts:v2 -- \
  --confirm-paid CLASSIFIER_FACTS_PROTOTYPE_V2
```

## Evaluation and limitations

The evaluator reports element precision/recall/F1, status accuracy, false
assurance, hard-negative rejection, exact source-unit validity, extraction
failures, deterministic rejection reasons, and each case’s fact ledger and final
derivation. Offline report regeneration revalidates raw model content and
recomputes facts, mapping, status, and metrics rather than trusting stored
aggregates.

The paid v2 preservation response returned four facts, all for the full
preservation candidate. It returned no fact—accepted or rejected—for
`preservation-records-inventory-partial`. The paid prompt included that candidate
and did not prohibit fixed retention; therefore the miss was extraction omission,
not mapper or validator loss. Future instructions now state generically that an
explicit incident-record retention operation must be extracted separately from
an adjacent descriptive inventory. Replay does not fabricate the missing fact.

The focused tests use explicitly constructed source-grounded fact responses to
exercise all nine reviewed derivations and the known false-positive patterns.
Those tests validate deterministic behavior; they are not model results. Actual
extraction quality, workflow-scope consistency, atomicity, and recall remain
unknown until the separately authorized paid run. The model can still attach an
incorrect controlled fact to a real unit; deterministic source-ID and quote
validation proves provenance, not semantic truth.
