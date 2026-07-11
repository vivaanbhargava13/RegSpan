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
  const hostSafetySource = await readFile("lib/productionHostSafety.mjs", "utf8");
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
  await writeFile(join(outDir, "productionHostSafety.mjs"), hostSafetySource, "utf8");
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

test("n8n webhook verification rejects tampering, stale timestamps, and malformed signatures", async () => {
  const {
    N8N_WEBHOOK_MAX_SKEW_MS,
    serializeN8nIngestionPayload,
    signN8nWebhook,
    verifyN8nWebhookSignature,
  } = await importN8nModule();
  const rawBody = serializeN8nIngestionPayload(payload);
  const signature = signN8nWebhook({ timestamp, rawBody, secret });
  const now = Date.parse(timestamp);

  assert.equal(verifyN8nWebhookSignature({ timestamp, rawBody, signature, secret, now }), true);
  assert.equal(verifyN8nWebhookSignature({
    timestamp,
    rawBody: `${rawBody} `,
    signature,
    secret,
    now,
  }), false);
  assert.equal(verifyN8nWebhookSignature({
    timestamp: "2026-07-10T12:00:01.000Z",
    rawBody,
    signature,
    secret,
    now,
  }), false);
  assert.equal(verifyN8nWebhookSignature({
    timestamp,
    rawBody,
    signature,
    secret: "different-signing-secret-with-at-least-32-characters",
    now,
  }), false);
  assert.equal(verifyN8nWebhookSignature({
    timestamp,
    rawBody,
    signature: "sha256=not-hex",
    secret,
    now,
  }), false);
  assert.equal(verifyN8nWebhookSignature({
    timestamp,
    rawBody,
    signature,
    secret,
    now: now + N8N_WEBHOOK_MAX_SKEW_MS + 1,
  }), false);
});

test("production n8n configuration fails closed while local development remains supported", async () => {
  const { getN8nConfiguration, N8nWebhookError } = await importN8nModule();
  const workerSecret = "worker-bearer-secret-with-at-least-32-characters";
  const production = {
    NODE_ENV: "production",
    N8N_INGEST_WEBHOOK_URL: "https://hooks.example.test/webhook/regspan",
    N8N_INGEST_WEBHOOK_SECRET: secret,
    INGESTION_WORKER_SECRET: workerSecret,
  };

  assert.deepEqual(getN8nConfiguration(production), {
    url: "https://hooks.example.test/webhook/regspan",
    secret,
  });
  assert.deepEqual(getN8nConfiguration({
    NODE_ENV: "development",
    N8N_INGEST_WEBHOOK_URL: "http://localhost:5678/webhook/regspan",
    N8N_INGEST_WEBHOOK_SECRET: secret,
  }), {
    url: "http://localhost:5678/webhook/regspan",
    secret,
  });

  for (const environment of [
    { ...production, N8N_INGEST_WEBHOOK_URL: "http://hooks.example.test/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://localhost:5678/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://127.0.0.1/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://2130706433/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://0x7f000001/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://0.0.0.0/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://[::1]/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://[0:0:0:0:0:0:0:1]/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://[::ffff:127.0.0.1]/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://[::ffff:7f00:1]/webhook/regspan" },
    { ...production, N8N_INGEST_WEBHOOK_URL: "https://host.docker.internal/webhook/regspan" },
    { ...production, INGESTION_WORKER_SECRET: undefined },
    { ...production, INGESTION_WORKER_SECRET: secret },
    { ...production, N8N_INGEST_WEBHOOK_SECRET: "replace-with-production-secret-value" },
  ]) {
    assert.throws(
      () => getN8nConfiguration(environment),
      (error) => error instanceof N8nWebhookError && error.kind === "configuration",
    );
  }

  for (const publicUrl of [
    "https://203.0.113.8/webhook/regspan",
    "https://[2606:4700:4700::1111]/webhook/regspan",
    "https://[::ffff:cb00:7108]/webhook/regspan",
  ]) {
    assert.equal(getN8nConfiguration({
      ...production,
      N8N_INGEST_WEBHOOK_URL: publicUrl,
    }).url, publicUrl);
  }
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
  assert.match(source, /timingSafeEqual/);
});

