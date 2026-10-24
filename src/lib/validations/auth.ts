import { z } from "zod";
import bs58 from "bs58";

export const solanaAddressSchema = z
  .string()
  .min(32, "Solana address too short")
  .max(44, "Solana address too long")
  .refine((val) => {
    try {
      const decoded = bs58.decode(val);
      return decoded.length === 32;
    } catch {
      return false;
    }
  }, "Invalid Solana Base58 public key");

export const base58SignatureSchema = z
  .string()
  .refine((val) => {
    try {
      const decoded = bs58.decode(val);
      return decoded.length === 64;
    } catch {
      return false;
    }
  }, "Invalid 64-byte Solana signature");

export const nonceRequestSchema = z.object({
  address: solanaAddressSchema.optional(),
});

export const verifySiwsRequestSchema = z.object({
  message: z.string().min(10, "Message cannot be empty"),
  signature: base58SignatureSchema,
  publicKey: solanaAddressSchema,
  nonce: z.string().min(8, "Nonce must be at least 8 characters").optional(),
});

export type VerifySiwsRequest = z.infer<typeof verifySiwsRequestSchema>;
