# Facts-only classifier prototype V3

## Purpose and boundary

V3 is the final one-pass facts-only extraction prototype. It is evaluation-only and imports the reviewed classifier-capability fixtures without changing their labels. It does not change production classification, prompts, retrieval, ingestion, embeddings, aggregation, quote rules, or status rules.

The model remains `gpt-4o-mini-2024-07-18`, with one request per requirement. V1 and V2 code paths remain available through their existing commands and schemas. V3 uses `classifier-facts-prototype-results/v3`, its own feature flag, script, dry-run artifact, result directory, replay directory, and report formatter.

## V3 fact contract

The required fields are:

- `fact_id`
- `source_candidate_id`
- `source_unit_ids`
- `actor`
- `action`
- `object`
- `workflow_scope`
- `condition_or_trigger`
- `modality`
- `tracking_details`
- `validation_activity`
- `record_or_material`
- `preservation_method`

`action_text` and `object_text` are optional diagnostics. They are not authoritative and their absence, capitalization, punctuation, or casing cannot invalidate a fact. `action` and `object` are normalized ontology values. Exact evidence is always reconstructed without rewriting from the cited source-unit offsets.

## Validation boundaries

Request-level failures are limited to provider or transport failure, malformed top-level JSON, a schema failure that prevents facts from being enumerated, unknown or cross-requirement source references, and replay corruption.

Fact-level failures include invalid fact shape, invalid or noncontiguous same-candidate units, normalized action or object semantics not grounded by approved generic lexeme families in the reconstructed source, invalid workflow scope, optional or non-operative modality, and other local semantic errors. Rejected facts remain in the ledger and are excluded before mapping. A rejected sibling never erases accepted facts.

Semantic matching uses Unicode NFKC normalization and case-insensitive comparison. The original unit text remains unchanged for quotations. An ontology label need not occur verbatim, but supporting source language must occur. For example, normalized `remediation_item` may be grounded by “Remediation items”; an unsupported normalized action remains rejected.

## Source-derived mapping

The deterministic mapper uses accepted normalized facts plus exact reconstructed source text:

- Assessment and containment retain the established mappings for scope assessment, affected customer-information systems, isolation, disabling credentials, blocking malicious infrastructure, containment, and controlled shutdown.
- Preservation recognizes maintained incident files, operational preserve/retain/maintain/collect/store actions, controlled handling details, and fixed incident-record retention. Fixed retention alone maps only `incident_materials`; an inventory alone maps nothing.
- Recovery recognizes restoration, rebuilding, return to service, credential reset, patches/configuration repair, and removal of unauthorized access paths.
- Remediation tracking can be established by source text containing remediation items plus owner, assignment, due-date, open-item, monitoring, completion-evidence, review, or closure detail. `tracking_details` may supplement but is not required.
- Validation can be established by validate/verify/test actions applied to logging, access, permissions, controls, integrity, transactions, functions, data, restored services, or systems. `validation_activity` may supplement but is not required.

Provider oversight, procurement or contract corrective action, descriptive inventories, incident-history registration, and optional language retain their rejection guards.

## Omission diagnostics

V3 reports source units containing configured high-signal operative lexemes when no accepted fact cites the unit. The families cover assessment, identification, containment, preservation, recovery, tracking, monitoring, review, validation, verification, and testing. Each diagnostic records the exact unit, hash, matched families, and `creates_evidence: false`.

Diagnostics never fabricate facts, map elements, or alter status. They are visibility into probable extraction omissions only.

## Offline and paid commands

Dry request serialization, with no network calls:

```bash
npm run eval:classifier-facts:v3:dry
```

Recompute a Markdown report from a stored V3 result:

```bash
npm run eval:classifier-facts:v3:report -- --input eval-results/classifier-facts-prototype/v3/results.json --output eval-results/classifier-facts-prototype/v3/results.md
```

Replay a stored paid V3 provider exchange without network calls and without overwriting it:

```bash
npm run eval:classifier-facts:v3:replay -- --input eval-results/classifier-facts-prototype/v3/results.json --output eval-results/classifier-facts-prototype/v3-replay/results.json --report-output eval-results/classifier-facts-prototype/v3-replay/results.md
```

Eventual paid command (not executed during implementation):

```bash
CLASSIFIER_FACTS_PROTOTYPE_V3_ENABLED=true ENABLE_EXTERNAL_AI_PROCESSING=true ENABLE_EXTERNAL_AI_CLASSIFIER=true npm run eval:classifier-facts:v3 -- --confirm-paid CLASSIFIER_FACTS_PROTOTYPE_V3
```

An API key must be supplied separately through `REQUIREMENT_CLASSIFIER_API_KEY` or `OPENAI_API_KEY`. Raw provider exchanges and raw model content are persisted for deterministic replay.

## Pre-registered final decision rule

V3 passes only if its paid run meets every condition:

- run valid;
- false assurance `0/9`;
- hard-negative rejection `4/4`;
- exact source-unit validity `100%`;
- element precision at least `90%`;
- element recall at least `81.8%`;
- requirement-status accuracy at least `8/9`.

If the paid V3 run misses either the recall threshold or the status-accuracy threshold, one-pass facts-only extraction is deemed insufficient and prompt/schema iteration stops. The next design is a separate recall-selection pass followed by precision extraction.

Constructed facts are used only to test deterministic validation and mapping mechanics; their offline score is not evidence that model extraction will meet this decision rule.
