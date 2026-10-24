export type BatchStatus =
  | "draft"
  | "quoting"
  | "awaiting_signature"
  | "processing"
  | "completed"
  | "partially_failed"
  | "failed"
  | "refunded"
  | "cancelled";

export type TransferStatus =
  | "created"
  | "quote"
  | "awaiting_signature"
  | "processing"
  | "active"
  | "completed"
  | "failed"
  | "expired"
  | "refunded"
  | "recoverable";

export type PayoutItemStatus =
  | "pending"
  | "queued"
  | "processing"
  | "routing"
  | "paid"
  | "delivered"
  | "failed"
  | "refunded";

export const VALID_BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  draft: ["quoting", "awaiting_signature", "processing", "failed", "cancelled"],
  quoting: ["awaiting_signature", "processing", "draft", "failed", "cancelled"],
  awaiting_signature: ["processing", "failed", "draft", "cancelled", "refunded"],
  processing: ["completed", "partially_failed", "failed", "refunded"],
  completed: [], // Terminal
  partially_failed: ["draft", "awaiting_signature", "processing", "refunded", "completed"], // Allows retry or refund of failed items
  failed: ["draft", "awaiting_signature", "processing", "refunded", "completed"], // Allows reset, retry, manual resolve, or refund
  refunded: [], // Terminal
  cancelled: [], // Terminal
};

export const VALID_TRANSFER_TRANSITIONS: Record<TransferStatus, TransferStatus[]> = {
  created: ["quote", "awaiting_signature", "processing", "failed", "refunded"],
  quote: ["awaiting_signature", "processing", "created", "failed", "expired", "refunded"],
  awaiting_signature: ["processing", "active", "failed", "expired", "refunded"],
  processing: ["active", "completed", "failed", "refunded", "recoverable"],
  active: ["processing", "completed", "failed", "refunded", "recoverable"],
  completed: [],
  failed: ["recoverable", "quote", "awaiting_signature", "processing", "refunded", "completed"],
  expired: ["refunded"],
  refunded: [],
  recoverable: ["processing", "awaiting_signature", "refunded", "completed"],
};

export const VALID_ITEM_TRANSITIONS: Record<PayoutItemStatus, PayoutItemStatus[]> = {
  pending: ["routing", "queued", "processing", "paid", "delivered", "failed", "refunded"],
  queued: ["routing", "processing", "paid", "delivered", "failed", "refunded"],
  processing: ["routing", "paid", "delivered", "failed", "refunded"],
  routing: ["delivered", "paid", "failed", "refunded"],
  paid: [], // Strictly Terminal - zero double payment guarantee
  delivered: [], // Strictly Terminal - zero double payment guarantee
  failed: ["routing", "processing", "paid", "delivered", "refunded"],
  refunded: [], // Strictly Terminal
};

export function isValidBatchTransition(from: BatchStatus, to: BatchStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_BATCH_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidBatchTransition(from: BatchStatus, to: BatchStatus): void {
  if (!isValidBatchTransition(from, to)) {
    throw new Error(
      `Invalid batch state transition: cannot transition from '${from}' to '${to}'. Allowed: [${(
        VALID_BATCH_TRANSITIONS[from] || []
      ).join(", ")}]`
    );
  }
}

export function isValidTransferTransition(from: TransferStatus, to: TransferStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSFER_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidTransferTransition(from: TransferStatus, to: TransferStatus): void {
  if (!isValidTransferTransition(from, to)) {
    throw new Error(
      `Invalid transfer state transition: cannot transition from '${from}' to '${to}'. Allowed: [${(
        VALID_TRANSFER_TRANSITIONS[from] || []
      ).join(", ")}]`
    );
  }
}

export function isValidItemTransition(from: PayoutItemStatus, to: PayoutItemStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_ITEM_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

export function assertValidItemTransition(from: PayoutItemStatus, to: PayoutItemStatus): void {
  if (!isValidItemTransition(from, to)) {
    throw new Error(
      `Invalid payout item state transition: cannot transition from '${from}' to '${to}'. Allowed: [${(
        VALID_ITEM_TRANSITIONS[from] || []
      ).join(", ")}]`
    );
  }
}

export function isTerminalBatchStatus(status: BatchStatus): boolean {
  return ["completed", "refunded", "cancelled"].includes(status);
}

export function isTerminalTransferStatus(status: TransferStatus): boolean {
  return ["completed", "expired", "refunded"].includes(status);
}

/**
 * Aggregates chunk statuses into parent batch status
 */
export function aggregateBatchStatusFromChunks(
  chunkStatuses: TransferStatus[]
): BatchStatus {
  if (chunkStatuses.length === 0) return "draft";

  if (chunkStatuses.every((s) => s === "completed")) {
    return "completed";
  }

  if (chunkStatuses.every((s) => s === "refunded")) {
    return "refunded";
  }

  if (chunkStatuses.every((s) => s === "failed")) {
    return "failed";
  }

  if (chunkStatuses.some((s) => s === "processing" || s === "active")) {
    return "processing";
  }

  const hasCompleted = chunkStatuses.some((s) => s === "completed");
  const hasFailed = chunkStatuses.some((s) => s === "failed");
  const hasRefunded = chunkStatuses.some((s) => s === "refunded");

  if (hasCompleted && (hasFailed || hasRefunded)) {
    return "partially_failed";
  }

  if (hasFailed && hasRefunded) {
    return "partially_failed";
  }

  if (hasCompleted) {
    return "processing";
  }

  if (hasFailed) {
    return "partially_failed";
  }

  if (chunkStatuses.some((s) => s === "awaiting_signature")) {
    return "awaiting_signature";
  }

  if (chunkStatuses.some((s) => s === "quote")) {
    return "quoting";
  }

  return "draft";
}
