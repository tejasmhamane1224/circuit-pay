import crypto from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { chunkPayoutDestinations } from "../multihopper/chunker";
import { MULTIHOPPER_RULES } from "../constants";
import { formatAmountFromRaw } from "../csv/parser";
import { db, schema } from "@/db";
import {
  assertValidBatchTransition,
  assertValidTransferTransition,
  assertValidItemTransition,
  aggregateBatchStatusFromChunks,
  type BatchStatus,
  type TransferStatus,
  type PayoutItemStatus,
} from "../multihopper/state-machine";
import { type BatchApproval, type Role, evaluateBatchApprovals, DEFAULT_APPROVAL_POLICY } from "../security/roles";
import { outboundWebhookManager } from "../webhooks/outbound";
import { dispatchBatchLifecycleNotification } from "../notifications/dispatcher";

export interface CreateBatchParams {
  organizationId?: string;
  title: string;
  senderWallet: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenDecimals: number;
  network?: "mainnet-beta" | "devnet";
  hops?: number;
  arrivalSeconds?: number;
  items: Array<{
    recipientWallet: string;
    amountFormatted: string;
    amountRaw?: string;
    recipientName?: string;
  }>;
}

export interface StoredBatch {
  id: string;
  organizationId: string;
  title: string;
  tokenMint: string;
  tokenSymbol: string;
  tokenDecimals: number;
  totalAmountRaw: string;
  totalAmountFormatted: string;
  status: BatchStatus;
  senderWallet: string;
  network: "mainnet-beta" | "devnet";
  hops: number;
  arrivalSeconds: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  transfers: StoredTransfer[];
  items: StoredPayoutItem[];
}

export interface StoredTransfer {
  id: string;
  batchId: string;
  chunkIndex: number;
  externalId: string;
  multihopperId?: string;
  hops: number;
  arrivalSeconds: number;
  status: TransferStatus;
  chunkAmountRaw: string;
  recipientCount: number;
  keeperFundingTx?: string;
  keeperFundingSignature?: string;
  routeInitSignatures?: string[];
  orchestratorInitSignature?: string;
  sessionInitSignatures?: string[];
  dispersionInitSignatures?: string[];
  percentFeeRaw?: string;
  flatFeeLamports?: string;
  integratorFeeShareRaw?: string;
  idempotencyKey?: string;
  attempts: number;
  lastRetryAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  items?: StoredPayoutItem[];
}

