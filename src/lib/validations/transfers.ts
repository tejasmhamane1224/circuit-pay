import { z } from "zod";
import { solanaAddressSchema } from "./auth";

export const destinationItemSchema = z.object({
  wallet: solanaAddressSchema,
  amountRaw: z.string().regex(/^\d+$/, "Amount must be a positive integer in base units"),
});

export const estimateTransferSchema = z.object({
  tokenMint: solanaAddressSchema.default("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  tokenSymbol: z.string().optional(),
  tokenDecimals: z.number().int().min(0).max(18).default(6),
  amountRaw: z.string().regex(/^\d+$/, "Amount must be an integer").optional(),
  hops: z.number().int().min(3).max(10).default(4),
  destinationCount: z.number().int().min(1).max(500).default(1),
  arrivalSeconds: z.number().int().min(20).max(2592000).default(900),
  destinations: z.array(destinationItemSchema).optional(),
});

export const createTransferSchema = z
  .object({
    inputMint: solanaAddressSchema.optional(),
    tokenMint: solanaAddressSchema.optional(),
    sourceWallet: solanaAddressSchema.optional(),
    sourceOwner: solanaAddressSchema.optional(),
    amountRaw: z.string().regex(/^\d+$/, "Amount must be an integer").optional(),
    amountTokens: z.string().optional(),
    tokenDecimals: z.number().int().min(0).max(18).default(6),
    tokenSymbol: z.string().min(1).max(10).default("USDC"),
    hops: z.number().int().min(3).max(10).default(4),
    arrivalSeconds: z.number().int().min(20).max(2592000).default(900),
    externalId: z.string().min(3).max(64).optional(),
    recipientWallet: solanaAddressSchema.optional(),
    destinations: z.array(destinationItemSchema).min(1).max(20).optional(),
    isConfidential: z.boolean().optional(),
    jitter: z.number().optional(),
  })
  .refine(
    (data) => !!(data.inputMint || data.tokenMint),
    {
      message: "Provide either inputMint or tokenMint",
      path: ["inputMint"],
    }
  )
  .refine(
    (data) => !!(data.sourceWallet || data.sourceOwner),
    {
      message: "Provide either sourceWallet or sourceOwner",
      path: ["sourceWallet"],
    }
  )
  .refine(
    (data) => {
      // Must have either recipientWallet OR destinations, but not both or neither
      const hasRecipient = !!data.recipientWallet;
      const hasDestinations = !!data.destinations && data.destinations.length > 0;
      return (hasRecipient && !hasDestinations) || (!hasRecipient && hasDestinations);
    },
    {
      message: "Provide exactly one of recipientWallet or destinations (1-20 destinations max)",
      path: ["destinations"],
    }
  )
  .refine(
    (data) => {
      // If amountRaw is provided and destinations provided, sum must match
      if (!data.destinations || !data.amountRaw) return true;
      const totalDestinationsRaw = data.destinations.reduce(
        (acc, curr) => acc + BigInt(curr.amountRaw),
        BigInt(0)
      );
      return totalDestinationsRaw === BigInt(data.amountRaw);
    },
    {
      message: "Sum of destination amounts must equal total transfer amountRaw",
      path: ["destinations"],
    }
  );

export const confirmBroadcastSchema = z.object({
  keeperFundingSignature: z.string().optional(),
  routeInitSignatures: z.array(z.string()).default([]),
  orchestratorInitSignature: z.string().optional(),
  sessionInitSignatures: z.array(z.string()).optional(),
  dispersionInitSignatures: z.array(z.string()).optional(),
});

export type EstimateTransferInput = z.input<typeof estimateTransferSchema>;
export type CreateTransferInput = z.input<typeof createTransferSchema>;
export type ConfirmBroadcastInput = z.input<typeof confirmBroadcastSchema>;
export type DestinationItem = z.input<typeof destinationItemSchema>;
