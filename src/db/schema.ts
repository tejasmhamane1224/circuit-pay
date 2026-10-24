import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// 1. Organizations
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("org_slug_idx").on(table.slug),
  ]
);

// 2. Organization Members
export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] })
      .notNull()
      .default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("member_org_idx").on(table.organizationId),
    index("member_wallet_idx").on(table.walletAddress),
    uniqueIndex("member_org_wallet_unique").on(table.organizationId, table.walletAddress),
  ]
);

// 3. Payout Batches
export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    tokenMint: text("token_mint").notNull(),
    tokenSymbol: text("token_symbol").notNull().default("USDC"),
    tokenDecimals: integer("token_decimals").notNull().default(6),
    totalAmountRaw: text("total_amount_raw").notNull(),
    totalAmountFormatted: text("total_amount_formatted").notNull(),
    status: text("status", {
      enum: [
        "draft",
        "quoting",
        "awaiting_signature",
        "pending_signature",
        "processing",
        "completed",
        "partially_failed",
        "failed",
        "refunded",
        "cancelled",
      ],
    })
      .notNull()
      .default("draft"),
    senderWallet: text("sender_wallet").notNull(),
    network: text("network", { enum: ["mainnet-beta", "devnet"] })
      .notNull()
      .default("devnet"),
    hops: integer("hops").notNull().default(4),
    arrivalSeconds: integer("arrival_seconds").notNull().default(900),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("batch_org_idx").on(table.organizationId),
    index("batch_status_idx").on(table.status),
    index("batch_sender_idx").on(table.senderWallet),
  ]
);

// 4. MultiHopper Transfers (Chunking table for 20-destination cap)
export const multihopperTransfers = pgTable(
  "multihopper_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    externalId: text("external_id").notNull().unique(),
    multihopperId: text("multihopper_id"),
    hops: integer("hops").notNull().default(4),
    arrivalSeconds: integer("arrival_seconds").notNull().default(900),
    status: text("status", {
      enum: [
        "created",
        "quote",
        "awaiting_signature",
        "processing",
        "active",
        "completed",
        "failed",
        "expired",
        "refunded",
        "recoverable",
      ],
    })
      .notNull()
      .default("created"),
    chunkAmountRaw: text("chunk_amount_raw").notNull(),
    recipientCount: integer("recipient_count").notNull(),
    keeperFundingTx: text("keeper_funding_tx"),
    keeperFundingSignature: text("keeper_funding_signature"),
    routeInitSignatures: jsonb("route_init_signatures").$type<string[]>(),
    finalSignatures: jsonb("final_signatures").$type<Record<string, unknown>>(),
    percentFeeRaw: text("percent_fee_raw"),
    flatFeeLamports: text("flat_fee_lamports"),
    integratorFeeShareRaw: text("integrator_fee_share_raw"),
    attempts: integer("attempts").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("transfer_batch_idx").on(table.batchId),
    uniqueIndex("transfer_ext_id_idx").on(table.externalId),
    index("transfer_mh_id_idx").on(table.multihopperId),
    index("transfer_status_idx").on(table.status),
  ]
);

// 5. Payout Items (Individual Recipient Shares)
export const payoutItems = pgTable(
  "payout_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => payoutBatches.id, { onDelete: "cascade" }),
    transferId: uuid("transfer_id").references(() => multihopperTransfers.id, {
      onDelete: "set null",
    }),
    recipientWallet: text("recipient_wallet").notNull(),
    recipientName: text("recipient_name"),
    amountRaw: text("amount_raw").notNull(),
    amountFormatted: text("amount_formatted").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "queued",
        "processing",
        "routing",
        "paid",
        "delivered",
        "failed",
        "refunded",
      ],
    })
      .notNull()
      .default("pending"),
    payoutSignature: text("payout_signature"),
    screeningStatus: text("screening_status", {
      enum: ["clean", "flagged", "exempt"],
    })
      .notNull()
      .default("clean"),
    paymentCount: integer("payment_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("item_batch_idx").on(table.batchId),
    index("item_transfer_idx").on(table.transferId),
    index("item_recipient_idx").on(table.recipientWallet),
  ]
);

// 6. Webhook Events (Idempotency and Audit Trail)
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    signature: text("signature").notNull(),
    processed: boolean("processed").notNull().default(false),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("webhook_event_id_idx").on(table.eventId),
    index("webhook_event_type_idx").on(table.eventType),
    index("webhook_processed_idx").on(table.processed),
  ]
);

