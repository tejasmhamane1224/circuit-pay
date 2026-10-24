import { MULTIHOPPER_RULES } from "../constants";

export interface QualifyingVolumeResult {
  qualifyingVolumeUsd: number;
  collectedFeeUsd: number;
  integratorFeeShareUsd: number;
  isMainnet: boolean;
  qualifiesForChallenge: boolean;
  thresholdProgressPercent: number;
  disqualificationReason?: string;
}

/**
 * Superteam Earn MultiHopper Build and Route Challenge Volume Calculator
 * 
 * Official Challenge Formula:
 * Qualifying Volume = Collected MultiHopper Percentage Fees / 0.0025
 * 
 * Rules:
 * 1. Minimum qualifying volume threshold: $100,000 USD on Solana Mainnet.
 * 2. Mainnet only (Devnet transfers yield $0 qualifying volume).
 * 3. Principal counted ONCE (never multiplied by number of hops or recipients).
 * 4. Exclude failed, refunded, free, circular, or wash-trading transfers.
 */
/**
 * Detects circular or wash-trading patterns where the sender routes funds to their own wallet
 * or where identical source and destination addresses indicate zero-economic-utility churn.
 */
export function isCircularOrWashTransfer(
  senderWallet?: string,
  recipientWallets?: string[]
): boolean {
  if (!senderWallet || !recipientWallets || recipientWallets.length === 0) {
    return false;
  }
  const normalizedSender = senderWallet.trim();
  return recipientWallets.some((recipient) => recipient.trim() === normalizedSender);
}

export function calculateQualifyingVolume(
  collectedFeeUsd: number,
  network: "mainnet-beta" | "devnet" | string,
  isEligibleTransfer: boolean = true,
  options?: {
    senderWallet?: string;
    recipientWallets?: string[];
  }
): QualifyingVolumeResult {
  if (collectedFeeUsd < 0 || !Number.isFinite(collectedFeeUsd)) {
    throw new Error("Invalid collected fee amount. Must be a non-negative finite number.");
  }

  const isMainnet = network === "mainnet-beta";

  // Check for wash-trading / circular transfer if sender and recipients provided
  const isWash = options?.senderWallet && options?.recipientWallets
    ? isCircularOrWashTransfer(options.senderWallet, options.recipientWallets)
    : false;

  if (!isEligibleTransfer || isWash) {
    return {
      qualifyingVolumeUsd: 0,
      collectedFeeUsd,
      integratorFeeShareUsd: 0,
      isMainnet,
      qualifiesForChallenge: false,
      thresholdProgressPercent: 0,
      disqualificationReason: isWash
        ? "Circular or wash-trading transfer detected (sender matches recipient); excluded from qualifying volume"
        : "Transfer is marked ineligible (failed, refunded, or wash-trading)",
    };
  }

  if (!isMainnet) {
    return {
      qualifyingVolumeUsd: 0,
      collectedFeeUsd,
      integratorFeeShareUsd: 0,
      isMainnet: false,
      qualifiesForChallenge: false,
      thresholdProgressPercent: 0,
      disqualificationReason: "Devnet transfers are excluded from Superteam Earn qualifying volume",
    };
  }

  // Official challenge volume formula
  const qualifyingVolumeUsd = collectedFeeUsd / MULTIHOPPER_RULES.QUALIFYING_VOLUME_FEE_DIVISOR;
  const integratorFeeShareUsd = collectedFeeUsd * MULTIHOPPER_RULES.INTEGRATOR_SHARE_PERCENT;
  const qualifiesForChallenge = qualifyingVolumeUsd >= MULTIHOPPER_RULES.MIN_QUALIFYING_VOLUME_USD;
  const thresholdProgressPercent = Math.min(
    100,
    (qualifyingVolumeUsd / MULTIHOPPER_RULES.MIN_QUALIFYING_VOLUME_USD) * 100
  );

  return {
    qualifyingVolumeUsd,
    collectedFeeUsd,
    integratorFeeShareUsd,
    isMainnet: true,
    qualifiesForChallenge,
    thresholdProgressPercent,
  };
}
