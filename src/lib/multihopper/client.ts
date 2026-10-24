import crypto from "node:crypto";
import { MULTIHOPPER_API_URLS, INTEGRATION_IDENTIFIER, type SupportedNetwork } from "../constants";
import { MultiHopperError } from "./errors";
import { MultiHopperLogger } from "./logger";
import type {
  EstimateTransferInput,
  CreateTransferInput,
  ConfirmBroadcastInput,
} from "../validations/transfers";

export interface MultiHopperClientOptions {
  apiKey?: string;
  network?: SupportedNetwork;
  baseUrl?: string;
  maxRetries?: number;
  initialRetryDelayMs?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface EstimateResponse {
  tier: string;
  percentFeeBps: number;
  percentFeeRaw: string;
  totalFlatFeeLamports: string;
  integratorPercentShare: string;
  integratorFlatShare: string;
  hopAmountRaw: string;
  priceSource: string;
  sol: {
    requiredSolUpFrontLamports: string;
    breakdown: {
      screeningFeeLamports: string;
      keeperFundingLamports?: string;
      dispersionRentLamports?: string;
    };
  };
}

export interface CreateTransferResponse {
  id: string;
  status: "quote" | "awaiting_signature" | "processing" | "active" | "completed" | "failed" | "expired" | "refunded";
  recipientReceivesRaw: string;
  destinations?: Array<{
    wallet: string;
    amountRaw: string;
    status: "pending" | "paid" | "failed" | "refunded";
    payoutSignature?: string;
  }>;
  route: {
    hops: Array<{
      index: number;
      address: string;
      label?: string;
      category?: string;
      scheduledAt?: string;
      executedAt?: string;
      txSignature?: string;
    }>;
  };
}

export interface PreparedTransactionsResponse {
  transfer: {
    id: string;
    status: string;
  };
  preparedTxs: {
    routeInitTxs: Array<{ base64: string } | string>;
    orchestratorInitTx: string | null;
    sessionInitTxs: string[];
    keeperFundingTx?: string | null;
    dispersionInitTxs?: string[];
    recentBlockhash: string;
    lastValidBlockHeight: number;
  };
  resume?: {
    nothingToDo?: boolean;
    routeAlreadyDeployed?: boolean;
  };
}

export interface UsageResponse {
  integratorAddress: string;
  collectedVolumeUsd: string;
  integratorRevenueShareUsd: string;
  transfersCount: number;
  unclaimedRewardsLamports: string;
}

export class MultiHopperClient {
  private apiKey: string;
  private baseUrl: string;
  private maxRetries: number;
  private initialRetryDelayMs: number;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: MultiHopperClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.MULTIHOPPER_API_KEY || "";
    this.baseUrl =
      options.baseUrl ||
      (options.network === "mainnet-beta"
        ? MULTIHOPPER_API_URLS.MAINNET
        : MULTIHOPPER_API_URLS.DEVNET);
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  private getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-integration-id": INTEGRATION_IDENTIFIER,
      ...customHeaders,
    };

    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }

    return headers;
  }

  private async requestWithRetry<T>(
    endpoint: string,
    options: {
      method: "GET" | "POST" | "DELETE";
      body?: unknown;
      idempotencyKey?: string;
      customHeaders?: Record<string, string>;
    }
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const idempotencyKey =
      options.idempotencyKey ||
      (options.method === "POST" ? crypto.randomUUID() : undefined);

    const headers = this.getHeaders({
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      ...(options.customHeaders || {}),
    });

    let attempt = 0;
    let delay = this.initialRetryDelayMs;

    while (attempt <= this.maxRetries) {
      attempt++;
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const isPost = options.method === "POST";
        const body = options.body !== undefined
          ? JSON.stringify(options.body)
          : isPost
          ? "{}"
          : undefined;

        const response = await this.fetchFn(url, {
          method: options.method,
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const error = MultiHopperError.fromResponse(response.status, errorData);

          MultiHopperLogger.warn(`Request failed: ${options.method} ${endpoint}`, {
            endpoint,
            method: options.method,
            status: response.status,
            durationMs,
            errorCode: error.code,
            idempotencyKey,
          });

          // Check if retryable and we haven't exhausted attempts
          if (error.retryable && attempt <= this.maxRetries) {
            // Respect Retry-After header if provided
            const retryAfter = response.headers.get("retry-after");
            const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;

            await new Promise((resolve) => setTimeout(resolve, waitMs));
            delay *= 2; // exponential backoff
            continue;
          }

          throw error;
        }

        const data = (await response.json()) as T;
        MultiHopperLogger.debug(`Request successful: ${options.method} ${endpoint}`, {
          endpoint,
          method: options.method,
          status: response.status,
          durationMs,
          idempotencyKey,
        });

        return data;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);

        // If it's already a MultiHopperError that is not retryable, rethrow immediately
        if (err instanceof MultiHopperError && !err.retryable) {
          throw err;
        }

        // On network/abort errors, retry if attempts remain
        if (attempt <= this.maxRetries) {
          MultiHopperLogger.warn(`Network error on ${options.method} ${endpoint}, retrying in ${delay}ms...`, {
            endpoint,
            method: options.method,
            durationMs,
            idempotencyKey,
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }

        if (err instanceof MultiHopperError) {
          throw err;
        }

        throw new MultiHopperError({
          code: "MH_NETWORK_ERROR",
          message: errorMessage || "MultiHopper request failed due to network error",
          status: 503,
        });
      }
    }

    throw new MultiHopperError({
      code: "MH_MAX_RETRIES_EXCEEDED",
      message: `MultiHopper request exceeded ${this.maxRetries} retries`,
      status: 504,
    });
  }

  /**
   * 0. Estimate Transfer Fees
   * POST /transfers/estimate
   * Dry run calculation of fees, rent, screening charges, and integrator share
   */
  async estimate(input: EstimateTransferInput, idempotencyKey?: string): Promise<EstimateResponse> {
    return this.requestWithRetry<EstimateResponse>("/transfers/estimate", {
      method: "POST",
      body: input,
      idempotencyKey,
    });
  }

  /**
   * Alias for estimate() matching Phase 2 specification
   */
  async estimateFee(input: EstimateTransferInput, idempotencyKey?: string): Promise<EstimateResponse> {
    return this.estimate(input, idempotencyKey);
  }

  /**
   * 1. Create Transfer Quote
   * POST /transfers
   * Supports single recipient or up to 20 destinations
   */
  async createTransfer(input: CreateTransferInput, idempotencyKey?: string): Promise<CreateTransferResponse> {
    const payload = {
      ...input,
      inputMint: input.inputMint || input.tokenMint,
      sourceWallet: input.sourceWallet || input.sourceOwner,
      tokenMint: input.tokenMint || input.inputMint,
      sourceOwner: input.sourceOwner || input.sourceWallet,
    };
    return this.requestWithRetry<CreateTransferResponse>("/transfers", {
      method: "POST",
      body: payload,
      idempotencyKey,
    });
  }

  /**
   * Alias for createTransfer()
   */
  async createMultiSend(input: CreateTransferInput, idempotencyKey?: string): Promise<CreateTransferResponse> {
    return this.createTransfer(input, idempotencyKey);
  }

  /**
   * 2. Prepare Transactions
   * POST /transfers/:id/prepare
   * Returns base64 unsigned Solana transactions for user wallet signing
   */
  async prepareTransfer(
    transferId: string,
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<PreparedTransactionsResponse> {
    return this.requestWithRetry<PreparedTransactionsResponse>(`/transfers/${transferId}/prepare`, {
      method: "POST",
      body: {},
      idempotencyKey,
    });
  }

  /**
   * 3. Confirm Broadcast
   * POST /transfers/:id/confirm-broadcast
   * Called twice:
   * First call: keeperFundingTx signature (prevents double-funding keeper)
   * Second call: routeInit, orchestrator, session, and dispersion signatures
   */
  async confirmBroadcast(
    transferId: string,
    signatures: ConfirmBroadcastInput,
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<{ status: string }> {
    return this.requestWithRetry<{ status: string }>(`/transfers/${transferId}/confirm-broadcast`, {
      method: "POST",
      body: signatures,
      idempotencyKey,
    });
  }

  /**
   * 4. Get Transfer Status
   * GET /transfers/:id
   */
  async getTransfer(transferId: string): Promise<Record<string, unknown>> {
    return this.requestWithRetry<Record<string, unknown>>(`/transfers/${transferId}`, {
      method: "GET",
    });
  }

  /**
   * 5. Get Transfer by External ID
   * GET /transfers?externalId=...
   */
  async getTransferByExternalId(externalId: string): Promise<Record<string, unknown> | null> {
    const res = await this.requestWithRetry<{ items?: Record<string, unknown>[] }>(
      `/transfers?externalId=${encodeURIComponent(externalId)}`,
      { method: "GET" }
    );
    return res.items?.[0] || null;
  }

  /**
   * 6. Get Integrator Usage & Revenue Share
   * GET /usage
   */
  async getUsage(): Promise<UsageResponse> {
    return this.requestWithRetry<UsageResponse>("/usage", {
      method: "GET",
    });
  }

  /**
   * 7. Prepare Rescue for stuck routes
   * POST /transfers/:id/rescue/prepare
   */
  async prepareRescue(
    transferId: string,
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<{ rescueTxs: string[] }> {
    return this.requestWithRetry<{ rescueTxs: string[] }>(`/transfers/${transferId}/rescue/prepare`, {
      method: "POST",
      idempotencyKey,
    });
  }

  /**
   * 8. Confirm Rescue
   * POST /transfers/:id/rescue/confirm
   */
  async confirmRescue(
    transferId: string,
    signatures: { rescueSignatures: string[] },
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<{ status: string }> {
    return this.requestWithRetry<{ status: string }>(`/transfers/${transferId}/rescue/confirm`, {
      method: "POST",
      body: signatures,
      idempotencyKey,
    });
  }

  /**
   * 9. Reclaim Lamport Rent for closed steps
   * POST /transfers/:id/reclaim-rent/prepare
   */
  async reclaimRent(
    transferId: string,
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<{ reclaimTxs: string[]; totalLamportsReclaimable: number }> {
    return this.requestWithRetry<{ reclaimTxs: string[]; totalLamportsReclaimable: number }>(
      `/transfers/${transferId}/reclaim-rent/prepare`,
      {
        method: "POST",
        idempotencyKey,
      }
    );
  }
}
