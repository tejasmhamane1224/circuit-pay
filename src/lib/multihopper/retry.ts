import crypto from "node:crypto";
import { payoutStore, type StoredTransfer } from "@/lib/db/payout-store";
import { isMultiHopperMock } from "./service";
import { MultiHopperLogger } from "./logger";
import { calculateQualifyingVolume } from "./volume";

export interface RetryOptions {
  idempotencyKey?: string;
  actorWallet?: string;
  simulateSettlement?: boolean;
}

export interface RetryTransferResult {
  transferId: string;
  chunkIndex: number;
  externalId: string;
  attempts: number;
  previousStatus: string;
  newStatus: string;
  retriedItemCount: number;
  skippedPaidItemCount: number;
  idempotencyKey: string;
  settledSignatures?: string[];
  deduplicated?: boolean;
}

export interface RetryBatchResult {
  success: boolean;
  batchId: string;
  previousStatus: string;
  newStatus: string;
  idempotencyKey: string;
  retriedChunksCount: number;
  totalUnsettledItemsRetried: number;
  totalSettledItemsPreserved: number;
  alreadyFullySettled: boolean;
  chunks: RetryTransferResult[];
  deduplicated?: boolean;
}

// Global in-memory cache to guarantee idempotency and prevent concurrent duplicate execution
const processedBatchRetries = new Map<string, RetryBatchResult>();
const inFlightBatchRetries = new Map<string, Promise<RetryBatchResult>>();

const processedTransferRetries = new Map<string, RetryTransferResult>();
const inFlightTransferRetries = new Map<string, Promise<RetryTransferResult>>();

/**
 * Resets retry idempotency caches (used in testing)
 */
export function resetRetryCaches() {
  processedBatchRetries.clear();
  inFlightBatchRetries.clear();
  processedTransferRetries.clear();
  inFlightTransferRetries.clear();
}

/**
 * Idempotent Retry Engine for Payout Batches
 * 
 * Strict Guarantees:
 * 1. Strictly retries ONLY unsettled or failed items.
 * 2. Never re-executes or double-pays settled items (Zero Double-Payment Guarantee).
 * 3. Enforces unique UUID idempotency keys per retry attempt and deduplicates concurrent duplicate requests.
 * 4. Tracks attempt counts on transfers and logs state transitions in audit trail.
 * 5. Rejects retries on terminal statuses (cancelled, refunded).
 */
