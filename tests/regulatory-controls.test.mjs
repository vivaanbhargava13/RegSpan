import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canonicalControlKeyForRequirement,
  regulatoryControlToRegSpRequirement,
} from "../lib/regulatoryControlFramework.ts";
import { aggregateFindingForRequirement } from "../lib/findingsAggregation.ts";
import { REG_SP_REQUIREMENTS } from "../lib/regSpRequirements.ts";

function regulatoryControl(overrides = {}) {
  return {
    id: "control-1",
    controlKey: "incident_assessment_containment_control",
    name: "Incident assessment, containment, and control",
    regulation: "Reg S-P",
    sourceKey: "sec_34_100155",
    category: "Incident response",
    summary: "Assess the nature and scope of unauthorized access and contain the incident.",
    regulatoryRole: "direct_reg_s_p",
    severity: "high",
    status: "active",
    displayOrder: 2,
    metadata: {
      legacy_requirement_id: "unauthorized_access_detection_escalation",
      sourceBasis: "Amended Regulation S-P incident response program elements.",
      retrievalQuery: "unauthorized access assess nature scope contain control",
      evidenceCriteria: {
        lookFor: "Assessment and containment procedures.",
        strongEvidence: "Strong evidence defines assessment and containment.",
        partialEvidence: "Partial evidence mentions one part.",
        missingOrNegativeEvidence: "Missing evidence lacks assessment and containment.",
      },
      directSignals: ["unauthorized access", "contain and control"],
      actionSignals: ["assess", "contain"],
      topicSignals: ["customer information"],
      partialSignals: ["triage"],
      backgroundSignals: ["incident"],
    },
    elements: [
      {
        id: "element-1",
        elementKey: "assesses_scope",
        label: "Assesses the nature and scope of unauthorized access or use",
        description: "Assesses scope.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 1,
        metadata: { signals: ["nature and scope"] },
      },
    ],
    citations: [
      {
        id: "citation-1",
        controlElementId: null,
        sourceChunkId: "source-chunk-1",
        citationType: "primary",
        citationNote: "17 CFR 248.30(a)(3).",
        displayOrder: 1,
        metadata: { evidence_role: "requirement_reference" },
        sourceChunk: {
          id: "source-chunk-1",
          chunkIndex: 0,
          pageStart: 323,
          pageEnd: 326,
          heading: "Incident response program",
          parentHeading: "Final Rule Text",
          sectionPath: "Final Rule Text > Incident Response Program",
          chunkKind: "direct_rule_requirement",
          content: "SEC rule text reference.",
          synopsis: "Incident response program.",
          metadata: { evidence_role: "requirement_reference" },
        },
      },
    ],
    ...overrides,
  };
}

function chunk(overrides = {}) {
  return {
    chunk_id: "chunk-1",
    document_id: "document-1",
    filename: "Incident Response Policy.pdf",
    page_start: 4,
    page_end: 4,
    chunk_index: 1,
    section_path: "Incident Response",
    content_preview:
      "The firm assesses the nature and scope of unauthorized access, identifies affected customer information systems, and takes steps to contain and control the incident.",
    similarity: 0.91,
    evidence_reason: "substantive policy evidence",
    embedding_input: null,
    source_type: "client_policy",
    evidence_role: "organization_evidence",
    rerank_score: 90,
    rerank_reason: "direct signals",
    grade: "direct",
    grade_reason: "The cited text supports the requirement.",
    negative_evidence: false,
    negative_evidence_reason: null,
    evidence_relationship: "supports",
    classifier_confidence: "high",
    requirement_supported: true,
    control_absent_or_out_of_scope: false,
    covered_elements: ["assesses_scope", "customer_information_systems", "containment_control"],
    missing_elements: [],
    vague_elements: [],
    supporting_quote:
      "assesses the nature and scope of unauthorized access, identifies affected customer information systems, and takes steps to contain and control the incident",
    classifier_provider: "heuristic",
    ...overrides,
  };
}

test("DB-backed controls convert to requirement definitions with canonical keys", () => {
  const requirement = regulatoryControlToRegSpRequirement(regulatoryControl());

  assert.equal(requirement.id, "incident_assessment_containment_control");
  assert.equal(requirement.title, "Incident assessment, containment, and control");
  assert.equal(requirement.riskSeverity, "high");
  assert.deepEqual(requirement.requiredElementsForCovered, ["assesses_scope"]);
  assert.deepEqual(requirement.coverageElements[0].signals, ["nature and scope"]);
  assert.match(requirement.retrievalQuery, /unauthorized access/);
});

