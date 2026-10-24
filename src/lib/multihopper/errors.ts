/**
 * MultiHopper Protocol Error Definitions
 * Maps official error codes from MultiHopper API and smart contracts
 */

export interface MultiHopperErrorPayload {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  details?: Record<string, unknown>;
}

export class MultiHopperError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(payload: MultiHopperErrorPayload) {
    super(`[${payload.code}] ${payload.message}`);
    this.name = "MultiHopperError";
    this.code = payload.code;
    this.status = payload.status || 400;
    this.requestId = payload.requestId;
    this.details = payload.details;

    // Retryable conditions: Rate limits (429), gateway timeouts (504, 502, 503),
    // and specific MultiHopper transient states like MH_041 (binding not on chain yet)
    this.retryable =
      this.status === 429 ||
      this.status >= 500 ||
      this.code === "MH_041" || // Multi-destination binding propagating on-chain
      this.code === "MH_072"; // Idempotency request currently in-progress
  }

  static fromResponse(status: number, data: Record<string, unknown>): MultiHopperError {
    const code = (typeof data?.code === "string" ? data.code : undefined) ||
      (status === 401 ? "MH_001" : status === 429 ? "MH_RATE_LIMIT" : "MH_UNKNOWN");
    const message = (typeof data?.message === "string" ? data.message : undefined) ||
      (typeof data?.error === "string" ? data.error : undefined) ||
      `HTTP ${status}`;
    const requestId = typeof data?.requestId === "string" ? data.requestId : undefined;

    return new MultiHopperError({
      code,
      message,
      status,
      requestId,
      details: typeof data?.details === "object" && data?.details !== null ? data.details as Record<string, unknown> : undefined,
    });
  }
}

// Well-known MultiHopper error codes
export const MH_ERROR_CODES = {
  // Auth
  UNAUTHORIZED: "MH_001",
  KEY_REVOKED: "MH_002",

  // Validation
  AMOUNT_TOO_LOW: "MH_012",
  HOPS_OUT_OF_RANGE: "MH_013",
  ARRIVAL_SECONDS_TOO_LOW: "MH_014",
  DESTINATION_CANNOT_BE_PAID: "MH_017",
  INVALID_CUSTOM_ROUTE: "MH_018",
  HOP_LIBRARY_UNAVAILABLE: "MH_019",
  BUNDLE_DEPLETED: "MH_020",

  // Lifecycle
  FUNDING_TIMEOUT: "MH_032",
  DUPLICATE_EXTERNAL_ID: "MH_033",
  TRANSFER_EXPIRED: "MH_034",
  KEEPER_FUNDING_SIG_MISSING: "MH_039",
  FEE_TIER_MOVED: "MH_040",
  DISPERSION_NOT_BOUND_YET: "MH_041",

  // Idempotency
  IDEMPOTENCY_KEY_MISSING: "MH_070",
  IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: "MH_071",
  IDEMPOTENCY_IN_PROGRESS: "MH_072",

  // Recovery
  NOTHING_TO_RESCUE: "MH_081",
  NOTHING_TO_RECLAIM: "MH_082",
  RESCUE_SIGS_MISMATCH: "MH_083",

  // Integrator
  REWARDS_WALLET_NOT_RENT_EXEMPT: "MH_091",
} as const;
