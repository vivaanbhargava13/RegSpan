# Requirement matching debug evaluation

RegSpan’s requirement matching debug page is available at `/requirement-debug`
for signed-in users. It is an internal prototype for evaluating whether
retrieved chunks look useful for a small Reg S-P baseline. It does not create
final findings, scores, reports, PDFs, or compliance conclusions.

## What it does

1. The browser sends a selected requirement, or `all`, to
   `POST /api/requirement-debug` with the user’s Supabase access token.
2. The server validates the user and resolves the user’s workspace.
3. For each selected requirement, the server uses the existing retrieval helper
   and `match_document_chunks_v1` to fetch top candidate chunks.
4. A deterministic debug grader labels each retrieved chunk as:
   - `direct`
   - `partial`
   - `background`
   - `irrelevant`
5. Requirement status is aggregated from grades:
   - `strong_match`: at least one direct candidate evidence chunk exists
   - `partial_match`: no direct candidate evidence, but multiple partial/background candidates exist
   - `weak_match`: only limited partial/background context exists
   - `no_match`: no useful candidate evidence exists

Status is based on graded evidence, not similarity alone.

## Manual review checklist

For each requirement:

- Confirm direct evidence really addresses the requirement, not just a related
  phrase.
- Confirm partial evidence is not being over-promoted to strong match.
- Confirm background evidence is useful context but not treated as support.
- Confirm ignored candidates are genuinely irrelevant or too generic.
- Check citations: filename, page range, section path, and chunk index should be
  plausible.
- If direct evidence exists outside the top candidates, increase top_k for a
  debug run before tuning chunking or retrieval.

## Baseline requirements included

- Written incident response program
- Unauthorized access detection and escalation
- Customer notification after unauthorized access to sensitive customer information
- Regulator/law enforcement notification where required
- Service provider/vendor incident handling
- Safeguards/access controls for customer information
- Evidence/log preservation
- Remediation and recovery validation

## Reviewer fields to capture manually

Copy these notes into an issue or evaluation document when reviewing a run:

```text
Requirement:
Status shown:
Should status be: strong_match / partial_match / weak_match / no_match
Direct evidence quality: good / weak / wrong / absent
Best citation:
Missing citation expected:
Problem noticed:
Recommended next change:
```

## Red flags

- A requirement is marked strong match without direct candidate evidence.
- Similarity score alone appears to drive status.
- Direct evidence is actually vendor/front matter/background context.
- Chunks cite the wrong workspace, document, page, or section.
- Requirement matching changes retrieval ranking or chunking behavior.

This debug layer is intentionally conservative and should be replaced or
augmented before customer-facing findings are generated.
