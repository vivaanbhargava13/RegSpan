import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildDeterministicChunks,
  HARD_MAX_CHUNK_TOKENS,
} from "../lib/pdfProcessingCore.ts";

const identifiers = {
  documentId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000002",
  jobId: "30000000-0000-4000-8000-000000000003",
  filename: "incident-response-policy.pdf",
};

function build(pages) {
  return buildDeterministicChunks({ pages, ...identifiers });
}

test("numbered headings create meaningful section paths and hierarchy", () => {
  const result = build([{ pageNumber: 1, text: [
    "1. Incident Response",
    "",
    "The Firm maintains procedures for responding to customer information incidents.",
    "",
    "1.1 Customer Notification",
    "",
    "The response team evaluates whether customer notice is required.",
    "",
    "- Notify affected customers promptly.",
    "- Describe the nature and timing of the incident.",
    "- Provide a contact for additional information.",
  ].join("\n") }]);

  const notificationChunk = result.chunks.find(
    (chunk) => chunk.section_heading === "1.1 Customer Notification",
  );
  assert.ok(notificationChunk);
  assert.equal(notificationChunk.parent_heading, "1. Incident Response");
  assert.equal(
    notificationChunk.section_path,
    "1. Incident Response > 1.1 Customer Notification",
  );
  assert.match(notificationChunk.content, /- Notify affected customers promptly\./);
  assert.match(notificationChunk.content, /- Provide a contact for additional information\./);
  assert.doesNotMatch(notificationChunk.content, /Filename:/);
  assert.notEqual(
    notificationChunk.metadata.content_hash,
    notificationChunk.metadata.source_content_hash,
  );
  assert.match(
    notificationChunk.metadata.embedding_input,
    /Section: 1\. Incident Response > 1\.1 Customer Notification/,
  );
  assert.equal(notificationChunk.metadata.evidence_class, "evidence");
  assert.equal(notificationChunk.metadata.evidence_reason, "substantive_requirement_or_procedure");
  assert.equal(notificationChunk.metadata.classification_version, "evidence-v2");
  assert.equal(notificationChunk.metadata.retrieval_included, true);
  assert.equal(notificationChunk.metadata.retrieval_excluded, false);
  assert.equal("evidence_classification" in notificationChunk.metadata, false);

  const incidentNode = result.hierarchy.headings.find(
    (heading) => heading.heading === "1. Incident Response",
  );
  assert.ok(incidentNode);
  assert.equal(incidentNode.children[0].heading, "1.1 Customer Notification");
});

test("uppercase, title-case, Roman, and lettered headings are detected", () => {
  const result = build([{ pageNumber: 1, text: [
    "I. GOVERNANCE",
    "",
    "Governance requirements establish accountable policy ownership.",
    "",
    "A. Roles and Responsibilities",
    "",
    "The security officer coordinates annual policy review.",
    "",
    "Access Control Standards",
    "",
    "Access is reviewed according to documented standards.",
  ].join("\n") }]);

  const lettered = result.chunks.find(
    (chunk) => chunk.section_heading === "A. Roles and Responsibilities",
  );
  const titleCase = result.chunks.find(
    (chunk) => chunk.section_heading === "Access Control Standards",
  );
  assert.equal(lettered?.parent_heading, "I. GOVERNANCE");
  assert.equal(lettered?.section_path, "I. GOVERNANCE > A. Roles and Responsibilities");
  assert.equal(titleCase?.section_path, "Access Control Standards");
});

test("policy-style headings infer parent and sibling context", () => {
  const result = build([{ pageNumber: 1, text: [
    "Incident Response",
    "",
    "The incident team coordinates containment and recovery.",
    "",
    "Customer Notification",
    "",
    "Customers receive notice when required by applicable law.",
    "",
    "Vendor Oversight",
    "",
    "Service providers are reviewed before handling customer information.",
  ].join("\n") }]);

  const customer = result.chunks.find((chunk) => chunk.section_heading === "Customer Notification");
  const vendor = result.chunks.find((chunk) => chunk.section_heading === "Vendor Oversight");
  assert.equal(customer?.section_path, "Incident Response > Customer Notification");
  assert.equal(customer?.parent_heading, "Incident Response");
  assert.equal(vendor?.section_path, "Vendor Oversight");
  assert.equal(vendor?.parent_heading, "Document");
});

