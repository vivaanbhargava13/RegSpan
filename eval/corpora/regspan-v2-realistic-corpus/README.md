# RegSpan V2 Realistic Company Policy Corpus

## Purpose

This corpus contains **12 fictional company-authored PDF policies** representing ordinary uploads to a Regulation S-P compliance review tool. The documents are not designed to trick a classifier. They vary because firms differ in size, entity type, maturity, drafting style, outsourcing model, and implementation detail.

The strict baseline is **SEC Release No. 34-100155** and amended **17 CFR 248.30**. The benchmark covers written safeguards, incident response, assessment and containment, customer notification, notice content, service-provider oversight and 72-hour breach notice, disposal, written compliance records, incident evidence, legal coordination, and recovery validation.

## Corpus composition

- 12 companies
- 12 PDFs
- 4 strong programs, 5 mixed/developing programs, and 3 weak/developing programs
- Registered investment advisers, broker-dealers, transfer agents, registered investment companies, and funding portals
- One integrated policy or procedure per company so each case can run through the current one-document evaluator
- No company name or filename reveals the expected score

## Files

- `documents/` - PDFs to upload
- `manifest.json` - case metadata and expected requirement statuses
- `answer_key.csv` - requirement-level expected status, section, and rationale
- `company_summary.csv` - coverage counts by company
- `baseline_requirements.csv` - strict benchmark definitions and source references
- `inventory.csv` - page counts, sizes, and SHA-256 hashes

## How to use

1. Treat each manifest case as a fresh company/workspace.
2. Upload only the listed PDF for that case.
3. Set the declared `sourceType` so the document is treated as organization evidence.
4. Run Analysis against the current Regulation S-P requirement model.
5. Compare requirement statuses with `answer_key.csv` or `manifest.json`.

This corpus is intentionally broader and more realistic than a one-requirement unit-test corpus. A case may contain strong evidence for one requirement and ordinary gaps in another.

## Baseline highlights

- Written safeguards must address administrative, technical, and physical safeguards.
- Incident response must be designed to detect, respond to, and recover from unauthorized access to or use of customer information.
- Assessment must identify affected customer information systems and information types; containment must prevent further unauthorized access or use.
- Customer notice is presumed unless a reasonable investigation supports a no-notice determination.
- Notice must be sent as soon as practicable and no later than 30 days after awareness.
- Notice content must include the required incident, contact, account, fraud-alert, credit-report, and FTC/usa.gov information.
- Service-provider procedures must include due diligence and monitoring, protection measures, and notice to the institution no later than 72 hours after awareness of a qualifying breach.
- The covered institution remains responsible for customer notice even when a service provider sends it.
- Disposal policies must cover both consumer information and customer information.
- Compliance records and retention periods vary by entity type.

## Important limitations

- All companies, people, systems, and incidents are fictional.
- The corpus is for software testing, not legal advice.
- The manifest schema is deliberately simple and may need a small field-name adapter if the repository's current evaluator schema differs.
- The annual privacy notice exception appears as realistic context in some documents but is not separately scored in the current 11-requirement answer key.