test("DB-backed service-provider controls require oversight, safeguards, and notice while keeping cooperation optional", () => {
  const providerRequirement = regulatoryControlToRegSpRequirement(regulatoryControl({
    controlKey: "service_provider_incident_oversight_notice",
    name: "Service provider incident oversight and notice",
    elements: [
      {
        id: "element-provider-scope",
        elementKey: "service_provider_scope",
        label: "Requires due diligence and monitoring",
        description: "Provider oversight.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 1,
        metadata: { signals: ["due diligence", "ongoing monitoring"] },
      },
      {
        id: "element-provider-safeguards",
        elementKey: "provider_safeguards",
        label: "Requires provider safeguards",
        description: "Provider safeguards.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 2,
        metadata: { signals: ["protect against unauthorized access"] },
      },
      {
        id: "element-provider-notice",
        elementKey: "notice_to_firm",
        label: "Requires provider notice",
        description: "Provider notice.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 3,
        metadata: { signals: ["notify the firm", "72 hours"] },
      },
      {
        id: "element-provider-cooperation",
        elementKey: "cooperation_remediation",
        label: "Provider cooperation",
        description: "Provider cooperation.",
        required: false,
        evidenceQuestion: null,
        missingIfAbsent: false,
        displayOrder: 4,
        metadata: { signals: ["cooperation"] },
      },
    ],
  }));

  assert.deepEqual(providerRequirement.requiredElementsForCovered, [
    "service_provider_scope",
    "provider_safeguards",
    "notice_to_firm",
  ]);
  assert.deepEqual(providerRequirement.optionalElements, ["cooperation_remediation"]);
});

test("hardcoded fallback framework still exposes the 11 curated controls", () => {
  assert.equal(REG_SP_REQUIREMENTS.length, 11);
  assert.equal(REG_SP_REQUIREMENTS.find((requirement) => requirement.id === "written_incident_response_program")?.riskSeverity, "high");
  assert.equal(REG_SP_REQUIREMENTS.find((requirement) => requirement.id === "evidence_log_preservation")?.riskSeverity, "medium");
  assert.deepEqual(
    REG_SP_REQUIREMENTS.map(canonicalControlKeyForRequirement),
    [
      "written_incident_response_program",
      "incident_assessment_containment_control",
      "customer_notification_unauthorized_access",
      "customer_notification_content",
      "service_provider_incident_oversight_notice",
      "safeguards_customer_information",
      "disposal_consumer_customer_information",
      "written_compliance_records",
      "incident_evidence_log_preservation",
      "response_recovery_remediation_validation",
      "regulator_law_enforcement_notification_coordination",
    ],
  );
});

test("regulatory chunks cannot satisfy client compliance findings", () => {
  const requirement = regulatoryControlToRegSpRequirement(regulatoryControl({
    elements: [
      {
        id: "element-1",
        elementKey: "assesses_scope",
        label: "Assesses the nature and scope of unauthorized access or use",
        description: "Assesses scope.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 1,
        metadata: { signals: ["nature and scope"] },
      },
      {
        id: "element-2",
        elementKey: "customer_information_systems",
        label: "Identifies affected customer information systems or information types",
        description: "Identifies systems.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 2,
        metadata: { signals: ["customer information systems"] },
      },
      {
        id: "element-3",
        elementKey: "containment_control",
        label: "Requires containment or control steps",
        description: "Requires containment.",
        required: true,
        evidenceQuestion: null,
        missingIfAbsent: true,
        displayOrder: 3,
        metadata: { signals: ["contain and control"] },
      },
    ],
  }));
  const reference = chunk({
    chunk_id: "regulatory-source-chunk-1",
    document_id: "sec_34_100155",
    filename: "SEC Release No. 34-100155.pdf",
    source_type: "regulatory_guidance",
    evidence_role: "requirement_reference",
  });

  const referenceOnly = aggregateFindingForRequirement(requirement, [reference]);
  const withClientEvidence = aggregateFindingForRequirement(requirement, [reference, chunk()]);

  assert.equal(referenceOnly.status, "missing");
  assert.equal(referenceOnly.evidence.length, 0);
  assert.match(referenceOnly.rationale, /Public guidance or other reference material was not treated as proof/);
  assert.equal(withClientEvidence.status, "covered");
  assert.equal(withClientEvidence.evidence.length, 1);
  assert.equal(withClientEvidence.evidence[0].chunk_id, "chunk-1");
});

