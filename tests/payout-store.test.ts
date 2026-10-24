import { describe, it, expect, beforeEach } from "vitest";
import { payoutStore } from "../src/lib/db/payout-store";

describe("Payout Repository & Store Layer", () => {
  beforeEach(() => {
    payoutStore.resetStore();
  });

  const senderWallet = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
  const dummyWallet = "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u";

  it("creates a batch with 25 recipients partitioned into 2 transfers under 20-destination cap", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      recipientWallet: dummyWallet,
      amountFormatted: "100.00",
      recipientName: `Dev #${i + 1}`,
    }));

    const batch = await payoutStore.createPayoutBatch({
      title: "Sprint 19 Core Engineering",
      senderWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      hops: 4,
      arrivalSeconds: 900,
      items,
    });

    expect(batch.id).toBeDefined();
    expect(batch.status).toBe("draft");
    expect(batch.transfers).toHaveLength(2);
    expect(batch.items).toHaveLength(25);

    // Chunk 0 must have exactly 20 items (20-cap)
    expect(batch.transfers[0].recipientCount).toBe(20);
    expect(batch.transfers[0].chunkAmountRaw).toBe("2000000000"); // 20 * 100 * 10^6

    // Chunk 1 must have remaining 5 items
    expect(batch.transfers[1].recipientCount).toBe(5);
    expect(batch.transfers[1].chunkAmountRaw).toBe("500000000");

    // Total raw amount = 2500 * 10^6
    expect(batch.totalAmountRaw).toBe("2500000000");
    expect(batch.totalAmountFormatted).toBe("2500.00");
  });

  it("updates transfer statuses and automatically aggregates batch state", async () => {
    const items = [
      { recipientWallet: dummyWallet, amountFormatted: "50.00" },
      { recipientWallet: dummyWallet, amountFormatted: "75.00" },
    ];

    const batch = await payoutStore.createPayoutBatch({
      title: "Mini Batch",
      senderWallet,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items,
    });

    expect(batch.transfers).toHaveLength(1);
    const transferId = batch.transfers[0].id;

    // Advance transfer to awaiting_signature
    await payoutStore.updateTransfer(transferId, { status: "awaiting_signature" });
    let updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("awaiting_signature");

    // Advance to processing
    await payoutStore.updateTransfer(transferId, { status: "processing" });
    updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("processing");

    // Complete transfer
    await payoutStore.updateTransfer(transferId, { status: "completed" });
    updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("completed");
  });

  it("registers webhook events and detects replays", async () => {
    const eventId = "evt_unique_123456";
    const res1 = await payoutStore.registerWebhookEvent(
      eventId,
      "transfer.deposit_confirmed",
      { id: "test" },
      "sig_abc"
    );
    expect(res1.existing).toBe(false);
    expect(res1.event.processed).toBe(false);

    // Mark processed
    await payoutStore.markWebhookProcessed(eventId, true);

    // Duplicate webhook attempt
    const res2 = await payoutStore.registerWebhookEvent(
      eventId,
      "transfer.deposit_confirmed",
      { id: "test" },
      "sig_abc"
    );
    expect(res2.existing).toBe(true);
    expect(res2.event.processed).toBe(true);
  });
});
