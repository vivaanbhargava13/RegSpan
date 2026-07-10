import "server-only";

import { createHmac } from "node:crypto";

const N8N_WEBHOOK_TIMEOUT_MS = 10_000;
export const N8N_WEBHOOK_SIGNATURE_ALGORITHM = "sha256";
export const N8N_WEBHOOK_TIMESTAMP_HEADER = "x-regspan-webhook-timestamp";
export const N8N_WEBHOOK_SIGNATURE_HEADER = "x-regspan-webhook-signature";

export type N8nIngestionPayload = {
  jobId: string;
  documentId: string;
  workspaceId: string;
  correlationId: string;
};

export class N8nWebhookError extends Error {
  constructor(
    public readonly kind: "configuration" | "timeout" | "network" | "response",
    public readonly upstreamStatus?: number,
  ) {
    super("The processing webhook could not be triggered.");
    this.name = "N8nWebhookError";
  }
}

function getN8nConfiguration() {
  const configuredUrl = process.env.N8N_INGEST_WEBHOOK_URL?.trim();
  const secret = process.env.N8N_INGEST_WEBHOOK_SECRET?.trim();

  if (!configuredUrl || !secret || secret.length < 32) {
    throw new N8nWebhookError("configuration");
  }

  let url: URL;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new N8nWebhookError("configuration");
  }

  const isLocalDevelopmentUrl =
    process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");

  if (url.protocol !== "https:" && !isLocalDevelopmentUrl) {
    throw new N8nWebhookError("configuration");
  }

  if (url.username || url.password) {
    throw new N8nWebhookError("configuration");
  }

  return { url: url.toString(), secret };
}

export function serializeN8nIngestionPayload(payload: N8nIngestionPayload) {
  return JSON.stringify({
    jobId: payload.jobId,
    documentId: payload.documentId,
    workspaceId: payload.workspaceId,
    correlationId: payload.correlationId,
  });
}

export function signN8nWebhook({
  timestamp,
  rawBody,
  secret,
}: {
  timestamp: string;
  rawBody: string;
  secret: string;
}) {
  const digest = createHmac(N8N_WEBHOOK_SIGNATURE_ALGORITHM, secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `${N8N_WEBHOOK_SIGNATURE_ALGORITHM}=${digest}`;
}

export function createN8nWebhookRequest(payload: N8nIngestionPayload, secret: string) {
  const timestamp = new Date().toISOString();
  const rawBody = serializeN8nIngestionPayload(payload);
  const signature = signN8nWebhook({ timestamp, rawBody, secret });

  return {
    body: rawBody,
    headers: {
      "content-type": "application/json",
      [N8N_WEBHOOK_TIMESTAMP_HEADER]: timestamp,
      [N8N_WEBHOOK_SIGNATURE_HEADER]: signature,
    },
  };
}

export async function triggerN8nIngestion(payload: N8nIngestionPayload) {
  const { url, secret } = getN8nConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_WEBHOOK_TIMEOUT_MS);
  const webhookRequest = createN8nWebhookRequest(payload, secret);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: webhookRequest.headers,
      body: webhookRequest.body,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new N8nWebhookError("response", response.status);
    }

    return { status: response.status };
  } catch (error) {
    if (error instanceof N8nWebhookError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new N8nWebhookError("timeout");
    }
    throw new N8nWebhookError("network");
  } finally {
    clearTimeout(timeout);
  }
}