test("retrieval and import paths keep regulatory chunks separate from workspace evidence", async () => {
  const [retrieval, hybrid, importer, seed, migration] = await Promise.all([
    readFile("lib/retrieval.ts", "utf8"),
    readFile("lib/hybridRetrieval.ts", "utf8"),
    readFile("scripts/import-sec-regsp-source.ts", "utf8"),
    readFile("scripts/seed-regsp-regulatory-source.ts", "utf8"),
    readFile("supabase/migrations/017_create_regulatory_source_controls_framework.sql", "utf8"),
  ]);

  assert.match(retrieval, /match_document_chunks_v1/);
  assert.doesNotMatch(retrieval, /regulatory_source_chunks/);
  assert.match(hybrid, /\.from\("document_chunks"\)/);
  assert.doesNotMatch(hybrid, /regulatory_source_chunks/);
  assert.match(importer, /\.from\("regulatory_source_chunks"\)/);
  assert.doesNotMatch(importer, /\.from\("document_chunks"\)/);
  assert.match(importer, /organization_evidence:\s*false/);
  assert.match(seed, /evidence_role:\s*"requirement_reference"/);
  assert.match(migration, /comment on table public\.regulatory_source_chunks/);
});

test("findings generation and Requirements tab prefer DB controls with fallback", async () => {
  const [generator, controlsPage, docs, hashScroller] = await Promise.all([
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("app/(app)/controls/page.tsx", "utf8"),
    readFile("docs/regulatory-source-of-truth.md", "utf8"),
    readFile("components/ControlsHashScroller.tsx", "utf8"),
  ]);

  assert.match(generator, /loadRegSpRequirementsForFindings/);
  assert.match(generator, /evidence_role === "organization_evidence"/);
  assert.match(controlsPage, /loadActiveRegulatoryControls/);
  assert.match(controlsPage, /fallbackControls/);
  assert.match(controlsPage, /Loading Reg S-P requirements/);
  assert.match(controlsPage, /No active Regulation S-P requirements/);
  assert.match(controlsPage, /control\.elements/);
  assert.match(controlsPage, /control\.citations/);
  assert.match(controlsPage, /id=\{controlAnchor\(control\)\}/);
  assert.match(controlsPage, /return `control-\$\{control\.controlKey\}`/);
  assert.match(controlsPage, /<ControlsHashScroller \/>/);
  assert.match(hashScroller, /window\.location\.hash/);
  assert.match(hashScroller, /document\.getElementById\(targetId\)/);
  assert.match(hashScroller, /scrollIntoView/);
  assert.match(docs, /regulatory_source_chunks` are never organization evidence/);
  assert.match(docs, /does not create `document_chunks`/);
});

test("Requirements tab renders human requirement cards without visible raw keys", async () => {
  const [controlsPage, globals] = await Promise.all([
    readFile("app/(app)/controls/page.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.match(controlsPage, /title="Requirements library"/);
  assert.match(controlsPage, /<h2 className="mt-1 text-base font-semibold[^"]*">\s+\{control\.name\}/);
  assert.match(controlsPage, /regulatoryRoleLabel\(control\.regulatoryRole\)/);
  assert.match(controlsPage, /<RiskBadge label=\{`\$\{titleCase\(control\.severity\)\} risk`\} value=\{control\.severity\} \/>/);
  assert.match(controlsPage, /Required elements/);
  assert.match(controlsPage, /SEC basis/);
  assert.match(controlsPage, /riskAccentClass\(control\.severity\)/);
  assert.doesNotMatch(controlsPage, />\{control\.controlKey\}<\/div>/);
  assert.doesNotMatch(controlsPage, /font-mono[^"]*">\{control\.controlKey\}/);
  assert.match(globals, /\.requirement-card\s*\{/);
  assert.match(globals, /scroll-margin-top:\s*7rem/);
  assert.match(globals, /\.requirement-card:target/);
});

test("Requirements tab collapses SEC citation details with unique per-card anchors", async () => {
  const [controlsPage, globals] = await Promise.all([
    readFile("app/(app)/controls/page.tsx", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.match(controlsPage, /<details\s+key=\{citation\.id\}\s+id=\{citationAnchor\(control, citation, citationIndex\)\}/);
  assert.match(controlsPage, /return `citation-\$\{control\.controlKey\}-\$\{citation\.id \|\| citationIndex\}`/);
  assert.match(controlsPage, /<summary className="cursor-pointer list-none rounded-md/);
  assert.match(controlsPage, /View SEC basis/);
  assert.match(controlsPage, /citation\.sourceChunk\?\.content/);
  assert.doesNotMatch(controlsPage, /source-\$\{citation\.sourceChunk\.id\}/);
  assert.match(globals, /\.citation-disclosure > summary::-webkit-details-marker/);
  assert.match(globals, /\.citation-disclosure:target > summary/);
});

test("user-facing navigation labels findings as Analysis, not Gaps", async () => {
  const [sidebar, productPreview] = await Promise.all([
    readFile("components/Sidebar.tsx", "utf8"),
    readFile("components/ProductPreview.tsx", "utf8"),
  ]);

  assert.match(sidebar, /label: "Analysis", href: "\/findings"/);
  assert.doesNotMatch(sidebar, /label: "Gaps"/);
  assert.doesNotMatch(productPreview, /High-Risk Gaps/);
});
