import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordSecurityAuditEvent } from "@/lib/securityAudit";

export type RateLimitCategory =
  | "document_upload"
  | "document_replace"
  | "document_reprocess"
  | "document_bulk_action"
  | "findings_generate"
  | "findings_generate_eval"
  | "password_reset"
  | "workspace_document_upload"
  | "workspace_upload_bytes"
  | "workspace_processing_request";

type RateLimitScope = "ip" | "user" | "workspace" | "identifier" | "anonymous";
type RateLimitEnvironment = Record<string, string | undefined>;

type RateLimitConfig = {
  limit: number;
  windowMs: number;
  publicMessage: string;
  scopes?: RateLimitScope[];
  quota?: boolean;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type DurableCounter = {
  counter_key: string;
  limit_value: number;
  window_seconds: number;
  increment_by: number;
};

type DurableRateLimitResult = {
  allowed?: boolean;
  retry_after_seconds?: number;
};

export type RateLimitInput = {
  request: Request;
  category: RateLimitCategory;
  supabase?: SupabaseClient;
  userId?: string | null;
  workspaceId?: string | null;
  identifier?: string | null;
  correlationId?: string;
  cost?: number;
  now?: number;
  environment?: RateLimitEnvironment;
};

export class RateLimitError extends Error {
  public readonly status = 429;
  public readonly code: "rate_limited" | "quota_exceeded";

  constructor(
    public readonly publicMessage: string,
    public readonly retryAfterSeconds: number,
    public readonly category: RateLimitCategory,
    quota = false,
  ) {
    super(publicMessage);
    this.code = quota ? "quota_exceeded" : "rate_limited";
  }
}

export class RateLimitConfigurationError extends Error {
  public readonly status = 503;
  public readonly code = "rate_limit_unavailable";
  public readonly publicMessage = "Request protection is temporarily unavailable. Please try again later.";

  constructor(message: string) {
    super(message);
  }
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function rateLimitConfiguration(
  environment: RateLimitEnvironment = process.env,
): Record<RateLimitCategory, RateLimitConfig> {
  return {
    document_upload: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_DOCUMENT_UPLOADS_PER_HOUR, 12),
      windowMs: HOUR_MS,
      publicMessage: "Too many requests. Try again later.",
    },
    document_replace: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_DOCUMENT_REPLACES_PER_HOUR, 12),
      windowMs: HOUR_MS,
      publicMessage: "Too many requests. Try again later.",
    },
    document_reprocess: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_DOCUMENT_REPROCESSES_PER_HOUR, 30),
      windowMs: HOUR_MS,
      publicMessage: "Too many requests. Try again later.",
    },
    document_bulk_action: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_DOCUMENT_BULK_ACTIONS_PER_HOUR, 20),
      windowMs: HOUR_MS,
      publicMessage: "Too many requests. Try again later.",
    },
    findings_generate: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_ANALYSIS_PER_HOUR, 8),
      windowMs: HOUR_MS,
      publicMessage: "Too many requests. Try again later.",
    },
    findings_generate_eval: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_EVAL_ANALYSIS_PER_HOUR, 25),
      windowMs: HOUR_MS,
      publicMessage: "Too many requests. Try again later.",
    },
    password_reset: {
      limit: positiveInteger(environment.REGSPAN_RATE_LIMIT_PASSWORD_RESETS_PER_15_MINUTES, 5),
      windowMs: 15 * 60 * 1000,
      publicMessage: "Too many requests. Try again later.",
      scopes: ["ip", "identifier"],
    },
    workspace_document_upload: {
      limit: positiveInteger(environment.REGSPAN_QUOTA_DOCUMENT_UPLOADS_PER_DAY, 100),
      windowMs: DAY_MS,
      publicMessage: "Upload quota reached. Try again later.",
      scopes: ["workspace"],
      quota: true,
    },
    workspace_upload_bytes: {
      limit: positiveInteger(environment.REGSPAN_QUOTA_UPLOAD_BYTES_PER_DAY, 100 * 1024 * 1024),
      windowMs: DAY_MS,
      publicMessage: "Upload quota reached. Try again later.",
      scopes: ["workspace"],
      quota: true,
    },
    workspace_processing_request: {
      limit: positiveInteger(environment.REGSPAN_QUOTA_PROCESSING_REQUESTS_PER_HOUR, 60),
      windowMs: HOUR_MS,
      publicMessage: "Workspace processing limit reached. Try again later.",
      scopes: ["workspace"],
      quota: true,
    },
  };
}

export const RATE_LIMITS = rateLimitConfiguration();

export function workspaceQuotaConfiguration(
  environment: RateLimitEnvironment = process.env,
) {
  return {
    maxActiveProcessingJobs: positiveInteger(
      environment.REGSPAN_QUOTA_MAX_ACTIVE_PROCESSING_JOBS,
      2,
    ),
    maxActiveAnalysisRuns: positiveInteger(
      environment.REGSPAN_QUOTA_MAX_ACTIVE_ANALYSIS_RUNS,
      1,
    ),
  };
}

const globalRateLimitState = globalThis as typeof globalThis & {
  __regspanRateLimitBuckets?: Map<string, RateLimitBucket>;
};

const buckets = globalRateLimitState.__regspanRateLimitBuckets
  ?? new Map<string, RateLimitBucket>();
globalRateLimitState.__regspanRateLimitBuckets = buckets;

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const candidate = forwarded || realIp;

  if (!candidate || candidate.length > 64 || !/^[0-9a-f:.]+$/i.test(candidate)) {
    return null;
  }

  return candidate;
}

