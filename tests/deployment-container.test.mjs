import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const strongValue = (label) => `${label}-A7c9E2g4J6m8Q1s3U5w0YxZbKpRvTnLd`;

function productionEnvironment() {
  return {
    NODE_ENV: "production",
    APP_BASE_URL: "https://app.staging.test",
    ALLOWED_AUTH_REDIRECT_ORIGINS: "https://app.staging.test",
    ALLOWED_APP_ORIGINS: "https://app.staging.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: strongValue("anon"),
    SUPABASE_SERVICE_ROLE_KEY: strongValue("service"),
    N8N_INGEST_WEBHOOK_URL: "https://hooks.staging.test/webhook/opaque-path",
    N8N_INGEST_WEBHOOK_SECRET: strongValue("hmac"),
    INGESTION_WORKER_SECRET: strongValue("worker"),
    REGSPAN_RATE_LIMIT_BACKEND: "supabase",
    REGSPAN_QUOTA_MAX_ACTIVE_PROCESSING_JOBS: "1",
    MAX_PDF_PAGES: "250",
    MAX_EXTRACTED_TEXT_CHARS: "2000000",
    MAX_PDF_PAGE_TEXT_CHARS: "500000",
    PDF_PROCESSING_TIMEOUT_MS: "180000",
    REGSPAN_SHUTDOWN_GRACE_MS: "330000",
    ENABLE_EXTERNAL_AI_PROCESSING: "false",
    ENABLE_EXTERNAL_AI_CLASSIFIER: "false",
    REQUIREMENT_CLASSIFIER_PROVIDER: "heuristic",
  };
}

async function importHealthRoute() {
  const source = await readFile("app/api/health/route.ts", "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: "app/api/health/route.ts",
  }).outputText;
  const outDir = await mkdtemp(join(tmpdir(), "regspan-health-test-"));
  const outPath = join(outDir, "health-route.mjs");
  await writeFile(outPath, transpiled, "utf8");
  return import(pathToFileURL(outPath).href);
}

test("production runtime preflight accepts the complete hardened configuration", async () => {
  const { validateRuntimeEnvironment } = await import("../scripts/runtimePreflight.mjs");
  assert.deepEqual(validateRuntimeEnvironment(productionEnvironment()), {
    mode: "production",
    productionValidated: true,
  });
});

test("production runtime preflight rejects unsafe URLs and missing or weak secrets", async () => {
  const { RuntimePreflightError, validateRuntimeEnvironment } =
    await import("../scripts/runtimePreflight.mjs");
  const valid = productionEnvironment();

  for (const [variableName, value] of [
    ["APP_BASE_URL", "http://app.staging.test"],
    ["N8N_INGEST_WEBHOOK_URL", "http://localhost:5678/webhook/test"],
    ["N8N_INGEST_WEBHOOK_SECRET", undefined],
    ["N8N_INGEST_WEBHOOK_SECRET", "short"],
    ["N8N_INGEST_WEBHOOK_SECRET", "replace-with-a-production-secret-value"],
  ]) {
    assert.throws(
      () => validateRuntimeEnvironment({ ...valid, [variableName]: value }),
      (error) => error instanceof RuntimePreflightError
        && error.variableName === variableName
        && (value === undefined || !error.message.includes(value)),
    );
  }
});

test("production runtime preflight rejects equivalent local hosts and accepts public HTTPS", async () => {
  const { RuntimePreflightError, validateRuntimeEnvironment } =
    await import("../scripts/runtimePreflight.mjs");
  const valid = productionEnvironment();
  const unsafeUrls = [
    "https://localhost",
    "https://host.docker.internal/webhook",
    "https://0.0.0.0/webhook",
    "https://2130706433/webhook",
    "https://0x7f000001/webhook",
    "https://[::1]/webhook",
    "https://[0:0:0:0:0:0:0:1]/webhook",
    "https://[::ffff:127.0.0.1]/webhook",
    "https://[::ffff:7f00:1]/webhook",
  ];

  for (const value of unsafeUrls) {
    assert.throws(
      () => validateRuntimeEnvironment({ ...valid, N8N_INGEST_WEBHOOK_URL: value }),
      (error) => error instanceof RuntimePreflightError
        && error.variableName === "N8N_INGEST_WEBHOOK_URL",
    );
  }

  for (const value of [
    "https://hooks.staging.test/webhook/opaque-path",
    "https://203.0.113.8/webhook/opaque-path",
    "https://[2606:4700:4700::1111]/webhook/opaque-path",
    "https://[::ffff:cb00:7108]/webhook/opaque-path",
  ]) {
    assert.equal(validateRuntimeEnvironment({
      ...valid,
      N8N_INGEST_WEBHOOK_URL: value,
    }).productionValidated, true);
  }
});

