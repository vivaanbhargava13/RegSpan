import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkerAuthorizationValid,
  validateConfiguredWorkerSecret,
  WorkerSecretConfigurationError,
} from "../lib/ingestionWorkerAuth.ts";

const validSecret = "worker-secret-with-at-least-32-characters";

test("missing worker configuration is rejected", () => {
  assert.throws(
    () => validateConfiguredWorkerSecret(undefined),
    WorkerSecretConfigurationError,
  );
  assert.throws(
    () => validateConfiguredWorkerSecret("too-short"),
    WorkerSecretConfigurationError,
  );
});

test("missing Authorization header is rejected", () => {
  assert.equal(isWorkerAuthorizationValid(null, validSecret), false);
});

test("invalid bearer secret is rejected", () => {
  assert.equal(
    isWorkerAuthorizationValid("Bearer definitely-not-the-secret", validSecret),
    false,
  );
});

test("valid bearer secret is accepted", () => {
  assert.equal(
    isWorkerAuthorizationValid(`Bearer ${validSecret}`, validSecret),
    true,
  );
});