test("short bullet and numbered lists stay together", () => {
  const result = build([{ pageNumber: 1, text: [
    "2. Response Procedures",
    "",
    "The response team will:",
    "",
    "1. Confirm the event scope.",
    "2. Preserve relevant records.",
    "3. Notify the response lead.",
    "4. Record the final disposition.",
  ].join("\n") }]);

  assert.equal(result.chunks.length, 1);
  for (const item of [
    "1. Confirm the event scope.",
    "2. Preserve relevant records.",
    "3. Notify the response lead.",
    "4. Record the final disposition.",
  ]) {
    assert.match(result.chunks[0].content, new RegExp(item.replaceAll(".", "\\.")));
  }
});

test("consecutive numbered list items are not mistaken for headings", () => {
  const result = build([{ pageNumber: 1, text: [
    "2. Response Procedures",
    "",
    "Complete each response action in order.",
    "",
    "1. Confirm Event Scope",
    "2. Preserve Relevant Records",
    "3. Notify the Response Lead",
  ].join("\n") }]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "2. Response Procedures");
  assert.match(result.chunks[0].content, /1\. Confirm Event Scope\n2\. Preserve Relevant Records\n3\. Notify the Response Lead/);
});

test("long sections split at paragraph boundaries with bounded overlap", () => {
  const paragraphs = Array.from({ length: 42 }, (_, index) =>
    `Control paragraph ${index + 1}. The response team documents evidence, assigns ownership, validates escalation timing, and preserves customer notification records for reviewer verification.`,
  );
  const input = [{
    pageNumber: 1,
    text: ["3. Incident Documentation", "", ...paragraphs.flatMap((paragraph) => [paragraph, ""])].join("\n"),
  }];
  const first = build(input);
  const retry = build(input);

  assert.ok(first.chunks.length > 1);
  assert.deepEqual(retry, first);
  assert.equal(first.chunks.every((chunk) => chunk.token_estimate <= HARD_MAX_CHUNK_TOKENS), true);
  assert.equal(first.chunks.every((chunk) => chunk.section_heading === "3. Incident Documentation"), true);
  assert.equal(first.chunks[0].section_chunk_start, 0);
  assert.equal(first.chunks.at(-1).section_chunk_end, first.chunks.length - 1);

  const hasParagraphOverlap = first.chunks.slice(1).some((chunk, index) => {
    const priorParagraphs = new Set(first.chunks[index].content.split("\n\n"));
    return chunk.content.split("\n\n").some((paragraph) => priorParagraphs.has(paragraph));
  });
  assert.equal(hasParagraphOverlap, true);
});

test("sections can span pages while preserving citation ranges and offsets", () => {
  const pageOne = "4. Recovery\n\nRecovery begins after containment is verified and documented.";
  const pageTwo = "The response lead validates restoration and records all follow-up actions.";
  const result = build([
    { pageNumber: 1, text: pageOne },
    { pageNumber: 2, text: pageTwo },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].page_start, 1);
  assert.equal(result.chunks[0].page_end, 2);
  assert.equal(result.chunks[0].char_start, 0);
  assert.equal(result.chunks[0].char_end, pageOne.length + 2 + pageTwo.length);
  assert.match(result.chunks[0].metadata.embedding_input, /Citation: Pages 1-2/);
});

