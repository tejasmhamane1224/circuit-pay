import { describe, it, expect, beforeEach } from "vitest";
import { payoutStore } from "@/lib/db/payout-store";
import { retryBatch, retryTransfer, resetRetryCaches } from "@/lib/multihopper/retry";
import { Keypair } from "@solana/web3.js";

describe("Failure-Injection & Idempotent Retry Engine", () => {
  beforeEach(() => {
    payoutStore.resetStore();
    resetRetryCaches();
  });

  it("simulates RPC/keeper drop after Chunk #1 settles, retries, and mathematically proves NO double payment", async () => {
    // 1. Create a 25-recipient payout batch (partitioned into Chunk #0: 20 recipients, Chunk #1: 5 recipients)
    const sender = Keypair.generate().publicKey.toBase58();
    const recipientWallets = Array.from({ length: 25 }, () => Keypair.generate().publicKey.toBase58());

    const batch = await payoutStore.createPayoutBatch({
      title: "Failure-Injection Simulation - Contributor Payroll",
      senderWallet: sender,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      network: "mainnet-beta",
      items: recipientWallets.map((wallet, idx) => ({
        recipientWallet: wallet,
        recipientName: `Dev #${idx + 1}`,
        amountFormatted: "100.00",
        amountRaw: "100000000", // 100 USDC each
      })),
    });

    expect(batch.transfers.length).toBe(2);
    expect(batch.items.length).toBe(25);
    expect(batch.totalAmountRaw).toBe("2500000000"); // 2,500 USDC

    const chunk0 = batch.transfers[0];
    const chunk1 = batch.transfers[1];

    expect(chunk0.recipientCount).toBe(20);
    expect(chunk1.recipientCount).toBe(5);

    // 2. Settle Chunk #0 successfully (all 20 items get paid with on-chain signatures)
    const chunk0Items = batch.items.filter((i) => i.transferId === chunk0.id);
    expect(chunk0Items.length).toBe(20);

    await payoutStore.updateTransfer(chunk0.id, {
      status: "processing",
      multihopperId: "mh_tr_chunk0_settled",
      keeperFundingSignature: "5wKeeperChunk0SigMockSol",
    });

    for (const item of chunk0Items) {
      const sig = `5wSigChunk0_${item.id.slice(0, 8)}Sol`;
      await payoutStore.updatePayoutItem(item.id, {
        status: "paid",
        payoutSignature: sig,
      });
    }

    await payoutStore.updateTransfer(chunk0.id, {
      status: "completed",
    });

    // 3. INJECT FAILURE on Chunk #1 (simulate network RPC timeout / keeper drop)
    const chunk1Items = batch.items.filter((i) => i.transferId === chunk1.id);
    expect(chunk1Items.length).toBe(5);

    await payoutStore.updateTransfer(chunk1.id, {
      status: "processing",
      multihopperId: "mh_tr_chunk1_dropped",
    });

    for (const item of chunk1Items) {
      await payoutStore.updatePayoutItem(item.id, {
        status: "failed",
      });
    }

    await payoutStore.updateTransfer(chunk1.id, {
      status: "failed",
    });

    // 4. Inspect Partially Failed State & Pre-Retry Snapshot
    const preRetryBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(preRetryBatch?.status).toBe("partially_failed");

    const preRecon = await payoutStore.getSettlementReconciliation(batch.id);
    expect(preRecon).not.toBeNull();
    expect(preRecon?.settledTotalRaw).toBe("2000000000"); // 2,000 USDC paid
    expect(preRecon?.failedTotalRaw).toBe("500000000"); // 500 USDC failed
    expect(preRecon?.isBalanced).toBe(true);
    expect(preRecon?.screeningFeeLamports).toBe((25 * 50000).toString());
    expect(preRecon?.keeperFundingLamports).toBe((2 * 5000000).toString());

    // Record original Chunk 0 signatures & payment counts
    const chunk0PreSignatures = preRetryBatch!.items
      .filter((i) => i.transferId === chunk0.id)
      .map((i) => ({ id: i.id, sig: i.payoutSignature, paymentCount: i.paymentCount }));

    expect(chunk0PreSignatures.every((x) => x.paymentCount === 1)).toBe(true);

    // 5. Trigger Idempotent Retry Engine
    const retryResult = await retryBatch(batch.id, {
      actorWallet: sender,
      simulateSettlement: true,
    });

    expect(retryResult.success).toBe(true);
    expect(retryResult.retriedChunksCount).toBe(1); // ONLY Chunk 1 was retried!
    expect(retryResult.totalUnsettledItemsRetried).toBe(5);
    expect(retryResult.totalSettledItemsPreserved).toBe(20);

    // 6. Mathematical Verification of ZERO Double Payment
    const postRetryBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(postRetryBatch?.status).toBe("completed");

    const postChunk0Items = postRetryBatch!.items.filter((i) => i.transferId === chunk0.id);
    const postChunk1Items = postRetryBatch!.items.filter((i) => i.transferId === chunk1.id);

    // Proof A: Chunk 0 items were NEVER re-paid or modified
    for (const pre of chunk0PreSignatures) {
      const current = postChunk0Items.find((i) => i.id === pre.id);
      expect(current?.payoutSignature).toBe(pre.sig); // Signature unmodified
      expect(current?.paymentCount).toBe(1); // EXACTLY ONE payment
      expect(current?.status).toBe("paid");
    }

    // Proof B: Chunk 1 items are now settled exactly once
    for (const item of postChunk1Items) {
      expect(item.status).toBe("paid");
      expect(item.paymentCount).toBe(1); // EXACTLY ONE payment
      expect(item.payoutSignature).toMatch(/^5wRetrySig/);
    }

    // Proof C: Total Sum equals requested sum with zero double-payment variance
    const totalPaidBig = postRetryBatch!.items.reduce(
      (sum, item) => sum + BigInt(item.amountRaw),
      BigInt(0)
    );
    expect(totalPaidBig.toString()).toBe(postRetryBatch!.totalAmountRaw);

    const postRecon = await payoutStore.getSettlementReconciliation(batch.id);
    expect(postRecon?.isBalanced).toBe(true);
    expect(postRecon?.varianceRaw).toBe("0");
    expect(postRecon?.settledTotalRaw).toBe(postRetryBatch!.totalAmountRaw);
    expect(postRecon?.failedTotalRaw).toBe("0");
    expect(postRecon?.pendingTotalRaw).toBe("0");

    // Proof D: Attempt counts
    const updatedChunk0 = postRetryBatch!.transfers.find((t) => t.id === chunk0.id);
    const updatedChunk1 = postRetryBatch!.transfers.find((t) => t.id === chunk1.id);
    expect(updatedChunk0?.attempts).toBe(1); // Not retried
    expect(updatedChunk1?.attempts).toBe(2); // Retried once

    // 7. Test Idempotency Guard: Calling retry AGAIN on fully settled batch MUST BE A NO-OP
    const secondRetryResult = await retryBatch(batch.id, {
      actorWallet: sender,
    });

    expect(secondRetryResult.alreadyFullySettled).toBe(true);
    expect(secondRetryResult.retriedChunksCount).toBe(0);
    expect(secondRetryResult.totalUnsettledItemsRetried).toBe(0);
    expect(secondRetryResult.totalSettledItemsPreserved).toBe(25);

    // Verify all 25 items still have paymentCount === 1
    const recheckBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(recheckBatch?.items.every((i) => i.paymentCount === 1)).toBe(true);

    // 8. Single transfer retry guard
    await expect(retryTransfer(chunk0.id)).rejects.toThrow(/already fully settled/);

    // 9. Audit Log Trail Verification
    const logs = payoutStore.listAuditLogs(batch.id);
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("batch.created");
    expect(actions).toContain("transfer.retry");
    expect(actions).toContain("batch.retry_completed");
    expect(actions).toContain("batch.retry_skipped");
  });

  it("enforces idempotency key deduplication: concurrent duplicate retries return the same result without duplicate attempts", async () => {
    const sender = Keypair.generate().publicKey.toBase58();
    const batch = await payoutStore.createPayoutBatch({
      title: "Concurrent Idempotency Test",
      senderWallet: sender,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: sender, amountFormatted: "50.00", amountRaw: "50000000" }],
    });

    const transfer = batch.transfers[0];
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updatePayoutItem(batch.items[0].id, { status: "failed" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const sharedIdempotencyKey = "client-req-uuid-98765";

    // Dispatch two retries with the EXACT SAME idempotency key
    const [res1, res2] = await Promise.all([
      retryBatch(batch.id, { idempotencyKey: sharedIdempotencyKey }),
      retryBatch(batch.id, { idempotencyKey: sharedIdempotencyKey }),
    ]);

    expect(res1.success).toBe(true);
    expect(res2.success).toBe(true);
    expect(res2.deduplicated).toBe(true);

    // Proves attempt count was only incremented ONCE
    const refreshed = await payoutStore.getPayoutBatch(batch.id);
    expect(refreshed?.transfers[0].attempts).toBe(2);
    expect(refreshed?.items[0].paymentCount).toBe(1);
  });

  it("handles partial chunk drop: preserving partially settled items within the dropped chunk", async () => {
    const sender = Keypair.generate().publicKey.toBase58();
    const recipients = Array.from({ length: 4 }, () => Keypair.generate().publicKey.toBase58());

    const batch = await payoutStore.createPayoutBatch({
      title: "Partial Chunk Settlement Test",
      senderWallet: sender,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: recipients.map((r, i) => ({
        recipientWallet: r,
        amountFormatted: "25.00",
        amountRaw: "25000000",
        recipientName: `Dev ${i + 1}`,
      })),
    });

    const transfer = batch.transfers[0];
    const items = batch.items;

    // Simulate item 0 and 1 paid on-chain, then keeper dropped before items 2 and 3
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updatePayoutItem(items[0].id, { status: "paid", payoutSignature: "5wOrigSigItem0" });
    await payoutStore.updatePayoutItem(items[1].id, { status: "paid", payoutSignature: "5wOrigSigItem1" });
    await payoutStore.updatePayoutItem(items[2].id, { status: "failed" });
    await payoutStore.updatePayoutItem(items[3].id, { status: "failed" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    // Execute retry on this partially settled chunk
    const retryRes = await retryTransfer(transfer.id);
    expect(retryRes.retriedItemCount).toBe(2); // Only items 2 and 3 retried
    expect(retryRes.skippedPaidItemCount).toBe(2); // Items 0 and 1 preserved

    const refreshedTransfer = await payoutStore.getTransferByIdOrExternal(transfer.id);
    const refreshedItems = refreshedTransfer?.items || [];

    // Verify items 0 and 1 retained original signatures and paymentCount === 1
    const item0 = refreshedItems.find((i) => i.id === items[0].id);
    const item1 = refreshedItems.find((i) => i.id === items[1].id);
    expect(item0?.payoutSignature).toBe("5wOrigSigItem0");
    expect(item0?.paymentCount).toBe(1);
    expect(item1?.payoutSignature).toBe("5wOrigSigItem1");
    expect(item1?.paymentCount).toBe(1);

    // Verify items 2 and 3 are now paid with paymentCount === 1
    const item2 = refreshedItems.find((i) => i.id === items[2].id);
    const item3 = refreshedItems.find((i) => i.id === items[3].id);
    expect(item2?.status).toBe("paid");
    expect(item2?.paymentCount).toBe(1);
    expect(item3?.status).toBe("paid");
    expect(item3?.paymentCount).toBe(1);
  });

  it("protects terminal items from being reset or double-credited", async () => {
    const sender = Keypair.generate().publicKey.toBase58();
    const batch = await payoutStore.createPayoutBatch({
      title: "Terminal Item Protection Test",
      senderWallet: sender,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: sender, amountFormatted: "10.00", amountRaw: "10000000" }],
    });

    const item = batch.items[0];
    await payoutStore.updatePayoutItem(item.id, { status: "processing" });
    await payoutStore.updatePayoutItem(item.id, { status: "paid", payoutSignature: "5wPaidSig" });

    // Attempting to set paid item back to processing must throw
    await expect(
      payoutStore.updatePayoutItem(item.id, { status: "processing" })
    ).rejects.toThrow(/Invalid payout item state transition/);

    // Payment count must remain strictly 1
    const refreshed = await payoutStore.getPayoutBatch(batch.id);
    expect(refreshed?.items[0].paymentCount).toBe(1);
    expect(refreshed?.items[0].status).toBe("paid");
  });

  it("rejects retrying terminal batches (cancelled or refunded)", async () => {
    const sender = Keypair.generate().publicKey.toBase58();
    const batch = await payoutStore.createPayoutBatch({
      title: "Terminal Batch Protection Test",
      senderWallet: sender,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: sender, amountFormatted: "10.00", amountRaw: "10000000" }],
    });

    await payoutStore.updateBatchStatus(batch.id, "cancelled");

    await expect(retryBatch(batch.id)).rejects.toThrow(/Cannot retry batch in terminal status 'cancelled'/);
  });

  it("supports manual resolution of failed batches and records audit log", async () => {
    const sender = Keypair.generate().publicKey.toBase58();
    const batch = await payoutStore.createPayoutBatch({
      title: "Manual Resolve Audit Test",
      senderWallet: sender,
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: sender, amountFormatted: "80.00", amountRaw: "80000000" }],
    });

    const transfer = batch.transfers[0];
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updatePayoutItem(batch.items[0].id, { status: "failed" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const manualSig = "5wManualTxSigConfirmedOnChain123Sol";
    const resolvedBatch = await payoutStore.manualResolveBatch(batch.id, {
      actorWallet: sender,
      reason: "Manual on-chain verification by DAO controller",
      resolutionSignature: manualSig,
    });

    expect(resolvedBatch.status).toBe("completed");
    expect(resolvedBatch.items[0].status).toBe("paid");
    expect(resolvedBatch.items[0].payoutSignature).toBe(manualSig);
    expect(resolvedBatch.items[0].paymentCount).toBe(1);

    const logs = payoutStore.listAuditLogs(batch.id);
    const manualLog = logs.find((l) => l.action === "batch.manual_resolved");
    expect(manualLog).toBeDefined();
    expect(manualLog?.details?.reason).toBe("Manual on-chain verification by DAO controller");
  });
});
