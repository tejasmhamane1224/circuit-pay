import { describe, it, expect, beforeEach } from "vitest";
import { GET as getBatches, POST as createBatch } from "../src/app/api/batches/route";
import { GET as getBatchById } from "../src/app/api/batches/[id]/route";
import { POST as prepareBatch } from "../src/app/api/batches/[id]/prepare/route";
import { POST as broadcastBatch } from "../src/app/api/batches/[id]/broadcast/route";
import { GET as getTransferById } from "../src/app/api/transfers/[id]/route";
import { POST as estimateTransfer } from "../src/app/api/transfers/estimate/route";
import { payoutStore } from "../src/lib/db/payout-store";
import { NextRequest } from "next/server";

describe("Batch Creation & Multi-Send API Endpoints", () => {
  const dummyWallet1 = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
  const dummyWallet2 = "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u";
  const tokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  beforeEach(() => {
    payoutStore.resetStore();
  });

  it("POST /api/batches rejects invalid payloads with 400", async () => {
    const req = new NextRequest("http://localhost:3000/api/batches", {
      method: "POST",
      body: JSON.stringify({
        title: "X", // too short
        tokenMint: "bad_address",
        items: [],
      }),
    });

    const res = await createBatch(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("POST /api/batches partitions 25 recipients across 2 transfers with <=20 destinations each", async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      recipientWallet: i % 2 === 0 ? dummyWallet1 : dummyWallet2,
      amountFormatted: (50 + i * 5).toFixed(2),
      recipientName: `Contributor ${i + 1}`,
    }));

    const req = new NextRequest("http://localhost:3000/api/batches", {
      method: "POST",
      body: JSON.stringify({
        title: "October Core Contributors",
        tokenMint,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        network: "devnet",
        hops: 4,
        arrivalSeconds: 900,
        senderWallet: dummyWallet1,
        items,
      }),
    });

    const res = await createBatch(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);

    const batch = json.batch;
    expect(batch.title).toBe("October Core Contributors");
    expect(batch.recipientCount).toBe(25);
    expect(batch.chunksCount).toBe(2);
    expect(batch.status).toBe("draft");

    // Chunk 0 has 20 recipients (20-destination cap)
    expect(batch.chunks[0].recipientCount).toBe(20);
    expect(batch.chunks[0].chunkIndex).toBe(0);

    // Chunk 1 has remaining 5 recipients
    expect(batch.chunks[1].recipientCount).toBe(5);
    expect(batch.chunks[1].chunkIndex).toBe(1);

    // Verify GET /api/batches/[id]
    const getReq = new NextRequest(`http://localhost:3000/api/batches/${batch.id}`);
    const getRes = await getBatchById(getReq, { params: Promise.resolve({ id: batch.id }) });
    expect(getRes.status).toBe(200);
    const getJson = await getRes.json();
    expect(getJson.batch.id).toBe(batch.id);
    expect(getJson.batch.items).toHaveLength(25);

    // Verify GET /api/transfers/[id]
    const chunk0Id = batch.chunks[0].id;
    const transferReq = new NextRequest(`http://localhost:3000/api/transfers/${chunk0Id}`);
    const transferRes = await getTransferById(transferReq, { params: Promise.resolve({ id: chunk0Id }) });
    expect(transferRes.status).toBe(200);
    const transferJson = await transferRes.json();
    expect(transferJson.transfer.id).toBe(chunk0Id);
    expect(transferJson.transfer.recipientCount).toBe(20);
  });

  it("POST /api/batches/[id]/prepare prepares transfers and updates state to awaiting_signature", async () => {
    const items = [
      { recipientWallet: dummyWallet1, amountFormatted: "250.00" },
      { recipientWallet: dummyWallet2, amountFormatted: "350.00" },
    ];

    const batch = await payoutStore.createPayoutBatch({
      title: "Preparation Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items,
    });

    const prepReq = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/prepare`, {
      method: "POST",
    });

    const prepRes = await prepareBatch(prepReq, { params: Promise.resolve({ id: batch.id }) });
    expect(prepRes.status).toBe(200);
    const prepJson = await prepRes.json();
    expect(prepJson.success).toBe(true);
    expect(prepJson.status).toBe("awaiting_signature");
    expect(prepJson.preparedChunks).toHaveLength(1);
    expect(prepJson.preparedChunks[0].preparedTxs).toBeDefined();

    const updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("awaiting_signature");
  });

  it("GET /api/batches returns all batches", async () => {
    await payoutStore.createPayoutBatch({
      title: "Batch 1",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "100.00" }],
    });

    const req = new NextRequest("http://localhost:3000/api/batches");
    const res = await getBatches(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBe(1);
  });

  it("POST /api/transfers/estimate returns live 50 bps commercial fee, 50% integrator share, and screening SOL", async () => {
    const req = new NextRequest("http://localhost:3000/api/transfers/estimate", {
      method: "POST",
      body: JSON.stringify({
        amountRaw: "1000000000", // 1000 USDC
        hops: 4,
        destinationCount: 25, // 2 chunks (20 cap)
        arrivalSeconds: 900,
      }),
    });

    const res = await estimateTransfer(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.percentFeeBps).toBe(50);
    expect(json.percentFeeRaw).toBe("5000000"); // 5 USDC (0.50% of 1000 USDC)
    expect(json.integratorPercentShare).toBe("2500000"); // 50% integrator split = 2.5 USDC

    // Screening fee for 25 destinations = 25 * 0.002 SOL = 0.05 SOL = 50,000,000 lamports
    expect(json.sol.breakdown.screeningFeeLamports).toBe("50000000");
    // Keeper funding for 2 chunks = 2 * 5,000,000 = 10,000,000 lamports
    expect(json.sol.breakdown.keeperFundingLamports).toBe("10000000");
    // Total required SOL = 60,000,000 lamports
    expect(json.sol.requiredSolUpFrontLamports).toBe("60000000");
  });

  it("POST /api/batches/[id]/broadcast executes MultiHopperSignerOrchestrator and transitions batch to processing", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Broadcast Orchestrator Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [
        { recipientWallet: dummyWallet1, amountFormatted: "200.00" },
        { recipientWallet: dummyWallet2, amountFormatted: "300.00" },
      ],
    });

    // 1. Prepare batch
    const prepReq = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/prepare`, {
      method: "POST",
    });
    await prepareBatch(prepReq, { params: Promise.resolve({ id: batch.id }) });

    // 2. Broadcast batch via MultiHopperSignerOrchestrator
    const broadcastReq = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/broadcast`, {
      method: "POST",
    });
    const broadcastRes = await broadcastBatch(broadcastReq, { params: Promise.resolve({ id: batch.id }) });
    expect(broadcastRes.status).toBe(200);
    const broadcastJson = await broadcastRes.json();
    expect(broadcastJson.success).toBe(true);
    expect(broadcastJson.status).toBe("processing");
    expect(broadcastJson.chunks).toHaveLength(1);
    expect(broadcastJson.chunks[0].keeperFundingSignature).toBeDefined();

    // 3. Verify batch in store updated to processing
    const updatedBatch = await payoutStore.getPayoutBatch(batch.id);
    expect(updatedBatch?.status).toBe("processing");
    expect(updatedBatch?.transfers[0].status).toBe("processing");
    expect(updatedBatch?.transfers[0].keeperFundingSignature).toBeDefined();
    expect(updatedBatch?.items[0].status).toBe("processing");
  });
});