export async function retryBatch(
  batchId: string,
  options: RetryOptions = {}
): Promise<RetryBatchResult> {
  const idempotencyKey = options.idempotencyKey || `retry-${crypto.randomUUID()}`;

  // 1. Check if this idempotency key was already processed
  if (options.idempotencyKey && processedBatchRetries.has(options.idempotencyKey)) {
    MultiHopperLogger.info(`Idempotent retry deduplication hit for key: ${options.idempotencyKey}`);
    const cached = processedBatchRetries.get(options.idempotencyKey)!;
    return { ...cached, deduplicated: true };
  }

  // 2. Check if a request with this idempotency key is currently in-flight
  if (options.idempotencyKey && inFlightBatchRetries.has(options.idempotencyKey)) {
    MultiHopperLogger.info(`Awaiting in-flight retry execution for key: ${options.idempotencyKey}`);
    const inFlightResult = await inFlightBatchRetries.get(options.idempotencyKey)!;
    return { ...inFlightResult, deduplicated: true };
  }

  const executionPromise = (async (): Promise<RetryBatchResult> => {
    const batch = await payoutStore.getPayoutBatch(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    // Guard against terminal batch statuses
    if (batch.status === "cancelled" || batch.status === "refunded") {
      throw new Error(`Cannot retry batch in terminal status '${batch.status}'`);
    }

    const actorWallet = options.actorWallet || batch.senderWallet || "system";

    // Identify settled vs unsettled items across the batch
    const allItems = batch.items || [];
    const settledItems = allItems.filter((i) => i.status === "paid");

    // Find transfers that need retry: status !== "completed" OR having any unpaid items
    const transfersToRetry: StoredTransfer[] = batch.transfers.filter((t) => {
      if (t.status !== "completed") return true;
      const items = t.items || [];
      return items.some((i) => i.status !== "paid");
    });

    // If no unsettled transfers exist, the batch is already fully settled
    if (transfersToRetry.length === 0) {
      MultiHopperLogger.info(
        `Batch ${batchId} retry requested, but all items are already settled. Skipping execution.`
      );

      await payoutStore.recordAuditLog({
        organizationId: batch.organizationId,
        actorWallet,
        action: "batch.retry_skipped",
        resourceType: "payout_batch",
        resourceId: batchId,
        details: {
          reason: "Batch already fully settled; zero items retried",
          idempotencyKey,
          settledItemsCount: settledItems.length,
        },
      });

      const fullySettledResult: RetryBatchResult = {
        success: true,
        batchId,
        previousStatus: batch.status,
        newStatus: batch.status,
        idempotencyKey,
        retriedChunksCount: 0,
        totalUnsettledItemsRetried: 0,
        totalSettledItemsPreserved: settledItems.length,
        alreadyFullySettled: true,
        chunks: [],
      };

      if (options.idempotencyKey) {
        processedBatchRetries.set(options.idempotencyKey, fullySettledResult);
      }

      return fullySettledResult;
    }

    await payoutStore.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet,
      action: "batch.retry_initiated",
      resourceType: "payout_batch",
      resourceId: batchId,
      details: {
        idempotencyKey,
        unsettledChunksCount: transfersToRetry.length,
        totalItemsCount: allItems.length,
        alreadySettledCount: settledItems.length,
      },
    });

    const shouldSimulate =
      options.simulateSettlement !== undefined
        ? options.simulateSettlement
        : isMultiHopperMock() || process.env.NODE_ENV === "test";

    const chunkResults: RetryTransferResult[] = [];
    let totalRetriedItems = 0;

    for (const transfer of transfersToRetry) {
      const transferItems = transfer.items || [];
      const paidItems = transferItems.filter((i) => i.status === "paid");
      const unpaidItems = transferItems.filter((i) => i.status !== "paid");

      const previousStatus = transfer.status;
      const newAttemptCount = (transfer.attempts || 1) + 1;
      const nowIso = new Date().toISOString();

      // 1. Advance transfer state to processing
      await payoutStore.updateTransfer(transfer.id, {
        status: "processing",
        attempts: newAttemptCount,
        lastRetryAt: nowIso,
      });

      // 2. Advance only unsettled items to processing
      for (const item of unpaidItems) {
        await payoutStore.updatePayoutItem(item.id, {
          status: "processing",
        });
      }

      const settledSigs: string[] = [];

      // 3. Execute retry settlement
      if (shouldSimulate) {
        // Simulate successful retry execution of unpaid items
        for (const item of unpaidItems) {
          const sig = `5wRetrySig${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}Sol`;
          settledSigs.push(sig);
          await payoutStore.updatePayoutItem(item.id, {
            status: "paid",
            payoutSignature: sig,
          });
        }

        await payoutStore.updateTransfer(transfer.id, {
          status: "completed",
        });

        // Record volume ledger entry for newly settled mainnet transfer if not already present
        const isMainnet = batch.network === "mainnet-beta";
        const existingLedger = payoutStore.getVolumeLedger().find((l) => l.transferId === transfer.id);
        if (isMainnet && !existingLedger) {
          const percentFeeRaw = BigInt(transfer.percentFeeRaw || "0");
          const collectedFeeUsd = Number(percentFeeRaw) / 10 ** (batch.tokenDecimals ?? 6);
          const volumeCalculation = calculateQualifyingVolume(collectedFeeUsd, batch.network, true);

          await payoutStore.recordVolumeLedger({
            transferId: transfer.id,
            multihopperId: transfer.multihopperId || `mh_tr_retried_${transfer.id.slice(0, 8)}`,
            network: batch.network,
            isMainnet: true,
            tokenMint: batch.tokenMint,
            tokenSymbol: batch.tokenSymbol,
            principalAmountRaw: transfer.chunkAmountRaw,
            principalAmountUsd: (Number(transfer.chunkAmountRaw) / 10 ** (batch.tokenDecimals ?? 6)).toFixed(4),
            collectedFeeRaw: percentFeeRaw.toString(),
            collectedFeeUsd: collectedFeeUsd.toFixed(4),
            qualifyingVolumeUsd: volumeCalculation.qualifyingVolumeUsd.toFixed(4),
            integratorFeeShareUsd: volumeCalculation.integratorFeeShareUsd.toFixed(4),
            verifiedAt: nowIso,
          });
        }
      }

      totalRetriedItems += unpaidItems.length;

      await payoutStore.recordAuditLog({
        organizationId: batch.organizationId,
        actorWallet,
        action: "transfer.retry",
        resourceType: "multihopper_transfer",
        resourceId: transfer.id,
        details: {
          batchId,
          chunkIndex: transfer.chunkIndex,
          attempt: newAttemptCount,
          idempotencyKey,
          retriedItemsCount: unpaidItems.length,
          preservedPaidItemsCount: paidItems.length,
        },
      });

      chunkResults.push({
        transferId: transfer.id,
        chunkIndex: transfer.chunkIndex,
        externalId: transfer.externalId,
        attempts: newAttemptCount,
        previousStatus,
        newStatus: shouldSimulate ? "completed" : "processing",
        retriedItemCount: unpaidItems.length,
        skippedPaidItemCount: paidItems.length,
        idempotencyKey,
        settledSignatures: settledSigs,
      });
    }

    // Refresh batch to get synchronized state
    const updatedBatch = await payoutStore.getPayoutBatch(batchId);
    const finalStatus = updatedBatch?.status || "processing";

    await payoutStore.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet,
      action: "batch.retry_completed",
      resourceType: "payout_batch",
      resourceId: batchId,
      details: {
        idempotencyKey,
        previousStatus: batch.status,
        newStatus: finalStatus,
        retriedChunksCount: chunkResults.length,
        totalUnsettledItemsRetried: totalRetriedItems,
      },
    });

    const result: RetryBatchResult = {
      success: true,
      batchId,
      previousStatus: batch.status,
      newStatus: finalStatus,
      idempotencyKey,
      retriedChunksCount: chunkResults.length,
      totalUnsettledItemsRetried: totalRetriedItems,
      totalSettledItemsPreserved: settledItems.length,
      alreadyFullySettled: false,
      chunks: chunkResults,
    };

    if (options.idempotencyKey) {
      processedBatchRetries.set(options.idempotencyKey, result);
    }

    return result;
  })();

  if (options.idempotencyKey) {
    inFlightBatchRetries.set(options.idempotencyKey, executionPromise);
  }

  try {
    return await executionPromise;
  } finally {
    if (options.idempotencyKey) {
      inFlightBatchRetries.delete(options.idempotencyKey);
    }
  }
}

