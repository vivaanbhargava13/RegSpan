import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function importServerUtility(filePath) {
  const source = (await readFile(filePath, "utf8")).replace(/^import "server-only";\n/, "");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: filePath,
  }).outputText;
  const outDir = await mkdtemp(join(tmpdir(), "regspan-security-test-"));
  const outPath = join(outDir, filePath.replace(/[^\w.-]+/g, "__") + ".mjs");
  await writeFile(outPath, transpiled, "utf8");
  return import(pathToFileURL(outPath).href);
}

test("mock processing route is server-gated before admin client usage", async () => {
  const route = await readFile("app/api/documents/[id]/mock-process/route.ts", "utf8");
  const flags = await readFile("lib/securityFeatureFlags.ts", "utf8");
  const envExample = await readFile(".env.example", "utf8");

  assert.match(flags, /import ["']server-only["']/);
  assert.match(flags, /ENABLE_MOCK_PROCESSING_ROUTE/);
  assert.match(flags, /NODE_ENV !== "production"/);
  assert.match(envExample, /ENABLE_MOCK_PROCESSING_ROUTE=/);
  assert.match(route, /isMockProcessingRouteEnabled/);
  assert.match(route, /status: 404/);
  assert.match(route, /code: "not_found"/);
  assert.ok(
    route.indexOf("if (!isMockProcessingRouteEnabled())") < route.indexOf("getServerSupabaseAdminClient()"),
    "mock route gate should run before creating the service-role client",
  );
});

test("internal debug API routes are server-gated before auth and admin work", async () => {
  const [retrievalRoute, requirementRoute, flags, envExample] = await Promise.all([
    readFile("app/api/retrieval-debug/route.ts", "utf8"),
    readFile("app/api/requirement-debug/route.ts", "utf8"),
    readFile("lib/securityFeatureFlags.ts", "utf8"),
    readFile(".env.example", "utf8"),
  ]);

  assert.match(flags, /ENABLE_INTERNAL_DEBUG_ROUTES/);
  assert.match(flags, /NODE_ENV !== "production"[\s\S]*ENABLE_INTERNAL_DEBUG_ROUTES/);
  assert.match(envExample, /ENABLE_INTERNAL_DEBUG_ROUTES=/);

  for (const route of [retrievalRoute, requirementRoute]) {
    assert.match(route, /areInternalDebugRoutesEnabled/);
    assert.match(route, /status: 404/);
    assert.match(route, /code: "not_found"/);
    assert.ok(
      route.indexOf("if (!areInternalDebugRoutesEnabled())") < route.indexOf("getServerSupabaseAdminClient()"),
      "debug route gate should run before creating the service-role client",
    );
    assert.ok(
      route.indexOf("if (!areInternalDebugRoutesEnabled())") < route.indexOf("authenticateRequest(supabase, request)"),
      "debug route gate should run before request auth work",
    );
  }
});

test("internal debug route flag is locked out in production", async () => {
  const { areInternalDebugRoutesEnabled } = await importServerUtility("lib/securityFeatureFlags.ts");

  assert.equal(
    areInternalDebugRoutesEnabled({
      NODE_ENV: "development",
      ENABLE_INTERNAL_DEBUG_ROUTES: "true",
    }),
    true,
  );
  assert.equal(
    areInternalDebugRoutesEnabled({
      NODE_ENV: "production",
      ENABLE_INTERNAL_DEBUG_ROUTES: "true",
    }),
    false,
  );
});

test("debug pages and sidebar links are hidden unless internal debug is enabled", async () => {
  const [layout, appShell, sidebar, retrievalPage, requirementPage] = await Promise.all([
    readFile("app/(app)/layout.tsx", "utf8"),
    readFile("components/AppShell.tsx", "utf8"),
    readFile("components/Sidebar.tsx", "utf8"),
    readFile("app/(app)/retrieval-debug/page.tsx", "utf8"),
    readFile("app/(app)/requirement-debug/page.tsx", "utf8"),
  ]);

  assert.match(layout, /areInternalDebugRoutesEnabled/);
  assert.match(layout, /showInternalDebugLinks=\{areInternalDebugRoutesEnabled\(\)\}/);
  assert.match(appShell, /showInternalDebugLinks = false/);
  assert.match(appShell, /<Sidebar showInternalDebugLinks=\{showInternalDebugLinks\} \/>/);
  assert.match(sidebar, /internalDebugHrefs/);
  assert.match(sidebar, /showInternalDebugLinks/);
  assert.match(sidebar, /primaryNavLinks\.filter\(\(link\) => !internalDebugHrefs\.has\(link\.href\)\)/);
  assert.match(retrievalPage, /notFound\(\)/);
  assert.match(requirementPage, /notFound\(\)/);
});

test("middleware matcher includes internal debug pages", async () => {
  const middleware = await readFile("middleware.ts", "utf8");

  assert.match(middleware, /"\/retrieval-debug\/:path\*"/);
  assert.match(middleware, /"\/requirement-debug\/:path\*"/);
});

test("debug API responses omit embedding_input from browser payloads", async () => {
  const [retrievalRoute, requirementRoute, retrievalClient, requirementClient] = await Promise.all([
    readFile("app/api/retrieval-debug/route.ts", "utf8"),
    readFile("app/api/requirement-debug/route.ts", "utf8"),
    readFile("components/RetrievalDebugClient.tsx", "utf8"),
    readFile("components/RequirementDebugClient.tsx", "utf8"),
  ]);

  assert.match(retrievalRoute, /omitEmbeddingInput/);
  assert.match(requirementRoute, /omitEmbeddingInput/);
  assert.doesNotMatch(retrievalClient, /Debug embedding input/);
  assert.doesNotMatch(retrievalClient, /embedding_input/);
  assert.doesNotMatch(requirementClient, /embedding_input/);
});

test("rate limit utility allows requests until the configured threshold and then returns safe 429 data", async () => {
  const {
    RATE_LIMITS,
    RateLimitError,
    checkRateLimit,
    rateLimitErrorResponse,
    resetRateLimitsForTests,
  } = await importServerUtility("lib/rateLimit.ts");
  resetRateLimitsForTests();

  const request = new Request("https://app.example.test/api/documents", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  for (let index = 0; index < RATE_LIMITS.document_upload.limit; index += 1) {
    checkRateLimit({
      request,
      category: "document_upload",
      userId: "user-a",
      workspaceId: "workspace-a",
      now: 1_700_000_000_000,
    });
  }

  assert.throws(
    () => checkRateLimit({
      request,
      category: "document_upload",
      userId: "user-a",
      workspaceId: "workspace-a",
      now: 1_700_000_000_000,
    }),
    RateLimitError,
  );

  try {
    checkRateLimit({
      request,
      category: "document_upload",
      userId: "user-a",
      workspaceId: "workspace-a",
      now: 1_700_000_000_000,
    });
  } catch (error) {
    const response = rateLimitErrorResponse(error);
    assert.equal(response.status, 429);
    assert.equal(response.body.code, "rate_limited");
    assert.match(response.body.error, /Too many upload attempts/);
    assert.doesNotMatch(JSON.stringify(response.body), /user-a|workspace-a|203\.0\.113\.10/);
  }
});

test("expensive and sensitive routes are wired to app-side rate limiting", async () => {
  const [upload, process, replace, bulk, generate, forgot] = await Promise.all([
    readFile("app/api/documents/route.ts", "utf8"),
    readFile("app/api/documents/[id]/process/route.ts", "utf8"),
    readFile("app/api/documents/[id]/replace/route.ts", "utf8"),
    readFile("app/api/documents/bulk/route.ts", "utf8"),
    readFile("app/api/findings/generate/route.ts", "utf8"),
    readFile("app/api/auth/forgot-password/route.ts", "utf8"),
  ]);

  assert.match(upload, /category: "document_upload"/);
  assert.match(process, /category: "document_reprocess"/);
  assert.match(replace, /category: "document_replace"/);
  assert.match(bulk, /category: "document_bulk_action"/);
  assert.match(generate, /category: "findings_generate"/);
  assert.match(forgot, /category: "password_reset"/);

  for (const route of [upload, process, replace, bulk, generate, forgot]) {
    assert.match(route, /checkRateLimit/);
    assert.match(route, /rateLimitErrorResponse/);
    assert.match(route, /status: rateLimited\.status/);
  }
});

test("auth redirect URLs are server-controlled and origin allow-listed", async () => {
  const {
    allowedAuthRedirectOrigins,
    appBaseOrigin,
    authRedirectUrl,
    isAllowedAuthRequestOrigin,
  } = await importServerUtility("lib/authRedirects.ts");
  const environment = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://app.regspan.example",
    ALLOWED_AUTH_REDIRECT_ORIGINS: "https://preview.regspan.example",
  };

  assert.equal(appBaseOrigin(environment), "https://app.regspan.example");
  assert.equal(
    authRedirectUrl("/auth/update-password", environment),
    "https://app.regspan.example/auth/update-password",
  );
  assert.deepEqual(
    [...allowedAuthRedirectOrigins(environment)].sort(),
    ["https://app.regspan.example", "https://preview.regspan.example"],
  );
  assert.equal(
    isAllowedAuthRequestOrigin(
      new Request("https://app.regspan.example/api/auth/forgot-password", {
        headers: { origin: "https://preview.regspan.example" },
      }),
      environment,
    ),
    true,
  );
  assert.equal(
    isAllowedAuthRequestOrigin(
      new Request("https://app.regspan.example/api/auth/forgot-password", {
        headers: { origin: "https://evil.example" },
      }),
      environment,
    ),
    false,
  );
  assert.throws(
    () => appBaseOrigin({ NODE_ENV: "production", APP_BASE_URL: "http://app.regspan.example" }),
    /https/,
  );
});

test("env example documents server-only redirect and AI variables", async () => {
  const envExample = await readFile(".env.example", "utf8");

  for (const name of [
    "APP_BASE_URL",
    "ALLOWED_AUTH_REDIRECT_ORIGINS",
    "OPENAI_API_KEY",
    "CHUNK_SYNOPSIS_MODEL",
    "CHUNK_SYNOPSIS_API_KEY",
  ]) {
    assert.match(envExample, new RegExp(`^${name}=`, "m"));
  }
  assert.doesNotMatch(
    envExample,
    /NEXT_PUBLIC_(OPENAI_API_KEY|CHUNK_SYNOPSIS_API_KEY|REQUIREMENT_CLASSIFIER_API_KEY|EMBEDDING_API_KEY)/,
  );
});
