import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function importN8nModule() {
  const source = (await readFile("lib/n8n.ts", "utf8")).replace(/^import "server-only";\n/, "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: "lib/n8n.ts",
  }).outputText;
  const outDir = await mkdtemp(join(tmpdir(), "regspan-n8n-test-"));
  const outPath = join(outDir, "n8n.mjs");
  await writeFile(outPath, transpiled, "utf8");
  return import(pathToFileURL(outPath).href);
}

const payload = {
  jobId: "00000000-0000-4000-8000-000000000001",
  documentId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  correlationId: "correlation-test",
};

const secret = "n8n-signing-secret-with-at-least-32-characters";
const timestamp = "2026-07-10T12:00:00.000Z";

test("n8n webhook serializes the safe handoff body deterministically", async () => {
  const { serializeN8nIngestionPayload } = await importN8nModule();
  const body = serializeN8nIngestionPayload({
    ...payload,
    jwt: "forbidden",
    storagePath: "forbidden",
    rawText: "forbidden",
    embedding: [1, 2, 3],
  });

  assert.equal(
    body,
    '{"jobId":"00000000-0000-4000-8000-000000000001","documentId":"00000000-0000-4000-8000-000000000002","workspaceId":"00000000-0000-4000-8000-000000000003","correlationId":"correlation-test"}',
  );
  const parsed = JSON.parse(body);
  assert.deepEqual(Object.keys(parsed), ["jobId", "documentId", "workspaceId", "correlationId"]);
  assert.doesNotMatch(
    body,
    /jwt|service|OpenAI|raw|signed|storage|path|text|chunk|embedding|pdf/i,
  );
});

test("n8n webhook HMAC signs timestamp dot raw body", async () => {
  const { serializeN8nIngestionPayload, signN8nWebhook } = await importN8nModule();
  const rawBody = serializeN8nIngestionPayload(payload);
  const expected = `sha256=${
    createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  }`;

  assert.equal(signN8nWebhook({ timestamp, rawBody, secret }), expected);
});

test("n8n webhook signature changes when body or timestamp changes", async () => {
  const { serializeN8nIngestionPayload, signN8nWebhook } = await importN8nModule();
  const rawBody = serializeN8nIngestionPayload(payload);
  const signature = signN8nWebhook({ timestamp, rawBody, secret });
  const changedBody = serializeN8nIngestionPayload({
    ...payload,
    correlationId: "changed-correlation",
  });
  const changedTimestamp = "2026-07-10T12:01:00.000Z";

  assert.notEqual(
    signN8nWebhook({ timestamp, rawBody: changedBody, secret }),
    signature,
  );
  assert.notEqual(
    signN8nWebhook({ timestamp: changedTimestamp, rawBody, secret }),
    signature,
  );
});

test("triggerN8nIngestion sends signed headers and no static secret header", async () => {
  const n8n = await importN8nModule();
  const previousUrl = process.env.N8N_INGEST_WEBHOOK_URL;
  const previousSecret = process.env.N8N_INGEST_WEBHOOK_SECRET;
  const previousFetch = globalThis.fetch;
  let captured;

  process.env.N8N_INGEST_WEBHOOK_URL = "https://n8n.example.test/webhook/regspan";
  process.env.N8N_INGEST_WEBHOOK_SECRET = secret;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response("ok", { status: 202 });
  };

  try {
    const result = await n8n.triggerN8nIngestion(payload);
    assert.equal(result.status, 202);
  } finally {
    if (previousUrl === undefined) delete process.env.N8N_INGEST_WEBHOOK_URL;
    else process.env.N8N_INGEST_WEBHOOK_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.N8N_INGEST_WEBHOOK_SECRET;
    else process.env.N8N_INGEST_WEBHOOK_SECRET = previousSecret;
    globalThis.fetch = previousFetch;
  }

  assert.equal(captured.url, "https://n8n.example.test/webhook/regspan");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["content-type"], "application/json");
  assert.ok(captured.init.headers["x-regspan-webhook-timestamp"]);
  assert.match(captured.init.headers["x-regspan-webhook-signature"], /^sha256=[0-9a-f]{64}$/);
  assert.equal(captured.init.headers["x-regspan-webhook-secret"], undefined);
  assert.equal(captured.init.body, n8n.serializeN8nIngestionPayload(payload));
  assert.deepEqual(Object.keys(JSON.parse(captured.init.body)), [
    "jobId",
    "documentId",
    "workspaceId",
    "correlationId",
  ]);
});

test("n8n documentation includes validation, freshness, replay, and migration guidance", async () => {
  const docs = await readFile("docs/n8n-ingestion-v1.md", "utf8");
  const source = await readFile("lib/n8n.ts", "utf8");

  assert.match(docs, /x-regspan-webhook-signature/);
  assert.match(docs, /HMAC-SHA256/);
  assert.match(docs, /<x-regspan-webhook-timestamp>\.<raw JSON body>/);
  assert.match(docs, /5 minutes/);
  assert.match(docs, /timingSafeEqual/);
  assert.match(docs, /replayed_regspan_webhook/);
  assert.match(docs, /Migration steps from the old static secret/);
  assert.match(docs, /curl -i/);
  assert.match(source, /x-regspan-webhook-signature/);
  assert.doesNotMatch(source, /x-regspan-webhook-secret/);
});