/**
 * Idempotent Retry Engine for Single Transfer
 */
export async function retryTransfer(
  transferId: string,
  options: RetryOptions = {}
): Promise<RetryTransferResult> {
  if (options.idempotencyKey && processedTransferRetries.has(options.idempotencyKey)) {
    MultiHopperLogger.info(`Idempotent transfer retry deduplication hit for key: ${options.idempotencyKey}`);
    const cached = processedTransferRetries.get(options.idempotencyKey)!;
    return { ...cached, deduplicated: true };
  }

  if (options.idempotencyKey && inFlightTransferRetries.has(options.idempotencyKey)) {
    const inFlightResult = await inFlightTransferRetries.get(options.idempotencyKey)!;
    return { ...inFlightResult, deduplicated: true };
  }

  const executionPromise = (async (): Promise<RetryTransferResult> => {
    const transfer = await payoutStore.getTransferByIdOrExternal(transferId);
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }

    // Reuse chunk's stored idempotency key per Phase 2 spec
    const effectiveIdempotencyKey = options.idempotencyKey || transfer.idempotencyKey || `retry-tr-${crypto.randomUUID()}`;

    if (transfer.status === "refunded" || transfer.status === "expired") {
      throw new Error(`Cannot retry transfer in terminal status '${transfer.status}'`);
    }

    const items = transfer.items || [];
    const unpaidItems = items.filter((i) => i.status !== "paid");
    const paidItems = items.filter((i) => i.status === "paid");

    if (transfer.status === "completed" && unpaidItems.length === 0) {
      throw new Error(
        `Transfer ${transferId} is already fully settled; cannot retry settled transfer`
      );
    }

    const actorWallet = options.actorWallet || "system";
    const previousStatus = transfer.status;
    const newAttemptCount = (transfer.attempts || 1) + 1;
    const nowIso = new Date().toISOString();

    await payoutStore.updateTransfer(transfer.id, {
      status: "processing",
      attempts: newAttemptCount,
      lastRetryAt: nowIso,
    });

    for (const item of unpaidItems) {
      await payoutStore.updatePayoutItem(item.id, { status: "processing" });
    }

    const shouldSimulate =
      options.simulateSettlement !== undefined
        ? options.simulateSettlement
        : isMultiHopperMock() || process.env.NODE_ENV === "test";

    const settledSigs: string[] = [];
    if (shouldSimulate) {
      for (const item of unpaidItems) {
        const sig = `5wRetrySig${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}Sol`;
        settledSigs.push(sig);
        await payoutStore.updatePayoutItem(item.id, {
          status: "paid",
          payoutSignature: sig,
        });
      }

      await payoutStore.updateTransfer(transfer.id, {
        status: "completed",
      });
    }

    await payoutStore.recordAuditLog({
      actorWallet,
      action: "transfer.retry",
      resourceType: "multihopper_transfer",
      resourceId: transfer.id,
      details: {
        batchId: transfer.batchId,
        chunkIndex: transfer.chunkIndex,
        attempt: newAttemptCount,
        idempotencyKey: effectiveIdempotencyKey,
        retriedItemsCount: unpaidItems.length,
        preservedPaidItemsCount: paidItems.length,
      },
    });

    const result: RetryTransferResult = {
      transferId: transfer.id,
      chunkIndex: transfer.chunkIndex,
      externalId: transfer.externalId,
      attempts: newAttemptCount,
      previousStatus,
      newStatus: shouldSimulate ? "completed" : "processing",
      retriedItemCount: unpaidItems.length,
      skippedPaidItemCount: paidItems.length,
      idempotencyKey: effectiveIdempotencyKey,
      settledSignatures: settledSigs,
    };

    if (options.idempotencyKey) {
      processedTransferRetries.set(options.idempotencyKey, result);
    }

    return result;
  })();

  if (options.idempotencyKey) {
    inFlightTransferRetries.set(options.idempotencyKey, executionPromise);
  }

  try {
    return await executionPromise;
  } finally {
    if (options.idempotencyKey) {
      inFlightTransferRetries.delete(options.idempotencyKey);
    }
  }
}

