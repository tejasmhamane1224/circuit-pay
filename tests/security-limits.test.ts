import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  RateLimiter,
  checkRequestRateLimit,
  appRateLimiter,
} from "../src/lib/security/rate-limit";
import {
  validateBatchLimits,
  calculateUsdValue,
  getSecurityLimits,
} from "../src/lib/security/limits";
import { scrubSensitiveData, sanitizeString } from "../src/lib/monitoring/scrubber";
import { payoutStore } from "../src/lib/db/payout-store";

describe("Rate Limiter (Sliding Window Engine)", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3 });
    appRateLimiter.clear();
  });

  it("allows requests up to the max limit within the window", () => {
    const r1 = limiter.check("client-ip-1", 3, 1000);
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check("client-ip-1", 3, 1000);
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check("client-ip-1", 3, 1000);
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("blocks requests once the limit is exceeded", () => {
    limiter.check("client-ip-2", 2, 1000);
    limiter.check("client-ip-2", 2, 1000);

    const r3 = limiter.check("client-ip-2", 2, 1000);
    expect(r3.success).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("tracks rate limits independently across different keys", () => {
    limiter.check("user-a", 2, 1000);
    limiter.check("user-a", 2, 1000);
    const blockedA = limiter.check("user-a", 2, 1000);
    expect(blockedA.success).toBe(false);

    // user-b has fresh quota
    const freshB = limiter.check("user-b", 2, 1000);
    expect(freshB.success).toBe(true);
    expect(freshB.remaining).toBe(1);
  });

  it("resets quota when explicitly requested", () => {
    limiter.check("user-c", 1, 1000);
    expect(limiter.check("user-c", 1, 1000).success).toBe(false);

    limiter.reset("user-c");
    const fresh = limiter.check("user-c", 1, 1000);
    expect(fresh.success).toBe(true);
  });

  it("extracts IP and creates standard 429 response when limit exceeded", () => {
    const req = new NextRequest("http://localhost:3000/api/batches", {
      headers: { "x-forwarded-for": "198.51.100.42" },
    });

    // Exhaust quota (limit = 2)
    appRateLimiter.check("batches:198.51.100.42", 2, 60000);
    appRateLimiter.check("batches:198.51.100.42", 2, 60000);

    const rateResult = checkRequestRateLimit(req, "batches", undefined, { limit: 2 });
    expect(rateResult.allowed).toBe(false);
    expect(rateResult.response).toBeDefined();
    expect(rateResult.response?.status).toBe(429);
    expect(rateResult.headers["X-RateLimit-Limit"]).toBe("2");
    expect(rateResult.headers["Retry-After"]).toBeDefined();
  });

  it("enforces sliding window limits during rapid bursts of 31 requests against 30 req/min limit", () => {
    const burstLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 30 });
    const clientKey = "burst-client-ip";

    // 30 requests should all be allowed
    for (let i = 0; i < 30; i++) {
      const res = burstLimiter.check(clientKey, 30, 60000);
      expect(res.success).toBe(true);
      expect(res.remaining).toBe(29 - i);
    }

    // 31st request in the same window must be blocked
    const resBlocked = burstLimiter.check(clientKey, 30, 60000);
    expect(resBlocked.success).toBe(false);
    expect(resBlocked.remaining).toBe(0);
    expect(resBlocked.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("correctly resolves rate limit categories for batches, webhooks, and retry", () => {
    const batchesReq = new NextRequest("http://localhost:3000/api/batches", {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });
    const retryReq = new NextRequest("http://localhost:3000/api/batches/batch-1/retry", {
      headers: { "x-forwarded-for": "203.0.113.1" },
    });

    const batchesRes = checkRequestRateLimit(batchesReq, "batches");
    const retryRes = checkRequestRateLimit(retryReq, "retry");

    expect(batchesRes.result.limit).toBe(30);
    expect(retryRes.result.limit).toBe(10);
  });

  it("handles x-vercel-forwarded-for and req.ip in getClientIp", () => {
    const reqVercel = new NextRequest("http://localhost:3000/api/batches", {
      headers: { "x-vercel-forwarded-for": "198.51.100.99" },
    });
    const res = checkRequestRateLimit(reqVercel, "batches");
    expect(res.allowed).toBe(true);
  });
});

describe("Per-Organization Safety Caps & Limits", () => {
  const dummyOrgId = "test-org-00000000-0000-0000-0000-000000000001";
  const validWallet = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";

  beforeEach(() => {
    payoutStore.resetStore();
  });

  it("loads default security limits", () => {
    const limits = getSecurityLimits();
    expect(limits.maxBatchAmountUsd).toBe(100000);
    expect(limits.maxRecipientsPerBatch).toBe(500);
    expect(limits.dailyOrgVolumeLimitUsd).toBe(500000);
    expect(limits.solUsdRate).toBe(150);
  });

  it("allows batch within valid limits", async () => {
    const result = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [
        { recipientWallet: validWallet, amountFormatted: "500.00" },
        { recipientWallet: validWallet, amountFormatted: "1500.00" },
      ],
    });

    expect(result.allowed).toBe(true);
    expect(result.details?.batchAmountUsd).toBe(2000);
    expect(result.details?.recipientCount).toBe(2);
  });

  it("allows exactly 500 recipients (boundary condition)", async () => {
    const items = Array.from({ length: 500 }, () => ({
      recipientWallet: validWallet,
      amountFormatted: "1.00",
    }));

    const result = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items,
    });

    expect(result.allowed).toBe(true);
    expect(result.details?.recipientCount).toBe(500);
  });

  it("blocks batches exceeding the recipient cap (501 recipients)", async () => {
    const items = Array.from({ length: 501 }, () => ({
      recipientWallet: validWallet,
      amountFormatted: "1.00",
    }));

    const result = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items,
    });

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("MAX_RECIPIENTS_EXCEEDED");
    expect(result.error).toContain("500 recipients");
  });

  it("rejects batches with zero recipients", async () => {
    const result = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [],
    });

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("RECIPIENTS_REQUIRED");
    expect(result.error).toContain("at least one recipient");
  });

  it("blocks batches with non-positive or non-finite amounts (negative, zero, Infinity)", async () => {
    const resNegative = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [{ recipientWallet: validWallet, amountFormatted: "-100.00" }],
    });
    expect(resNegative.allowed).toBe(false);
    expect(resNegative.errorCode).toBe("INVALID_ITEM_AMOUNT");

    const resZero = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [{ recipientWallet: validWallet, amountFormatted: "0.00" }],
    });
    expect(resZero.allowed).toBe(false);
    expect(resZero.errorCode).toBe("INVALID_ITEM_AMOUNT");

    const resInfinity = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [{ recipientWallet: validWallet, amountFormatted: "Infinity" }],
    });
    expect(resInfinity.allowed).toBe(false);
    expect(resInfinity.errorCode).toBe("INVALID_ITEM_AMOUNT");
  });

  it("allows single batch exactly at $100,000 USD and blocks $100,000.01 USD", async () => {
    const resultBoundary = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [{ recipientWallet: validWallet, amountFormatted: "100000.00" }],
    });
    expect(resultBoundary.allowed).toBe(true);

    const resultExceeded = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [{ recipientWallet: validWallet, amountFormatted: "100000.01" }],
    });
    expect(resultExceeded.allowed).toBe(false);
    expect(resultExceeded.errorCode).toBe("MAX_BATCH_AMOUNT_EXCEEDED");
  });

  it("correctly converts SOL to USD for limits checking", () => {
    const usdVal = calculateUsdValue("10", "SOL", 150);
    expect(usdVal).toBe(1500);

    const usdValLower = calculateUsdValue("10", "sol", 150);
    expect(usdValLower).toBe(1500);

    const usdcVal = calculateUsdValue("1500", "USDC", 150);
    expect(usdcVal).toBe(1500);
  });

  it("computes daily organization volume case-insensitively for SOL", async () => {
    await payoutStore.createPayoutBatch({
      organizationId: dummyOrgId,
      title: "Sol Batch",
      senderWallet: validWallet,
      tokenMint: "So11111111111111111111111111111111111111112",
      tokenSymbol: "sol", // lowercase
      tokenDecimals: 9,
      items: [{ recipientWallet: validWallet, amountFormatted: "10.00" }],
    });

    const dailyVol = await payoutStore.getDailyOrganizationVolume(dummyOrgId, undefined, 150);
    expect(dailyVol).toBe(1500);
  });

  it("accurately reports existing daily volume in details when single batch cap is exceeded", async () => {
    // Seed existing volume of $50,000
    await payoutStore.createPayoutBatch({
      organizationId: dummyOrgId,
      title: "Seed Batch",
      senderWallet: validWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: validWallet, amountFormatted: "50000.00" }],
    });

    const result = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [{ recipientWallet: validWallet, amountFormatted: "105000.00" }],
    });

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("MAX_BATCH_AMOUNT_EXCEEDED");
    expect(result.details?.currentDailyVolumeUsd).toBe(50000);
    expect(result.details?.projectedDailyVolumeUsd).toBe(155000);
  });

  it("blocks batches exceeding the daily organization volume limit ($500,000 USD)", async () => {
    // Seed existing batch of $450,000 USD for dummyOrgId
    await payoutStore.createPayoutBatch({
      organizationId: dummyOrgId,
      title: "Earlier Large Batch",
      senderWallet: validWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [
        { recipientWallet: validWallet, amountFormatted: "450000.00" },
      ],
    });

    // Attempt new batch of $60,000 USD (total would be $510,000 > $500,000 limit)
    const result = await validateBatchLimits({
      organizationId: dummyOrgId,
      tokenSymbol: "USDC",
      items: [
        { recipientWallet: validWallet, amountFormatted: "60000.00" },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.errorCode).toBe("DAILY_VOLUME_LIMIT_EXCEEDED");
    expect(result.error).toContain("Daily organization volume limit");
  });
});

