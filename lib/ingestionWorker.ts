import "server-only";

import {
  isWorkerAuthorizationValid,
  validateConfiguredWorkerSecret,
} from "@/lib/ingestionWorkerAuth";

export function authenticateIngestionWorker(request: Request) {
  const expectedSecret = validateConfiguredWorkerSecret(
    process.env.INGESTION_WORKER_SECRET,
  );
  return isWorkerAuthorizationValid(
    request.headers.get("authorization"),
    expectedSecret,
  );
}

