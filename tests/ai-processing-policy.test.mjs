import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
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

test("external AI policy flags are server-only and not NEXT_PUBLIC", async () => {
  const [envExample, policy, clientSources] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("lib/aiProcessingPolicy.ts", "utf8"),
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
  assert.equal(
    clientSources.some((source) => /ENABLE_EXTERNAL_AI_PROCESSING|ENABLE_EXTERNAL_AI_CLASSIFIER/.test(source)),
    false,
  );
});
