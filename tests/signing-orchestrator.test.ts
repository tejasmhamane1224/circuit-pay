import { describe, it, expect, beforeEach, vi } from "vitest";
import { MultiHopperClient } from "../src/lib/multihopper/client";
import { MultiHopperMockServer } from "../src/lib/multihopper/mock-server";
import {
  MultiHopperSignerOrchestrator,
  type WalletSignerInterface,
} from "../src/lib/multihopper/signer";
import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

describe("MultiHopper Signer Orchestrator Flow", () => {
  let mockServer: MultiHopperMockServer;
  let client: MultiHopperClient;
  let mockConnection: Connection;
  let mockWallet: WalletSignerInterface;
  const userKeypair = Keypair.generate();

  beforeEach(() => {
    mockServer = new MultiHopperMockServer();
    client = new MultiHopperClient({
      apiKey: "mh_test_valid_api_key_123",
      baseUrl: "https://mock.multihopper.com/api/v1",
      fetchFn: (url, init) => mockServer.handleFetch(url as string, init),
      maxRetries: 2,
      initialRetryDelayMs: 10,
    });

    // Mock Connection to simulate Solana RPC responses
    mockConnection = {
      sendRawTransaction: vi.fn().mockImplementation(async () => {
        return `5wSigMock${Math.random().toString(36).substring(2, 10)}`;
      }),
      getSignatureStatus: vi.fn().mockImplementation(async () => {
        return { value: { confirmationStatus: "confirmed" } };
      }),
    } as unknown as Connection;

    // Mock Wallet signer interface representing wallet adapter behavior
    mockWallet = {
      publicKey: userKeypair.publicKey,
      signTransaction: vi.fn().mockImplementation(async (tx) => {
        if (tx instanceof VersionedTransaction) {
          // Solana wallet adapters attach signatures to the versioned transaction
          if (tx.signatures && tx.signatures.length > 0) {
            tx.signatures[0] = new Uint8Array(64).fill(7);
          }
          return tx;
        } else if (tx instanceof Transaction) {
          return tx;
        }
        return tx;
      }),
    };
  });

  it("executes the full multi-step signing sequence with intermediate keeper confirmation", async () => {
    // 1. Create a transfer with 2 destinations
    const createRes = await client.createTransfer({
      tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amountRaw: "2000000000",
      amountTokens: "2000.00",
      tokenDecimals: 6,
      tokenSymbol: "USDC",
      sourceOwner: userKeypair.publicKey.toBase58(),
      hops: 4,
      externalId: "test_signer_batch_chunk_0",
      destinations: [
        { wallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4", amountRaw: "1200000000" },
        { wallet: "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u", amountRaw: "800000000" },
      ],
    });

    const progressSteps: string[] = [];
    const orchestrator = new MultiHopperSignerOrchestrator(client, mockConnection);

    // Fast-forward delay in testing by stubbing setTimeout or using vi.useFakeTimers
    vi.useFakeTimers({ toFake: ["setTimeout"] });

    const promise = orchestrator.signAndBroadcast(
      createRes.id,
      mockWallet,
      (step) => progressSteps.push(step)
    );

    // Advance all timers through delays
    await vi.runAllTimersAsync();
    const result = await promise;
    vi.useRealTimers();

    expect(result.status).toBe("processing");
    expect(result.keeperFundingSignature).toBeDefined();
    expect(result.routeInitSignatures.length).toBeGreaterThan(0);
    expect(result.orchestratorInitSignature).toBeDefined();
    expect(result.sessionInitSignatures.length).toBeGreaterThan(0);
    expect(result.dispersionInitSignatures.length).toBeGreaterThan(0);

    // Verify progress callbacks fired in sequence
    expect(progressSteps.some((s) => s.includes("Keeper Funding"))).toBe(true);
    expect(progressSteps.some((s) => s.includes("Route Init"))).toBe(true);
    expect(progressSteps.some((s) => s.includes("Orchestrator"))).toBe(true);
    expect(progressSteps.some((s) => s.includes("Dispersion"))).toBe(true);
    expect(progressSteps.some((s) => s.includes("Final Signatures"))).toBe(true);

    // Verify mock server state advanced to processing
    const record = mockServer.getTransferRecord(createRes.id);
    expect(record?.status).toBe("processing");
    expect(record?.phase).toBe("executing");
    expect(record?.keeperFundingSignature).toBe(result.keeperFundingSignature);
  });
});
