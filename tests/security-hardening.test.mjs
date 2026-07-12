import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "typescript";

async function importServerUtility(filePath) {
  const source = (await readFile(filePath, "utf8"))
    .replace(/^import "server-only";\n/, "")
    .replace(
      'import { recordSecurityAuditEvent } from "@/lib/securityAudit";',
      "const recordSecurityAuditEvent = async () => undefined;",
    );
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

test("proxy matcher includes internal debug pages", async () => {
  const middleware = await readFile("proxy.ts", "utf8");

  assert.match(middleware, /"\/retrieval-debug"/);
  assert.match(middleware, /"\/requirement-debug"/);
  assert.match(middleware, /"\/\(\(\?!_next\/static\|_next\/image/);
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
    rateLimitCounterKeys,
    resetRateLimitsForTests,
  } = await importServerUtility("lib/rateLimit.ts");
  resetRateLimitsForTests();

  const request = new Request("https://app.example.test/api/documents", {
    headers: { "x-forwarded-for": "203.0.113.10" },
  });
  for (let index = 0; index < RATE_LIMITS.document_upload.limit; index += 1) {
    await checkRateLimit({
      request,
      category: "document_upload",
      userId: "user-a",
      workspaceId: "workspace-a",
      now: 1_700_000_000_000,
    });
  }

  await assert.rejects(
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
    await checkRateLimit({
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
    assert.match(response.body.error, /Too many requests/);
    assert.doesNotMatch(JSON.stringify(response.body), /user-a|workspace-a|203\.0\.113\.10/);
  }

  const resetAt = 1_700_000_000_000 + RATE_LIMITS.document_upload.windowMs + 1;
  await checkRateLimit({
    request,
    category: "document_upload",
    userId: "user-a",
    workspaceId: "workspace-a",
    now: resetAt,
  });

  assert.notDeepEqual(
    rateLimitCounterKeys({ request, category: "document_upload", userId: "user-a" }),
    rateLimitCounterKeys({ request, category: "document_upload", userId: "user-b" }),
  );
  assert.notDeepEqual(
    rateLimitCounterKeys({ request, category: "document_upload", workspaceId: "workspace-a" }),
    rateLimitCounterKeys({ request, category: "document_upload", workspaceId: "workspace-b" }),
  );
});

test("evaluator Analysis quota is separate from browser Analysis quota and fits the v1 corpus", async () => {
  const {
    RATE_LIMITS,
    RateLimitError,
    checkRateLimit,
    rateLimitCounterKeys,
    resetRateLimitsForTests,
  } = await importServerUtility("lib/rateLimit.ts");
  resetRateLimitsForTests();
  assert.equal(RATE_LIMITS.findings_generate_eval.limit, 25);
  assert.notDeepEqual(
    rateLimitCounterKeys({ request: new Request("https://app.example.test"), category: "findings_generate", workspaceId: "workspace-a" }),
    rateLimitCounterKeys({ request: new Request("https://app.example.test"), category: "findings_generate_eval", workspaceId: "workspace-a" }),
  );
  const request = new Request("https://app.example.test/api/findings/generate", {
    headers: { "x-forwarded-for": "203.0.113.12" },
  });
  for (let index = 0; index < 12; index += 1) {
    await checkRateLimit({
      request,
      category: "findings_generate_eval",
      userId: "eval-user",
      workspaceId: "eval-workspace",
      now: 1_700_000_000_000,
    });
  }
  for (let index = 12; index < RATE_LIMITS.findings_generate_eval.limit; index += 1) {
    await checkRateLimit({
      request,
      category: "findings_generate_eval",
      userId: "eval-user",
      workspaceId: "eval-workspace",
      now: 1_700_000_000_000,
    });
  }
  await assert.rejects(
    () => checkRateLimit({
      request,
      category: "findings_generate_eval",
      userId: "eval-user",
      workspaceId: "eval-workspace",
      now: 1_700_000_000_000,
    }),
    RateLimitError,
  );
  await checkRateLimit({
    request,
    category: "findings_generate",
    userId: "eval-user",
    workspaceId: "eval-workspace",
    now: 1_700_000_000_000,
  });
});

test("durable rate limits use an atomic RPC and production refuses memory fallback", async () => {
  const {
    checkRateLimit,
    rateLimitErrorResponse,
  } = await importServerUtility("lib/rateLimit.ts");
  const calls = [];
  const request = new Request("https://app.example.test/api/documents", {
    headers: { "x-forwarded-for": "203.0.113.11" },
  });
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { allowed: false, retry_after_seconds: 42 }, error: null };
    },
  };

  await assert.rejects(
    () => checkRateLimit({
      request,
      category: "workspace_upload_bytes",
      workspaceId: "workspace-a",
      cost: 1024,
      supabase,
      environment: { REGSPAN_RATE_LIMIT_BACKEND: "supabase" },
    }),
    (error) => {
      const response = rateLimitErrorResponse(error);
      assert.equal(response.status, 429);
      assert.equal(response.headers["Retry-After"], "42");
      assert.equal(response.body.code, "quota_exceeded");
      return true;
    },
  );
  assert.equal(calls[0].name, "consume_rate_limit_batch_v1");
  assert.equal(calls[0].args.p_counters[0].increment_by, 1024);
  assert.doesNotMatch(JSON.stringify(calls), /workspace-a|203\.0\.113\.11/);

  await assert.rejects(
    () => checkRateLimit({
      request,
      category: "document_upload",
      environment: { NODE_ENV: "production" },
    }),
    (error) => rateLimitErrorResponse(error)?.status === 503,
  );
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
    assert.match(route, /await checkRateLimit/);
  }

  assert.match(upload, /category: "workspace_document_upload"/);
  assert.match(upload, /category: "workspace_upload_bytes"/);
  assert.match(upload, /category: "workspace_processing_request"/);
  assert.match(process, /category: "workspace_processing_request"/);
  assert.match(bulk, /category: "workspace_processing_request"/);
  assert.match(forgot, /identifier: email/);
  assert.match(forgot, /getServerSupabaseAdminClient/);
});

