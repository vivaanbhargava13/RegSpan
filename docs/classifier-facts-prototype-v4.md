# Facts-only classifier prototype V4

## Hypothesis and isolation

V4 tests whether one-pass extraction recall improves when the model must account for every supplied source unit. It preserves the same reviewed fixture suite, nine scored cases, exact candidate text, stable V3 segmentation, three requirement-level requests, and `gpt-4o-mini-2024-07-18`.

V3 is a completed failed experiment and remains immutable. V4 has separate source files, schemas, feature flag, commands, output directory, replay directory, tests, and documentation. It imports V3's fact-level validator, semantic grounding, mapper, and deterministic scorer without modifying their behavior.

## Unit-accountable contract

The response is an object containing only `units`. It must contain exactly one entry for each supplied `unit_id`; response order is irrelevant because validation binds entries by ID.

Each entry contains exactly:

- `unit_id`
- `disposition`: `facts` or `no_fact`
- `facts`: an array of V3 normalized facts
- `no_fact_reason`: string or null

`facts` requires at least one returned fact and a null reason. `no_fact` requires an empty array and a non-empty reason. Missing, duplicate, unknown, or cross-requirement units invalidate the request. A valid `no_fact` entry never creates evidence.

Facts retain the V3 normalized schema: `fact_id`, source candidate and unit IDs, actor, action, object, workflow scope, condition/trigger, modality, tracking details, validation activity, record/material, and preservation method. A fact may cite contiguous units from one candidate for context, but must cite the unit whose entry contains it.

## Validation boundaries

Request-fatal conditions are provider/transport failure, non-enumerable top-level JSON, unit-accountability failure, unknown or cross-requirement units, cross-candidate facts, and replay corruption.

Fact-local failures retain quarantine: invalid fact schema or enums, unresolved same-candidate references, action/object grounding mismatch, invalid workflow scope, invalid modality, duplicate fact identity, or failure to cite the containing entry's unit. Rejected facts remain persisted and cannot map. Rejected siblings do not erase accepted facts.

Exact quotations are reconstructed from the cited stable units. There is no fuzzy recovery, source rewriting, or evidence generation from `no_fact_reason`.

## Reused mapping and safety rules

V4 delegates accepted facts to the V3 mapper:

- Assessment and containment recognize scope assessment, affected customer-information systems, isolation, credential disabling, blocking, containment, and controlled shutdown.
- Preservation recognizes maintained incident files, preservation/retention of incident materials, fixed record retention, controlled storage, access controls, source and collection metadata, custodianship, integrity, and chain of custody. Fixed retention alone maps only `incident_materials`; inventory alone maps nothing.
- Recovery recognizes restore/recover/rebuild/return to service, credential reset, patching/configuration repair, and unauthorized-access-path removal.
- Tracking requires remediation items plus ownership, due dates, open status, monitoring, completion evidence, review, or closure tracking.
- Validation requires validate/verify/test actions applied to controls, logging, permissions, access, integrity, transactions, functions, systems, services, or data.

Monitoring alone does not establish recovery. Closure approval alone does not establish validation. Optional retention, inventories, procurement corrective actions, provider oversight, and adjacent workflows remain rejected.

## Diagnostics

Each requirement reports supplied and returned units; facts/no_fact units; missing and duplicated units; returned, accepted, and rejected facts; rejection counts; suspicious high-signal no_fact entries; accepted-but-unmapped units; multiple-fact units; exact request and response hashes; and provider exchange identity.

Diagnostics are observational only and never create facts, evidence, elements, or status.

## Commands

Offline dry serialization:

```bash
npm run eval:classifier-facts:v4:dry
```

Offline replay after a paid V4 artifact exists:

```bash
npm run eval:classifier-facts:v4:replay -- --input eval-results/classifier-facts-prototype/v4/results.json --output eval-results/classifier-facts-prototype/v4-replay/results.json --report-output eval-results/classifier-facts-prototype/v4-replay/results.md
```

Offline Markdown reporting:

```bash
npm run eval:classifier-facts:v4:report -- --input eval-results/classifier-facts-prototype/v4/results.json --output eval-results/classifier-facts-prototype/v4/results.md
```

Eventual paid command, not executed during implementation:

```bash
CLASSIFIER_FACTS_PROTOTYPE_V4_ENABLED=true ENABLE_EXTERNAL_AI_PROCESSING=true ENABLE_EXTERNAL_AI_CLASSIFIER=true npm run eval:classifier-facts:v4 -- --confirm-paid CLASSIFIER_FACTS_PROTOTYPE_V4
```

An API key must be supplied separately through `REQUIREMENT_CLASSIFIER_API_KEY` or `OPENAI_API_KEY`.

## Pre-registered decision rule and stop condition

V4 passes only if the paid run is valid, every unit has facts or valid no_fact, false assurance is `0/9`, hard-negative rejection is `4/4`, exact source-unit validity is `100%`, element precision is at least `90%`, element recall is at least `81.8%`, and requirement-status accuracy is at least `8/9`.

If paid V4 misses element recall or status accuracy, one-pass prompt/schema iteration stops. The next design is a separate recall-selection pass followed by precision extraction.
