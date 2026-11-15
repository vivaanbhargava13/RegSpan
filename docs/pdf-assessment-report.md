# PDF assessment report

The Analysis toolbar downloads a US Letter PDF through `GET /api/findings/export/pdf?runId=<displayed-run-id>`. The React PDF architecture and Markdown export remain unchanged.

## Editorial design

Major headings use **Source Serif 4**; body, tables and metadata use **Source Sans 3**. Both are unmodified Adobe static TTFs, bundled under the SIL Open Font License 1.1 with their license notices. Regular maps to 400, Semibold to 600. `public/fonts/report/sources.json` pins upstream commit URLs and checksums. Export embeds all four faces and uses no network font requests or new package dependencies.

The report uses a 48-point margin, deep navy text, white pages, subtle gray rules, a 27-point editorial title, 17-point section headings, 10.5-point body and quotation text, and secondary metadata at 8.5–9 points. The existing coverage colors and proportional rounded coverage bar remain unchanged.

- Executive overview: understated 17-point figures and three numbered management priorities on one page.
- Coverage matrix: aligned audit-style columns with repeated continuation headers and readable footnotes.
- Action plan: numbered requirements with coverage/risk metadata and separate issue/action columns.
- Detailed assessments: serif requirement headings, quiet field labels, recorded conclusions/rationale/actions, source references and regulatory basis. Short findings stay together; large fields flow.
- Evidence appendix: filenames and source location precede the complete exact quotations; evidence, document, passage and finding identifiers follow in a secondary style. No identifiers or quotations are removed.
- Methodology: serif subsections with controlled spacing, hanging document numbers, definitions and reviewer limitations. Modest scope/definition/limitation groups stay together to avoid an isolated closing paragraph.

This visual redesign changes `lib/assessmentPdf.tsx`, font assets and notices under `public/fonts/report/`, font tracing in `next.config.ts`, relevant PDF tests and this document. It does not change the report model, synthetic assessment fields, classification, retrieval, matching, evidence generation, authentication, data selection or export authorization.

## Final editorial polish

Current presentation changes are confined to:

- `lib/assessmentPdf.tsx`: reader-facing labels; prominent finding number/title and status with secondary severity; deliberate section openings and repeating chapter titles; a compact complete action-plan page; clean finding paragraphs; short evidence links; matrix navigation.
- `lib/assessmentPdfPresentation.ts`: PDF-only deterministic evidence aliases and destination names. Each alias is derived from the original evidence ID; input order does not affect it. Colliding short prefixes are extended rather than made ambiguous. The original IDs remain mapped in the appendix.
- `tests/assessment-report.test.mjs`: reference stability and collision checks; complete field/quotation preservation; one-page sample action plans; internal link annotations, target pages and heading coordinates; oversized-finding navigation.
- This document and the two regenerated sample PDFs.

Labels such as "Recorded recommendation" and "Recorded issue" become "Recommendation" and "Issue". The methodology explains that recommendations are the original remediation text and have not been approved or corrected. The selected source fields and their meanings are unchanged. Raw evidence IDs appear in the appendix rather than the main workpapers; document, passage, requirement and finding IDs are retained.

The coverage matrix links to each detailed finding. Main-report evidence references link to their appendix entries. These use native PDF named destinations and local link annotations. PDF.js tests resolve every sample link and verify finding heading coordinates, including an oversized finding. Anchors are placed at page level because the renderer otherwise uses relative coordinates for nested text destinations.

Major sections begin deliberately: overview, matrix, action plan, detailed assessments, evidence appendix and methodology. Continuation pages repeat the section title. All six unresolved findings fit on one typical action-plan page. The methodology is compact enough for one page. Short findings remain intact while large fields can flow.

No report-model, synthetic assessment data, analysis, authentication, source selection, export endpoint, font or color changes are part of this polish. No dependencies or AI calls were added.

## Review and source integrity

The run schema contains no verifiable reviewer-approval state. Every report remains **Draft / Not Independently Reviewed** on the executive page, every footer and PDF subject metadata. Completed analysis is not reviewer approval. Unverified approval metadata cannot change the designation.

Before distribution or reliance, a qualified reviewer must compare every status, conclusion, recorded recommendation, regulatory basis and cited source, including Covered findings. Existing structured fields do not support reliable semantic contradiction detection; export performs no keyword check, AI call or silent correction.

The typical fixture's F-04 deliberately combines a Covered notice-content conclusion with the recorded recommendation "No notice content is documented. Draft a complete customer-notice template." It is a manually authored integrity test, not evidence of a classifier defect. Both source fields remain unchanged in the redesigned PDF.

Regulatory basis descriptions come from the bundled requirement catalog. The run does not retain a versioned regulatory-text snapshot. Catalog references are distinguished from exact client-document quotations. Documentary coverage does not prove operational or legal compliance.

## Run and workspace isolation

The endpoint authenticates bearer tokens or cookies, derives the actor's workspace through the existing membership policy, and loads the defensible completed run used by `/api/findings`. Client workspace IDs and findings are ignored. A displayed `runId` that no longer matches is rejected with HTTP 409.

Findings and document snapshots are scoped by workspace and run. Evidence is scoped by workspace and the selected finding IDs. Mixed run/workspace/count data is rejected before rendering. Pagination preserves all snapshot/evidence rows. These protections are unchanged by the redesign.

## Synthetic samples

Generate without credentials or AI calls:

```sh
node --import ./scripts/registerServerTsLoader.mjs scripts/sampleAssessmentPdf.ts
```

- `output/pdf/regspan-typical-assessment.pdf`: 11 requirements, 12 pages; realistic excerpt lengths and a deliberately contradictory recorded recommendation.
- `output/pdf/regspan-synthetic-assessment.pdf`: 5 requirements, 11 pages; alternate quotation fields, missing evidence, long filenames and a full 26-clause excerpt.

Every page of both final PDFs was rendered with Poppler and visually inspected for typography, hierarchy, spacing, source readability, wrapping, page furniture and page breaks.

## Validation

- Targeted PDF tests: 13 passed, including workspace/run isolation, unchanged metrics, complete quotation strings across page boundaries, all typical summary/rationale/recommendation fields, draft labels, page numbers, actual font sizes and glyph bounds.
- Font tests verify four embedded TrueType faces, absence of Geist/Helvetica font descriptors, pinned checksums, license notices and tracing configuration.
- Lint, production build and diff checks passed. Standalone output contains all four TTF files and both licenses.
- The earlier typography redesign passed all 600 regression tests. This PDF-only editorial polish reruns the 13 targeted PDF tests, lint, production build and diff checks.

## Remaining limitations

Page count varies with source length; long exact quotations intentionally expand the appendix. Extremely large reports require sufficient server memory and request duration because the renderer buffers the PDF. The embedded fonts do not cover every writing system. The result has selectable text but is not tagged PDF/UA.

No verified approval workflow was added. A real authenticated production-data download and deployment load test have not been performed. No commit was created.