export function hashRateLimitIdentifier(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function counterKey(category: RateLimitCategory, scope: RateLimitScope, value: string) {
  return hashRateLimitIdentifier(`${category}:${scope}:${value}`);
}

export function rateLimitCounterKeys(input: RateLimitInput) {
  const config = rateLimitConfiguration(input.environment);
  const scopes = config[input.category].scopes ?? ["ip", "user", "workspace", "identifier"];
  const keys: string[] = [];
  const ip = getClientIp(input.request);

  if (scopes.includes("ip") && ip) keys.push(counterKey(input.category, "ip", ip));
  if (scopes.includes("user") && input.userId) keys.push(counterKey(input.category, "user", input.userId));
  if (scopes.includes("workspace") && input.workspaceId) {
    keys.push(counterKey(input.category, "workspace", input.workspaceId));
  }
  if (scopes.includes("identifier") && input.identifier?.trim()) {
    keys.push(counterKey(input.category, "identifier", input.identifier));
  }

  if (keys.length === 0) {
    keys.push(counterKey(input.category, "anonymous", "anonymous"));
  }

  return keys;
}

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function consumeInMemoryLimiter({
  input,
  config,
  keys,
  now,
  cost,
}: {
  input: RateLimitInput;
  config: RateLimitConfig;
  keys: string[];
  now: number;
  cost: number;
}) {
  cleanupExpiredBuckets(now);
  for (const key of keys) {
    const current = buckets.get(key);
    if (current && current.count + cost > config.limit) {
      throw new RateLimitError(
        config.publicMessage,
        Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        input.category,
        config.quota,
      );
    }
  }

  for (const key of keys) {
    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: cost, resetAt: now + config.windowMs });
    } else {
      current.count += cost;
    }
  }
}

function durableLimiterRequired(environment: RateLimitEnvironment) {
  return environment.NODE_ENV === "production"
    || environment.REGSPAN_REQUIRE_DURABLE_RATE_LIMITING?.trim().toLowerCase() === "true";
}

function durableLimiterEnabled(environment: RateLimitEnvironment) {
  return (environment.REGSPAN_RATE_LIMIT_BACKEND ?? "")
    .trim()
    .toLowerCase() === "supabase";
}

async function recordExceededLimit(input: RateLimitInput, error: RateLimitError) {
  if (!input.supabase) return;
  await recordSecurityAuditEvent(input.supabase, {
    request: input.request,
    correlationId: input.correlationId,
    action: error.code === "quota_exceeded"
      ? "abuse.workspace_quota.exceeded"
      : "abuse.rate_limit.exceeded",
    outcome: "failure",
    workspaceId: input.workspaceId,
    actorUserId: input.userId,
    targetType: "request",
    metadata: {
      category: input.category,
      retry_after_seconds: error.retryAfterSeconds,
      limit_type: error.code,
    },
  });
}

function validateCost(cost: number | undefined) {
  const normalized = cost ?? 1;
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new RateLimitConfigurationError("Rate limit cost must be a positive integer.");
  }
  return normalized;
}

export async function checkRateLimit(input: RateLimitInput) {
  const environment = input.environment ?? process.env;
  const config = rateLimitConfiguration(environment)[input.category];
  const cost = validateCost(input.cost);
  const keys = rateLimitCounterKeys(input);
  const now = input.now ?? Date.now();

  if (!durableLimiterEnabled(environment)) {
    if (durableLimiterRequired(environment)) {
      throw new RateLimitConfigurationError(
        "Production requires REGSPAN_RATE_LIMIT_BACKEND=supabase.",
      );
    }
    try {
      consumeInMemoryLimiter({ input, config, keys, now, cost });
      return;
    } catch (error) {
      if (error instanceof RateLimitError) await recordExceededLimit(input, error);
      throw error;
    }
  }

  if (!input.supabase) {
    throw new RateLimitConfigurationError(
      "Supabase is required for durable rate limiting.",
    );
  }

  const counters: DurableCounter[] = keys.map((key) => ({
    counter_key: key,
    limit_value: config.limit,
    window_seconds: Math.ceil(config.windowMs / 1000),
    increment_by: cost,
  }));
  const { data, error } = await input.supabase.rpc("consume_rate_limit_batch_v1", {
    p_counters: counters,
  });

  if (error || !data) {
    console.error("[RegSpan security] Durable rate limit RPC failed", {
      category: input.category,
      code: error?.code ?? "missing_result",
    });
    throw new RateLimitConfigurationError("Durable rate limiting is unavailable.");
  }

  const result = data as DurableRateLimitResult;
  if (result.allowed !== true) {
    const rateLimitError = new RateLimitError(
      config.publicMessage,
      Math.max(1, Number(result.retry_after_seconds) || 1),
      input.category,
      config.quota,
    );
    await recordExceededLimit(input, rateLimitError);
    throw rateLimitError;
  }
}

export function rateLimitErrorResponse(error: unknown) {
  if (error instanceof RateLimitError) {
    return {
      status: error.status,
      headers: { "Retry-After": String(error.retryAfterSeconds) },
      body: { ok: false, error: error.publicMessage, code: error.code },
    };
  }
  if (error instanceof RateLimitConfigurationError) {
    return {
      status: error.status,
      headers: { "Retry-After": "60" },
      body: { ok: false, error: error.publicMessage, code: error.code },
    };
  }
  return null;
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
