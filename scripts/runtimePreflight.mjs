import { pathToFileURL } from "node:url";
import { isUnsafeProductionHostname } from "../lib/productionHostSafety.mjs";

const MINIMUM_SECRET_LENGTH = 32;
const DEFAULT_SHUTDOWN_GRACE_MS = 330_000;
const MINIMUM_SHUTDOWN_HEADROOM_MS = 60_000;
const PLACEHOLDER_PATTERN = /replace|placeholder|change[-_ ]?me|example|your[-_ ]?(?:key|secret)|todo/i;

export class RuntimePreflightError extends Error {
  constructor(variableName, requirement) {
    super(`${variableName}: ${requirement}`);
    this.name = "RuntimePreflightError";
    this.variableName = variableName;
  }
}

function fail(variableName, requirement) {
  throw new RuntimePreflightError(variableName, requirement);
}

function required(environment, variableName) {
  const value = environment[variableName]?.trim();
  if (!value) fail(variableName, "is required in production");
  return value;
}

function productionUrl(environment, variableName, { originOnly = false } = {}) {
  const configured = required(environment, variableName);
  let url;
  try {
    url = new URL(configured);
  } catch {
    fail(variableName, "must be a valid HTTPS URL");
  }

  if (url.protocol !== "https:") fail(variableName, "must use HTTPS");
  if (url.username || url.password) fail(variableName, "must not contain credentials");
  if (isUnsafeProductionHostname(url.hostname)) {
    fail(variableName, "must not target a local, loopback, or unspecified host");
  }
  if (originOnly && (url.pathname !== "/" || url.search || url.hash)) {
    fail(variableName, "must be an exact origin without a path, query, or fragment");
  }
  return url;
}

function originList(environment, variableName) {
  const values = required(environment, variableName)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) fail(variableName, "must include at least one HTTPS origin");

  return new Set(values.map((value) => {
    const scopedEnvironment = { [variableName]: value };
    return productionUrl(scopedEnvironment, variableName, { originOnly: true }).origin;
  }));
}

function strongSecret(environment, variableName) {
  const value = required(environment, variableName);
  if (value.length < MINIMUM_SECRET_LENGTH) {
    fail(variableName, `must contain at least ${MINIMUM_SECRET_LENGTH} characters`);
  }
  if (PLACEHOLDER_PATTERN.test(value) || new Set(value).size < 8) {
    fail(variableName, "must be a non-placeholder high-entropy value");
  }
  return value;
}

function optionalStrongSecret(environment, variableName) {
  if (!environment[variableName]?.trim()) return null;
  return strongSecret(environment, variableName);
}

