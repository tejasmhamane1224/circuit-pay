import { describe, it, expect } from "vitest";
import {
  solanaAddressSchema,
  estimateTransferSchema,
  createTransferSchema,
  createPayoutBatchSchema,
} from "@/lib/validations";
import { verifyMultiHopperWebhook } from "@/lib/multihopper/webhook";
import crypto from "node:crypto";

describe("Solana Address Validation Schema", () => {
  it("accepts valid Solana Base58 32-byte public keys", () => {
    const validAddresses = [
      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      "So11111111111111111111111111111111111111112", // WSOL
      "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh", // MultiHopper Core
    ];

    for (const addr of validAddresses) {
      const res = solanaAddressSchema.safeParse(addr);
      expect(res.success).toBe(true);
    }
  });

  it("rejects invalid addresses (wrong length, invalid chars)", () => {
    expect(solanaAddressSchema.safeParse("not-a-solana-address").success).toBe(false);
    expect(solanaAddressSchema.safeParse("").success).toBe(false);
    // 0, O, I, l are invalid in standard Base58
    expect(solanaAddressSchema.safeParse("0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl").success).toBe(false);
  });
});

describe("MultiHopper Transfer Validation Schemas", () => {
  const validMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const validSender = "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh";

  it("accepts valid estimate payload", () => {
    const valid = {
      tokenMint: validMint,
      amountRaw: "1000000000",
      tokenDecimals: 6,
      hops: 4,
      destinationCount: 5,
      arrivalSeconds: 900,
    };
    expect(estimateTransferSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects estimate with hops out of range (must be 3-10)", () => {
    expect(
      estimateTransferSchema.safeParse({
        tokenMint: validMint,
        amountRaw: "1000000000",
        hops: 2, // too low
      }).success
    ).toBe(false);

    expect(
      estimateTransferSchema.safeParse({
        tokenMint: validMint,
        amountRaw: "1000000000",
        hops: 11, // too high
      }).success
    ).toBe(false);
  });

  it("accepts valid create transfer payload with destinations <= 20", () => {
    const payload = {
      tokenMint: validMint,
      amountRaw: "5000000000",
      amountTokens: "5000.0",
      tokenDecimals: 6,
      tokenSymbol: "USDC",
      sourceOwner: validSender,
      hops: 4,
      arrivalSeconds: 900,
      externalId: "payroll_batch_01_chunk_0",
      destinations: [
        { wallet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "2500000000" },
        { wallet: "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh", amountRaw: "2500000000" },
      ],
    };

    const res = createTransferSchema.safeParse(payload);
    expect(res.success).toBe(true);
  });

  it("rejects create transfer when destination shares do not equal amountRaw", () => {
    const payload = {
      tokenMint: validMint,
      amountRaw: "5000000000",
      amountTokens: "5000.0",
      tokenDecimals: 6,
      tokenSymbol: "USDC",
      sourceOwner: validSender,
      hops: 4,
      arrivalSeconds: 900,
      externalId: "payroll_batch_01_chunk_0",
      destinations: [
        { wallet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", amountRaw: "2000000000" },
        { wallet: "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh", amountRaw: "2000000000" },
      ], // Sum = 4,000,000,000 != 5,000,000,000
    };

    const res = createTransferSchema.safeParse(payload);
    expect(res.success).toBe(false);
  });

  it("rejects create transfer exceeding MultiHopper 20 destinations limit", () => {
    const destinations = [];
    for (let i = 0; i < 21; i++) {
      destinations.push({
        wallet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "1000",
      });
    }

    const payload = {
      tokenMint: validMint,
      amountRaw: "21000",
      amountTokens: "0.021",
      tokenDecimals: 6,
      tokenSymbol: "USDC",
      sourceOwner: validSender,
      hops: 4,
      arrivalSeconds: 900,
      externalId: "batch_exceed_cap",
      destinations,
    };

    const res = createTransferSchema.safeParse(payload);
    expect(res.success).toBe(false);
  });

  it("rejects create transfer when both recipientWallet and destinations are provided", () => {
    const payload = {
      tokenMint: validMint,
      amountRaw: "1000",
      amountTokens: "0.001",
      tokenDecimals: 6,
      tokenSymbol: "USDC",
      sourceOwner: validSender,
      hops: 4,
      arrivalSeconds: 900,
      externalId: "conflict_test",
      recipientWallet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      destinations: [
        { wallet: "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh", amountRaw: "1000" },
      ],
    };

    const res = createTransferSchema.safeParse(payload);
    expect(res.success).toBe(false);
  });
});

describe("Payout Batch Creation Schema", () => {
  it("accepts valid batch input with items", () => {
    const validBatch = {
      organizationId: "123e4567-e89b-12d3-a456-426614174000",
      title: "Core Team Payroll",
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      network: "mainnet-beta" as const,
      hops: 4,
      arrivalSeconds: 900,
      items: [
        {
          recipientWallet: "3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh",
          recipientName: "Alice",
          amountFormatted: "1500.00",
        },
      ],
    };

    expect(createPayoutBatchSchema.safeParse(validBatch).success).toBe(true);
  });
});

describe("MultiHopper HMAC-SHA256 Webhook Verification", () => {
  const secret = "whsec_test_secret_for_unit_tests";
  const body = JSON.stringify({
    eventId: "evt_12345",
    eventType: "transfer.completed",
    timestamp: Date.now(),
    data: { id: "mh_tr_123", status: "completed" },
  });

  it("validates correct HMAC-SHA256 signature", () => {
    const validSignature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyMultiHopperWebhook(body, validSignature, secret)).toBe(true);
  });

  it("rejects tampered body or invalid signature", () => {
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const tamperedBody = body.replace("transfer.completed", "transfer.failed");
    expect(verifyMultiHopperWebhook(tamperedBody, signature, secret)).toBe(false);
    expect(verifyMultiHopperWebhook(body, "bad_signature", secret)).toBe(false);
  });
});