test("sanitized n8n local infrastructure docs include required setup", async () => {
  const [compose, envExample, readme, outline, docs] = await Promise.all([
    readFile("infra/n8n/docker-compose.example.yml", "utf8"),
    readFile("infra/n8n/.env.example", "utf8"),
    readFile("infra/n8n/README.md", "utf8"),
    readFile("infra/n8n/workflow-outline.md", "utf8"),
    readFile("docs/n8n-ingestion-v1.md", "utf8"),
  ]);

  assert.match(compose, /N8N_INGEST_WEBHOOK_SECRET: \$\{N8N_INGEST_WEBHOOK_SECRET\}/);
  assert.match(compose, /REGSPAN_WEBHOOK_SECRET: \$\{N8N_INGEST_WEBHOOK_SECRET\}/);
  assert.match(compose, /INGESTION_WORKER_SECRET: \$\{INGESTION_WORKER_SECRET\}/);
  assert.match(compose, /N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"/);
  assert.match(compose, /NODE_FUNCTION_ALLOW_BUILTIN: crypto/);

  assert.match(envExample, /replace-with-64-hex-hmac-secret/);
  assert.match(envExample, /replace-with-different-64-hex-worker-secret/);
  assert.match(readme, /openssl rand -hex 32/);
  assert.match(readme, /N8N_INGEST_WEBHOOK_SECRET.*must match/s);
  assert.match(readme, /INGESTION_WORKER_SECRET.*must match/s);
  assert.match(readme, /must be different/);
  assert.match(readme, /docker compose --env-file \.env -f docker-compose\.example\.yml up -d/);
  assert.match(readme, /host\.docker\.internal:3000\/api\/internal\/ingest\/process-job/);
  assert.match(readme, /Never commit a real `\.env`/);
  assert.match(outline, /Webhook[\s\S]*Code in JavaScript HMAC validation[\s\S]*Respond to Webhook[\s\S]*HTTP Request worker/);
  assert.match(docs, /\.\.\/infra\/n8n\/README\.md/);

  for (const file of [compose, envExample, readme, outline]) {
    assert.doesNotMatch(file, /\b[a-f0-9]{64}\b/i);
    assert.doesNotMatch(file, /sk-[A-Za-z0-9]/);
    assert.doesNotMatch(file, /eyJ[A-Za-z0-9_-]+\./);
  }
});

test("production n8n infrastructure is pinned, private, persistent, and credential-backed", async () => {
  const [compose, envExample, readme, outline, proxy, runbook, checklist, rootEnv] =
    await Promise.all([
      readFile("infra/n8n/docker-compose.production.example.yml", "utf8"),
      readFile("infra/n8n/.env.production.example", "utf8"),
      readFile("infra/n8n/README.md", "utf8"),
      readFile("infra/n8n/workflow-outline.md", "utf8"),
      readFile("infra/n8n/reverse-proxy-security.md", "utf8"),
      readFile("docs/security/n8n-production-hardening.md", "utf8"),
      readFile("infra/n8n/manual-production-migration-checklist.md", "utf8"),
      readFile(".env.example", "utf8"),
    ]);

  assert.match(compose, /docker\.n8n\.io\/n8nio\/n8n:2\.27\.3/);
  assert.doesNotMatch(compose, /n8n:(?:latest|stable)\b/);
  assert.match(compose, /postgres:16\.14-alpine/);
  assert.match(compose, /127\.0\.0\.1:\$\{N8N_BIND_PORT:-5678\}:5678/);
  assert.match(compose, /N8N_BLOCK_ENV_ACCESS_IN_NODE: "true"/);
  assert.match(compose, /N8N_PUBLIC_API_DISABLED: "true"/);
  assert.match(compose, /EXECUTIONS_DATA_SAVE_ON_SUCCESS: none/);
  assert.match(compose, /EXECUTIONS_DATA_SAVE_ON_ERROR: none/);
  assert.match(compose, /n8n_data:\/home\/node\/\.n8n/);
  assert.match(compose, /postgres_data:\/var\/lib\/postgresql\/data/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:\s*true|host\.docker\.internal/);

  assert.match(envExample, /N8N_ENCRYPTION_KEY=replace-with/);
  assert.match(envExample, /WEBHOOK_URL=https:\/\//);
  assert.match(envExample, /N8N_EDITOR_BASE_URL=https:\/\//);
  assert.doesNotMatch(envExample, /\b[a-f0-9]{64}\b/i);
  assert.doesNotMatch(envExample, /N8N_INGEST_WEBHOOK_SECRET|INGESTION_WORKER_SECRET/);

  assert.match(readme, /Current local workflow/);
  assert.match(readme, /Target production workflow/);
  assert.match(outline, /Crypto HMAC-SHA256/);
  assert.match(outline, /Crypto credential/);
  assert.match(outline, /Bearer Auth[\s\S]*credential/);
  assert.match(proxy, /HMAC authenticates/);
  assert.match(proxy, /do not expose.*5678/is);
  assert.match(runbook, /Before deployment/);
  assert.match(runbook, /Rotate and recover/);
  assert.match(checklist, /Rollback/);
  assert.match(checklist, /Hmac Secret/);
  assert.match(rootEnv, /N8N_INGEST_WEBHOOK_URL/);
  assert.match(rootEnv, /production.*HTTPS/is);

  for (const file of [compose, envExample, readme, outline, proxy, runbook, checklist]) {
    assert.doesNotMatch(file, /sk-[A-Za-z0-9]/);
    assert.doesNotMatch(file, /eyJ[A-Za-z0-9_-]+\./);
  }
});

test("worker authentication and duplicate invocation remain server-authoritative", async () => {
  const [workerRoute, workerAuth, claimMigration] = await Promise.all([
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("lib/ingestionWorkerAuth.ts", "utf8"),
    readFile("supabase/migrations/014_create_pdf_chunk_ingestion.sql", "utf8"),
  ]);

  assert.match(workerRoute, /authenticateIngestionWorker\(request\)/);
  assert.match(workerRoute, /return jsonError\(401, "Unauthorized\.", "unauthorized"\)/);
  assert.match(workerRoute, /\.eq\("id", payload\.jobId\)/);
  assert.match(workerRoute, /\.eq\("document_id", payload\.documentId\)/);
  assert.match(workerRoute, /\.eq\("workspace_id", payload\.workspaceId\)/);
  assert.match(workerRoute, /claimResult\.result === "already_completed"/);
  assert.match(workerAuth, /timingSafeEqual/);
  assert.match(claimMigration, /pg_advisory_xact_lock/);
  assert.match(claimMigration, /current_job\.status = 'Processed'[\s\S]*'already_completed'/);
});
