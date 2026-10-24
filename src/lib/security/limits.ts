import { payoutStore } from "../db/payout-store";

/**
 * Per-Organization Limits and Safety Configuration
 */
export function getSecurityLimits() {
  const maxBatchAmountUsd = parseFloat(process.env.MAX_BATCH_AMOUNT_USD || "100000");
  const maxRecipientsPerBatch = parseInt(process.env.MAX_RECIPIENTS_PER_BATCH || "500", 10);
  const dailyOrgVolumeLimitUsd = parseFloat(process.env.DAILY_ORG_VOLUME_LIMIT_USD || "500000");
  const solUsdRate = parseFloat(process.env.SOL_USD_RATE || "150");

  return {
    maxBatchAmountUsd: Number.isFinite(maxBatchAmountUsd) && maxBatchAmountUsd > 0 ? maxBatchAmountUsd : 100000,
    maxRecipientsPerBatch: Number.isFinite(maxRecipientsPerBatch) && maxRecipientsPerBatch > 0 ? maxRecipientsPerBatch : 500,
    dailyOrgVolumeLimitUsd: Number.isFinite(dailyOrgVolumeLimitUsd) && dailyOrgVolumeLimitUsd > 0 ? dailyOrgVolumeLimitUsd : 500000,
    solUsdRate: Number.isFinite(solUsdRate) && solUsdRate > 0 ? solUsdRate : 150,
  };
}

export interface BatchLimitsCheckParams {
  organizationId: string;
  tokenSymbol: string;
  tokenDecimals?: number;
  items: Array<{
    recipientWallet: string;
    amountFormatted: string;
  }>;
}

export type LimitErrorCode =
  | "MAX_RECIPIENTS_EXCEEDED"
  | "MAX_BATCH_AMOUNT_EXCEEDED"
  | "DAILY_VOLUME_LIMIT_EXCEEDED"
  | "INVALID_ITEM_AMOUNT"
  | "RECIPIENTS_REQUIRED";

export interface BatchLimitsCheckResult {
  allowed: boolean;
  errorCode?: LimitErrorCode;
  error?: string;
  details?: {
    batchAmountUsd: number;
    maxBatchAmountUsd: number;
    recipientCount: number;
    maxRecipients: number;
    currentDailyVolumeUsd: number;
    dailyLimitUsd: number;
    projectedDailyVolumeUsd: number;
  };
}

/**
 * Calculates USD equivalent for token amount
 */
export function calculateUsdValue(amountFormatted: string, tokenSymbol: string, solUsdRate = 150): number {
  const parsed = parseFloat(amountFormatted.replace(/,/g, "")) || 0;
  if (tokenSymbol.toUpperCase() === "SOL") {
    return parsed * solUsdRate;
  }
  // USDC, USDT, and USD-pegged stablecoins
  return parsed;
}

/**
 * Enforces per-organization safety caps and batch limits
 */
