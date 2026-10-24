import { z } from "zod";
import { solanaAddressSchema } from "./auth";

export const payoutItemInputSchema = z.object({
  recipientWallet: solanaAddressSchema,
  recipientName: z.string().max(100).optional(),
  amountFormatted: z.string().regex(/^\d+(\.\d+)?$/, "Invalid numeric format"),
});

export const createPayoutBatchSchema = z.object({
  organizationId: z.string().uuid("Invalid organization ID").optional(),
  title: z.string().min(2, "Title must be at least 2 characters").max(100),
  tokenMint: solanaAddressSchema,
  tokenSymbol: z.string().min(1).max(10).default("USDC"),
  tokenDecimals: z.number().int().min(0).max(18).default(6),
  network: z.enum(["mainnet-beta", "devnet"]).default("devnet"),
  hops: z.number().int().min(3).max(10).default(4),
  arrivalSeconds: z.number().int().min(20).max(2592000).default(900),
  senderWallet: solanaAddressSchema.optional(),
  items: z.array(payoutItemInputSchema).min(1, "At least one payout recipient is required"),
});

export type PayoutItemInput = z.infer<typeof payoutItemInputSchema>;
export type CreatePayoutBatchInput = z.infer<typeof createPayoutBatchSchema>;
