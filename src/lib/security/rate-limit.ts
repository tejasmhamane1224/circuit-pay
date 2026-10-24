import { NextRequest, NextResponse } from "next/server";

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Seconds until window reset
  retryAfter: number; // Seconds to wait before retry
}

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  cleanupIntervalMs?: number;
}

/**
 * High-performance sliding window rate limiter
 * Enforces per-client, per-org, and per-endpoint quotas
 */
export class RateLimiter {
  private requests = new Map<string, number[]>();
  private defaultLimit: number;
  private defaultWindowMs: number;
  private lastCleanup = Date.now();
  private cleanupIntervalMs: number;

  constructor(options: RateLimiterOptions = {}) {
    this.defaultWindowMs = options.windowMs ?? 60 * 1000; // 1 minute window
    this.defaultLimit = options.maxRequests ?? 60; // 60 requests / min default
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? 5 * 60 * 1000; // 5 min sweep
  }

  /**
   * Evaluates if a request for a key is permitted under the sliding window
   */
  public check(
    key: string,
    limit: number = this.defaultLimit,
    windowMs: number = this.defaultWindowMs
  ): RateLimitResult {
    const now = Date.now();
    this.maybeCleanup(now);

    const windowStart = now - windowMs;
    const timestamps = (this.requests.get(key) || []).filter((t) => t > windowStart);

    if (timestamps.length >= limit) {
      const indexToFree = Math.max(0, timestamps.length - limit);
      const oldestTimestamp = timestamps[indexToFree] || windowStart;
      const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

      this.requests.set(key, timestamps);
      return {
        success: false,
        limit,
        remaining: 0,
        reset: retryAfter,
        retryAfter,
      };
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);

    const oldestTimestamp = timestamps[0];
    const reset = Math.max(1, Math.ceil((oldestTimestamp + windowMs - now) / 1000));

    return {
      success: true,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      reset,
      retryAfter: 0,
    };
  }

  /**
   * Explicitly resets quotas for a key (useful for tests and admin resets)
   */
  public reset(key: string): void {
    this.requests.delete(key);
  }

  /**
   * Clears all tracking state
   */
  public clear(): void {
    this.requests.clear();
  }

  private maybeCleanup(now: number): void {
    if (now - this.lastCleanup > this.cleanupIntervalMs) {
      this.lastCleanup = now;
      const cutoff = now - Math.max(this.defaultWindowMs, 60000);
      for (const [key, timestamps] of this.requests.entries()) {
        const valid = timestamps.filter((t) => t > cutoff);
        if (valid.length === 0) {
          this.requests.delete(key);
        } else {
          this.requests.set(key, valid);
        }
      }
    }
  }
}

// Global rate limiter instance for Next.js runtime
const globalForLimiter = globalThis as unknown as { appRateLimiter?: RateLimiter };
export const appRateLimiter = globalForLimiter.appRateLimiter ?? new RateLimiter();
globalForLimiter.appRateLimiter = appRateLimiter;

export type EndpointCategory = "batches" | "transfers" | "webhooks" | "retry" | "schedules" | "default";

/**
 * Resolves configured rate limits from environment variables
 */
export function getCategoryLimit(category: EndpointCategory): { limit: number; windowMs: number } {
  const windowMs = 60 * 1000; // 1 minute
  let limit: number;

  switch (category) {
    case "batches":
    case "transfers":
      limit = parseInt(process.env.RATE_LIMIT_BATCHES_PER_MIN || "30", 10);
      break;
    case "schedules":
      limit = parseInt(process.env.RATE_LIMIT_SCHEDULES_PER_MIN || "30", 10);
      break;
    case "webhooks":
      limit = parseInt(process.env.RATE_LIMIT_WEBHOOKS_PER_MIN || "120", 10);
      break;
    case "retry":
      limit = parseInt(process.env.RATE_LIMIT_RETRY_PER_MIN || "10", 10);
      break;
    default:
      limit = parseInt(process.env.RATE_LIMIT_DEFAULT_PER_MIN || "60", 10);
      break;
  }

  return { limit: Number.isFinite(limit) && limit > 0 ? limit : 60, windowMs };
}

/**
 * Extracts client IP safely from NextRequest
 */
export function getClientIp(req: NextRequest): string {
  const reqIp = (req as unknown as { ip?: string }).ip;
  if (reqIp) return reqIp;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || req.headers.get("x-vercel-forwarded-for") || "127.0.0.1";
}

/**
 * Checks rate limiting for an incoming Next.js API request
 */
export function checkRequestRateLimit(
  req: NextRequest,
  category: EndpointCategory = "default",
  customKey?: string,
  options?: { limit?: number; windowMs?: number }
): {
  allowed: boolean;
  result: RateLimitResult;
  headers: Record<string, string>;
  response?: NextResponse;
} {
  const ip = getClientIp(req);
  const key = customKey || `${category}:${ip}`;
  const categoryConfig = getCategoryLimit(category);
  const limit = options?.limit ?? categoryConfig.limit;
  const windowMs = options?.windowMs ?? categoryConfig.windowMs;

  const result = appRateLimiter.check(key, limit, windowMs);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.reset.toString(),
  };

  if (!result.success) {
    headers["Retry-After"] = result.retryAfter.toString();

    const response = NextResponse.json(
      {
        success: false,
        error: "Rate limit exceeded. Please wait before retrying.",
        retryAfter: result.retryAfter,
      },
      {
        status: 429,
        headers,
      }
    );

    return { allowed: false, result, headers, response };
  }

  return { allowed: true, result, headers };
}