export interface StoredPayoutItem {
  id: string;
  batchId: string;
  transferId?: string;
  recipientWallet: string;
  recipientName?: string;
  amountRaw: string;
  amountFormatted: string;
  status: PayoutItemStatus;
  payoutSignature?: string;
  screeningStatus: "clean" | "flagged" | "exempt";
  paymentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredAuditLogEntry {
  id: string;
  organizationId?: string;
  actorWallet: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

export interface BatchReconciliationResult {
  batchId: string;
  network: "mainnet-beta" | "devnet";
  tokenSymbol: string;
  tokenDecimals: number;
  requestedTotalRaw: string;
  requestedTotalFormatted: string;
  settledTotalRaw: string;
  settledTotalFormatted: string;
  failedTotalRaw: string;
  failedTotalFormatted: string;
  pendingTotalRaw: string;
  pendingTotalFormatted: string;
  varianceRaw: string;
  isBalanced: boolean;
  totalItemsCount: number;
  settledItemsCount: number;
  failedItemsCount: number;
  pendingItemsCount: number;
  screeningCount: number;
  screeningFeeSol: number;
  keeperFundingSol: number;
  screeningFeeLamports: string;
  keeperFundingLamports: string;
  totalProtocolSolLamports: string;
  estimatedPercentFeeRaw: string;
}

export interface StoredWebhookEvent {
  id: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  signature: string;
  processed: boolean;
  processedAt?: string;
  error?: string;
  createdAt: string;
}

export interface StoredVolumeLedgerEntry {
  id: string;
  transferId?: string;
  multihopperId: string;
  network: "mainnet-beta" | "devnet";
  isMainnet: boolean;
  tokenMint: string;
  tokenSymbol: string;
  principalAmountRaw: string;
  principalAmountUsd: string;
  collectedFeeRaw: string;
  collectedFeeUsd: string;
  qualifyingVolumeUsd: string;
  integratorFeeShareUsd: string;
  verifiedAt: string;
  createdAt: string;
}

/**
 * In-memory repository with Postgres parity
 */
class PayoutRepository {
  private batches = new Map<string, StoredBatch>();
  private transfers = new Map<string, StoredTransfer>();
  private items = new Map<string, StoredPayoutItem>();
  private webhooks = new Map<string, StoredWebhookEvent>();
  private volumeLedger: StoredVolumeLedgerEntry[] = [];
  private auditLogs: StoredAuditLogEntry[] = [];
  private batchApprovals = new Map<string, BatchApproval[]>();

  constructor() {
    this.seedDefaultData();
  }

  public seedDefaultData() {
    if (process.env.NODE_ENV !== "test") {
      this.volumeLedger = [];
      return;
    }

    // Initial demo batch for the dashboard (test fixtures only)
    const demoBatchId = "batch-core-dev-01";
    const chunk0Id = "tr-chunk-0";
    const chunk1Id = "tr-chunk-1";

    const transfer0: StoredTransfer = {
      id: chunk0Id,
      batchId: demoBatchId,
      chunkIndex: 0,
      externalId: `${demoBatchId}_chunk_0`,
      multihopperId: "mh_tr_8f9104b2a",
      hops: 4,
      arrivalSeconds: 900,
      status: "completed",
      chunkAmountRaw: "19600000000",
      recipientCount: 20,
      percentFeeRaw: "98000000",
      flatFeeLamports: "1500000",
      integratorFeeShareRaw: "49000000",
      idempotencyKey: "idem-seed-chunk-0",
      attempts: 1,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
      items: [],
    };

    const transfer1: StoredTransfer = {
      id: chunk1Id,
      batchId: demoBatchId,
      chunkIndex: 1,
      externalId: `${demoBatchId}_chunk_1`,
      multihopperId: "mh_tr_9a0223e1b",
      hops: 4,
      arrivalSeconds: 900,
      status: "completed",
      chunkAmountRaw: "4900000000",
      recipientCount: 5,
      percentFeeRaw: "24500000",
      flatFeeLamports: "1500000",
      integratorFeeShareRaw: "12250000",
      idempotencyKey: "idem-seed-chunk-1",
      attempts: 1,
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
      items: [],
    };

    this.transfers.set(chunk0Id, transfer0);
    this.transfers.set(chunk1Id, transfer1);

    // Seed 25 contributor items (20 in Chunk 0, 5 in Chunk 1)
    const contributorNames = [
      "Alex Chen (Lead Protocol)",
      "Maria Garcia (Core Engine)",
      "David Kim (Security / Audits)",
      "Elena Rostova (Cryptography)",
      "Satoshi M. (Anchor Contracts)",
      "Marcus Aurelius (Routing)",
      "Sarah Jenkins (UI / UX)",
      "Liam O'Connor (DevOps / RPC)",
      "Tariq Al-Mansoor (Auditor)",
      "Chloe Dupont (Zero-Knowledge)",
      "Kenji Sato (State Machine)",
      "Amara Okafor (Keeper Network)",
      "Lucas Silva (Analytics)",
      "Priya Patel (Tokenomics)",
      "Hannah Weber (QA / Reliability)",
      "Dmitri Ivanov (Solana Validator)",
      "Carlos Santana (Integration)",
      "Fatima Zahra (Compliance / AML)",
      "Gabriel Vance (Documentation)",
      "Zoe Barnes (Community Grants)",
      // Chunk 1 (5 contributors)
      "Noah Bennett (Advisory)",
      "Aaliyah Khan (Infrastructure)",
      "Vikram Singh (Performance)",
      "Rachel Green (Operations)",
      "Leo Vance (Developer Advocate)",
    ];

    const demoItems: StoredPayoutItem[] = [];
    for (let i = 0; i < 25; i++) {
      const isChunk0 = i < 20;
      const transferId = isChunk0 ? chunk0Id : chunk1Id;
      // Deterministic valid base58 pubkey from seed
      const seedBytes = new Uint8Array(32);
      seedBytes[0] = i + 1;
      seedBytes[31] = i + 1;
      const simulatedPubkey = Keypair.fromSeed(seedBytes).publicKey.toBase58();
      const itemId = `item-seed-${i + 1}`;
      const amountRaw = "980000000"; // 980 USDC

      const item: StoredPayoutItem = {
        id: itemId,
        batchId: demoBatchId,
        transferId,
        recipientWallet: simulatedPubkey,
        recipientName: contributorNames[i],
        amountRaw,
        amountFormatted: "980.00",
        status: "paid",
        payoutSignature: `5wSigSettledMock${i + 1}${simulatedPubkey.slice(0, 16)}Sol`,
        screeningStatus: "clean",
        paymentCount: 1,
        createdAt: new Date(Date.now() - 3600000).toISOString(),
        updatedAt: new Date(Date.now() - 1800000).toISOString(),
      };

      this.items.set(itemId, item);
      demoItems.push(item);
      if (isChunk0) {
        transfer0.items?.push(item);
      } else {
        transfer1.items?.push(item);
      }
    }

    const batch: StoredBatch = {
      id: demoBatchId,
      organizationId: "00000000-0000-0000-0000-000000000001",
      title: "Core Protocol Contributors - Sprint 18",
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      totalAmountRaw: "24500000000",
      totalAmountFormatted: "24500.00",
      status: "completed",
      senderWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      network: "mainnet-beta",
      hops: 4,
      arrivalSeconds: 900,
      createdBy: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      createdAt: new Date(Date.now() - 3600000).toISOString(),
      updatedAt: new Date(Date.now() - 1800000).toISOString(),
      transfers: [transfer0, transfer1],
      items: demoItems,
    };

    this.batches.set(demoBatchId, batch);

    // In test environment, provide deterministic test fixtures for math and volume tests
    // In production/staging, volume ledger is strictly 100% real on-chain verified entries
    if (process.env.NODE_ENV === "test") {
      this.volumeLedger = [
        {
          id: "vol-test-01",
          transferId: chunk0Id,
          multihopperId: "mh_tr_8f9104b2a",
          network: "mainnet-beta",
          isMainnet: true,
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol: "USDC",
          principalAmountRaw: "19600000000",
          principalAmountUsd: "19600.0000",
          collectedFeeRaw: "98000000",
          collectedFeeUsd: "98.0000",
          qualifyingVolumeUsd: "39200.0000", // 98 / 0.0025
          integratorFeeShareUsd: "49.0000",
          verifiedAt: new Date(Date.now() - 3600000).toISOString(),
          createdAt: new Date(Date.now() - 3600000).toISOString(),
        },
        {
          id: "vol-test-02",
          transferId: chunk1Id,
          multihopperId: "mh_tr_9a0223e1b",
          network: "mainnet-beta",
          isMainnet: true,
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol: "USDC",
          principalAmountRaw: "32000000000",
          principalAmountUsd: "32000.0000",
          collectedFeeRaw: "160000000",
          collectedFeeUsd: "160.0000",
          qualifyingVolumeUsd: "64000.0000", // 160 / 0.0025
          integratorFeeShareUsd: "80.0000",
          verifiedAt: new Date(Date.now() - 86400000 * 4).toISOString(),
          createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
        },
      ];
    } else {
      this.volumeLedger = [];
    }

    // Seed Audit Log Entries
    this.auditLogs = [
      {
        id: "audit-seed-01",
        organizationId: "00000000-0000-0000-0000-000000000001",
        actorWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        action: "batch.created",
        resourceType: "payout_batch",
        resourceId: demoBatchId,
        details: {
          title: "Core Protocol Contributors - Sprint 18",
          network: "mainnet-beta",
          totalAmountFormatted: "24500.00",
          recipientCount: 25,
          chunksCount: 2,
        },
        createdAt: new Date(Date.now() - 3600000).toISOString(),
      },
      {
        id: "audit-seed-02",
        organizationId: "00000000-0000-0000-0000-000000000001",
        actorWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        action: "transfer.broadcast",
        resourceType: "multihopper_transfer",
        resourceId: chunk0Id,
        details: {
          chunkIndex: 0,
          recipientCount: 20,
          amountUsd: "19600.00",
          status: "processing",
        },
        createdAt: new Date(Date.now() - 3400000).toISOString(),
      },
      {
        id: "audit-seed-03",
        organizationId: "00000000-0000-0000-0000-000000000001",
        actorWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        action: "transfer.broadcast",
        resourceType: "multihopper_transfer",
        resourceId: chunk1Id,
        details: {
          chunkIndex: 1,
          recipientCount: 5,
          amountUsd: "4900.00",
          status: "processing",
        },
        createdAt: new Date(Date.now() - 3300000).toISOString(),
      },
      {
        id: "audit-seed-04",
        organizationId: "00000000-0000-0000-0000-000000000001",
        actorWallet: "system",
        action: "webhook.transfer.completed",
        resourceType: "multihopper_transfer",
        resourceId: chunk0Id,
        details: {
          multihopperId: "mh_tr_8f9104b2a",
          settledItems: 20,
        },
        createdAt: new Date(Date.now() - 2400000).toISOString(),
      },
      {
        id: "audit-seed-05",
        organizationId: "00000000-0000-0000-0000-000000000001",
        actorWallet: "system",
        action: "webhook.transfer.completed",
        resourceType: "multihopper_transfer",
        resourceId: chunk1Id,
        details: {
          multihopperId: "mh_tr_9a0223e1b",
          settledItems: 5,
        },
        createdAt: new Date(Date.now() - 1800000).toISOString(),
      },
    ];
  }

  public resetStore() {
    this.batches.clear();
    this.transfers.clear();
    this.items.clear();
    this.webhooks.clear();
    this.volumeLedger = [];
    this.auditLogs = [];
  }

  /**
   * Creates a new Payout Batch, chunks items into <=20 destinations,
   * and persists transfers and payout items
   */
  public async createPayoutBatch(params: CreateBatchParams): Promise<StoredBatch> {
    const batchId = `batch-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const orgId = params.organizationId || "00000000-0000-0000-0000-000000000001";
    const decimals = params.tokenDecimals ?? 6;

    // Convert items amounts if not present
    const processedItems = params.items.map((item) => {
      let amountRaw = item.amountRaw;
      if (!amountRaw) {
        const parts = item.amountFormatted.split(".");
        const integerPart = BigInt(parts[0] || "0");
        const fractionalStr = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
        const fractionalPart = BigInt(fractionalStr || "0");
        amountRaw = (integerPart * (BigInt(10) ** BigInt(decimals)) + fractionalPart).toString();
      }
      return {
        ...item,
        amountRaw,
      };
    });

    // Calculate totals
    const totalRawBig = processedItems.reduce(
      (sum, item) => sum + BigInt(item.amountRaw),
      BigInt(0)
    );

    // Chunk destinations strictly respecting MultiHopper's 20-destination cap
    const destinationInputs = processedItems.map((item) => ({
      wallet: item.recipientWallet,
      amountRaw: item.amountRaw,
      recipientName: item.recipientName,
    }));

    const chunks = chunkPayoutDestinations(
      batchId,
      destinationInputs,
      MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK
    );

    const storedTransfers: StoredTransfer[] = [];
    const storedItems: StoredPayoutItem[] = [];

    // Create chunks and associate items
    let globalItemIdx = 0;
    for (const chk of chunks) {
      const transferId = `tr-${crypto.randomUUID()}`;

      const transferRecord: StoredTransfer = {
        id: transferId,
        batchId,
        chunkIndex: chk.chunkIndex,
        externalId: chk.externalId,
        multihopperId: undefined,
        hops: params.hops ?? 4,
        arrivalSeconds: params.arrivalSeconds ?? 900,
        status: "created",
        chunkAmountRaw: chk.chunkAmountRaw,
        recipientCount: chk.recipientCount,
        idempotencyKey: crypto.randomUUID(),
        routeInitSignatures: [],
        attempts: 1,
        createdAt: now,
        updatedAt: now,
        items: [],
      };

      this.transfers.set(transferId, transferRecord);
      storedTransfers.push(transferRecord);

      // Create PayoutItems for this chunk
      for (const d of chk.destinations) {
        const originalItem = processedItems[globalItemIdx++];
        const itemId = `item-${crypto.randomUUID()}`;

        const itemRecord: StoredPayoutItem = {
          id: itemId,
          batchId,
          transferId,
          recipientWallet: d.wallet,
          recipientName: originalItem?.recipientName,
          amountRaw: d.amountRaw,
          amountFormatted: originalItem?.amountFormatted || "0",
          status: "pending",
          screeningStatus: "clean",
          paymentCount: 0,
          createdAt: now,
          updatedAt: now,
        };

        this.items.set(itemId, itemRecord);
        storedItems.push(itemRecord);
        transferRecord.items?.push(itemRecord);
      }
    }

    const batchRecord: StoredBatch = {
      id: batchId,
      organizationId: orgId,
      title: params.title,
      tokenMint: params.tokenMint,
      tokenSymbol: params.tokenSymbol || "USDC",
      tokenDecimals: decimals,
      totalAmountRaw: totalRawBig.toString(),
      totalAmountFormatted: formatAmountFromRaw(totalRawBig, decimals),
      status: "draft",
      senderWallet: params.senderWallet,
      network: params.network || "devnet",
      hops: params.hops ?? 4,
      arrivalSeconds: params.arrivalSeconds ?? 900,
      createdBy: params.senderWallet,
      createdAt: now,
      updatedAt: now,
      transfers: storedTransfers,
      items: storedItems,
    };

    this.batches.set(batchId, batchRecord);

    await this.recordAuditLog({
      organizationId: orgId,
      actorWallet: params.senderWallet,
      action: "batch.created",
      resourceType: "payout_batch",
      resourceId: batchId,
      details: {
        title: params.title,
        network: batchRecord.network,
        totalAmountFormatted: batchRecord.totalAmountFormatted,
        recipientCount: batchRecord.items.length,
        chunksCount: batchRecord.transfers.length,
      },
    });

    // If batch total exceeds multi-approval threshold, dispatch batch.awaiting_approval notification & webhook
    const totalUsd = parseFloat(batchRecord.totalAmountFormatted.replace(/,/g, "")) || 0;
    const roundedUsd = Math.round((totalUsd + Number.EPSILON) * 100) / 100;
    if (roundedUsd >= DEFAULT_APPROVAL_POLICY.thresholdUsd) {
      try {
        await dispatchBatchLifecycleNotification("batch.awaiting_approval", {
          batchId: batchRecord.id,
          organizationId: batchRecord.organizationId,
          title: batchRecord.title,
          totalAmountFormatted: batchRecord.totalAmountFormatted,
          tokenSymbol: batchRecord.tokenSymbol,
          recipientCount: batchRecord.items?.length || 0,
          network: batchRecord.network,
        });

        await outboundWebhookManager.dispatchBatchSettlement(
          "batch.awaiting_approval",
          batchRecord
        );
      } catch (err) {
        console.error("Notification / webhook dispatch error in createPayoutBatch:", err);
      }
    }

    // Attempt Drizzle PostgreSQL persistence with graceful fallback
    try {
      if (process.env.NODE_ENV !== "test") {
        await db.insert(schema.payoutBatches).values({
          id: batchId,
          organizationId: orgId,
          title: batchRecord.title,
          tokenMint: batchRecord.tokenMint,
          tokenSymbol: batchRecord.tokenSymbol,
          tokenDecimals: batchRecord.tokenDecimals,
          totalAmountRaw: batchRecord.totalAmountRaw,
          totalAmountFormatted: batchRecord.totalAmountFormatted,
          status: batchRecord.status,
          senderWallet: batchRecord.senderWallet,
          network: batchRecord.network,
          hops: batchRecord.hops,
          arrivalSeconds: batchRecord.arrivalSeconds,
          createdBy: batchRecord.createdBy,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        });

        for (const t of storedTransfers) {
          await db.insert(schema.multihopperTransfers).values({
            id: t.id,
            batchId: t.batchId,
            chunkIndex: t.chunkIndex,
            externalId: t.externalId,
            multihopperId: t.multihopperId,
            hops: t.hops,
            arrivalSeconds: t.arrivalSeconds,
            status: t.status,
            chunkAmountRaw: t.chunkAmountRaw,
            recipientCount: t.recipientCount,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          });
        }

        for (const i of storedItems) {
          await db.insert(schema.payoutItems).values({
            id: i.id,
            batchId: i.batchId,
            transferId: i.transferId,
            recipientWallet: i.recipientWallet,
            recipientName: i.recipientName,
            amountRaw: i.amountRaw,
            amountFormatted: i.amountFormatted,
            status: i.status,
            screeningStatus: i.screeningStatus,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          });
        }
      }
    } catch (err) {
      console.error("Drizzle PostgreSQL persistence error in createPayoutBatch (in-memory fallback active):", err);
    }

    return batchRecord;
  }

  public async getPayoutBatch(id: string): Promise<StoredBatch | null> {
    const batch = this.batches.get(id);
    if (!batch) return null;

    // Refresh transfers and items
    const transfers = Array.from(this.transfers.values()).filter((t) => t.batchId === id);
    const items = Array.from(this.items.values()).filter((i) => i.batchId === id);

    for (const t of transfers) {
      t.items = items.filter((i) => i.transferId === t.id);
    }

    return {
      ...batch,
      transfers,
      items,
    };
  }

  public async listPayoutBatches(orgId?: string): Promise<StoredBatch[]> {
    const all = Array.from(this.batches.values());
    const filtered = orgId ? all.filter((b) => b.organizationId === orgId) : all;

    return Promise.all(
      filtered.map(async (b) => (await this.getPayoutBatch(b.id)) || b)
    );
  }

  /**
   * Computes the total USD volume of batches created by an organization in the last 24 hours
   */
  public async getDailyOrganizationVolume(orgId: string, sinceDate?: Date, solRate = 150): Promise<number> {
    const cutoff = sinceDate ? sinceDate.getTime() : Date.now() - 24 * 60 * 60 * 1000;
    const all = Array.from(this.batches.values());
    const orgBatches = all.filter(
      (b) =>
        b.organizationId === orgId &&
        b.status !== "failed" &&
        b.status !== "refunded" &&
        new Date(b.createdAt).getTime() >= cutoff
    );

    let totalUsd = 0;
    for (const b of orgBatches) {
      const parsedAmount = parseFloat(b.totalAmountFormatted.replace(/,/g, "")) || 0;
      if (b.tokenSymbol?.toUpperCase() === "SOL") {
        totalUsd += parsedAmount * solRate;
      } else {
        totalUsd += parsedAmount;
      }
    }

    return totalUsd;
  }

  public async updateBatchStatus(id: string, newStatus: BatchStatus): Promise<StoredBatch> {
    const batch = this.batches.get(id);
    if (!batch) {
      throw new Error(`Batch ${id} not found`);
    }

    assertValidBatchTransition(batch.status, newStatus);
    const oldStatus = batch.status;
    batch.status = newStatus;
    batch.updatedAt = new Date().toISOString();

    await this.recordAuditLog({
      actorWallet: "system",
      action: "batch.status_updated",
      resourceType: "payout_batch",
      resourceId: id,
      details: {
        fromStatus: oldStatus,
        toStatus: newStatus,
      },
    });

    if (newStatus === "completed" || newStatus === "failed") {
      outboundWebhookManager.dispatchBatchSettlement(
        newStatus === "completed" ? "batch.completed" : "batch.failed",
        batch
      ).catch(() => {});

      dispatchBatchLifecycleNotification(
        newStatus === "completed" ? "batch.completed" : "batch.failed",
        {
          batchId: batch.id,
          organizationId: batch.organizationId,
          title: batch.title,
          totalAmountFormatted: batch.totalAmountFormatted,
          tokenSymbol: batch.tokenSymbol,
          recipientCount: batch.items?.length || 0,
          network: batch.network,
        }
      ).catch(() => {});
    }

    return batch;
  }

  public async addBatchApproval(
    batchId: string,
    approval: { approverWallet: string; role: Role; notes?: string }
  ): Promise<{
    approval: BatchApproval;
    evaluation: ReturnType<typeof evaluateBatchApprovals>;
  }> {
    const batch = await this.getPayoutBatch(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    const current = this.batchApprovals.get(batchId) || [];
    if (current.some((a) => a.approverWallet === approval.approverWallet)) {
      throw new Error(`Wallet ${approval.approverWallet} has already approved batch ${batchId}`);
    }

    const record: BatchApproval = {
      id: `appr-${crypto.randomUUID()}`,
      batchId,
      approverWallet: approval.approverWallet,
      role: approval.role,
      approvedAt: new Date().toISOString(),
      notes: approval.notes,
    };

    current.push(record);
    this.batchApprovals.set(batchId, current);

    const totalUsd = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    const evaluation = evaluateBatchApprovals(totalUsd, current);

    await this.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet: approval.approverWallet,
      action: "batch.approved",
      resourceType: "payout_batch",
      resourceId: batchId,
      details: {
        role: approval.role,
        notes: approval.notes,
        isApproved: evaluation.isApproved,
        approversCount: evaluation.currentCount,
        requiredApprovals: evaluation.requiredApprovals,
      },
    });

    if (evaluation.isApproved && batch.status === "draft") {
      await this.updateBatchStatus(batchId, "awaiting_signature");
    }

    return { approval: record, evaluation };
  }

  public getBatchApprovals(batchId: string): BatchApproval[] {
    return [...(this.batchApprovals.get(batchId) || [])];
  }

  public getBatchApprovalEvaluation(batchId: string): ReturnType<typeof evaluateBatchApprovals> | null {
    const batch = this.batches.get(batchId);
    if (!batch) return null;
    const approvals = this.batchApprovals.get(batchId) || [];
    const totalUsd = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    return evaluateBatchApprovals(totalUsd, approvals);
  }

  public async getTransferByIdOrExternal(idOrExternalId: string): Promise<StoredTransfer | null> {
    let transfer = this.transfers.get(idOrExternalId);
    if (!transfer) {
      transfer = Array.from(this.transfers.values()).find(
        (t) => t.externalId === idOrExternalId || t.multihopperId === idOrExternalId
      );
    }
    if (!transfer) return null;

    transfer.items = Array.from(this.items.values()).filter(
      (i) => i.transferId === transfer.id
    );
    return transfer;
  }

  public async updateTransfer(
    id: string,
    updates: Partial<StoredTransfer>
  ): Promise<StoredTransfer> {
    const transfer = this.transfers.get(id);
    if (!transfer) {
      throw new Error(`Transfer ${id} not found`);
    }

    if (updates.status && updates.status !== transfer.status) {
      assertValidTransferTransition(transfer.status, updates.status);
    }

    const oldStatus = transfer.status;
    Object.assign(transfer, updates, { updatedAt: new Date().toISOString() });

    if (updates.status && updates.status !== oldStatus) {
      await this.recordAuditLog({
        actorWallet: "system",
        action: "transfer.status_updated",
        resourceType: "multihopper_transfer",
        resourceId: id,
        details: {
          fromStatus: oldStatus,
          toStatus: updates.status,
          batchId: transfer.batchId,
          chunkIndex: transfer.chunkIndex,
          attempts: transfer.attempts,
        },
      });
    }

    // Sync parent batch state
    const batch = this.batches.get(transfer.batchId);
    if (batch) {
      const allTransfers = Array.from(this.transfers.values()).filter(
        (t) => t.batchId === batch.id
      );
      const newBatchStatus = aggregateBatchStatusFromChunks(
        allTransfers.map((t) => t.status)
      );

      if (newBatchStatus !== batch.status) {
        batch.status = newBatchStatus;
        batch.updatedAt = new Date().toISOString();

        if (newBatchStatus === "completed" || newBatchStatus === "failed") {
          outboundWebhookManager.dispatchBatchSettlement(
            newBatchStatus === "completed" ? "batch.completed" : "batch.failed",
            batch
          ).catch(() => {});

          dispatchBatchLifecycleNotification(
            newBatchStatus === "completed" ? "batch.completed" : "batch.failed",
            {
              batchId: batch.id,
              organizationId: batch.organizationId,
              title: batch.title,
              totalAmountFormatted: batch.totalAmountFormatted,
              tokenSymbol: batch.tokenSymbol,
              recipientCount: batch.items?.length || 0,
              network: batch.network,
            }
          ).catch(() => {});
        }
      }
    }

    return transfer;
  }

  public async updatePayoutItem(
    id: string,
    updates: Partial<StoredPayoutItem>
  ): Promise<StoredPayoutItem> {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Payout item ${id} not found`);
    }

    if (updates.status && updates.status !== item.status) {
      assertValidItemTransition(item.status, updates.status);
    }

    const isBecomingPaid = updates.status === "paid" && item.status !== "paid";
    const newPaymentCount = isBecomingPaid
      ? (item.paymentCount || 0) + 1
      : updates.paymentCount !== undefined
      ? updates.paymentCount
      : item.paymentCount ?? 0;

    Object.assign(item, updates, {
      paymentCount: newPaymentCount,
      updatedAt: new Date().toISOString(),
    });
    return item;
  }

