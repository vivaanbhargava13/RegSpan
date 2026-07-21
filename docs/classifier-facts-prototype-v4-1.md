# Facts-only classifier prototype V4.1

## Root cause and boundary

The invalid V4 run used a strict schema whose `units` field was a generic array. The schema constrained the shape of each array item, but it did not encode the expected unit identities, exact item count, uniqueness, or conditional relationship between `disposition`, `facts`, and `no_fact_reason`. The deterministic post-response validator therefore enforced a stronger contract than the provider boundary.

V4.1 changes only that response schema contract. It inherits V4's model, system and user messages, fixture suite, candidate text, unit IDs, fact schema, fact quarantine, semantic grounding, mapper, status derivation, safety guards, and quality thresholds. V4 and its invalid paid artifacts remain immutable.

## Dynamic strict schema

Each requirement receives a distinct JSON Schema. `units` is an object whose properties are the exact supplied unit IDs. Every unit ID appears in `required`, and `additionalProperties` is false. This makes omission and unknown units schema-invalid. A JSON object cannot contain two independently addressable values for the same property, so duplication is structurally eliminated. Property order has no meaning.

Each unit property uses `anyOf` with two object branches:

- `facts`: one-value `enum`, `facts.minItems: 1`, null `no_fact_reason`, all fields required, no additional properties.
- `no_fact`: one-value `enum`, `facts.maxItems: 0`, non-empty string reason via `minLength: 1`, all fields required, no additional properties.

The schema uses the strict Structured Outputs subset requested for this correction: object `properties`, `required`, and `additionalProperties: false`; array `items`, `minItems`, and `maxItems`; string `enum` and `minLength`; null types; and nested `anyOf`. No conditional `if`/`then`, `const`, pattern properties, unevaluated properties, or custom keywords are used.

The official documentation MCP was unavailable during implementation and network access was prohibited by the task. No network lookup or provider request was made. The implementation therefore stays within the documented subset enumerated in the task and validates it locally. If the API rejects one of these features, only the schema will be adapted to the documented supported subset.

## Defensive validation and replay

Post-response validation remains defense in depth. It checks exact expected keys, rejects unknown keys, rechecks branch exclusivity, binds facts to source candidates and units, reconstructs exact quotes, and applies V4/V3 semantic quarantine and mapping.

Future V4.1 result outcomes persist the complete raw HTTP response body, parsed transport JSON, raw assistant content, parsed structured output, finish reason, provider request ID, request hash, and raw-response hash. Offline replay verifies the hashes and never overwrites its source.

No fact or no_fact reason maps directly. Only accepted facts passing the inherited validator reach the deterministic mapper.

## Commands

```bash
npm run eval:classifier-facts:v4-1:dry
```

```bash
npm run eval:classifier-facts:v4-1:replay -- --input eval-results/classifier-facts-prototype/v4-1/results.json --output eval-results/classifier-facts-prototype/v4-1-replay/results.json --report-output eval-results/classifier-facts-prototype/v4-1-replay/results.md
```

```bash
npm run eval:classifier-facts:v4-1:report -- --input eval-results/classifier-facts-prototype/v4-1/results.json --output eval-results/classifier-facts-prototype/v4-1/results.md
```

Eventual paid command, not executed here:

```bash
CLASSIFIER_FACTS_PROTOTYPE_V4_1_ENABLED=true ENABLE_EXTERNAL_AI_PROCESSING=true ENABLE_EXTERNAL_AI_CLASSIFIER=true npm run eval:classifier-facts:v4-1 -- --confirm-paid CLASSIFIER_FACTS_PROTOTYPE_V4_1
```

## Pre-registered rule

V4.1 passes only when the run is valid, all 35 units are accountable, false assurance is `0/9`, hard-negative rejection is `4/4`, exact source-unit validity is `100%`, element precision is at least `90%`, element recall is at least `81.8%`, and requirement-status accuracy is at least `8/9`.

V4.1 is the final one-pass experiment. If the API accepts the schemas but recall or status accuracy misses its threshold, all one-pass prompt/schema iteration stops and the next design is recall selection followed by precision extraction.
