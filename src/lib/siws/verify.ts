import nacl from "tweetnacl";
import bs58 from "bs58";
import { parseSIWSMessage } from "./message";

export interface VerifySIWSParams {
  message: string;
  signature: string; // base58 encoded signature (64 bytes)
  publicKey: string; // base58 encoded public key (32 bytes)
  expectedNonce?: string;
  expectedDomain?: string;
  now?: Date;
}

export interface VerifySIWSResult {
  valid: boolean;
  address?: string;
  reason?: string;
}

export function verifySIWSSignature(params: VerifySIWSParams): VerifySIWSResult {
  const { message, signature, publicKey, expectedNonce, expectedDomain, now = new Date() } = params;

  if (!message || !signature || !publicKey) {
    return { valid: false, reason: "Missing required verification parameters" };
  }

  // 1. Parse and validate SIWS message structure
  const parsed = parseSIWSMessage(message);
  if (!parsed) {
    return { valid: false, reason: "Malformed SIWS message format" };
  }

  // 2. Validate that message address matches the claiming public key
  if (parsed.address !== publicKey) {
    return { valid: false, reason: "Public key does not match address in message" };
  }

  // 3. Validate domain if specified
  if (expectedDomain && parsed.domain !== expectedDomain) {
    return { valid: false, reason: `Domain mismatch: expected ${expectedDomain}, got ${parsed.domain}` };
  }

  // 4. Validate nonce if specified
  if (expectedNonce && parsed.nonce !== expectedNonce) {
    return { valid: false, reason: "Invalid or mismatched nonce" };
  }

  // 5. Validate expiration timestamp if present
  if (parsed.expirationTime) {
    const expirationDate = new Date(parsed.expirationTime);
    if (isNaN(expirationDate.getTime()) || now.getTime() > expirationDate.getTime()) {
      return { valid: false, reason: "SIWS message has expired" };
    }
  }

  // 6. Validate issuedAt not in the far future (clock skew tolerance of 5 minutes)
  const issuedDate = new Date(parsed.issuedAt);
  if (!isNaN(issuedDate.getTime()) && issuedDate.getTime() > now.getTime() + 5 * 60 * 1000) {
    return { valid: false, reason: "SIWS message issued in the future" };
  }

  // 7. Cryptographic Ed25519 signature verification
  try {
    const publicKeyBytes = bs58.decode(publicKey);
    if (publicKeyBytes.length !== 32) {
      return { valid: false, reason: "Invalid public key length (must be 32 bytes)" };
    }

    const signatureBytes = bs58.decode(signature);
    if (signatureBytes.length !== 64) {
      return { valid: false, reason: "Invalid signature length (must be 64 bytes)" };
    }

    const messageBytes = new TextEncoder().encode(message);

    const verified = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!verified) {
      return { valid: false, reason: "Cryptographic signature verification failed" };
    }

    return { valid: true, address: publicKey };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return { valid: false, reason: `Failed to decode signature or public key: ${errMsg}` };
  }
}
