import { z } from "zod";
import crypto from "node:crypto";
import { MULTIHOPPER_API_URLS, INTEGRATION_IDENTIFIER, type SupportedNetwork } from "./constants";

/**
 * Sanitized logger - guarantees API keys and private secrets are never leaked in logs
 */
function sanitizeForLogging(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForLogging);
  
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("key") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("token") ||
      lowerKey.includes("auth") ||
      lowerKey.includes("signature")
    ) {
      sanitized[key] = typeof value === "string" ? `[REDACTED_LEN_${value.length}]` : "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeForLogging(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function logRequest(method: string, url: string, headers: Record<string, string>, body?: unknown) {
  const safeHeaders = { ...headers };
  if (safeHeaders["x-api-key"]) {
    safeHeaders["x-api-key"] = `mh_...${safeHeaders["x-api-key"].slice(-6)}`;
  }
  if (safeHeaders["authorization"]) {
    safeHeaders["authorization"] = "[REDACTED]";
  }
  console.log(`[MultiHopper HTTP Request] ${method} ${url}`, {
    headers: safeHeaders,
    body: sanitizeForLogging(body),
  });
}

function logResponse(method: string, url: string, status: number, durationMs: number, body?: unknown) {
  console.log(`[MultiHopper HTTP Response] ${method} ${url} - Status ${status} (${durationMs}ms)`, {
    body: sanitizeForLogging(body),
  });
}

// -----------------------------------------------------------------------------
// Zod Response Schemas
// -----------------------------------------------------------------------------

export const estimateResponseSchema = z.object({
  tier: z.string().optional().default("standard"),
  percentFeeBps: z.number(),
  percentFeeRaw: z.string(),
  totalFlatFeeLamports: z.string(),
  integratorPercentShare: z.string().optional().default("0"),
  integratorFlatShare: z.string().optional().default("0"),
  hopAmountRaw: z.string(),
  priceSource: z.string().optional().default("jupiter"),
  sol: z.object({
    requiredSolUpFrontLamports: z.string(),
    breakdown: z
      .object({
        screeningFeeLamports: z.string(),
        keeperFundingLamports: z.string().optional(),
        dispersionRentLamports: z.string().optional(),
      })
      .optional(),
  }),
});
export type EstimateResponse = z.infer<typeof estimateResponseSchema>;

export const transferDestinationSchema = z.object({
  wallet: z.string(),
  amountRaw: z.string(),
  status: z.enum(["pending", "routing", "delivered", "paid", "failed", "refunded"]).optional(),
  payoutSignature: z.string().optional(),
});
export type TransferDestination = z.infer<typeof transferDestinationSchema>;

