import { z } from "zod";

export const webhookEventTypeSchema = z.enum([
  "transfer.quote_created",
  "transfer.deposit_confirmed",
  "transfer.processing",
  "transfer.hop_complete",
  "transfer.completed",
  "transfer.failed",
  "transfer.expired",
  "transfer.refunded",
  "transfer.recoverable",
  "transfer.rescued",
]);

export const webhookDestinationStatusSchema = z.object({
  wallet: z.string(),
  amountRaw: z.string(),
  status: z.enum(["pending", "paid", "failed"]).default("pending"),
  payoutSignature: z.string().optional(),
});

export const multihopperWebhookPayloadSchema = z.object({
  eventId: z.string().min(1),
  eventType: webhookEventTypeSchema,
  timestamp: z.union([z.string(), z.number()]),
  data: z.object({
    id: z.string(),
    externalId: z.string().optional(),
    status: z.string(),
    network: z.enum(["mainnet-beta", "devnet"]).optional(),
    tokenMint: z.string().optional(),
    tokenSymbol: z.string().optional(),
    amountRaw: z.string().optional(),
    recipientReceivesRaw: z.string().optional(),
    percentFeeRaw: z.string().optional(),
    totalFlatFeeLamports: z.string().optional(),
    destinations: z.array(webhookDestinationStatusSchema).optional(),
    progress: z
      .object({
        hopsCompleted: z.number(),
        hopsTotal: z.number(),
      })
      .optional(),
  }),
});

export type MultiHopperWebhookPayload = z.infer<typeof multihopperWebhookPayloadSchema>;
