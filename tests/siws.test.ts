import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createSIWSMessage, parseSIWSMessage, generateNonce } from "@/lib/siws/message";
import { verifySIWSSignature } from "@/lib/siws/verify";
import { createSessionToken, verifySessionToken } from "@/lib/siws/session";

describe("SIWS Message & Nonce Utilities", () => {
  it("generates a 32-character hexadecimal random nonce", () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).toHaveLength(32);
    expect(nonce2).toHaveLength(32);
    expect(nonce1).not.toBe(nonce2);
  });

  it("formats and parses standard SIWS message correctly", () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const nonce = generateNonce();
    const issuedAt = new Date().toISOString();
    const expirationTime = new Date(Date.now() + 600000).toISOString();

    const formatted = createSIWSMessage({
      domain: "circuitpay.app",
      address,
      statement: "Sign in with Solana to authenticate with CircuitPay.",
      uri: "https://circuitpay.app",
      chainId: "solana:mainnet-beta",
      nonce,
      issuedAt,
      expirationTime,
    });

    const parsed = parseSIWSMessage(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed?.domain).toBe("circuitpay.app");
    expect(parsed?.address).toBe(address);
    expect(parsed?.statement).toBe("Sign in with Solana to authenticate with CircuitPay.");
    expect(parsed?.uri).toBe("https://circuitpay.app");
    expect(parsed?.chainId).toBe("solana:mainnet-beta");
    expect(parsed?.nonce).toBe(nonce);
    expect(parsed?.issuedAt).toBe(issuedAt);
    expect(parsed?.expirationTime).toBe(expirationTime);
  });

  it("returns null when parsing malformed message", () => {
    expect(parseSIWSMessage("invalid text")).toBeNull();
    expect(parseSIWSMessage("wants you to sign in\n123")).toBeNull();
  });
});

describe("SIWS Cryptographic Signature Verification", () => {
  it("verifies genuine Ed25519 signature successfully", () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const nonce = generateNonce();
    const issuedAt = new Date().toISOString();

    const message = createSIWSMessage({
      domain: "circuitpay.app",
      address,
      uri: "https://circuitpay.app",
      chainId: "solana:devnet",
      nonce,
      issuedAt,
    });

    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = nacl.sign.detached(messageBytes, keypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    const result = verifySIWSSignature({
      message,
      signature: signatureBase58,
      publicKey: address,
      expectedNonce: nonce,
      expectedDomain: "circuitpay.app",
    });

    expect(result.valid).toBe(true);
    expect(result.address).toBe(address);
  });

  it("rejects when message has been tampered with", () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const nonce = generateNonce();
    const issuedAt = new Date().toISOString();

    const originalMessage = createSIWSMessage({
      domain: "circuitpay.app",
      address,
      uri: "https://circuitpay.app",
      chainId: "solana:devnet",
      nonce,
      issuedAt,
    });

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(originalMessage), keypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    // Tampered message
    const tamperedMessage = originalMessage.replace("solana:devnet", "solana:mainnet-beta");

    const result = verifySIWSSignature({
      message: tamperedMessage,
      signature: signatureBase58,
      publicKey: address,
      expectedNonce: nonce,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Cryptographic signature verification failed");
  });

  it("rejects when signature does not match public key", () => {
    const keypair1 = nacl.sign.keyPair();
    const keypair2 = nacl.sign.keyPair();

    const address1 = bs58.encode(keypair1.publicKey);
    const nonce = generateNonce();
    const issuedAt = new Date().toISOString();

    const message = createSIWSMessage({
      domain: "circuitpay.app",
      address: address1,
      uri: "https://circuitpay.app",
      chainId: "solana:devnet",
      nonce,
      issuedAt,
    });

    // Signed by keypair2 instead of keypair1
    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair2.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    const result = verifySIWSSignature({
      message,
      signature: signatureBase58,
      publicKey: address1,
    });

    expect(result.valid).toBe(false);
  });

  it("rejects expired SIWS messages", () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const nonce = generateNonce();
    const issuedAt = new Date(Date.now() - 3600000).toISOString();
    const expirationTime = new Date(Date.now() - 1800000).toISOString(); // Expired 30 mins ago

    const message = createSIWSMessage({
      domain: "circuitpay.app",
      address,
      uri: "https://circuitpay.app",
      chainId: "solana:devnet",
      nonce,
      issuedAt,
      expirationTime,
    });

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    const result = verifySIWSSignature({
      message,
      signature: signatureBase58,
      publicKey: address,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("SIWS message has expired");
  });

  it("rejects mismatched nonce", () => {
    const keypair = nacl.sign.keyPair();
    const address = bs58.encode(keypair.publicKey);
    const nonce = generateNonce();

    const message = createSIWSMessage({
      domain: "circuitpay.app",
      address,
      uri: "https://circuitpay.app",
      chainId: "solana:devnet",
      nonce,
      issuedAt: new Date().toISOString(),
    });

    const signatureBytes = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
    const signatureBase58 = bs58.encode(signatureBytes);

    const result = verifySIWSSignature({
      message,
      signature: signatureBase58,
      publicKey: address,
      expectedNonce: "different-nonce-123",
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Invalid or mismatched nonce");
  });
});

describe("HMAC Session Token Creation & Verification", () => {
  it("creates and verifies valid session tokens", () => {
    const address = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
    const token = createSessionToken(address, { role: "owner" });

    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.address).toBe(address);
    expect(payload?.role).toBe("owner");
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tampered session tokens", () => {
    const address = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
    const token = createSessionToken(address);
    const tamperedToken = token + "xyz";

    expect(verifySessionToken(tamperedToken)).toBeNull();
  });
});