test("durable abuse protection migration enforces atomic counters and workspace concurrency", async () => {
  const [migration, processing, findings, audit, envExample, docs] = await Promise.all([
    readFile("supabase/migrations/019_add_durable_abuse_protection.sql", "utf8"),
    readFile("lib/documentProcessing.ts", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("lib/securityAudit.ts", "utf8"),
    readFile(".env.example", "utf8"),
    readFile("docs/abuse-protection.md", "utf8"),
  ]);

  assert.match(migration, /019_add_durable_abuse_protection/);
  assert.match(migration, /rate_limit_counters/);
  assert.match(migration, /consume_rate_limit_batch_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /start_processing_job_with_quota_v1/);
  assert.match(migration, /workspace_processing_limit_reached/);
  assert.match(migration, /start_analysis_run_with_quota_v1/);
  assert.match(migration, /already_running/);
  assert.match(processing, /start_processing_job_with_quota_v1/);
  assert.match(processing, /workspace_processing_limit_reached/);
  assert.match(findings, /start_analysis_run_with_quota_v1/);
  assert.match(findings, /reused_active_run/);
  assert.match(audit, /security_audit\.insert_failed/);
  assert.match(envExample, /REGSPAN_RATE_LIMIT_BACKEND=/);
  assert.match(envExample, /REGSPAN_QUOTA_UPLOAD_BYTES_PER_DAY=/);
  assert.match(envExample, /REGSPAN_QUOTA_MAX_ACTIVE_ANALYSIS_RUNS=/);
  assert.match(docs, /REGSPAN_RATE_LIMIT_BACKEND=supabase/);
  assert.match(docs, /hashed normalized email/i);
  assert.match(docs, /do not record source excerpts, passwords, tokens, provider keys, or plaintext reset emails/i);
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

test("production RLS migration establishes explicit browser and service-role boundaries", async () => {
  const migration = await readFile(
    "supabase/migrations/021_harden_production_rls_and_storage.sql",
    "utf8",
  );

  assert.match(migration, /Query name: 021_harden_production_rls_and_storage/);
  for (const table of [
    "documents",
    "processing_jobs",
    "document_chunks",
    "document_hierarchy",
    "chunk_embeddings",
    "analysis_runs",
    "analysis_run_documents",
    "findings",
    "finding_evidence",
    "security_audit_events",
    "rate_limit_counters",
  ]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }

  assert.match(migration, /force row level security/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /grant select, insert on public\.security_audit_events to service_role/);
  assert.doesNotMatch(migration, /grant select[^;]*chunk_embeddings[^;]*to authenticated/s);
  assert.doesNotMatch(migration, /create policy chunk_embeddings[^;]*/);
  assert.doesNotMatch(migration, /create policy rate_limit_counters[^;]*/);
  assert.doesNotMatch(migration, /create policy security_audit_events[^;]*/);
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /alter function %s set search_path =/);
  assert.match(migration, /revoke all on function %s from public, anon, authenticated/);
  assert.match(migration, /grant execute on function %s to service_role/);
});

test("analysis relationships and private document Storage are fail-closed", async () => {
  const migration = await readFile(
    "supabase/migrations/021_harden_production_rls_and_storage.sql",
    "utf8",
  );

  assert.match(migration, /enforce_analysis_run_document_workspace_match/);
  assert.match(migration, /enforce_finding_analysis_run_workspace_match/);
  assert.match(migration, /analysis_run_document_run_workspace_mismatch/);
  assert.match(migration, /finding_analysis_run_workspace_mismatch/);
  assert.match(migration, /alter table %I\.%I validate constraint %I/);
  assert.match(migration, /insert into storage\.buckets/);
  assert.match(migration, /values \('documents', 'documents', false, 10485760/);
  assert.match(migration, /array\['application\/pdf'\]::text\[\]/);
  assert.match(migration, /drop policy if exists %I on storage\.objects/);
  assert.doesNotMatch(migration, /create policy documents_storage_/);
  assert.match(
    migration,
    /revoke all on function private\.can_access_document_storage\(text, uuid\)[\s\S]*from public, anon, authenticated/,
  );
});

test("service-role application reads retain explicit workspace scope", async () => {
  const [documentSecurity, worker, findings, generation, mockProcess, ingestion] = await Promise.all([
    readFile("lib/documentSecurity.ts", "utf8"),
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
    readFile("app/api/findings/route.ts", "utf8"),
    readFile("lib/findingsGeneration.ts", "utf8"),
    readFile("app/api/documents/[id]/mock-process/route.ts", "utf8"),
    readFile("lib/ingestion.ts", "utf8"),
  ]);

  const documentAuthorization = documentSecurity.slice(
    documentSecurity.indexOf("export async function authorizeDocumentRequest"),
    documentSecurity.indexOf("export function sanitizePdfFilename"),
  );
  assert.match(documentAuthorization, /getActorWorkspaceId\(supabaseAdmin, actor\.user\.id\)/);
  assert.match(documentAuthorization, /\.eq\("id", documentId\)[\s\S]*\.eq\("workspace_id", workspaceId\)/);

  const jobLookup = worker.slice(worker.indexOf('.from("processing_jobs")'), worker.indexOf("if (jobError)"));
  assert.match(jobLookup, /\.eq\("id", payload\.jobId\)/);
  assert.match(jobLookup, /\.eq\("document_id", payload\.documentId\)/);
  assert.match(jobLookup, /\.eq\("workspace_id", payload\.workspaceId\)/);
  const documentLookup = worker.slice(worker.indexOf('.from("documents")'), worker.indexOf("if (documentError)"));
  assert.match(documentLookup, /\.eq\("id", payload\.documentId\)/);
  assert.match(documentLookup, /\.eq\("workspace_id", payload\.workspaceId\)/);

  const evidenceLookup = findings.slice(
    findings.indexOf('.from("finding_evidence")'),
    findings.indexOf("if (evidenceError)"),
  );
  assert.match(evidenceLookup, /\.eq\("workspace_id", workspaceId\)/);
  assert.match(evidenceLookup, /\.in\("finding_id", findingIds\)/);

  const failRun = generation.slice(
    generation.indexOf("async function failAnalysisRun"),
    generation.indexOf("export async function generateFindingsForWorkspace"),
  );
  assert.match(failRun, /workspaceId: string/);
  assert.match(failRun, /\.eq\("id", analysisRunId\)[\s\S]*\.eq\("workspace_id", workspaceId\)/);
  assert.match(mockProcess, /\.eq\("id", jobId\)[\s\S]*\.eq\("document_id", authorized\.document\.id\)[\s\S]*\.eq\("workspace_id", authorized\.document\.workspace_id\)/);
  assert.match(ingestion, /documentId: string,[\s\S]*workspaceId: string/);
  assert.match(ingestion, /\.eq\("id", documentId\)[\s\S]*\.eq\("workspace_id", workspaceId\)/);
});

test("two-workspace authorization regression and production verification artifacts are complete", async () => {
  const [regression, verification, documentation] = await Promise.all([
    readFile("supabase/tests/021_production_data_isolation_regression.sql", "utf8"),
    readFile("docs/security/verify-production-rls-storage.sql", "utf8"),
    readFile("docs/security/production-data-isolation.md", "utf8"),
  ]);

  assert.match(regression, /two disposable auth users/i);
  assert.match(regression, /User A can read workspace B documents/);
  assert.match(regression, /User A can read workspace B chunks/);
  assert.match(regression, /User A can read workspace B findings/);
  assert.match(regression, /User A can read workspace B finding evidence/);
  assert.match(regression, /Authenticated browser can read chunk embeddings/);
  assert.match(regression, /Authenticated browser can read rate limit counters/);
  assert.match(regression, /Authenticated browser can execute an internal analysis RPC/);
  assert.match(regression, /User A can read workspace B Storage objects/);
  assert.match(regression, /Cross-workspace analysis snapshot was accepted/);

  for (const queryName of [
    "rls_and_force_rls_status",
    "sensitive_table_grants",
    "public_rls_policy_definitions",
    "browser_executable_internal_rpcs_expected_zero_rows",
    "documents_bucket_security_configuration",
    "storage_objects_rls_status",
    "storage_objects_managed_grants_informational",
    "storage_browser_policy_review",
    "documents_bucket_browser_policies_expected_zero_rows",
    "authenticated_documents_storage_visibility_expected_zero",
    "anonymous_documents_storage_visibility_expected_zero",
    "cross_workspace_relationships_expected_zero_rows",
  ]) {
    assert.match(verification, new RegExp(`Query name: ${queryName}`));
  }

  assert.match(documentation, /service role bypasses RLS/i);
  assert.match(documentation, /Supabase manages grants on `storage\.objects` and `storage\.buckets`/);
  assert.match(documentation, /allow a\s+request to reach the Storage RLS boundary/);
  assert.match(documentation, /Effective access is determined by bucket privacy and RLS policies/);
  assert.match(documentation, /Do not revoke Supabase-managed Storage grants/);
  assert.match(documentation, /Pre-deployment two-workspace test/);
  assert.match(documentation, /RLS does not compensate for an unscoped admin\s+query/i);
  assert.match(documentation, /Regulatory source tables are global authenticated reference data/);
  assert.match(documentation, /never\s+sent to n8n/);
  assert.doesNotMatch(verification, /storage_objects_browser_grants_expected_zero_rows/);
});

test("browser mutation origin validation is explicit and fail-closed", async () => {
  const {
    allowedAppOrigins,
    validateBrowserMutationOrigin,
  } = await importServerUtility("lib/requestOrigin.ts");
  const production = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://app.example.test",
    ALLOWED_APP_ORIGINS: "https://preview.example.test",
  };

  assert.deepEqual(
    [...allowedAppOrigins(production)].sort(),
    ["https://app.example.test", "https://preview.example.test"],
  );

  const allowed = validateBrowserMutationOrigin(new Request(
    "https://app.example.test/api/documents",
    {
      method: "POST",
      headers: {
        origin: "https://app.example.test",
        "sec-fetch-site": "same-origin",
      },
    },
  ), production);
  assert.equal(allowed.allowed, true);

  for (const origin of ["https://malicious.example.test", "null"]) {
    const rejected = validateBrowserMutationOrigin(new Request(
      "https://app.example.test/api/documents",
      { method: "POST", headers: { origin } },
    ), production);
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.code, "origin_not_allowed");
    assert.doesNotMatch(JSON.stringify(rejected.body), /malicious|origin.*null/i);
  }

  const missingOrigin = validateBrowserMutationOrigin(new Request(
    "https://app.example.test/api/documents",
    { method: "DELETE" },
  ), production);
  assert.equal(missingOrigin.allowed, false);
  assert.equal(missingOrigin.reason, "origin_missing");

  const missingConfiguration = validateBrowserMutationOrigin(new Request(
    "https://app.example.test/api/documents",
    { method: "POST", headers: { origin: "https://app.example.test" } },
  ), { NODE_ENV: "production" });
  assert.equal(missingConfiguration.allowed, false);
  assert.equal(missingConfiguration.status, 503);
  assert.equal(missingConfiguration.body.code, "origin_configuration_error");

  const safeGet = validateBrowserMutationOrigin(new Request(
    "https://app.example.test/api/findings",
  ), { NODE_ENV: "production" });
  assert.deepEqual(safeGet, { allowed: true, reason: "safe_method" });

  const localhostDevelopment = validateBrowserMutationOrigin(new Request(
    "http://localhost:4100/api/documents",
    { method: "POST", headers: { origin: "http://localhost:4100" } },
  ), {
    NODE_ENV: "development",
    APP_BASE_URL: "http://localhost:4100",
  });
  assert.equal(localhostDevelopment.allowed, true);

  const localhostProduction = validateBrowserMutationOrigin(new Request(
    "https://app.example.test/api/documents",
    { method: "POST", headers: { origin: "https://localhost:4100" } },
  ), {
    NODE_ENV: "production",
    APP_BASE_URL: "https://localhost:4100",
  });
  assert.equal(localhostProduction.allowed, false);
  assert.equal(localhostProduction.status, 503);
});

test("nonce CSP is per-request, strict in production, and limited to browser dependencies", async () => {
  const {
    applySecurityHeaders,
    buildContentSecurityPolicy,
    createCspNonce,
    appendVaryOrigin,
    securityHeaders,
  } = await importServerUtility("lib/securityHeaders.ts");
  const production = {
    NODE_ENV: "production",
    APP_BASE_URL: "https://app.example.test",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.test",
    N8N_INGEST_WEBHOOK_URL: "https://internal-automation.example.test",
    INGESTION_WORKER_SECRET: "worker-secret-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-secret-value",
    OPENAI_API_KEY: "ai-secret-value",
  };
  const nonceA = createCspNonce();
  const nonceB = createCspNonce();
  assert.notEqual(nonceA, nonceB);
  assert.match(nonceA, /^[a-zA-Z0-9_-]+$/);

  const policy = buildContentSecurityPolicy(nonceA, production);
  const scriptDirective = policy.split("; ").find((value) => value.startsWith("script-src "));
  assert.match(scriptDirective, new RegExp(`'nonce-${nonceA}'`));
  assert.match(scriptDirective, /'strict-dynamic'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-eval'|'unsafe-inline'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /connect-src 'self' https:\/\/project\.supabase\.test wss:\/\/project\.supabase\.test/);
  assert.match(policy, /upgrade-insecure-requests/);
  assert.doesNotMatch(policy, /internal-automation|worker-secret|service-secret|ai-secret|openai/i);
  assert.doesNotMatch(policy, /https:\/\/\*|wss:\/\/\*/);

  const developmentPolicy = buildContentSecurityPolicy(createCspNonce(), {
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  });
  assert.match(developmentPolicy, /script-src[^;]*'unsafe-eval'/);
  assert.match(developmentPolicy, /connect-src[^;]*ws: wss:/);
  assert.doesNotMatch(developmentPolicy, /upgrade-insecure-requests/);

  const productionHeaders = securityHeaders(policy, production);
  assert.equal(productionHeaders["Content-Security-Policy"], policy);
  assert.equal(productionHeaders["X-Content-Type-Options"], "nosniff");
  assert.equal(productionHeaders["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(productionHeaders["X-Frame-Options"], "DENY");
  assert.match(productionHeaders["Permissions-Policy"], /camera=\(\)/);
  assert.equal(productionHeaders["Cross-Origin-Opener-Policy"], "same-origin-allow-popups");
  assert.equal(productionHeaders["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(
    productionHeaders["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains",
  );
  assert.doesNotMatch(productionHeaders["Strict-Transport-Security"], /preload/i);

  const proxyTerminatedTlsHeaders = securityHeaders(policy, {
    NODE_ENV: "production",
    APP_BASE_URL: undefined,
    X_FORWARDED_PROTO: "http",
  });
  assert.equal(
    proxyTerminatedTlsHeaders["Strict-Transport-Security"],
    "max-age=31536000; includeSubDomains",
  );

  const publicPageHeaders = new Headers();
  const apiRejectionHeaders = new Headers({ "Content-Type": "application/json" });
  applySecurityHeaders(publicPageHeaders, policy, { NODE_ENV: "production" });
  applySecurityHeaders(apiRejectionHeaders, policy, { NODE_ENV: "production" });
  assert.equal(
    publicPageHeaders.get("Strict-Transport-Security"),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(
    apiRejectionHeaders.get("Strict-Transport-Security"),
    "max-age=31536000; includeSubDomains",
  );
  assert.equal(
    securityHeaders(developmentPolicy, { NODE_ENV: "development" })["Strict-Transport-Security"],
    undefined,
  );

  const varyHeaders = new Headers({ Vary: "Accept-Encoding" });
  appendVaryOrigin(varyHeaders);
  appendVaryOrigin(varyHeaders);
  assert.equal(varyHeaders.get("Vary"), "Accept-Encoding, Origin");
});

test("Next.js proxy applies nonce headers globally and exempts only the secret-authenticated worker", async () => {
  const [proxySource, securityHeadersSource, sessionMiddleware, nextConfig, rootLayout, workerRoute] = await Promise.all([
    readFile("proxy.ts", "utf8"),
    readFile("lib/securityHeaders.ts", "utf8"),
    readFile("lib/supabase/middleware.ts", "utf8"),
    readFile("next.config.ts", "utf8"),
    readFile("app/layout.tsx", "utf8"),
    readFile("app/api/internal/ingest/process-job/route.ts", "utf8"),
  ]);

  assert.match(proxySource, /createCspNonce\(\)/);
  assert.match(proxySource, /requestHeaders\.set\("x-nonce", nonce\)/);
  assert.match(proxySource, /requestHeaders\.set\("Content-Security-Policy", contentSecurityPolicy\)/);
  assert.match(proxySource, /applySecurityHeaders\(response\.headers, contentSecurityPolicy\)/);
  assert.match(proxySource, /applySecurityHeaders\(rejection\.headers, contentSecurityPolicy\)/);
  assert.match(proxySource, /appendVaryOrigin\(rejection\.headers\)/);
  assert.match(proxySource, /if \(isBrowserApiMutation\) appendVaryOrigin\(response\.headers\)/);
  assert.match(proxySource, /\/\(\(\?!_next\/static\|_next\/image/);
  assert.match(rootLayout, /export const dynamic = "force-dynamic"/);
  assert.match(sessionMiddleware, /request: \{ headers: requestHeaders \}/);

  assert.match(proxySource, /INTERNAL_SERVER_ROUTES = new Set\(\["\/api\/internal\/ingest\/process-job"\]\)/);
  assert.match(proxySource, /!INTERNAL_SERVER_ROUTES\.has\(pathname\)/);
  assert.match(workerRoute, /authenticateIngestionWorker\(request\)/);
  assert.match(workerRoute, /return jsonError\(401, "Unauthorized\.", "unauthorized"\)/);
  assert.doesNotMatch(proxySource, /api\/documents|api\/findings|api\/workspace/);

  assert.match(nextConfig, /poweredByHeader: false/);
  assert.doesNotMatch(nextConfig, /async headers\(\)/);
  assert.match(securityHeadersSource, /environment\.NODE_ENV === "production"/);
  assert.doesNotMatch(
    securityHeadersSource,
    /APP_BASE_URL|x-forwarded-proto|X_FORWARDED_PROTO|nextUrl\.protocol/i,
  );
});

test("same-origin API hardening emits no wildcard CORS and documents every exemption", async () => {
  const routePaths = [
    "app/api/auth/forgot-password/route.ts",
    "app/api/auth/redirect/route.ts",
    "app/api/dashboard/route.ts",
    "app/api/documents/route.ts",
    "app/api/documents/bulk/route.ts",
    "app/api/documents/[id]/route.ts",
    "app/api/documents/[id]/mock-process/route.ts",
    "app/api/documents/[id]/process/route.ts",
    "app/api/documents/[id]/replace/route.ts",
    "app/api/findings/route.ts",
    "app/api/findings/generate/route.ts",
    "app/api/internal/ingest/process-job/route.ts",
    "app/api/requirement-debug/route.ts",
    "app/api/retrieval-debug/route.ts",
    "app/api/workspace/external-ai-processing/route.ts",
  ];
  const [proxySource, requestOrigin, securityHeadersSource, documentation, envExample, ...routes] = await Promise.all([
    readFile("proxy.ts", "utf8"),
    readFile("lib/requestOrigin.ts", "utf8"),
    readFile("lib/securityHeaders.ts", "utf8"),
    readFile("docs/security/browser-request-hardening.md", "utf8"),
    readFile(".env.example", "utf8"),
    ...routePaths.map((routePath) => readFile(routePath, "utf8")),
  ]);
  const browserBoundarySource = [proxySource, requestOrigin, securityHeadersSource, ...routes].join("\n");

  assert.doesNotMatch(browserBoundarySource, /Access-Control-Allow-Origin/i);
  assert.doesNotMatch(browserBoundarySource, /Access-Control-Allow-Credentials/i);
  assert.doesNotMatch(browserBoundarySource, /origin[^\n]*\*|\*[^\n]*origin/i);
  assert.match(requestOrigin, /The request origin is not allowed\./);
  assert.doesNotMatch(requestOrigin, /body:[^}]*rawOrigin/s);
  assert.match(requestOrigin, /route: new URL\(request\.url\)\.pathname/);
  assert.match(requestOrigin, /method: request\.method\.toUpperCase\(\)/);
  assert.match(requestOrigin, /reason: decision\.reason/);
  assert.doesNotMatch(requestOrigin, /cookie|authorization|request\.text|request\.json/i);

  assert.match(envExample, /^ALLOWED_APP_ORIGINS=http:\/\/localhost:3000$/m);
  assert.match(documentation, /CORS alone is not CSRF protection/);
  assert.match(documentation, /POST `?\/api\/internal\/ingest\/process-job`?/);
  assert.match(documentation, /INGESTION_WORKER_SECRET/);
  assert.match(documentation, /Do not include paths, query strings, fragments, credentials, or wildcards/);
  assert.doesNotMatch(routes[1], /isAllowedAuthRequestOrigin/);
  assert.match(routes[1], /authRedirectUrl\(path\)/);
});
