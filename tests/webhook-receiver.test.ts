import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import { POST } from "../src/app/api/webhooks/multihopper/route";
import { payoutStore } from "../src/lib/db/payout-store";
import { NextRequest } from "next/server";

describe("Webhook Receiver Endpoint (/api/webhooks/multihopper)", () => {
  const secret = process.env.MULTIHOPPER_WEBHOOK_SECRET || "whsec_test_secret_for_local_hmac";
  const dummyWallet = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";

  function createSignedRequest(payload: Record<string, unknown>, customSignature?: string) {
    const rawBody = JSON.stringify(payload);
    const signature =
      customSignature !== undefined
        ? customSignature
        : crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    return new NextRequest("http://localhost:3000/api/webhooks/multihopper", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-multihopper-signature": signature,
      },
      body: rawBody,
    });
  }

  beforeEach(() => {
    payoutStore.resetStore();
  });

  it("rejects requests missing x-multihopper-signature header with 401", async () => {
    const req = new NextRequest("http://localhost:3000/api/webhooks/multihopper", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/Missing x-multihopper-signature/);
  });

  it("rejects requests with invalid HMAC signatures with 401", async () => {
    const payload = {
      eventId: "evt_1",
      eventType: "transfer.deposit_confirmed",
      timestamp: Date.now(),
      data: { id: "tr_1", status: "processing" },
    };

    const req = createSignedRequest(payload, "bad_signature_deadbeef");
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid webhook HMAC signature/);
  });

  it("rejects requests with timestamp older than 5 minutes with 401", async () => {
    const expiredTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const payload = {
      eventId: "evt_expired_replay",
      eventType: "transfer.deposit_confirmed",
      timestamp: expiredTimestamp,
      data: { id: "tr_1", status: "processing" },
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toMatch(/5-minute replay window/);
  });

  it("processes valid webhook and advances transfer state to processing on deposit_confirmed", async () => {
    // 1. Create a batch with transfer
    const batch = await payoutStore.createPayoutBatch({
      title: "Batch Webhook Test",
      senderWallet: dummyWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet, amountFormatted: "150.00" }],
    });

    const transfer = batch.transfers[0];
    const externalId = transfer.externalId;

    const payload = {
      eventId: "evt_deposit_001",
      eventType: "transfer.deposit_confirmed" as const,
      timestamp: new Date().toISOString(),
      data: {
        id: "mh_transfer_real_999",
        externalId,
        status: "processing",
      },
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.received).toBe(true);

    // Verify transfer updated
    const updatedTransfer = await payoutStore.getTransferByIdOrExternal(externalId);
    expect(updatedTransfer?.status).toBe("processing");
    expect(updatedTransfer?.multihopperId).toBe("mh_transfer_real_999");
  });

  it("deduplicates replay events with the same eventId", async () => {
    const payload = {
      eventId: "evt_replay_test_888",
      eventType: "transfer.processing" as const,
      timestamp: Date.now(),
      data: {
        id: "mh_123",
        status: "processing",
      },
    };

    // First call
    const req1 = createSignedRequest(payload);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.success).toBe(true);
    expect(json1.deduplicated).toBeUndefined();

    // Replay call
    const req2 = createSignedRequest(payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.success).toBe(true);
    expect(json2.deduplicated).toBe(true);
    expect(json2.message).toMatch(/already processed/);
  });

  it("advances transfer to completed, marks items paid with signatures, and records qualifying volume on mainnet", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Completed Webhook Test",
      senderWallet: dummyWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      network: "mainnet-beta",
      items: [
        { recipientWallet: dummyWallet, amountFormatted: "1000.00" },
      ],
    });

    const transfer = batch.transfers[0];

    // Transfer must first be in processing before transitioning to completed
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });

    const payload = {
      eventId: "evt_comp_1001",
      eventType: "transfer.completed" as const,
      timestamp: Date.now(),
      data: {
        id: "mh_completed_transfer",
        externalId: transfer.externalId,
        network: "mainnet-beta" as const,
        status: "completed",
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "1000000000",
        percentFeeRaw: "5000000", // 5 USDC fee
        destinations: [
          {
            wallet: dummyWallet,
            amountRaw: "995000000",
            status: "paid" as const,
            payoutSignature: "5wTestPayoutSignatureSolanaExplorerTx123",
          },
        ],
      },
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.volumeCalculation).toBeDefined();
    // 5 USDC fee / 0.0025 = 2000 USD qualifying volume
    expect(json.volumeCalculation.qualifyingVolumeUsd).toBe(2000);

    const updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("completed");

    const updatedItem = updatedBatch?.items[0];
    expect(updatedItem?.status).toBe("paid");
    expect(updatedItem?.payoutSignature).toBe("5wTestPayoutSignatureSolanaExplorerTx123");

    // Verify volume ledger entry was written
    const volumeEntries = payoutStore.getVolumeLedger();
    expect(volumeEntries.length).toBeGreaterThan(0);
    expect(volumeEntries[0].qualifyingVolumeUsd).toBe("2000.0000");
  });

  it("accepts signatures with sha256= prefix and uppercase hex", async () => {
    const payload = {
      eventId: "evt_sha256_prefix_test",
      eventType: "transfer.processing" as const,
      timestamp: Date.now(),
      data: { id: "tr_prefix", status: "processing" },
    };

    const rawBody = JSON.stringify(payload);
    const hexSig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex").toUpperCase();
    const req = new NextRequest("http://localhost:3000/api/webhooks/multihopper", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-multihopper-signature": `sha256=${hexSig}`,
      },
      body: rawBody,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("handles transfer.refunded event and updates transfer and items to refunded", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Refund Test Batch",
      senderWallet: dummyWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet, amountFormatted: "75.00" }],
    });

    const transfer = batch.transfers[0];
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const payload = {
      eventId: "evt_refund_999",
      eventType: "transfer.refunded" as const,
      timestamp: Date.now(),
      data: {
        id: "mh_refunded_1",
        externalId: transfer.externalId,
        status: "refunded",
      },
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);
    expect(res.status).toBe(200);

    const updatedTransfer = await payoutStore.getTransferByIdOrExternal(transfer.externalId);
    expect(updatedTransfer?.status).toBe("refunded");

    const updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("refunded");
  });
});
