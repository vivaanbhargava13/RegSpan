import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createWorkspaceExternalAiProcessingPolicy,
  isExternalAiClassifierEnabled,
  isExternalAiProcessingEnabled,
} from "../lib/aiProcessingPolicy.ts";

test("external AI processing policy is disabled unless explicitly enabled", () => {
  assert.equal(isExternalAiProcessingEnabled({}), false);
  assert.equal(isExternalAiProcessingEnabled({ ENABLE_EXTERNAL_AI_PROCESSING: "false" }), false);
  assert.equal(isExternalAiProcessingEnabled({ ENABLE_EXTERNAL_AI_PROCESSING: "TRUE" }), true);
});

test("external AI classifier requires both processing and classifier flags", () => {
  assert.equal(isExternalAiClassifierEnabled({}), false);
  assert.equal(isExternalAiClassifierEnabled({
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
  }), false);
  assert.equal(isExternalAiClassifierEnabled({
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
  }), false);
  assert.equal(isExternalAiClassifierEnabled({
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
  }), true);
});

test("workspace external AI consent is required in addition to server flags", () => {
  const environment = {
    ENABLE_EXTERNAL_AI_PROCESSING: "true",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "true",
  };

  assert.equal(createWorkspaceExternalAiProcessingPolicy({
    workspaceId: "workspace-1",
    workspaceConsentEnabled: false,
    environment,
  }).externalAiProcessingEnabled, false);
  assert.equal(createWorkspaceExternalAiProcessingPolicy({
    workspaceId: "workspace-1",
    workspaceConsentEnabled: true,
    environment: { ENABLE_EXTERNAL_AI_PROCESSING: "false" },
  }).externalAiProcessingEnabled, false);

  const allowed = createWorkspaceExternalAiProcessingPolicy({
    workspaceId: "workspace-1",
    workspaceConsentEnabled: true,
    environment,
  });
  assert.equal(allowed.externalAiProcessingEnabled, true);
  assert.equal(allowed.externalAiClassifierEnabled, true);
  assert.equal(createWorkspaceExternalAiProcessingPolicy({
    workspaceConsentEnabled: true,
    environment,
  }).externalAiProcessingEnabled, false);
});

test("external AI policy flags are server-only and not NEXT_PUBLIC", async () => {
  const [envExample, policy, embeddingCore, chunkContext, classifier, workerRoute, findingsGeneration, clientSources] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("lib/aiProcessingPolicy.ts", "utf8"),
    readFile("lib/embeddingCore.ts", "utf8"),
    readFile("lib/chunkContext.ts", "utf8"),
    readFile("lib/requirementEvidenceClassifier.ts", "utf8"),
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    Promise.all([
      readFile("components/RetrievalDebugClient.tsx", "utf8"),
      readFile("components/RequirementDebugClient.tsx", "utf8"),
      readFile("components/AppShell.tsx", "utf8"),
      readFile("components/Sidebar.tsx", "utf8"),
    ]),
  ]);

  assert.match(envExample, /ENABLE_EXTERNAL_AI_PROCESSING=/);
  assert.match(envExample, /ENABLE_EXTERNAL_AI_CLASSIFIER=/);
  assert.doesNotMatch(envExample, /NEXT_PUBLIC_ENABLE_EXTERNAL_AI/);
  assert.match(policy, /AI processing policy helpers are server-only/);
  assert.match(policy, /loadWorkspaceExternalAiProcessingPolicy/);
  assert.match(policy, /external_ai_processing_enabled/);
  assert.match(embeddingCore, /createWorkspaceExternalAiProcessingPolicy/);
  assert.match(chunkContext, /createWorkspaceExternalAiProcessingPolicy/);
  assert.match(classifier, /createWorkspaceExternalAiProcessingPolicy/);
  assert.match(workerRoute, /loadWorkspaceExternalAiProcessingPolicy/);
  assert.match(findingsGeneration, /loadWorkspaceExternalAiProcessingPolicy/);
  assert.equal(
    clientSources.some((source) => /ENABLE_EXTERNAL_AI_PROCESSING|ENABLE_EXTERNAL_AI_CLASSIFIER/.test(source)),
    false,
  );
});