export async function validateBatchLimits(
  params: BatchLimitsCheckParams
): Promise<BatchLimitsCheckResult> {
  const limits = getSecurityLimits();
  const recipientCount = params.items.length;

  // Retrieve current organization 24h rolling volume upfront
  const currentDailyVolumeUsd = await payoutStore.getDailyOrganizationVolume(
    params.organizationId,
    undefined,
    limits.solUsdRate
  );

  // 1. Validate non-empty recipient list
  if (recipientCount === 0) {
    return {
      allowed: false,
      errorCode: "RECIPIENTS_REQUIRED",
      error: "Batch must contain at least one recipient.",
      details: {
        batchAmountUsd: 0,
        maxBatchAmountUsd: limits.maxBatchAmountUsd,
        recipientCount: 0,
        maxRecipients: limits.maxRecipientsPerBatch,
        currentDailyVolumeUsd,
        dailyLimitUsd: limits.dailyOrgVolumeLimitUsd,
        projectedDailyVolumeUsd: currentDailyVolumeUsd,
      },
    };
  }

  // 2. Recipient Count Cap Check
  if (recipientCount > limits.maxRecipientsPerBatch) {
    return {
      allowed: false,
      errorCode: "MAX_RECIPIENTS_EXCEEDED",
      error: `Batch exceeds maximum recipient limit of ${limits.maxRecipientsPerBatch} recipients (received ${recipientCount}).`,
      details: {
        batchAmountUsd: 0,
        maxBatchAmountUsd: limits.maxBatchAmountUsd,
        recipientCount,
        maxRecipients: limits.maxRecipientsPerBatch,
        currentDailyVolumeUsd,
        dailyLimitUsd: limits.dailyOrgVolumeLimitUsd,
        projectedDailyVolumeUsd: currentDailyVolumeUsd,
      },
    };
  }

  // 3. Validate individual item amounts
  let batchAmountUsd = 0;
  for (const item of params.items) {
    const num = parseFloat(item.amountFormatted.replace(/,/g, ""));
    if (!Number.isFinite(num) || num <= 0) {
      return {
        allowed: false,
        errorCode: "INVALID_ITEM_AMOUNT",
        error: `Invalid payout amount: ${item.amountFormatted}. All recipient amounts must be strictly positive numbers.`,
        details: {
          batchAmountUsd: 0,
          maxBatchAmountUsd: limits.maxBatchAmountUsd,
          recipientCount,
          maxRecipients: limits.maxRecipientsPerBatch,
          currentDailyVolumeUsd,
          dailyLimitUsd: limits.dailyOrgVolumeLimitUsd,
          projectedDailyVolumeUsd: currentDailyVolumeUsd,
        },
      };
    }
    batchAmountUsd += calculateUsdValue(item.amountFormatted, params.tokenSymbol, limits.solUsdRate);
  }

  // 4. Single Batch Amount Cap Check
  if (batchAmountUsd > limits.maxBatchAmountUsd) {
    return {
      allowed: false,
      errorCode: "MAX_BATCH_AMOUNT_EXCEEDED",
      error: `Batch total of $${batchAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD exceeds the single batch cap of $${limits.maxBatchAmountUsd.toLocaleString()} USD.`,
      details: {
        batchAmountUsd,
        maxBatchAmountUsd: limits.maxBatchAmountUsd,
        recipientCount,
        maxRecipients: limits.maxRecipientsPerBatch,
        currentDailyVolumeUsd,
        dailyLimitUsd: limits.dailyOrgVolumeLimitUsd,
        projectedDailyVolumeUsd: currentDailyVolumeUsd + batchAmountUsd,
      },
    };
  }

  // 5. Daily Organization Volume Limit Check
  const projectedDailyVolumeUsd = currentDailyVolumeUsd + batchAmountUsd;

  if (projectedDailyVolumeUsd > limits.dailyOrgVolumeLimitUsd) {
    return {
      allowed: false,
      errorCode: "DAILY_VOLUME_LIMIT_EXCEEDED",
      error: `Daily organization volume limit of $${limits.dailyOrgVolumeLimitUsd.toLocaleString()} USD exceeded. Current daily: $${currentDailyVolumeUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD, batch: $${batchAmountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD.`,
      details: {
        batchAmountUsd,
        maxBatchAmountUsd: limits.maxBatchAmountUsd,
        recipientCount,
        maxRecipients: limits.maxRecipientsPerBatch,
        currentDailyVolumeUsd,
        dailyLimitUsd: limits.dailyOrgVolumeLimitUsd,
        projectedDailyVolumeUsd,
      },
    };
  }

  return {
    allowed: true,
    details: {
      batchAmountUsd,
      maxBatchAmountUsd: limits.maxBatchAmountUsd,
      recipientCount,
      maxRecipients: limits.maxRecipientsPerBatch,
      currentDailyVolumeUsd,
      dailyLimitUsd: limits.dailyOrgVolumeLimitUsd,
      projectedDailyVolumeUsd,
    },
  };
}
