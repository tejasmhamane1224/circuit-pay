import posthog from "posthog-js";
import { scrubSensitiveData } from "../monitoring/scrubber";
import { MultiHopperLogger } from "../multihopper/logger";

export type FunnelEvent =
  | "wallet_connected"
  | "csv_imported"
  | "batch_created"
  | "signing_started"
  | "broadcast_completed"
  | "webhook_settled"
  | "receipt_downloaded";

export interface FunnelEventProperties {
  wallet_connected: {
    wallet: string;
    network?: string;
  };
  csv_imported: {
    recipientCount: number;
    totalAmount: string;
    tokenSymbol: string;
    hasInvalidRows: boolean;
  };
  batch_created: {
    batchId: string;
    totalAmount: string;
    recipientCount: number;
    hops: number;
    tokenSymbol: string;
  };
  signing_started: {
    batchId: string;
    chunksCount: number;
  };
  broadcast_completed: {
    batchId: string;
    chunkIndex: number;
    signature: string;
  };
  webhook_settled: {
    eventId: string;
    transferId?: string;
    eventType: string;
    qualifyingVolumeUsd?: string;
  };
  receipt_downloaded: {
    batchId: string;
    format: "csv" | "pdf";
  };
}

let isInitialized = false;

/**
 * Initializes PostHog in the browser. Safe to call multiple times.
 */
export function initPostHog(): void {
  if (typeof window === "undefined" || isInitialized) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

  if (!key) {
    MultiHopperLogger.info("PostHog key not configured; analytics running in offline debug mode");
    return;
  }

  try {
    posthog.init(key, {
      api_host: host,
      capture_pageview: false, // We control views manually or via Next.js navigation
      capture_pageleave: true,
      persistence: "localStorage",
      autocapture: false,
      sanitize_properties: (properties) => {
        return scrubSensitiveData(properties);
      },
    });
    isInitialized = true;
  } catch (err) {
    MultiHopperLogger.warn("Failed to initialize PostHog", {
      errorCode: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Captures a typed funnel event with scrubbed payload
 */
export function trackEvent<E extends FunnelEvent>(
  event: E,
  properties: FunnelEventProperties[E]
): void {
  const scrubbed = scrubSensitiveData(properties);

  if (typeof window !== "undefined" && isInitialized) {
    try {
      posthog.capture(event, scrubbed);
    } catch {
      // ignore client errors
    }
  }

  MultiHopperLogger.info(`[Analytics][Event: ${event}]`, {
    details: scrubbed as Record<string, unknown>,
  });
}

/**
 * Identifies the active user by their Solana wallet address
 */
export function identifyWalletUser(walletAddress: string): void {
  if (typeof window !== "undefined" && isInitialized && walletAddress) {
    try {
      posthog.identify(walletAddress, {
        wallet: walletAddress,
        type: "non_custodial_treasury_admin",
      });
    } catch {
      // ignore
    }
  }
}

/**
 * Resets user identity upon wallet disconnection
 */
export function resetAnalyticsUser(): void {
  if (typeof window !== "undefined" && isInitialized) {
    try {
      posthog.reset();
    } catch {
      // ignore
    }
  }
}

export { posthog };