test("production runtime preflight requires separated credentials and durable limits", async () => {
  const { RuntimePreflightError, validateRuntimeEnvironment } =
    await import("../scripts/runtimePreflight.mjs");
  const valid = productionEnvironment();

  for (const [variableName, environment] of [
    ["INGESTION_WORKER_SECRET", {
      ...valid,
      INGESTION_WORKER_SECRET: valid.N8N_INGEST_WEBHOOK_SECRET,
    }],
    ["SUPABASE_SERVICE_ROLE_KEY", {
      ...valid,
      SUPABASE_SERVICE_ROLE_KEY: valid.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    }],
    ["REGSPAN_RATE_LIMIT_BACKEND", {
      ...valid,
      REGSPAN_RATE_LIMIT_BACKEND: "memory",
    }],
  ]) {
    assert.throws(
      () => validateRuntimeEnvironment(environment),
      (error) => error instanceof RuntimePreflightError
        && error.variableName === variableName,
    );
  }
});

test("production runtime preflight rejects invalid PDF resource limits", async () => {
  const { RuntimePreflightError, validateRuntimeEnvironment } =
    await import("../scripts/runtimePreflight.mjs");
  const valid = productionEnvironment();

  for (const [variableName, value] of [
    ["MAX_PDF_PAGES", "0"],
    ["MAX_EXTRACTED_TEXT_CHARS", "not-a-number"],
    ["MAX_PDF_PAGE_TEXT_CHARS", "2000001"],
    ["PDF_PROCESSING_TIMEOUT_MS", "290001"],
  ]) {
    assert.throws(
      () => validateRuntimeEnvironment({ ...valid, [variableName]: value }),
      (error) => error instanceof RuntimePreflightError
        && error.variableName === variableName,
    );
  }
});

test("production runtime preflight preserves shutdown headroom over PDF processing", async () => {
  const { RuntimePreflightError, validateRuntimeEnvironment } =
    await import("../scripts/runtimePreflight.mjs");
  const valid = productionEnvironment();

  assert.equal(validateRuntimeEnvironment({
    ...valid,
    PDF_PROCESSING_TIMEOUT_MS: "180000",
    REGSPAN_SHUTDOWN_GRACE_MS: "240000",
  }).productionValidated, true);

  for (const [timeout, grace] of [
    ["180000", "239999"],
    ["180000", "180000"],
  ]) {
    assert.throws(
      () => validateRuntimeEnvironment({
        ...valid,
        PDF_PROCESSING_TIMEOUT_MS: timeout,
        REGSPAN_SHUTDOWN_GRACE_MS: grace,
      }),
      (error) => error instanceof RuntimePreflightError
        && error.variableName === "REGSPAN_SHUTDOWN_GRACE_MS",
    );
  }
});

test("development preflight preserves localhost and incomplete local configuration", async () => {
  const { validateRuntimeEnvironment } = await import("../scripts/runtimePreflight.mjs");
  assert.deepEqual(validateRuntimeEnvironment({
    NODE_ENV: "development",
    APP_BASE_URL: "http://localhost:3000",
    N8N_INGEST_WEBHOOK_URL: "http://localhost:5678/webhook/local",
  }), {
    mode: "development",
    productionValidated: false,
  });
});

test("health endpoint returns only safe liveness fields", async () => {
  const { GET } = await importHealthRoute();
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, status: "live" });
});