test("compatible short context sections merge without altering source text", () => {
  const result = build([{ pageNumber: 1, text: [
    "Purpose",
    "",
    "This policy protects customer information.",
    "",
    "Scope",
    "",
    "This policy applies to all business units.",
  ].join("\n") }]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Purpose / Scope");
  assert.match(result.chunks[0].content, /^Purpose/);
  assert.match(result.chunks[0].content, /Scope\n\nThis policy applies/);
  assert.doesNotMatch(result.chunks[0].content, /Parent heading:|Citation:/);
});

test("CISA boilerplate and footnotes are removed before evidence chunking", () => {
  const result = build([
    { pageNumber: 7, text: [
      "TLP:CLEAR",
      "INCIDENT RESPONSE PLAYBOOK",
      "",
      "Preparation Activities",
      "",
      "Policies and Procedures",
      "",
      "Organizations should maintain documented incident response policies and procedures.",
      "",
      "5 NIST SP 800-61, Computer Security Incident Handling Guide.",
      "",
      "CISA | Cybersecurity and Infrastructure Security Agency 7",
    ].join("\n") },
    { pageNumber: 8, text: [
      "TLP:CLEAR",
      "INCIDENT RESPONSE PLAYBOOK",
      "Preparation Activities",
      "",
      "Cyber Threat Intelligence",
      "",
      "The incident response team should incorporate current threat intelligence into preparation activities.",
      "",
      "10 See Best Practices for Event Logging and Threat Detection.",
      "",
      "CISA | Cybersecurity and Infrastructure Security Agency 8",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 2);
  assert.equal(
    result.chunks[0].section_path,
    "INCIDENT RESPONSE PLAYBOOK > Preparation Activities > Policies and Procedures",
  );
  assert.equal(
    result.chunks[1].section_path,
    "INCIDENT RESPONSE PLAYBOOK > Preparation Activities > Cyber Threat Intelligence",
  );
  for (const chunk of result.chunks) {
    assert.doesNotMatch(chunk.content, /TLP:CLEAR|Cybersecurity and Infrastructure Security Agency|NIST SP 800-61|See Best Practices/);
    assert.equal(chunk.metadata.is_boilerplate, false);
    assert.equal(chunk.metadata.is_toc, false);
    assert.equal(chunk.metadata.is_footnote, false);
    assert.equal(chunk.metadata.retrieval_excluded, false);
    assert.equal(chunk.metadata.retrieval_included, true);
    assert.notEqual(chunk.content.trim(), chunk.section_heading);
  }
  assert.equal(result.hierarchy.cleanup.boilerplate_lines_removed, 4);
  assert.equal(result.hierarchy.cleanup.footnote_lines_removed, 2);
});

test("table of contents pages are excluded from evidence and embeddings", () => {
  const result = build([
    { pageNumber: 2, text: [
      "TABLE OF CONTENTS",
      "Incident Response Playbook ........ 4",
      "Preparation Activities ........ 7",
      "Detection & Analysis ........ 18",
      "Containment ........ 27",
      "Eradication & Recovery ........ 31",
      "CISA | Cybersecurity and Infrastructure Security Agency 2",
    ].join("\n") },
    { pageNumber: 18, text: [
      "INCIDENT RESPONSE PLAYBOOK",
      "",
      "Detection & Analysis",
      "",
      "The organization should validate alerts, document incident scope, and preserve supporting evidence.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(
    result.chunks[0].section_path,
    "INCIDENT RESPONSE PLAYBOOK > Detection & Analysis",
  );
  assert.equal(result.chunks[0].page_start, 18);
  assert.doesNotMatch(result.chunks[0].content, /TABLE OF CONTENTS|Preparation Activities \.{2,}/);
  assert.deepEqual(result.hierarchy.cleanup.toc_pages_excluded, [2]);
});

test("playbook phase hierarchy survives heading-only parents", () => {
  const result = build([
    { pageNumber: 31, text: [
      "VULNERABILITY RESPONSE PLAYBOOK",
      "",
      "Remediation",
      "",
      "Organizations should prioritize remediation using risk, exposure, and operational impact.",
    ].join("\n") },
    { pageNumber: 40, text: [
      "APPENDIX A",
      "",
      "Coordination",
      "",
      "Response teams should establish coordination channels before an incident occurs.",
    ].join("\n") },
  ]);

  assert.equal(
    result.chunks[0].section_path,
    "VULNERABILITY RESPONSE PLAYBOOK > Remediation",
  );
  assert.equal(result.chunks[1].section_path, "APPENDIX A > Coordination");
  assert.equal(result.chunks.some((chunk) => chunk.content.trim() === chunk.section_heading), false);
});

test("repeated confidentiality footers are learned from incident policy pages", () => {
  const footer = "Northstar Security Program | Internal Distribution";
  const result = build([
    { pageNumber: 1, text: [
      "Incident Response",
      "",
      "Customer Notification",
      "",
      "The organization evaluates notification duties after confirming an incident.",
      "",
      `${footer} 1`,
    ].join("\n") },
    { pageNumber: 2, text: [
      "Incident Response",
      "",
      "Escalation",
      "",
      "The response lead escalates material incidents to executive management.",
      "",
      `${footer} 2`,
    ].join("\n") },
    { pageNumber: 3, text: [
      "Incident Response",
      "",
      "Recovery",
      "",
      "Recovery activities are validated before normal operations resume.",
      "",
      `${footer} 3`,
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 3);
  assert.equal(result.chunks.every((chunk) => !chunk.content.includes(footer)), true);
  assert.equal(result.chunks.every((chunk) => chunk.section_path.startsWith("Incident Response > ")), true);
  assert.equal(result.hierarchy.cleanup.boilerplate_lines_removed, 3);
});

test("vendor policy TOC and standalone page numbers are removed generically", () => {
  const result = build([
    { pageNumber: 1, text: [
      "Contents",
      "1. Vendor Oversight ........ 3",
      "1.1 Due Diligence ........ 4",
      "1.2 Contract Controls ........ 6",
      "1.3 Ongoing Monitoring ........ 8",
      "1",
    ].join("\n") },
    { pageNumber: 3, text: [
      "1. Vendor Oversight",
      "",
      "The organization maintains risk-based oversight of service providers.",
      "",
      "3",
    ].join("\n") },
    { pageNumber: 4, text: [
      "1.1 Due Diligence",
      "",
      "Reviewers assess security, privacy, resilience, and subcontractor risks before approval.",
      "",
      "4",
    ].join("\n") },
  ]);

  assert.deepEqual(result.hierarchy.cleanup.toc_pages_excluded, [1]);
  assert.equal(result.chunks.every((chunk) => !/^\d+$/.test(chunk.content.trim())), true);
  assert.equal(result.chunks.some((chunk) => chunk.section_path === "1. Vendor Oversight > 1.1 Due Diligence"), true);
});

test("regulatory citation footnotes are ignored without publisher-specific rules", () => {
  const result = build([
    { pageNumber: 10, text: [
      "1. Scope",
      "",
      "Covered institutions must maintain safeguards appropriate to the sensitivity of customer information.",
      "",
      "1 17 C.F.R. § 248.30(a).",
    ].join("\n") },
    { pageNumber: 11, text: [
      "2. Risk Assessment",
      "",
      "The written program should identify reasonably foreseeable internal and external risks.",
      "",
      "2 Smith et al., Information Security Law Review, vol. 12, no. 3.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 2);
  assert.equal(result.chunks.some((chunk) => /C\.F\.R\.|Smith et al\.|vol\. 12/.test(chunk.content)), false);
  assert.equal(result.chunks.some((chunk) => /^\d+\s/.test(chunk.section_heading)), false);
  assert.equal(result.hierarchy.cleanup.footnote_lines_removed, 2);
});

test("numeric and risk-column table fragments do not become evidence headings", () => {
  const result = build([
    { pageNumber: 1, text: [
      "Network Architecture",
      "",
      "20 connections)",
      "Low Medium High",
      "AC-1",
      "100 access points)",
    ].join("\n") },
    { pageNumber: 2, text: [
      "Access Control Requirements",
      "",
      "The organization shall review privileged access every quarter and document approvals.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Access Control Requirements");
  assert.equal(result.chunks.some((chunk) => /20 connections\)|100 access points\)|Low Medium High/.test(chunk.section_path)), false);
  assert.equal(result.hierarchy.cleanup.excluded_candidates.table_fragment, 1);
});

test("checkbox artifacts are removed from headings without rewriting cited source text", () => {
  const result = build([{ pageNumber: 1, text: [
    "0 0 Patch Maintenance",
    "",
    "Administrators shall install critical security patches within the approved remediation window.",
  ].join("\n") }]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Patch Maintenance");
  assert.equal(result.chunks[0].section_path, "Patch Maintenance");
  assert.match(result.chunks[0].content, /^0 0 Patch Maintenance/);
});

test("publication metadata is excluded while later policy guidance remains evidence", () => {
  const result = build([
    { pageNumber: 1, text: [
      "CYBERSECURITY PRACTICE GUIDE",
      "",
      "Publication Date: June 2026",
      "Prepared by Example Research Group",
      "Document ID: 2026-04",
      "Available at https://example.invalid/publications",
      "Copyright 2026. All rights reserved.",
    ].join("\n") },
    { pageNumber: 3, text: [
      "Risk Assessment",
      "",
      "The organization must assess foreseeable threats and document the safeguards selected to address them.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Risk Assessment");
  assert.doesNotMatch(result.chunks[0].content, /Publication Date|Document ID|All rights reserved/);
  assert.equal(result.hierarchy.cleanup.excluded_candidates.front_matter, 1);
});

test("contact blocks are excluded but incident notification procedures remain evidence", () => {
  const result = build([
    { pageNumber: 4, text: [
      "Contact Us",
      "",
      "Example Security Office",
      "100 Market Street, Suite 400",
      "Arlington, VA 22201",
      "Phone: 202-555-0147",
      "Email: publications@example.invalid",
    ].join("\n") },
    { pageNumber: 5, text: [
      "Incident Notification",
      "",
      "Personnel must report a suspected security incident to the response team at incidents@example.invalid within one hour.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Incident Notification");
  assert.match(result.chunks[0].content, /must report a suspected security incident/);
  assert.doesNotMatch(result.chunks[0].content, /100 Market Street|publications@example/);
  assert.equal(result.hierarchy.cleanup.excluded_candidates.contact_block, 1);
});

test("acronym, reference, and back-matter candidates do not pollute evidence", () => {
  const result = build([
    { pageNumber: 8, text: [
      "Security Controls",
      "",
      "The organization shall implement multifactor authentication for privileged and remote access.",
    ].join("\n") },
    { pageNumber: 9, text: [
      "Acronyms",
      "",
      "MFA - Multifactor Authentication",
      "IAM - Identity and Access Management",
      "SOC - Security Operations Center",
    ].join("\n") },
    { pageNumber: 10, text: [
      "References",
      "",
      "Security Controls Catalogue, vol. 2, no. 4.",
      "Risk Management Guide, available at https://example.invalid/guide.",
      "Privacy Engineering Review, doi:10.1000/example.",
    ].join("\n") },
    { pageNumber: 11, text: [
      "About the Authors",
      "",
      "The editorial group includes researchers and technical reviewers.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Security Controls");
  assert.equal(result.hierarchy.cleanup.excluded_candidates.acronym_glossary, 1);
  assert.equal(result.hierarchy.cleanup.excluded_candidates.references, 1);
  assert.equal(result.hierarchy.cleanup.excluded_candidates.back_matter, 1);
});

test("substantive control rows remain evidence under the nearest real section", () => {
  const result = build([{ pageNumber: 6, text: [
    "Access Controls",
    "",
    "Low Medium High",
    "AC-1 | The organization shall approve access before granting credentials.",
    "AC-2 | Administrators must review privileged accounts every quarter.",
  ].join("\n") }]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Access Controls");
  assert.equal(result.chunks[0].section_path, "Access Controls");
  assert.match(result.chunks[0].content, /AC-1 \| The organization shall approve access/);
  assert.match(result.chunks[0].content, /AC-2 \| Administrators must review/);
  assert.equal(result.chunks[0].metadata.evidence_class, "evidence");
  assert.equal(result.chunks[0].metadata.evidence_reason, "substantive_requirement_or_procedure");
  assert.equal(result.chunks[0].metadata.retrieval_included, true);
});

test("broken, truncated, and split repeated edge fragments are removed generically", () => {
  const result = build([
    { pageNumber: 1, text: [
      "SEC.PUB.800",
      "Access Control",
      "",
      "The organization shall review administrative access every quarter.",
      "",
      "Security Publication Series 800 | 1",
    ].join("\n") },
    { pageNumber: 2, text: [
      "SEC.PUB.800",
      "Monitoring",
      "",
      "The organization must monitor privileged sessions for unauthorized activity.",
      "",
      "ecurity Publication Series 800 | 2",
    ].join("\n") },
    { pageNumber: 3, text: [
      "SEC.PUB.800",
      "Incident Reporting",
      "",
      "Personnel must report suspected incidents through the approved escalation channel.",
      "",
      "Security Publication",
      "Series 800 | 3",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 2);
  for (const chunk of result.chunks) {
    assert.doesNotMatch(chunk.content, /SEC\.PUB\.800|Security Publication|ecurity Publication|Series 800/);
    assert.doesNotMatch(chunk.section_path, /SEC\.PUB\.800|Publication Series/);
  }
  assert.ok(result.hierarchy.cleanup.boilerplate_lines_removed >= 7);
});

test("single acronym expansions and standalone reference links are not evidence chunks", () => {
  const result = build([
    { pageNumber: 1, text: "MFA - Multifactor Authentication" },
    { pageNumber: 2, text: "https://example.invalid/security-guide" },
    { pageNumber: 3, text: [
      "Authentication Requirements",
      "",
      "The organization shall require multifactor authentication for privileged access.",
    ].join("\n") },
  ]);

  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].section_heading, "Authentication Requirements");
  assert.doesNotMatch(result.chunks[0].content, /Multifactor Authentication|example\.invalid/);
  assert.equal(result.hierarchy.cleanup.excluded_candidates.references, 1);
});

test("cleanup implementation contains no agency- or filename-specific rule", async () => {
  const source = await readFile("lib/pdfProcessingCore.ts", "utf8");
  assert.doesNotMatch(source, /Cybersecurity and Infrastructure Security Agency/);
  assert.doesNotMatch(source, /CISA_FOOTER_PATTERN/);
  assert.doesNotMatch(source, /NIST\b/);
  assert.doesNotMatch(source, /cisa.*\.pdf/i);
});