  public async getPayoutItem(id: string): Promise<StoredPayoutItem | null> {
    return this.items.get(id) || null;
  }

  public async manualResolveTransfer(
    transferId: string,
    params: {
      actorWallet?: string;
      reason: string;
      resolutionSignature?: string;
      status?: "completed" | "refunded";
    }
  ): Promise<StoredTransfer> {
    const transfer = await this.getTransferByIdOrExternal(transferId);
    if (!transfer) {
      throw new Error(`Transfer ${transferId} not found`);
    }

    if (transfer.status === "completed") {
      throw new Error(`Transfer ${transferId} is already completed; cannot manually resolve`);
    }

    const actor = params.actorWallet || "admin";
    const targetStatus = params.status || "completed";
    const sig = params.resolutionSignature || `5wManualResolve_${crypto.randomUUID().slice(0, 8)}Sol`;
    const now = new Date().toISOString();

    const items = transfer.items || [];
    for (const item of items) {
      if (item.status !== "paid" && item.status !== "refunded") {
        const itemTargetStatus = targetStatus === "completed" ? "paid" : "refunded";
        await this.updatePayoutItem(item.id, {
          status: itemTargetStatus,
          payoutSignature: itemTargetStatus === "paid" ? sig : undefined,
        });
      }
    }

    await this.updateTransfer(transfer.id, {
      status: targetStatus,
      updatedAt: now,
    });

    await this.recordAuditLog({
      actorWallet: actor,
      action: "transfer.manual_resolved",
      resourceType: "multihopper_transfer",
      resourceId: transfer.id,
      details: {
        batchId: transfer.batchId,
        chunkIndex: transfer.chunkIndex,
        reason: params.reason,
        resolutionSignature: sig,
        resolvedToStatus: targetStatus,
      },
    });

    return (await this.getTransferByIdOrExternal(transfer.id))!;
  }

