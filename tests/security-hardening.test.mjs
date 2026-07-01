import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
