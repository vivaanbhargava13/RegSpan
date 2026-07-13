import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadTsModule(sourcePath) {
  const source = await readFile(sourcePath, "utf8");
  const outDir = await mkdtemp(join(tmpdir(), "regspan-source-test-"));
  const outPath = join(outDir, sourcePath.replace(/[\/:]/g, "__").replace(/\.ts$/, ".mjs"));
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: false,
    },
    fileName: sourcePath,
  });
  await writeFile(outPath, transpiled.outputText, "utf8");
  return import(pathToFileURL(outPath).href);
}

test("document source model exposes required source types and evidence roles", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  for (const sourceType of [
    "client_policy",
    "client_procedure",
    "client_standard",
    "vendor_contract",
    "regulatory_guidance",
    "control_framework",
    "sample_template",
    "unknown",
  ]) {
    assert.match(source, new RegExp(`"${sourceType}"`));
  }

  for (const role of [
    "organization_evidence",
    "requirement_reference",
    "supporting_context",
  ]) {
    assert.match(source, new RegExp(`"${role}"`));
  }
});

test("guidance and framework publishers are classified away from client policy evidence", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  assert.match(source, /nist/);
  assert.match(source, /ffiec/);
  assert.match(source, /ftc/);
  assert.match(source, /cisa/);
  assert.match(source, /finra/);
  assert.match(source, /federal government/);
  assert.match(source, /return "control_framework"/);
  assert.match(source, /return "regulatory_guidance"/);

  const frameworkBlock = source.slice(
    source.indexOf("const controlFrameworkSignals"),
    source.indexOf("const sampleTemplateSignals"),
  );
  assert.doesNotMatch(frameworkBlock, /return "client_policy"/);
});

test("public guidance and framework documents do not become organization evidence", async () => {
  const {
    inferDocumentSourceType,
    evidenceRoleForSourceType,
  } = await loadTsModule("lib/documentSource.ts");

  const cases = [
    {
      filename: "NIST SP 800-61 Computer Security Incident Handling Guide.pdf",
      documentType: "Policy",
      expected: "control_framework",
    },
    {
      filename: "FFIEC Cybersecurity Assessment Tool.pdf",
      documentType: "Procedure",
      expected: "control_framework",
    },
    {
      filename: "FTC Safeguards Rule compliance guide.pdf",
      documentType: "Policy",
      expected: "regulatory_guidance",
    },
    {
      filename: "FINRA Core Cybersecurity Controls.pdf",
      documentType: "Procedure",
      expected: "control_framework",
    },
    {
      filename: "CISA Federal Government Cybersecurity Incident and Vulnerability Response Playbooks.pdf",
      documentType: "Incident Response Plan",
      expected: "regulatory_guidance",
    },
  ];

  for (const item of cases) {
    const sourceType = inferDocumentSourceType(item);
    assert.equal(sourceType, item.expected);
    assert.equal(evidenceRoleForSourceType(sourceType), "requirement_reference");
    assert.notEqual(sourceType, "client_policy");
    assert.notEqual(sourceType, "client_procedure");
  }
});

test("public documents keep public-reference precedence over organization metadata", async () => {
  const {
    inferDocumentSourceType,
    inferEvidenceRole,
  } = await loadTsModule("lib/documentSource.ts");

  const sourceType = inferDocumentSourceType({
    filename: "FINRA Core Cybersecurity Controls.pdf",
    documentType: "Source type: client policy",
    notes: "User verified this uploaded file is the organization's adopted source_type: client_policy.",
  });

  assert.equal(sourceType, "control_framework");
  assert.equal(inferEvidenceRole({
    filename: "FINRA Core Cybersecurity Controls.pdf",
    documentType: "Source type: client policy",
    notes: "User verified this uploaded file is the organization's adopted source_type: client_policy.",
  }), "requirement_reference");
});

test("client policy metadata is not overridden by incidental public-reference text", async () => {
  const {
    inferDocumentSourceType,
    evidenceRoleForSourceType,
  } = await loadTsModule("lib/documentSource.ts");

  const sourceType = inferDocumentSourceType({
    filename: "Customer Incident Response Policy.pdf",
    documentType: "Policy",
    contentPreview:
      "The privacy team may notify regulators, law enforcement, or the federal government when required by law.",
  });

  assert.equal(sourceType, "client_policy");
  assert.equal(evidenceRoleForSourceType(sourceType), "organization_evidence");
});

test("server-persisted client provenance remains authoritative during retrieval hydration", async () => {
  const { resolvePersistedDocumentChunkProvenance } = await loadTsModule("lib/documentSource.ts");

  const clientPolicy = resolvePersistedDocumentChunkProvenance({
    metadata: {
      document_id: "document-a",
      workspace_id: "workspace-a",
      source_type: "client_policy",
      evidence_role: "organization_evidence",
    },
    documentId: "document-a",
    workspaceId: "workspace-a",
    fallback: {
      filename: "Customer Notice Policy.pdf",
      documentType: "Policy",
      contentPreview: "The notice includes FTC and usa.gov identity-theft guidance.",
    },
  });
  const clientProcedure = resolvePersistedDocumentChunkProvenance({
    metadata: {
      document_id: "document-b",
      workspace_id: "workspace-a",
      source_type: "client_procedure",
      evidence_role: "organization_evidence",
    },
    documentId: "document-b",
    workspaceId: "workspace-a",
    fallback: {
      filename: "Customer Notice Procedure.pdf",
      documentType: "Procedure",
      contentPreview: "Follow FTC and usa.gov guidance when preparing customer notices.",
    },
  });

  assert.deepEqual(clientPolicy, {
    sourceType: "client_policy",
    evidenceRole: "organization_evidence",
    source: "persisted",
  });
  assert.deepEqual(clientProcedure, {
    sourceType: "client_procedure",
    evidenceRole: "organization_evidence",
    source: "persisted",
  });
});