test("standalone Docker runtime is non-root and explicitly packages PDF.js", async () => {
  const [dockerfile, dockerignore, nextConfig, entrypoint, instrumentation, lifecycle, workerRoute] = await Promise.all([
    readFile("Dockerfile", "utf8"),
    readFile(".dockerignore", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile("scripts/container-entrypoint.sh", "utf8"),
    readFile("instrumentation.ts", "utf8"),
    readFile("lib/serverLifecycle.ts", "utf8"),
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
  ]);
  const runtimeStage = dockerfile.slice(dockerfile.indexOf("FROM base AS runtime"));

  assert.match(dockerfile, /FROM node:24\.17\.0-bookworm-slim AS base/);
  assert.match(dockerfile, /npm ci --no-audit --no-fund/);
  assert.match(runtimeStage, /USER 10001:10001/);
  assert.match(runtimeStage, /STOPSIGNAL SIGTERM/);
  assert.match(runtimeStage, /COPY --from=builder \/app\/\.next\/standalone/);
  assert.match(runtimeStage, /COPY --from=builder \/app\/lib\/pdfParserWorker\.js/);
  assert.match(runtimeStage, /COPY --from=builder \/app\/lib\/productionHostSafety\.mjs/);
  assert.doesNotMatch(runtimeStage, /COPY \.[ /]/);
  assert.doesNotMatch(dockerfile, /ARG .*SECRET|ARG .*KEY|privileged|docker\.sock/i);
  assert.match(entrypoint, /runtimePreflight\.mjs/);
  assert.match(entrypoint, /exec node \/app\/server\.js/);
  assert.match(dockerfile, /NEXT_MANUAL_SIG_HANDLE=true/);
  assert.match(instrumentation, /installGracefulShutdownHandlers/);
  assert.match(lifecycle, /activeIngestionRequests/);
  assert.match(lifecycle, /process\.once\("SIGTERM"/);
  assert.match(workerRoute, /beginIngestionRequest/);
  assert.match(workerRoute, /server_shutting_down/);

  assert.match(nextConfig, /output: "standalone"/);
  assert.match(nextConfig, /node_modules\/pdfjs-dist\/\*\*\/\*/);
  assert.match(nextConfig, /lib\/pdfParserWorker\.js/);
  assert.match(dockerignore, /^\.env$/m);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^\.next$/m);
  assert.match(dockerignore, /^credentials\*\.json$/m);
  assert.match(dockerignore, /^\.npmrc$/m);
  assert.match(dockerignore, /^\.netrc$/m);
  assert.match(dockerignore, /^id_rsa\*$/m);
  assert.match(dockerignore, /^id_ed25519\*$/m);
  assert.match(dockerignore, /workflow-export/);
});

test("staging Compose keeps RegSpan private, bounded, and separate from dependencies", async () => {
  const compose = await readFile("infra/app/docker-compose.staging.example.yml", "utf8");
  assert.match(compose, /127\.0\.0\.1:\$\{REGSPAN_BIND_PORT:-3000\}:3000/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /restart: on-failure:5/);
  assert.match(compose, /stop_grace_period: 360s/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /cap_drop:[\s\S]*- ALL/);
  assert.match(compose, /mem_limit: 2g/);
  assert.match(compose, /REGSPAN_SHUTDOWN_GRACE_MS: "\$\{REGSPAN_SHUTDOWN_GRACE_MS:-330000\}"/);
  assert.doesNotMatch(compose, /privileged: true|docker\.sock|volumes:[\s\S]*\.\.\//);
  assert.doesNotMatch(compose, /supabase|postgres|n8n:/i);
});

test("staging Compose honors an explicit shutdown-grace override", (context) => {
  const dockerAvailable = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (dockerAvailable.status !== 0) {
    context.skip("Docker Compose is unavailable.");
    return;
  }

  const result = spawnSync("docker", [
    "compose",
    "--env-file",
    "infra/app/.env.staging.example",
    "-f",
    "infra/app/docker-compose.staging.example.yml",
    "config",
    "--format",
    "json",
  ], {
    encoding: "utf8",
    env: { ...process.env, REGSPAN_SHUTDOWN_GRACE_MS: "340000" },
  });

  assert.equal(result.status, 0, result.stderr || "docker compose config failed");
  const configuration = JSON.parse(result.stdout);
  assert.equal(configuration.services.app.environment.REGSPAN_SHUTDOWN_GRACE_MS, "340000");
});

test("browser Supabase configuration is injected at runtime instead of build time", async () => {
  const [layout, browserClient, runtimeEnvironment] = await Promise.all([
    readFile("app/layout.tsx", "utf8"),
    readFile("components/supabaseClient.ts", "utf8"),
    readFile("lib/supabase/runtimeEnvironment.ts", "utf8"),
  ]);
  assert.match(layout, /data-supabase-url/);
  assert.match(layout, /data-supabase-anon-key/);
  assert.match(browserClient, /document\.documentElement\.dataset\.supabaseUrl/);
  assert.doesNotMatch(browserClient, /process\.env/);
  assert.match(runtimeEnvironment, /environment\.NEXT_PUBLIC_SUPABASE_URL/);
  assert.doesNotMatch(runtimeEnvironment, /data-supabase.*serviceRole/i);
});

test("deployment documentation covers boundaries, secrets, environments, resources, and rollback", async () => {
  const [deployment, matrix, readme] = await Promise.all([
    readFile("docs/security/regspan-production-deployment.md", "utf8"),
    readFile("docs/security/regspan-environment-matrix.md", "utf8"),
    readFile("infra/app/README.md", "utf8"),
  ]);
  for (const boundary of [
    "Browser",
    "RegSpan application",
    "Supabase",
    "n8n webhook",
    "n8n editor",
    "n8n PostgreSQL",
    "External AI provider",
  ]) {
    assert.match(deployment, new RegExp(boundary, "i"));
  }
  assert.match(deployment, /2 vCPU, 2 GiB memory/);
  assert.match(deployment, /one active ingestion/);
  assert.match(deployment, /Staging deployment/);
  assert.match(deployment, /Production promotion/);
  assert.match(deployment, /Failure and rollback/);
  assert.match(matrix, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(matrix, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(matrix, /N8N_INGEST_WEBHOOK_SECRET/);
  assert.match(matrix, /PDF_PROCESSING_TIMEOUT_MS/);
  assert.match(matrix, /REGSPAN_SHUTDOWN_GRACE_MS/);
  assert.match(readme, /docker compose/);

  for (const file of [deployment, matrix, readme]) {
    assert.doesNotMatch(file, /\b[a-f0-9]{64}\b/i);
    assert.doesNotMatch(file, /sk-[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]+\./);
  }
});