function integerSetting(environment, variableName, minimum, maximum) {
  const configured = required(environment, variableName);
  if (!/^[1-9]\d*$/.test(configured)) {
    fail(variableName, "must be a positive integer");
  }
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(variableName, `must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalBoolean(environment, variableName) {
  const configured = environment[variableName]?.trim().toLowerCase();
  if (!configured) return false;
  if (configured !== "true" && configured !== "false") {
    fail(variableName, "must be true or false when configured");
  }
  return configured === "true";
}

function validateExternalAiConfiguration(environment) {
  const processingEnabled = optionalBoolean(environment, "ENABLE_EXTERNAL_AI_PROCESSING");
  const classifierEnabled = optionalBoolean(environment, "ENABLE_EXTERNAL_AI_CLASSIFIER");
  if (classifierEnabled && !processingEnabled) {
    fail("ENABLE_EXTERNAL_AI_CLASSIFIER", "requires ENABLE_EXTERNAL_AI_PROCESSING=true");
  }

  for (const variableName of [
    "EMBEDDING_API_KEY",
    "OPENAI_API_KEY",
    "CHUNK_SYNOPSIS_API_KEY",
    "REQUIREMENT_CLASSIFIER_API_KEY",
  ]) {
    optionalStrongSecret(environment, variableName);
  }

  const classifierProvider = (environment.REQUIREMENT_CLASSIFIER_PROVIDER ?? "heuristic")
    .trim()
    .toLowerCase();
  if (classifierProvider !== "heuristic" && classifierProvider !== "openai") {
    fail("REQUIREMENT_CLASSIFIER_PROVIDER", "must be heuristic or openai");
  }

  if (!processingEnabled) return;
  if ((environment.EMBEDDING_PROVIDER ?? "").trim().toLowerCase() !== "openai") {
    fail("EMBEDDING_PROVIDER", "must be openai when external AI processing is enabled");
  }
  required(environment, "EMBEDDING_MODEL");
  strongSecret(environment, "EMBEDDING_API_KEY");

  if (environment.CHUNK_SYNOPSIS_MODEL?.trim()) {
    const synopsisKey = environment.CHUNK_SYNOPSIS_API_KEY?.trim()
      || environment.REQUIREMENT_CLASSIFIER_API_KEY?.trim()
      || environment.OPENAI_API_KEY?.trim();
    if (!synopsisKey) {
      fail("CHUNK_SYNOPSIS_API_KEY", "or another supported server-side AI key is required for synopses");
    }
  }

  if (classifierEnabled && classifierProvider === "openai") {
    required(environment, "REQUIREMENT_CLASSIFIER_MODEL");
    if (!environment.REQUIREMENT_CLASSIFIER_API_KEY?.trim()
      && !environment.OPENAI_API_KEY?.trim()) {
      fail("REQUIREMENT_CLASSIFIER_API_KEY", "or OPENAI_API_KEY is required for the OpenAI classifier");
    }
  }
}

export function validateRuntimeEnvironment(environment = process.env) {
  if (environment.NODE_ENV !== "production") {
    return { mode: environment.NODE_ENV ?? "development", productionValidated: false };
  }

  const appOrigin = productionUrl(environment, "APP_BASE_URL", { originOnly: true }).origin;
  const authOrigins = originList(environment, "ALLOWED_AUTH_REDIRECT_ORIGINS");
  const appOrigins = originList(environment, "ALLOWED_APP_ORIGINS");
  if (!authOrigins.has(appOrigin)) {
    fail("ALLOWED_AUTH_REDIRECT_ORIGINS", "must include APP_BASE_URL");
  }
  if (!appOrigins.has(appOrigin)) {
    fail("ALLOWED_APP_ORIGINS", "must include APP_BASE_URL");
  }

  productionUrl(environment, "NEXT_PUBLIC_SUPABASE_URL", { originOnly: true });
  const anonKey = strongSecret(environment, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const serviceRoleKey = strongSecret(environment, "SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey === serviceRoleKey) {
    fail("SUPABASE_SERVICE_ROLE_KEY", "must differ from NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  productionUrl(environment, "N8N_INGEST_WEBHOOK_URL");
  const hmacSecret = strongSecret(environment, "N8N_INGEST_WEBHOOK_SECRET");
  const workerSecret = strongSecret(environment, "INGESTION_WORKER_SECRET");
  if (hmacSecret === workerSecret) {
    fail("INGESTION_WORKER_SECRET", "must differ from N8N_INGEST_WEBHOOK_SECRET");
  }

  if (required(environment, "REGSPAN_RATE_LIMIT_BACKEND").toLowerCase() !== "supabase") {
    fail("REGSPAN_RATE_LIMIT_BACKEND", "must be supabase in production");
  }

  integerSetting(environment, "MAX_PDF_PAGES", 1, 1_000);
  const maxExtractedTextChars = integerSetting(
    environment,
    "MAX_EXTRACTED_TEXT_CHARS",
    20,
    10_000_000,
  );
  const maxPdfPageTextChars = integerSetting(
    environment,
    "MAX_PDF_PAGE_TEXT_CHARS",
    20,
    2_000_000,
  );
  const pdfProcessingTimeoutMs = integerSetting(
    environment,
    "PDF_PROCESSING_TIMEOUT_MS",
    1_000,
    290_000,
  );
  if (maxPdfPageTextChars > maxExtractedTextChars) {
    fail("MAX_PDF_PAGE_TEXT_CHARS", "must not exceed MAX_EXTRACTED_TEXT_CHARS");
  }

  if (environment.REGSPAN_QUOTA_MAX_ACTIVE_PROCESSING_JOBS?.trim()) {
    integerSetting(environment, "REGSPAN_QUOTA_MAX_ACTIVE_PROCESSING_JOBS", 1, 8);
  }
  const shutdownGraceMs = environment.REGSPAN_SHUTDOWN_GRACE_MS?.trim()
    ? integerSetting(environment, "REGSPAN_SHUTDOWN_GRACE_MS", 61_000, 350_000)
    : DEFAULT_SHUTDOWN_GRACE_MS;
  if (shutdownGraceMs - pdfProcessingTimeoutMs < MINIMUM_SHUTDOWN_HEADROOM_MS) {
    fail(
      "REGSPAN_SHUTDOWN_GRACE_MS",
      `must exceed PDF_PROCESSING_TIMEOUT_MS by at least ${MINIMUM_SHUTDOWN_HEADROOM_MS} milliseconds`,
    );
  }

  for (const forbiddenName of [
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_N8N_INGEST_WEBHOOK_SECRET",
    "NEXT_PUBLIC_INGESTION_WORKER_SECRET",
    "NEXT_PUBLIC_OPENAI_API_KEY",
    "NEXT_PUBLIC_EMBEDDING_API_KEY",
  ]) {
    if (environment[forbiddenName]?.trim()) {
      fail(forbiddenName, "must never be exposed through a NEXT_PUBLIC variable");
    }
  }

  validateExternalAiConfiguration(environment);
  return { mode: "production", productionValidated: true };
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  try {
    const result = validateRuntimeEnvironment(process.env);
    console.info(result.productionValidated
      ? "[RegSpan startup] Production runtime configuration validated."
      : "[RegSpan startup] Runtime preflight skipped outside production.");
  } catch (error) {
    const message = error instanceof RuntimePreflightError
      ? error.message
      : "runtime_configuration_invalid";
    console.error(`[RegSpan startup] Configuration error: ${message}`);
    process.exitCode = 1;
  }
}
