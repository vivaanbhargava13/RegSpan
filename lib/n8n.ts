import "server-only";

const N8N_WEBHOOK_TIMEOUT_MS = 10_000;

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

export async function triggerN8nIngestion(payload: N8nIngestionPayload) {
  const { url, secret } = getN8nConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-regspan-webhook-secret": secret,
        "x-regspan-webhook-timestamp": new Date().toISOString(),
      },
      body: JSON.stringify(payload),
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
