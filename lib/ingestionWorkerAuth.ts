import { createHash, timingSafeEqual } from "node:crypto";

export const MINIMUM_WORKER_SECRET_LENGTH = 32;

export class WorkerSecretConfigurationError extends Error {
  constructor() {
    super("INGESTION_WORKER_SECRET is missing or too short.");
    this.name = "WorkerSecretConfigurationError";
  }
}

export function validateConfiguredWorkerSecret(secret: string | undefined) {
  const normalized = secret?.trim();
  if (!normalized || normalized.length < MINIMUM_WORKER_SECRET_LENGTH) {
    throw new WorkerSecretConfigurationError();
  }
  return normalized;
}

export function isWorkerAuthorizationValid(
  authorization: string | null,
  expectedSecret: string,
) {
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }

  const providedSecret = authorization.slice("Bearer ".length).trim();
  if (!providedSecret) {
    return false;
  }

  const providedDigest = createHash("sha256").update(providedSecret).digest();
  const expectedDigest = createHash("sha256").update(expectedSecret).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