/**
 * Idempotent Retry Engine for Single Failed Payout Item
 * 
 * Strict Guarantees per Phase 2:
 * 1. ONLY unsettled / failed items can be retried (verified before re-sending).
 * 2. Reuses the chunk's stored unique idempotency key to prevent double-spending.
 * 3. Advances item state and updates parent transfer/batch reconciliation.
 */
export async function retryItem(
  itemId: string,
  options: RetryOptions = {}
): Promise<{
  success: boolean;
  item: { id: string; status: string; payoutSignature?: string; recipientWallet: string };
  transferId: string;
  idempotencyKey: string;
}> {
  const item = await payoutStore.getPayoutItem(itemId);
  if (!item) {
    throw new Error(`Payout item ${itemId} not found`);
  }

  // Verify item is truly unsettled before re-sending
  if (item.status === "paid" || item.status === "delivered" || item.status === "refunded") {
    throw new Error(`Payout item ${itemId} is already settled (${item.status}); cannot retry settled disbursement`);
  }

  if (item.status === "processing" || item.status === "routing") {
    throw new Error(`Payout item ${itemId} is currently in-flight (${item.status}); cannot retry while routing is active`);
  }

  if (!item.transferId) {
    throw new Error(`Payout item ${itemId} has no associated transfer record`);
  }

  const transfer = await payoutStore.getTransferByIdOrExternal(item.transferId);
  if (!transfer) {
    throw new Error(`Associated transfer ${item.transferId} not found`);
  }

  // Strictly reuse the same idempotency key from chunk/transfer to prevent double-spending
  const idempotencyKey =
    transfer.idempotencyKey ||
    options.idempotencyKey ||
    `retry-item-${crypto.randomUUID()}`;

  // Advance item to processing
  await payoutStore.updatePayoutItem(itemId, { status: "processing" });

  const shouldSimulate =
    options.simulateSettlement !== undefined
      ? options.simulateSettlement
      : isMultiHopperMock() || process.env.NODE_ENV === "test";

  let payoutSignature: string | undefined;
  if (shouldSimulate) {
    payoutSignature = `5wRetryItemSig${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}Sol`;
    await payoutStore.updatePayoutItem(itemId, {
      status: "paid",
      payoutSignature,
    });
  }

  await payoutStore.recordAuditLog({
    actorWallet: options.actorWallet || "system",
    action: "item.retry",
    resourceType: "payout_item",
    resourceId: itemId,
    details: {
      batchId: item.batchId,
      transferId: item.transferId,
      idempotencyKey,
      payoutSignature,
    },
  });

  const updatedItem = (await payoutStore.getPayoutItem(itemId))!;

  // If all items in the parent transfer are now paid or delivered, update transfer to completed
  const refreshedTransfer = await payoutStore.getTransferByIdOrExternal(item.transferId);
  if (
    refreshedTransfer &&
    (refreshedTransfer.items || []).every((i) => i.status === "paid" || i.status === "delivered")
  ) {
    await payoutStore.updateTransfer(refreshedTransfer.id, { status: "completed" });
  }

  return {
    success: true,
    item: {
      id: updatedItem.id,
      status: updatedItem.status,
      payoutSignature: updatedItem.payoutSignature,
      recipientWallet: updatedItem.recipientWallet,
    },
    transferId: item.transferId,
    idempotencyKey,
  };
}
