import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { parseRecipientCsv } from "../src/lib/csv/parser";
import { getCanonicalRecipientStatus } from "../src/components/dashboard/BatchDetailView";
import { payoutStore } from "../src/lib/db/payout-store";
import { resetRetryCaches } from "../src/lib/multihopper/retry";
import { POST as estimateTransferRoute } from "../src/app/api/transfers/estimate/route";
import { POST as createTransferRoute } from "../src/app/api/transfers/route";
import { POST as prepareTransferRoute } from "../src/app/api/transfers/[id]/prepare/route";
import { POST as confirmBroadcastRoute } from "../src/app/api/transfers/[id]/confirm-broadcast/route";
import { POST as retryItemRoute } from "../src/app/api/items/[id]/retry/route";
import { getMultiHopperClient } from "../src/lib/multihopper/service";
import crypto from "node:crypto";

describe("Phase 2 — Real Payout Flow Comprehensive Verification", () => {
  const validWallet1 = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
  const validWallet2 = "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u";
  const tokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  beforeEach(() => {
    payoutStore.resetStore();
    resetRetryCaches();
  });

  // ==========================================
  // 1. CSV UPLOAD & VALIDATION
  // ==========================================
  describe("1. CSV Upload & Validation", () => {
    it("parses RFC-4180 compliant CSV files with quoted text and commas", () => {
      const csv = `address,amount,name\n"${validWallet1}","125.50","Acme, Corp"\n"${validWallet2}","75.25","Engineering Team"`;
      const result = parseRecipientCsv(csv, { tokenDecimals: 6 });

      expect(result.validCount).toBe(2);
      expect(result.errorCount).toBe(0);
      expect(result.rows[0].wallet).toBe(validWallet1);
      expect(result.rows[0].recipientName).toBe("Acme, Corp");
      expect(result.rows[0].amountFormatted).toBe("125.50");
      expect(result.rows[0].amountRaw).toBe("125500000");
    });

    it("validates Solana Base58 public keys inline and flags invalid addresses", () => {
      const csv = `address,amount\n${validWallet1},100\nNotAValidSolanaAddress123,50\n${validWallet2},75`;
      const result = parseRecipientCsv(csv);

      expect(result.validCount).toBe(2);
      expect(result.errorCount).toBe(1);
      const invalidRow = result.rows.find((r) => !r.isValid);
      expect(invalidRow).toBeDefined();
      expect(invalidRow?.errors.some((e) => e.includes("Invalid Solana Base58"))).toBe(true);
    });

    it("rejects duplicate recipient addresses across rows", () => {
      const csv = `address,amount\n${validWallet1},100\n${validWallet1},50`;
      const result = parseRecipientCsv(csv);

      expect(result.duplicateWallets).toContain(validWallet1);
      expect(result.validCount).toBe(0);
      expect(result.errorCount).toBe(2);
      expect(result.rows[0].isValid).toBe(false);
      expect(result.rows[1].isValid).toBe(false);
      expect(result.rows[0].errors.some((e) => e.includes("Duplicate wallet detected"))).toBe(true);
      expect(result.rows[1].errors.some((e) => e.includes("Duplicate wallet detected"))).toBe(true);
    });

    it("parses RFC-4180 multi-line quoted fields without corrupting records", () => {
      const csv = `address,amount,name\n"${validWallet1}","125.50","Line 1\nLine 2"\n"${validWallet2}","75.25","Normal Name"`;
      const result = parseRecipientCsv(csv);

      expect(result.validCount).toBe(2);
      expect(result.errorCount).toBe(0);
      expect(result.rows[0].recipientName).toBe("Line 1\nLine 2");
      expect(result.rows[1].recipientName).toBe("Normal Name");
    });

    it("enforces 500 recipient cap per batch UI and parser side", () => {
      // Generate 505 lines with distinct valid wallets
      const lines = ["address,amount"];
      for (let i = 0; i < 505; i++) {
        const dummyWallet = new PublicKey(Buffer.alloc(32, (i % 250) + 1)).toBase58();
        lines.push(`${dummyWallet},10`);
      }
      const csv = lines.join("\n");
      const result = parseRecipientCsv(csv, { maxRecipients: 500, requireOnCurve: false });

      expect(result.totalRecipients).toBe(505);
      // Rows exceeding 500 are marked invalid with cap error
      const cappedRows = result.rows.filter((r) => r.errors.some((e) => e.includes("cap exceeded")));
      expect(cappedRows.length).toBe(5);
    });
  });

  // ==========================================
  // 2. FEE PREVIEW & MULTIHOPPER ESTIMATE API
  // ==========================================
  describe("2. Fee Preview & MultiHopper API", () => {
    it("requires registered integration identifier circuitpay_treasury_v1", async () => {
      const req = new NextRequest("http://localhost:3000/api/transfers/estimate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-id": "unregistered_external_id",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          tokenMint,
          amountRaw: "1000000000",
        }),
      });

      const res = await estimateTransferRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid or missing integration identifier");
    });

    it("requires UUID Idempotency-Key on estimate requests", async () => {
      const req = new NextRequest("http://localhost:3000/api/transfers/estimate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-id": "circuitpay_treasury_v1",
          "Idempotency-Key": "not-a-valid-uuid",
        },
        body: JSON.stringify({
          tokenMint,
          amountRaw: "1000000000",
        }),
      });

      const res = await estimateTransferRoute(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Idempotency-Key must be a valid UUID");
    });

    it("calculates 0.5% (50 bps) customer fee, estimated arrival, hops, and total SOL & USD", async () => {
      const req = new NextRequest("http://localhost:3000/api/transfers/estimate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-id": "circuitpay_treasury_v1",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          tokenMint,
          tokenSymbol: "USDC",
          tokenDecimals: 6,
          amountRaw: "1000000000", // 1,000 USDC
          destinations: [
            { wallet: validWallet1, amountRaw: "600000000" },
            { wallet: validWallet2, amountRaw: "400000000" },
          ],
        }),
      });

      const res = await estimateTransferRoute(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.estimate).toBeDefined();
      // 50 bps on 1,000 USDC = 5 USDC (5,000,000 raw)
      expect(data.estimate.customerFeeRaw).toBe("5000000");
      expect(data.estimate.feeBps).toBe(50);
      expect(data.estimate.hops).toBeGreaterThanOrEqual(2);
      expect(data.estimate.estimatedArrivalSeconds).toBeGreaterThan(0);
      expect(data.estimate.totalCostSol).toBeDefined();
      expect(data.estimate.totalCostUsd).toBeDefined();
    });
  });

  // ==========================================
  // 3. BATCH CREATION & CHUNKING (<= 20)
  // ==========================================
  describe("3. Batch Creation & Partitioning", () => {
    it("POST /api/transfers enforces circuitpay_treasury_v1 and UUID Idempotency-Key", async () => {
      const req = new NextRequest("http://localhost:3000/api/transfers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-integration-id": "wrong_id",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          inputMint: tokenMint,
          sourceWallet: validWallet1,
          destinations: [{ wallet: validWallet2, amountRaw: "100000000" }],
        }),
      });

      const res = await createTransferRoute(req);
      expect(res.status).toBe(400);
    });

    it("automatically partitions recipients into chunks of <= 20 and stores unique UUID idempotency key per chunk", async () => {
      // 45 recipients -> ceil(45/20) = 3 chunks (20, 20, 5)
      const items = Array.from({ length: 45 }, (_, idx) => ({
        recipientWallet: new PublicKey(Buffer.alloc(32, idx + 1)).toBase58(),
        amountFormatted: "10.00",
        amountRaw: "10000000",
      }));

      const batch = await payoutStore.createPayoutBatch({
        title: "Large Batch Partition Test",
        senderWallet: validWallet1,
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "mainnet-beta",
        items,
      });

      expect(batch.transfers).toHaveLength(3);

      expect(batch.transfers[0].recipientCount).toBe(20);
      expect(batch.transfers[1].recipientCount).toBe(20);
      expect(batch.transfers[2].recipientCount).toBe(5);

      // Verify each chunk has a unique UUID idempotency key
      const keys = batch.transfers.map((t) => t.idempotencyKey);
      expect(keys.every(Boolean)).toBe(true);
      expect(new Set(keys).size).toBe(3);
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuidRegex.test(batch.transfers[0].idempotencyKey!)).toBe(true);
    });
  });

  // ==========================================
  // 4. WALLET SIGNING & SERVER NON-CUSTODIAL MODEL
  // ==========================================
  describe("4. Non-Custodial Wallet Signing", () => {
    it("builds unsigned base64 tx vectors server-side via /api/transfers/:id/prepare", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "Signing Flow Batch",
        senderWallet: validWallet1,
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "mainnet-beta",
        items: [{ recipientWallet: validWallet2, amountFormatted: "100.00", amountRaw: "100000000" }],
      });

      const transfer = batch.transfers[0];
      const req = new NextRequest(`http://localhost:3000/api/transfers/${transfer.id}/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerWallet: validWallet1 }),
      });

      const res = await prepareTransferRoute(req, { params: Promise.resolve({ id: transfer.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.transactions).toBeDefined();
      expect(typeof data.transactions.keeperFundingTx).toBe("string");
      expect(typeof data.transactions.routeInitTx).toBe("string");
      expect(typeof data.transactions.orchestratorInitTx).toBe("string");
      expect(typeof data.transactions.dispersionTx).toBe("string");

      // Verify server NEVER exposes private keys
      expect(data).not.toHaveProperty("privateKey");
      expect(data).not.toHaveProperty("secretKey");
    });

    it("confirms broadcast signatures via /api/transfers/:id/confirm-broadcast and transitions status", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "Broadcast Flow Batch",
        senderWallet: validWallet1,
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "mainnet-beta",
        items: [{ recipientWallet: validWallet2, amountFormatted: "50.00", amountRaw: "50000000" }],
      });

      const transfer = batch.transfers[0];
      const mockKeeperSig = "5MockKeeperFundingSignature1111111111111111111111111111111111111111";
      const mockRouteSig = "4MockRouteSignature22222222222222222222222222222222222222222";

      const req = new NextRequest(`http://localhost:3000/api/transfers/${transfer.id}/confirm-broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keeperFundingSignature: mockKeeperSig,
          routeInitSignature: mockRouteSig,
        }),
      });

      const res = await confirmBroadcastRoute(req, { params: Promise.resolve({ id: transfer.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.transfer.status).toBe("processing");
      expect(data.transfer.keeperFundingSignature).toBe(mockKeeperSig);
    });
  });

  // ==========================================
  // 5. STATUS POLLING & CANONICAL MAPPING
  // ==========================================
  describe("5. Status Polling & Canonical Mapping", () => {
    it("maps diverse raw statuses to canonical pending / routing / delivered / failed", () => {
      expect(getCanonicalRecipientStatus("paid")).toBe("delivered");
      expect(getCanonicalRecipientStatus("delivered")).toBe("delivered");
      expect(getCanonicalRecipientStatus("settled")).toBe("delivered");
      expect(getCanonicalRecipientStatus("completed")).toBe("delivered");

      expect(getCanonicalRecipientStatus("processing")).toBe("routing");
      expect(getCanonicalRecipientStatus("routing")).toBe("routing");
      expect(getCanonicalRecipientStatus("in_flight")).toBe("routing");
      expect(getCanonicalRecipientStatus("broadcasting")).toBe("routing");

      expect(getCanonicalRecipientStatus("failed")).toBe("failed");
      expect(getCanonicalRecipientStatus("error")).toBe("failed");
      expect(getCanonicalRecipientStatus("cancelled")).toBe("failed");

      expect(getCanonicalRecipientStatus("pending")).toBe("pending");
      expect(getCanonicalRecipientStatus("draft")).toBe("pending");
      expect(getCanonicalRecipientStatus("queued")).toBe("pending");
    });
  });

  // ==========================================
  // 6. RETRIES & DOUBLE-PAYMENT PROTECTION
  // ==========================================
  describe("6. Item-Level Retries & Idempotency", () => {
    it("rejects retry when item is already settled (paid/delivered)", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "Settled Item Retry Test",
        senderWallet: validWallet1,
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "mainnet-beta",
        items: [{ recipientWallet: validWallet2, amountFormatted: "100.00", amountRaw: "100000000" }],
      });

      const item = batch.items[0];
      // Mark item as paid
      await payoutStore.updatePayoutItem(item.id, {
        status: "paid",
        payoutSignature: "5wPaidSigPreSol",
      });

      const req = new NextRequest(`http://localhost:3000/api/items/${item.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await retryItemRoute(req, { params: Promise.resolve({ id: item.id }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("already settled");
    });

    it("retries failed item safely reusing the transfer's stored idempotency key", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "Failed Item Retry Test",
        senderWallet: validWallet1,
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "mainnet-beta",
        items: [{ recipientWallet: validWallet2, amountFormatted: "100.00", amountRaw: "100000000" }],
      });

      const item = batch.items[0];
      const transfer = batch.transfers[0];
      const originalKey = transfer.idempotencyKey;

      // Mark item and transfer as failed
      await payoutStore.updatePayoutItem(item.id, { status: "failed" });
      await payoutStore.updateTransfer(transfer.id, { status: "failed" });

      const req = new NextRequest(`http://localhost:3000/api/items/${item.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await retryItemRoute(req, { params: Promise.resolve({ id: item.id }) });
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.item.status).toBe("paid");
      // Must reuse exactly the transfer's stored idempotency key
      expect(data.idempotencyKey).toBe(originalKey);
    });

    it("rejects retry when item is currently in-flight (processing/routing)", async () => {
      const batch = await payoutStore.createPayoutBatch({
        title: "In-Flight Retry Guard Test",
        senderWallet: validWallet1,
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "mainnet-beta",
        items: [{ recipientWallet: validWallet2, amountFormatted: "100.00", amountRaw: "100000000" }],
      });

      const item = batch.items[0];
      await payoutStore.updatePayoutItem(item.id, { status: "routing" });

      const req = new NextRequest(`http://localhost:3000/api/items/${item.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await retryItemRoute(req, { params: Promise.resolve({ id: item.id }) });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("in-flight");
    });

    it("calls estimateFee() on MultiHopperClient with real MultiHopper API contract", async () => {
      const client = getMultiHopperClient("devnet");
      expect(typeof client.estimateFee).toBe("function");

      const estimate = await client.estimateFee({
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        amountRaw: "1000000000",
        hops: 4,
        arrivalSeconds: 900,
      });

      expect(estimate.percentFeeBps).toBe(50);
      expect(estimate.percentFeeRaw).toBe("5000000");
      expect(estimate.sol.requiredSolUpFrontLamports).toBeDefined();
    });
  });
});
