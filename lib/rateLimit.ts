import "server-only";

import { createHash } from "node:crypto";

export type RateLimitCategory =
  | "document_upload"
  | "document_replace"
  | "document_reprocess"
  | "document_bulk_action"
  | "findings_generate"
  | "password_reset";

type RateLimitConfig = {
  limit: number;
  windowMs: number;
  publicMessage: string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitInput = {
  request: Request;
  category: RateLimitCategory;
  userId?: string | null;
  workspaceId?: string | null;
  identifier?: string | null;
  now?: number;
};

export class RateLimitError extends Error {
  public readonly status = 429;
  public readonly code = "rate_limited";

  constructor(
    public readonly publicMessage: string,
    public readonly retryAfterSeconds: number,
  ) {
    super(publicMessage);
    this.name = "RateLimitError";
  }
}

export const RATE_LIMITS: Record<RateLimitCategory, RateLimitConfig> = {
  document_upload: {
    limit: 12,
    windowMs: 60 * 60 * 1000,
    publicMessage: "Too many upload attempts. Please wait before uploading another document.",
  },
  document_replace: {
    limit: 12,
    windowMs: 60 * 60 * 1000,
    publicMessage: "Too many replacement attempts. Please wait before replacing another document.",
  },
  document_reprocess: {
    limit: 30,
    windowMs: 60 * 60 * 1000,
    publicMessage: "Too many reprocess requests. Please wait before trying again.",
  },
  document_bulk_action: {
    limit: 20,
    windowMs: 60 * 60 * 1000,
    publicMessage: "Too many bulk document actions. Please wait before trying again.",
  },
  findings_generate: {
    limit: 8,
    windowMs: 60 * 60 * 1000,
    publicMessage: "Too many Analysis requests. Please wait before running Analysis again.",
  },
  password_reset: {
    limit: 5,
    windowMs: 15 * 60 * 1000,
    publicMessage: "Too many password reset requests. Please wait before trying again.",
  },
};

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

function hashIdentifier(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function rateLimitKeys(input: RateLimitInput) {
  const keys = [];
  const ip = getClientIp(input.request);
  if (ip) keys.push(`${input.category}:ip:${ip}`);
  if (input.userId) keys.push(`${input.category}:user:${input.userId}`);
  if (input.workspaceId) keys.push(`${input.category}:workspace:${input.workspaceId}`);
  if (input.identifier?.trim()) {
    keys.push(`${input.category}:identifier:${hashIdentifier(input.identifier)}`);
  }

  // Keep anonymous local/dev requests bounded even when proxy headers are absent.
  if (keys.length === 0) {
    keys.push(`${input.category}:anonymous`);
  }

  return keys;
}

function cleanupExpiredBuckets(now: number) {
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

// MVP-local limiter. Production should replace this process-local state with
// Redis/Upstash/Supabase-backed durable counters shared by all app instances.
export function checkRateLimit(input: RateLimitInput) {
  const config = RATE_LIMITS[input.category];
  const now = input.now ?? Date.now();
  cleanupExpiredBuckets(now);

  const keys = rateLimitKeys(input);
  for (const key of keys) {
    const current = buckets.get(key);
    if (current && current.count >= config.limit) {
      throw new RateLimitError(
        config.publicMessage,
        Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      );
    }
  }

  for (const key of keys) {
    const current = buckets.get(key);
    if (!current) {
      buckets.set(key, { count: 1, resetAt: now + config.windowMs });
    } else {
      current.count += 1;
    }
  }
}

export function rateLimitErrorResponse(error: unknown) {
  if (!(error instanceof RateLimitError)) return null;
  return {
    status: error.status,
    headers: { "Retry-After": String(error.retryAfterSeconds) },
    body: { ok: false, error: error.publicMessage, code: error.code },
  };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