test("server-persisted regulatory provenance remains excluded from client evidence", async () => {
  const { resolvePersistedDocumentChunkProvenance } = await loadTsModule("lib/documentSource.ts");
  const provenance = resolvePersistedDocumentChunkProvenance({
    metadata: {
      document_id: "document-a",
      workspace_id: "workspace-a",
      source_type: "regulatory_guidance",
      evidence_role: "requirement_reference",
    },
    documentId: "document-a",
    workspaceId: "workspace-a",
    fallback: {
      filename: "Customer Incident Response Policy.pdf",
      documentType: "Source type: client policy",
      contentPreview: "FTC guidance describes customer notification content.",
    },
  });

  assert.deepEqual(provenance, {
    sourceType: "regulatory_guidance",
    evidenceRole: "requirement_reference",
    source: "persisted",
  });
});

test("invalid or unscoped provenance falls back to server-side inference", async () => {
  const { resolvePersistedDocumentChunkProvenance } = await loadTsModule("lib/documentSource.ts");
  const fallback = {
    filename: "FTC Safeguards Rule compliance guide.pdf",
    documentType: "Source type: client policy",
    contentPreview: "FTC guidance for covered institutions.",
  };

  const malformed = resolvePersistedDocumentChunkProvenance({
    metadata: {
      document_id: "document-a",
      workspace_id: "workspace-a",
      source_type: "regulatory_guidance",
      evidence_role: "organization_evidence",
    },
    documentId: "document-a",
    workspaceId: "workspace-a",
    fallback,
  });
  const unscoped = resolvePersistedDocumentChunkProvenance({
    metadata: {
      document_id: "another-document",
      workspace_id: "workspace-a",
      source_type: "client_policy",
      evidence_role: "organization_evidence",
    },
    documentId: "document-a",
    workspaceId: "workspace-a",
    fallback,
  });
  const missing = resolvePersistedDocumentChunkProvenance({
    metadata: null,
    documentId: "document-a",
    workspaceId: "workspace-a",
    fallback,
  });

  for (const provenance of [malformed, unscoped, missing]) {
    assert.equal(provenance.source, "inferred");
    assert.equal(provenance.sourceType, "regulatory_guidance");
    assert.equal(provenance.evidenceRole, "requirement_reference");
  }
});

test("explicit document text metadata classifies client and vendor documents", async () => {
  const {
    inferDocumentSourceType,
    inferEvidenceRole,
  } = await loadTsModule("lib/documentSource.ts");

  const clientPolicy = {
    filename: "Larkspur_Response_Limitations.pdf",
    contentPreview:
      "Document class Client policy. Evidence role Organization evidence. This document describes limitations.",
  };
  assert.equal(inferDocumentSourceType(clientPolicy), "client_policy");
  assert.equal(inferEvidenceRole(clientPolicy), "organization_evidence");

  const clientProcedure = {
    filename: "Harborview_Procedure.pdf",
    contentPreview:
      "Document class Client procedure. Evidence role Organization evidence. Procedure scope and steps.",
  };
  assert.equal(inferDocumentSourceType(clientProcedure), "client_procedure");
  assert.equal(inferEvidenceRole(clientProcedure), "organization_evidence");

  const clientStandard = {
    filename: "Elm_Ridge_Standard.pdf",
    contentPreview:
      "Source type: client standard. Evidence role Organization evidence. Required controls are documented.",
  };
  assert.equal(inferDocumentSourceType(clientStandard), "client_standard");
  assert.equal(inferEvidenceRole(clientStandard), "organization_evidence");

  const vendorAddendum = {
    filename: "AtlasPay_Third_Party_Security_Incident_Addendum.pdf",
    contentPreview:
      "Document class Vendor contract addendum. Evidence role Organization evidence. Supplier incident notice and cooperation obligations. This is not a full internal incident response policy.",
  };
  assert.equal(inferDocumentSourceType(vendorAddendum), "vendor_contract");
  assert.equal(inferEvidenceRole(vendorAddendum), "organization_evidence");
});

test("client policy, procedure, and vendor contract sources map to organization evidence", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  assert.match(source, /clientPolicySignals/);
  assert.match(source, /clientProcedureSignals/);
  assert.match(source, /vendorContractSignals/);
  assert.match(source, /sourceType === "client_policy"/);
  assert.match(source, /sourceType === "client_procedure"/);
  assert.match(source, /sourceType === "client_standard"/);
  assert.match(source, /sourceType === "vendor_contract"/);
  assert.match(source, /return "organization_evidence"/);
});

test("unknown normal documents remain supporting context", async () => {
  const {
    inferDocumentSourceType,
    inferEvidenceRole,
  } = await loadTsModule("lib/documentSource.ts");
  const document = {
    filename: "uploaded-document.pdf",
    documentType: "Information Security",
    notes: "",
  };
  assert.equal(inferDocumentSourceType(document), "unknown");
  assert.equal(inferEvidenceRole(document), "supporting_context");
});

test("guidance and framework source types map to requirement reference role", async () => {
  const source = await readFile("lib/documentSource.ts", "utf8");

  assert.match(source, /sourceType === "regulatory_guidance" \|\| sourceType === "control_framework"/);
  assert.match(source, /return "requirement_reference"/);
  assert.match(source, /return "supporting_context"/);
});
