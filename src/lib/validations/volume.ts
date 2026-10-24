import { z } from "zod";
import { solanaAddressSchema } from "./auth";

export const volumeCalculationInputSchema = z.object({
  collectedFeeUsd: z.number().min(0, "Collected fee must be non-negative"),
  network: z.enum(["mainnet-beta", "devnet"]),
});

export const volumeLedgerEntrySchema = z.object({
  transferId: z.string().uuid().optional(),
  multihopperId: z.string().min(1),
  network: z.enum(["mainnet-beta", "devnet"]),
  isMainnet: z.boolean(),
  tokenMint: solanaAddressSchema,
  tokenSymbol: z.string().default("USDC"),
  principalAmountRaw: z.string().regex(/^\d+$/),
  principalAmountUsd: z.number().positive(),
  collectedFeeRaw: z.string().regex(/^\d+$/),
  collectedFeeUsd: z.number().min(0),
  qualifyingVolumeUsd: z.number().min(0),
  integratorFeeShareUsd: z.number().min(0),
  verifiedAt: z.date().default(() => new Date()),
});

export type VolumeCalculationInput = z.infer<typeof volumeCalculationInputSchema>;
export type VolumeLedgerEntry = z.infer<typeof volumeLedgerEntrySchema>;