export const createMultiSendResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  recipientReceivesRaw: z.string().optional(),
  destinations: z.array(transferDestinationSchema).optional(),
  route: z
    .object({
      hops: z
        .array(
          z.object({
            index: z.number(),
            address: z.string(),
            label: z.string().optional(),
            category: z.string().optional(),
            scheduledAt: z.string().optional(),
            executedAt: z.string().optional(),
            txSignature: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});
export type CreateMultiSendResponse = z.infer<typeof createMultiSendResponseSchema>;

export const transferStatusResponseSchema = z.object({
  id: z.string(),
  status: z.string(),
  externalId: z.string().optional(),
  network: z.string().optional(),
  destinations: z.array(transferDestinationSchema).optional(),
  percentFeeRaw: z.string().optional(),
  totalFlatFeeLamports: z.string().optional(),
  amountRaw: z.string().optional(),
  route: z.any().optional(),
});
export type TransferStatusResponse = z.infer<typeof transferStatusResponseSchema>;

export const preparedTransactionsResponseSchema = z.object({
  transfer: z.object({
    id: z.string(),
    status: z.string(),
  }),
  preparedTxs: z.object({
    routeInitTxs: z.array(z.union([z.object({ base64: z.string() }), z.string()])),
    orchestratorInitTx: z.string().nullable().optional(),
    sessionInitTxs: z.array(z.string()).optional(),
    keeperFundingTx: z.string().nullable().optional(),
    dispersionInitTxs: z.array(z.string()).optional(),
    recentBlockhash: z.string(),
    lastValidBlockHeight: z.number(),
  }),
});
export type PreparedTransactionsResponse = z.infer<typeof preparedTransactionsResponseSchema>;

export const usageResponseSchema = z.object({
  totalTransfers: z.number().optional(),
  completedTransfers: z.number().optional(),
  failedTransfers: z.number().optional(),
  totalVolumeRaw: z.string().optional(),
  totalFlatFeeEarned: z.string().optional(),
  totalPayouts: z.number().optional(),
  tokenFeesEarned: z.record(z.string(), z.string()).optional(),
  isTestMode: z.boolean().optional(),
  integratorAddress: z.string().optional(),
  collectedVolumeUsd: z.string().optional(),
  integratorRevenueShareUsd: z.string().optional(),
  transfersCount: z.number().optional(),
  unclaimedRewardsLamports: z.string().optional(),
});
export type UsageResponse = z.infer<typeof usageResponseSchema>;

// -----------------------------------------------------------------------------
// MultiHopper API Client with Exponential Backoff (3 retries: 1s, 2s, 4s)
// -----------------------------------------------------------------------------

export interface MultiHopperClientOptions {
  apiKey?: string;
  baseUrl?: string;
  network?: SupportedNetwork;
  fetchFn?: typeof fetch;
}

export class MultiHopperClient {
  private apiKey: string;
  private baseUrl: string;
  private fetchFn: typeof fetch;

  constructor(options: MultiHopperClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.MULTIHOPPER_API_KEY || "";
    const defaultUrl =
      options.network === "mainnet-beta" || process.env.NEXT_PUBLIC_NETWORK === "mainnet-beta"
        ? MULTIHOPPER_API_URLS.MAINNET
        : MULTIHOPPER_API_URLS.DEVNET;
    this.baseUrl = (options.baseUrl || process.env.MULTIHOPPER_BASE_URL || defaultUrl).replace(/\/$/, "");
    this.fetchFn = options.fetchFn || fetch.bind(globalThis);
  }

  private async requestWithRetry<T>(
    endpoint: string,
    options: {
      method: "GET" | "POST" | "DELETE";
      body?: unknown;
      idempotencyKey?: string;
      schema?: z.ZodSchema<T>;
    }
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const idempotencyKey =
      options.idempotencyKey || (options.method === "POST" ? crypto.randomUUID() : undefined);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-integration-id": INTEGRATION_IDENTIFIER,
    };
    if (this.apiKey) {
      headers["x-api-key"] = this.apiKey;
    }
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }

    const delays = [1000, 2000, 4000]; // 3 attempts with exponential backoff 1s/2s/4s
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const startTime = Date.now();
      logRequest(options.method, url, headers, options.body);

      try {
        const response = await this.fetchFn(url, {
          method: options.method,
          headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const durationMs = Date.now() - startTime;
        const text = await response.text();
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = text;
        }

        logResponse(options.method, url, response.status, durationMs, json);

        if (!response.ok) {
          const errorMsg =
            typeof json === "object" && json !== null && "error" in json
              ? String((json as Record<string, unknown>).error)
              : `HTTP ${response.status}: ${response.statusText}`;

          const isRetryable = response.status >= 500 || response.status === 429;
          if (isRetryable && attempt < delays.length) {
            const waitMs = delays[attempt];
            console.warn(`[MultiHopper Retry] Attempt ${attempt + 1} failed (${response.status}), retrying in ${waitMs}ms...`);
            await new Promise((r) => setTimeout(r, waitMs));
            continue;
          }
          throw new Error(`MultiHopper API Error: ${errorMsg}`);
        }

        if (options.schema) {
          const parseResult = options.schema.safeParse(json);
          if (!parseResult.success) {
            console.error(`[MultiHopper Schema Validation Error]`, parseResult.error.format());
            throw new Error(`Invalid response schema from MultiHopper ${endpoint}`);
          }
          return parseResult.data;
        }

        return json as T;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < delays.length) {
          const waitMs = delays[attempt];
          console.warn(`[MultiHopper Retry] Network failure on attempt ${attempt + 1}, retrying in ${waitMs}ms...`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
      }
    }

    throw lastError || new Error(`MultiHopper request failed after 3 retries: ${options.method} ${endpoint}`);
  }

  /**
   * Estimate fee for a transfer
   */
  async estimate(input: {
    tokenMint: string;
    tokenSymbol?: string;
    tokenDecimals?: number;
    amountRaw?: string;
    hops?: number;
    arrivalSeconds?: number;
    destinations?: Array<{ wallet: string; amountRaw: string }>;
  }): Promise<EstimateResponse> {
    return this.requestWithRetry<EstimateResponse>("/transfers/estimate", {
      method: "POST",
      body: input,
      schema: estimateResponseSchema,
    });
  }

  /**
   * Create multi-send transfer
   */
  async createMultiSend(input: {
    inputMint: string;
    sourceWallet: string;
    destinations: Array<{ wallet: string; amountRaw: string }>;
    isConfidential?: boolean;
    hops?: number;
    jitter?: number;
    externalId?: string;
  }, idempotencyKey?: string): Promise<CreateMultiSendResponse> {
    return this.requestWithRetry<CreateMultiSendResponse>("/transfers", {
      method: "POST",
      body: input,
      idempotencyKey,
      schema: createMultiSendResponseSchema,
    });
  }

  /**
   * Get transfer status
   */
  async getTransferStatus(transferId: string): Promise<TransferStatusResponse> {
    return this.requestWithRetry<TransferStatusResponse>(`/transfers/${transferId}`, {
      method: "GET",
      schema: transferStatusResponseSchema,
    });
  }

  /**
   * Get integrator usage statistics
   */
  async getUsage(): Promise<UsageResponse> {
    return this.requestWithRetry<UsageResponse>("/usage", {
      method: "GET",
      schema: usageResponseSchema,
    });
  }
}

// -----------------------------------------------------------------------------
// Singleton instance & Required Named Exports
// -----------------------------------------------------------------------------

const defaultClient = new MultiHopperClient();

export async function estimateFee(params: {
  tokenMint: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  amountRaw?: string;
  hops?: number;
  arrivalSeconds?: number;
  destinations?: Array<{ wallet: string; amountRaw: string }>;
}): Promise<EstimateResponse> {
  return defaultClient.estimate(params);
}

export async function createMultiSend(
  params: {
    inputMint: string;
    sourceWallet: string;
    destinations: Array<{ wallet: string; amountRaw: string }>;
    isConfidential?: boolean;
    hops?: number;
    jitter?: number;
    externalId?: string;
  },
  idempotencyKey?: string
): Promise<CreateMultiSendResponse> {
  return defaultClient.createMultiSend(params, idempotencyKey);
}

export async function getTransferStatus(transferId: string): Promise<TransferStatusResponse> {
  return defaultClient.getTransferStatus(transferId);
}