// 7. Volume Ledger (Tracks Verified Mainnet Challenge Volume)
export const volumeLedger = pgTable(
  "volume_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id").references(() => payoutBatches.id, {
      onDelete: "cascade",
    }),
    feesCollected: numeric("fees_collected", { precision: 18, scale: 4 }).notNull(),
    qualifyingVolume: numeric("qualifying_volume", { precision: 18, scale: 4 }).notNull(),
    network: text("network", { enum: ["mainnet-beta", "devnet"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    inCompetitionWindow: boolean("in_competition_window").notNull().default(true),
    // MultiHopper transfer linkage & audit details
    transferId: uuid("transfer_id").references(() => multihopperTransfers.id, {
      onDelete: "set null",
    }),
    multihopperId: text("multihopper_id"),
    isMainnet: boolean("is_mainnet").notNull().default(false),
    tokenMint: text("token_mint"),
    tokenSymbol: text("token_symbol"),
    principalAmountRaw: text("principal_amount_raw"),
    principalAmountUsd: numeric("principal_amount_usd", { precision: 18, scale: 4 }),
    collectedFeeRaw: text("collected_fee_raw"),
    collectedFeeUsd: numeric("collected_fee_usd", { precision: 18, scale: 4 }),
    qualifyingVolumeUsd: numeric("qualifying_volume_usd", { precision: 18, scale: 4 }),
    integratorFeeShareUsd: numeric("integrator_fee_share_usd", { precision: 18, scale: 4 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (table) => [
    index("volume_ledger_batch_idx").on(table.batchId),
    index("volume_ledger_network_idx").on(table.network),
    index("volume_ledger_created_at_idx").on(table.createdAt),
    index("ledger_mh_id_idx").on(table.multihopperId),
    index("ledger_is_mainnet_idx").on(table.isMainnet),
  ]
);

// 8. Audit Log
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorWallet: text("actor_wallet").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_org_idx").on(table.organizationId),
    index("audit_actor_idx").on(table.actorWallet),
    index("audit_action_idx").on(table.action),
  ]
);

// Drizzle Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(members),
  batches: many(payoutBatches),
  auditLogs: many(auditLog),
}));

export const membersRelations = relations(members, ({ one }) => ({
  organization: one(organizations, {
    fields: [members.organizationId],
    references: [organizations.id],
  }),
}));

export const payoutBatchesRelations = relations(payoutBatches, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [payoutBatches.organizationId],
    references: [organizations.id],
  }),
  transfers: many(multihopperTransfers),
  items: many(payoutItems),
}));

export const multihopperTransfersRelations = relations(multihopperTransfers, ({ one, many }) => ({
  batch: one(payoutBatches, {
    fields: [multihopperTransfers.batchId],
    references: [payoutBatches.id],
  }),
  items: many(payoutItems),
  ledgerEntries: many(volumeLedger),
}));

export const payoutItemsRelations = relations(payoutItems, ({ one }) => ({
  batch: one(payoutBatches, {
    fields: [payoutItems.batchId],
    references: [payoutBatches.id],
  }),
  transfer: one(multihopperTransfers, {
    fields: [payoutItems.transferId],
    references: [multihopperTransfers.id],
  }),
}));

// 9. Recurring Schedules
export const recurringSchedules = pgTable(
  "recurring_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    frequency: text("frequency", { enum: ["weekly", "bi-weekly", "monthly"] }).notNull(),
    cronExpression: text("cron_expression").notNull(),
    tokenMint: text("token_mint").notNull(),
    tokenSymbol: text("token_symbol").notNull().default("USDC"),
    tokenDecimals: integer("token_decimals").notNull().default(6),
    senderWallet: text("sender_wallet").notNull(),
    network: text("network", { enum: ["mainnet-beta", "devnet"] }).notNull().default("devnet"),
    items: jsonb("items").notNull().$type<Array<{ recipientWallet: string; amountFormatted: string; recipientName?: string }>>(),
    status: text("status", { enum: ["active", "paused", "cancelled"] }).notNull().default("active"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    totalRuns: integer("total_runs").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("schedule_org_idx").on(table.organizationId),
    index("schedule_status_idx").on(table.status),
    index("schedule_next_run_idx").on(table.nextRunAt),
  ]
);

// 10. Customer Webhooks
export const customerWebhooks = pgTable(
  "customer_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").notNull().$type<string[]>(),
    active: boolean("active").notNull().default(true),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("customer_webhook_org_idx").on(table.organizationId),
    index("customer_webhook_active_idx").on(table.active),
  ]
);

// Entity TypeScript Types
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;

export type PayoutBatch = typeof payoutBatches.$inferSelect;
export type NewPayoutBatch = typeof payoutBatches.$inferInsert;

export type MultihopperTransfer = typeof multihopperTransfers.$inferSelect;
export type NewMultihopperTransfer = typeof multihopperTransfers.$inferInsert;

export type PayoutItem = typeof payoutItems.$inferSelect;
export type NewPayoutItem = typeof payoutItems.$inferInsert;

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

export type VolumeLedgerRow = typeof volumeLedger.$inferSelect;
export type NewVolumeLedgerRow = typeof volumeLedger.$inferInsert;

export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;

export type RecurringScheduleRow = typeof recurringSchedules.$inferSelect;
export type NewRecurringScheduleRow = typeof recurringSchedules.$inferInsert;

export type CustomerWebhookRow = typeof customerWebhooks.$inferSelect;
export type NewCustomerWebhookRow = typeof customerWebhooks.$inferInsert;