  public async manualResolveBatch(
    batchId: string,
    params: {
      actorWallet?: string;
      reason: string;
      resolutionSignature?: string;
      status?: "completed" | "refunded";
    }
  ): Promise<StoredBatch> {
    const batch = await this.getPayoutBatch(batchId);
    if (!batch) {
      throw new Error(`Batch ${batchId} not found`);
    }

    if (batch.status === "completed") {
      throw new Error(`Batch ${batchId} is already completed; cannot manually resolve`);
    }

    const actor = params.actorWallet || batch.senderWallet || "admin";
    const targetStatus = params.status || "completed";
    const sig = params.resolutionSignature || `5wManualBatchResolve_${crypto.randomUUID().slice(0, 8)}Sol`;

    for (const transfer of batch.transfers) {
      if (transfer.status !== "completed" && transfer.status !== "refunded") {
        await this.manualResolveTransfer(transfer.id, {
          actorWallet: actor,
          reason: params.reason,
          resolutionSignature: sig,
          status: targetStatus,
        });
      }
    }

    await this.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet: actor,
      action: "batch.manual_resolved",
      resourceType: "payout_batch",
      resourceId: batchId,
      details: {
        reason: params.reason,
        resolutionSignature: sig,
        resolvedToStatus: targetStatus,
      },
    });

    return (await this.getPayoutBatch(batchId))!;
  }

  /**
   * Idempotent webhook event registration & deduplication
   */
  public async registerWebhookEvent(
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    signature: string
  ): Promise<{ existing: boolean; event: StoredWebhookEvent }> {
    const existing = this.webhooks.get(eventId);
    if (existing) {
      return { existing: true, event: existing };
    }

    const eventRecord: StoredWebhookEvent = {
      id: `wh-${crypto.randomUUID()}`,
      eventId,
      eventType,
      payload,
      signature,
      processed: false,
      createdAt: new Date().toISOString(),
    };

    this.webhooks.set(eventId, eventRecord);
    return { existing: false, event: eventRecord };
  }

  public async markWebhookProcessed(
    eventId: string,
    success: boolean,
    error?: string
  ): Promise<void> {
    const event = this.webhooks.get(eventId);
    if (event) {
      event.processed = success;
      event.processedAt = new Date().toISOString();
      if (error) event.error = error;
    }
  }

  public async recordVolumeLedger(entry: Omit<StoredVolumeLedgerEntry, "id" | "createdAt">): Promise<StoredVolumeLedgerEntry> {
    const record: StoredVolumeLedgerEntry = {
      ...entry,
      id: `vol-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    this.volumeLedger.push(record);
    return record;
  }

  public getVolumeLedger(): StoredVolumeLedgerEntry[] {
    return [...this.volumeLedger];
  }

  public async recordAuditLog(
    entry: Omit<StoredAuditLogEntry, "id" | "createdAt">
  ): Promise<StoredAuditLogEntry> {
    const id = `audit-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const logRecord: StoredAuditLogEntry = {
      id,
      organizationId: entry.organizationId,
      actorWallet: entry.actorWallet,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details,
      ipAddress: entry.ipAddress,
      createdAt,
    };
    this.auditLogs.unshift(logRecord);

    try {
      if (process.env.NODE_ENV !== "test") {
        await db.insert(schema.auditLog).values({
          id,
          organizationId: entry.organizationId,
          actorWallet: entry.actorWallet,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId,
          details: entry.details,
          ipAddress: entry.ipAddress,
          createdAt: new Date(createdAt),
        });
      }
    } catch (err) {
      console.error("Drizzle PostgreSQL audit log persistence error (in-memory fallback active):", err);
    }

    return logRecord;
  }

  public listAuditLogs(resourceId?: string, limit = 50): StoredAuditLogEntry[] {
    if (!resourceId) {
      return this.auditLogs.slice(0, limit);
    }
    return this.auditLogs
      .filter(
        (log) =>
          log.resourceId === resourceId ||
          (log.details &&
            (log.details.batchId === resourceId || log.details.resourceId === resourceId))
      )
      .slice(0, limit);
  }

  public async getSettlementReconciliation(
    batchId: string
  ): Promise<BatchReconciliationResult | null> {
    const batch = await this.getPayoutBatch(batchId);
    if (!batch) return null;

    const decimals = batch.tokenDecimals ?? 6;
    let requestedRawBig = BigInt(0);
    let settledRawBig = BigInt(0);
    let failedRawBig = BigInt(0);
    let pendingRawBig = BigInt(0);

    let settledCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    for (const item of batch.items) {
      const raw = BigInt(item.amountRaw || "0");
      requestedRawBig += raw;
      if (item.status === "paid") {
        settledRawBig += raw;
        settledCount++;
      } else if (item.status === "failed") {
        failedRawBig += raw;
        failedCount++;
      } else {
        pendingRawBig += raw;
        pendingCount++;
      }
    }

    const varianceBig = requestedRawBig - (settledRawBig + failedRawBig + pendingRawBig);
    const isBalanced = varianceBig === BigInt(0);

    const screeningFeeSol = batch.items.length * MULTIHOPPER_RULES.SCREENING_FEE_SOL;
    const keeperFundingSol = batch.transfers.length * 0.005;
    const screeningFeeLamports = (BigInt(batch.items.length) * BigInt(50000)).toString(); // 0.00005 SOL
    const keeperFundingLamports = (BigInt(batch.transfers.length) * BigInt(5000000)).toString(); // 0.005 SOL
    const totalProtocolSolLamports = (BigInt(screeningFeeLamports) + BigInt(keeperFundingLamports)).toString();

    // Estimated 0.50% fee (50 bps)
    const estimatedPercentFeeRaw = ((requestedRawBig * BigInt(50)) / BigInt(10000)).toString();

    return {
      batchId: batch.id,
      network: batch.network,
      tokenSymbol: batch.tokenSymbol,
      tokenDecimals: decimals,
      requestedTotalRaw: requestedRawBig.toString(),
      requestedTotalFormatted: formatAmountFromRaw(requestedRawBig, decimals),
      settledTotalRaw: settledRawBig.toString(),
      settledTotalFormatted: formatAmountFromRaw(settledRawBig, decimals),
      failedTotalRaw: failedRawBig.toString(),
      failedTotalFormatted: formatAmountFromRaw(failedRawBig, decimals),
      pendingTotalRaw: pendingRawBig.toString(),
      pendingTotalFormatted: formatAmountFromRaw(pendingRawBig, decimals),
      varianceRaw: varianceBig.toString(),
      isBalanced,
      totalItemsCount: batch.items.length,
      settledItemsCount: settledCount,
      failedItemsCount: failedCount,
      pendingItemsCount: pendingCount,
      screeningCount: batch.items.length,
      screeningFeeSol,
      keeperFundingSol,
      screeningFeeLamports,
      keeperFundingLamports,
      totalProtocolSolLamports,
      estimatedPercentFeeRaw,
    };
  }
}

const globalForPayout = globalThis as unknown as { payoutStore?: PayoutRepository };
export const payoutStore = globalForPayout.payoutStore ?? new PayoutRepository();
globalForPayout.payoutStore = payoutStore;