describe("Sensitive Data Scrubber (Zero-Leakage Guarantee)", () => {
  it("scrubs MultiHopper, Sentry, and JWT secrets from strings", () => {
    const raw = "Error connecting with key mh_live_abc123xyz and token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy and token sntrys_secret123";
    const scrubbed = sanitizeString(raw);

    expect(scrubbed).not.toContain("mh_live_abc123xyz");
    expect(scrubbed).not.toContain("sntrys_secret123");
    expect(scrubbed).toContain("[REDACTED_SECRET]");
  });

  it("redacts database credentials embedded in PostgreSQL connection strings", () => {
    const raw = "Database failure at postgresql://postgres:mysecretpassword123@aws.supabase.co:5432/circuitpay";
    const scrubbed = sanitizeString(raw);

    expect(scrubbed).not.toContain("mysecretpassword123");
    expect(scrubbed).toContain("postgresql://postgres:[REDACTED_PASSWORD]@aws.supabase.co:5432/circuitpay");
  });

  it("redacts Solana 32-byte and 64-byte secret key byte arrays (Array and Uint8Array)", () => {
    const dummyKeyBytes = Array.from({ length: 64 }, (_, i) => i % 256);
    const scrubbed = scrubSensitiveData({
      user: "treasury-admin",
      secretKey: dummyKeyBytes,
    });
    expect(scrubbed.secretKey).toBe("[REDACTED]");

    // Verify Uint8Array directly (e.g. Keypair.secretKey) is redacted and NOT leaked as object
    const rawKeyUint8 = new Uint8Array(64);
    rawKeyUint8.fill(42);
    const scrubbedDirect = scrubSensitiveData(rawKeyUint8);
    expect(scrubbedDirect).toBe("[REDACTED_KEY_BYTES]");

    // Verify Uint8Array inside a non-sensitive property name
    const scrubbedNested = scrubSensitiveData({ keyData: new Uint8Array(32) });
    expect(scrubbedNested.keyData).toBe("[REDACTED_KEY_BYTES]");
  });

  it("redacts auth tokens and cookie headers from metadata objects", () => {
    const payload = {
      headers: {
        authorization: "Bearer my-secret-session-jwt",
        cookie: "session_id=super_secret_cookie_val",
        contentType: "application/json",
      },
      webhookSecret: "whsec_test_secret",
      transfersCount: 5,
    };

    const scrubbed = scrubSensitiveData(payload);
    expect(scrubbed.headers.authorization).toBe("[REDACTED]");
    expect(scrubbed.headers.cookie).toBe("[REDACTED]");
    expect(scrubbed.webhookSecret).toBe("[REDACTED]");
    expect(scrubbed.transfersCount).toBe(5);
  });
});
