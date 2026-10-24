import { describe, it, expect, beforeEach } from "vitest";
import { MultiHopperClient } from "../src/lib/multihopper/client";
import { MultiHopperMockServer } from "../src/lib/multihopper/mock-server";
import { MultiHopperError } from "../src/lib/multihopper/errors";
import { MultiHopperSignerOrchestrator } from "../src/lib/multihopper/signer";
import { Connection } from "@solana/web3.js";

describe("Phase 2: MultiHopper Client & Protocol Integration", () => {
  let mockServer: MultiHopperMockServer;
  let client: MultiHopperClient;

  beforeEach(() => {
    mockServer = new MultiHopperMockServer();
    client = new MultiHopperClient({
      apiKey: "mh_test_valid_api_key_123",
      baseUrl: "https://mock.multihopper.com/api/v1",
      fetchFn: (url, init) => mockServer.handleFetch(url as string, init),
      maxRetries: 2,
      initialRetryDelayMs: 10, // fast in tests
    });
  });

  describe("1. Authentication & Idempotency", () => {
    it("rejects calls with missing API key (MH_001) and sets retryable flag correctly", async () => {
      const unauthorizedClient = new MultiHopperClient({
        apiKey: "",
        baseUrl: "https://mock.multihopper.com/api/v1",
        fetchFn: (url, init) => mockServer.handleFetch(url as string, init),
      });

      try {
        await unauthorizedClient.estimate({
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "1000000000",
          tokenDecimals: 6,
          hops: 4,
          destinationCount: 1,
        });
        expect.fail("Should have thrown MultiHopperError");
      } catch (err) {
        expect(err).toBeInstanceOf(MultiHopperError);
        const mhErr = err as MultiHopperError;
        expect(mhErr.code).toBe("MH_001");
        expect(mhErr.status).toBe(401);
        expect(mhErr.retryable).toBe(false);
      }
    });

    it("attaches registered integration identifier 'circuitpay_treasury_v1' on all request headers", async () => {
      let interceptedHeaders: Record<string, string> = {};
      const capturingClient = new MultiHopperClient({
        apiKey: "mh_test_valid_api_key_123",
        baseUrl: "https://mock.multihopper.com/api/v1",
        fetchFn: async (url, init) => {
          interceptedHeaders = (init?.headers as Record<string, string>) || {};
          return mockServer.handleFetch(url as string, init);
        },
      });

      await capturingClient.estimate({
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "1000000000",
        tokenDecimals: 6,
        hops: 4,
        destinationCount: 1,
      });

      expect(interceptedHeaders["x-integration-id"]).toBe("circuitpay_treasury_v1");
    });

    it("attaches unique Idempotency-Key on mutations and returns cached response for identical payload", async () => {
      const input = {
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "1000000000",
        tokenDecimals: 6,
        hops: 4,
        destinationCount: 5,
      };

      const customKey = "idemp_test_key_abc_123";
      const res1 = await client.estimate(input, customKey);
      const res2 = await client.estimate(input, customKey);

      expect(res1.percentFeeRaw).toBe(res2.percentFeeRaw);
      expect(res1.tier).toBe("tier_3");
    });

    it("rejects reused Idempotency-Key with mismatched payload (MH_071)", async () => {
      const customKey = "idemp_test_conflict_999";
      await client.estimate(
        {
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "1000000000",
          hops: 4,
        },
        customKey
      );

      await expect(
        client.estimate(
          {
            tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            amountRaw: "5000000000", // Changed amount!
            hops: 4,
          },
          customKey
        )
      ).rejects.toThrow("MH_071");
    });
  });

  describe("2. Estimation & Fee Calculations", () => {
    it("calculates exact 0.50% commercial fee and 50% integrator revenue share", async () => {
      const res = await client.estimate({
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "10000000000", // 10,000 USDC
        tokenDecimals: 6,
        hops: 4,
        destinationCount: 10,
      });

      expect(res.percentFeeBps).toBe(50);
      expect(res.percentFeeRaw).toBe("50000000"); // 50 USDC (0.50%)
      expect(res.hopAmountRaw).toBe("9950000000"); // 9,950 USDC delivered
      expect(res.integratorPercentShare).toBe("25000000"); // 25 USDC (50% of fee)
      // 10 recipients * 0.002 SOL = 0.02 SOL screening fee
      expect(res.sol.breakdown.screeningFeeLamports).toBe("20000000");
    });

    it("validates hop count range between 3 and 10 (MH_013)", async () => {
      await expect(
        client.estimate({
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "1000000000",
          hops: 2, // invalid: too few
        })
      ).rejects.toThrow("MH_013");

      await expect(
        client.estimate({
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "1000000000",
          hops: 12, // invalid: too many
        })
      ).rejects.toThrow("MH_013");
    });
  });

  describe("3. Multi-Destination Transfer Lifecycle (1 to 20 recipients)", () => {
    it("creates multi-destination transfer and prepares transaction bundle", async () => {
      const destinations = [
        { wallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4", amountRaw: "3000000000" },
        { wallet: "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u", amountRaw: "2000000000" },
      ];

      const createRes = await client.createTransfer({
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "5000000000",
        amountTokens: "5000.00",
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        sourceOwner: "DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj",
        hops: 4,
        arrivalSeconds: 900,
        externalId: "payroll_batch_01_chunk_0",
        destinations,
      });

      expect(createRes.id).toMatch(/^mh_mock_/);
      expect(createRes.status).toBe("quote");
      expect(createRes.destinations).toHaveLength(2);

      // Prepare transactions
      const prepRes = await client.prepareTransfer(createRes.id);
      expect(prepRes.transfer.status).toBe("awaiting_signature");
      expect(prepRes.preparedTxs.keeperFundingTx).toBeDefined();
      expect(prepRes.preparedTxs.routeInitTxs.length).toBeGreaterThan(0);
      expect(prepRes.preparedTxs.orchestratorInitTx).toBeDefined();
      expect(prepRes.preparedTxs.dispersionInitTxs?.length).toBeGreaterThan(0);
    });

    it("rejects destination lists exceeding 20 recipients (MH_017)", async () => {
      const excessiveDestinations = Array.from({ length: 25 }, (_, i) => ({
        wallet: `5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q500${i.toString().padStart(2, "0")}`,
        amountRaw: "100000000",
      }));

      await expect(
        client.createTransfer({
          tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: "2500000000",
          amountTokens: "2500.00",
          tokenDecimals: 6,
          tokenSymbol: "USDC",
          sourceOwner: "DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj",
          hops: 4,
          externalId: "payroll_batch_err_test",
          destinations: excessiveDestinations,
        })
      ).rejects.toThrow("MH_017");
    });
  });

  describe("4. Confirm Broadcast Lifecycle & Intermediate Keeper Call", () => {
    it("enforces intermediate keeper call before other signatures (MH_039)", async () => {
      const createRes = await client.createTransfer({
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "1000000000",
        amountTokens: "1000.00",
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        sourceOwner: "DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj",
        hops: 4,
        externalId: "payroll_batch_keeper_test",
        recipientWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      });

      await client.prepareTransfer(createRes.id);

      // Attempting to confirm route init without keeperFundingSignature should fail with MH_039
      await expect(
        client.confirmBroadcast(createRes.id, {
          routeInitSignatures: ["sig_route_1"],
          // keeperFundingSignature missing!
        })
      ).rejects.toThrow("MH_039");

      // Correct protocol flow: Call 1 with keeper funding signature
      const intermediateRes = await client.confirmBroadcast(createRes.id, {
        routeInitSignatures: [],
        keeperFundingSignature: "sig_keeper_valid_123",
      });
      expect(intermediateRes.status).toBe("received");

      // Call 2: Final broadcast confirm with all remaining signatures
      const finalRes = await client.confirmBroadcast(createRes.id, {
        routeInitSignatures: ["sig_route_1", "sig_route_2"],
        orchestratorInitSignature: "sig_orchestrator_1",
        sessionInitSignatures: ["sig_session_1"],
        keeperFundingSignature: "sig_keeper_valid_123",
      });
      expect(finalRes.status).toBe("received");

      // Verify transfer status advanced to processing
      const record = mockServer.getTransferRecord(createRes.id);
      expect(record?.status).toBe("processing");
      expect(record?.phase).toBe("executing");
    });
  });

  describe("5. Deserialization & Transaction Orchestrator", () => {
    it("correctly deserializes VersionedTransactions and Legacy Transactions", async () => {
      const createRes = await client.createTransfer({
        tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        amountRaw: "1000000000",
        amountTokens: "1000.00",
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        sourceOwner: "DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj",
        hops: 4,
        externalId: "payroll_batch_deserialize_test",
        destinations: [
          { wallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4", amountRaw: "1000000000" },
        ],
      });

      const prepRes = await client.prepareTransfer(createRes.id);
      const orchestrator = new MultiHopperSignerOrchestrator(
        client,
        new Connection("https://api.devnet.solana.com")
      );

      const deserialized = orchestrator.deserializePreparedTxs(prepRes.preparedTxs);

      expect(deserialized.keeperTx?.version).toBe(0);
      expect(deserialized.routeTxs[0].version).toBe(0);
      expect(deserialized.orchestratorTx).toBeDefined(); // Legacy transaction
      expect(deserialized.dispersionTxs[0].version).toBe(0);
    });
  });

  describe("6. Integrator Usage & Revenue Metrics", () => {
    it("fetches integrator usage and volume share", async () => {
      const usage = await client.getUsage();
      expect(usage.integratorAddress).toBe("7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u");
      expect(usage.collectedVolumeUsd).toBe("150000.00");
      expect(usage.integratorRevenueShareUsd).toBe("375.00");
      expect(usage.transfersCount).toBe(14);
    });
  });
});
