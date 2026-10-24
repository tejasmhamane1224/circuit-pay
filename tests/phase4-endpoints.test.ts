import { describe, it, expect, beforeEach } from "vitest";
import { POST as retryBatchRoute } from "../src/app/api/batches/[id]/retry/route";
import { POST as retryTransferRoute } from "../src/app/api/transfers/[id]/retry/route";
import { POST as resolveBatchRoute } from "../src/app/api/batches/[id]/resolve/route";
import { POST as resolveTransferRoute } from "../src/app/api/transfers/[id]/resolve/route";
import { GET as getCsvReceipt } from "../src/app/api/batches/[id]/receipt/csv/route";
import { GET as getPdfReceipt } from "../src/app/api/batches/[id]/receipt/pdf/route";
import { GET as getReconciliation } from "../src/app/api/batches/[id]/reconciliation/route";
import { GET as getAuditLogs } from "../src/app/api/batches/[id]/audit-logs/route";
import { GET as getEvidenceCsv } from "../src/app/api/evidence/csv/route";
import { GET as getVolume } from "../src/app/api/volume/route";
import { payoutStore } from "../src/lib/db/payout-store";
import { resetRetryCaches } from "../src/lib/multihopper/retry";
import { NextRequest } from "next/server";

describe("Phase 4 Endpoints: Retries, Receipts, Reconciliation, Audit & Evidence", () => {
  const dummyWallet1 = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4";
  const dummyWallet2 = "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u";
  const tokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  beforeEach(() => {
    payoutStore.resetStore();
    resetRetryCaches();
  });

  it("POST /api/batches/[id]/retry executes safe retry on unsettled items and skips settled items", async () => {
    // Create batch with 2 items
    const batch = await payoutStore.createPayoutBatch({
      title: "Retry API Test Batch",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      network: "mainnet-beta",
      items: [
        { recipientWallet: dummyWallet1, amountFormatted: "100.00", amountRaw: "100000000" },
        { recipientWallet: dummyWallet2, amountFormatted: "200.00", amountRaw: "200000000" },
      ],
    });

    const transfer = batch.transfers[0];
    const item0 = batch.items[0];
    const item1 = batch.items[1];

    // Settle item0, fail item1
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updatePayoutItem(item0.id, { status: "paid", payoutSignature: "5wPaidSigPreSol" });
    await payoutStore.updatePayoutItem(item1.id, { status: "failed" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const req = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/retry`, {
      method: "POST",
      body: JSON.stringify({ actorWallet: dummyWallet1 }),
    });

    const res = await retryBatchRoute(req, { params: Promise.resolve({ id: batch.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.totalUnsettledItemsRetried).toBe(1);
    expect(json.totalSettledItemsPreserved).toBe(1);
    expect(json.status).toBe("completed");

    // Check item0 signature is still 5wPaidSigPreSol
    const refreshed = await payoutStore.getPayoutBatch(batch.id);
    const refreshedItem0 = refreshed?.items.find((i) => i.id === item0.id);
    const refreshedItem1 = refreshed?.items.find((i) => i.id === item1.id);
    expect(refreshedItem0?.payoutSignature).toBe("5wPaidSigPreSol");
    expect(refreshedItem0?.paymentCount).toBe(1);
    expect(refreshedItem1?.status).toBe("paid");
    expect(refreshedItem1?.paymentCount).toBe(1);
  });

  it("POST /api/transfers/[id]/retry retries specific transfer safely", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Transfer Retry Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "50.00", amountRaw: "50000000" }],
    });

    const transfer = batch.transfers[0];
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const req = new NextRequest(`http://localhost:3000/api/transfers/${transfer.id}/retry`, {
      method: "POST",
    });

    const res = await retryTransferRoute(req, { params: Promise.resolve({ id: transfer.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.transfer.attempts).toBe(2);
    expect(json.transfer.newStatus).toBe("completed");
  });

  it("POST /api/batches/[id]/resolve manually resolves failed batch with audit log", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Batch Manual Resolve Route Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "75.00", amountRaw: "75000000" }],
    });

    const transfer = batch.transfers[0];
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updatePayoutItem(batch.items[0].id, { status: "failed" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const req = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        actorWallet: dummyWallet1,
        reason: "Treasury manual resolution via multisig",
        resolutionSignature: "5wMultisigResolvedTxSignature123Sol",
      }),
    });

    const res = await resolveBatchRoute(req, { params: Promise.resolve({ id: batch.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.batch.status).toBe("completed");

    const logs = payoutStore.listAuditLogs(batch.id);
    const resolveLog = logs.find((l) => l.action === "batch.manual_resolved");
    expect(resolveLog).toBeDefined();
    expect(resolveLog?.details?.reason).toBe("Treasury manual resolution via multisig");
  });

  it("POST /api/transfers/[id]/resolve manually resolves individual transfer with signature", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Transfer Manual Resolve Route Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "40.00", amountRaw: "40000000" }],
    });

    const transfer = batch.transfers[0];
    await payoutStore.updateTransfer(transfer.id, { status: "processing" });
    await payoutStore.updatePayoutItem(batch.items[0].id, { status: "failed" });
    await payoutStore.updateTransfer(transfer.id, { status: "failed" });

    const req = new NextRequest(`http://localhost:3000/api/transfers/${transfer.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        reason: "Manual chunk dispute resolution",
        resolutionSignature: "5wDisputeChunkResolvedSigSol",
      }),
    });

    const res = await resolveTransferRoute(req, { params: Promise.resolve({ id: transfer.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.transfer.status).toBe("completed");

    const refreshedTransfer = await payoutStore.getTransferByIdOrExternal(transfer.id);
    expect(refreshedTransfer?.items?.[0].status).toBe("paid");
    expect(refreshedTransfer?.items?.[0].payoutSignature).toBe("5wDisputeChunkResolvedSigSol");
  });

  it("GET /api/batches/[id]/receipt/csv returns formatted CSV for DAO accounting with Solscan & Explorer links", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "DAO Sprint 18 CSV Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "500.00", amountRaw: "500000000" }],
    });

    const req = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/receipt/csv`);
    const res = await getCsvReceipt(req, { params: Promise.resolve({ id: batch.id }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(`circuitpay-receipt-${batch.id}.csv`);

    const text = await res.text();
    expect(text).toContain("Batch ID,Batch Title,Network,Status");
    expect(text).toContain("Solscan Link");
    expect(text).toContain("Solana Explorer Link");
    expect(text).toContain("DAO TREASURY RECONCILIATION & AUDIT SUMMARY");
    expect(text).toContain("DAO Sprint 18 CSV Test");
    expect(text).toContain(dummyWallet1);
  });

  it("GET /api/batches/[id]/receipt/pdf returns printable HTML/PDF receipt with Solscan, Explorer & completion timestamp", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "PDF Receipt Render Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "120.00", amountRaw: "120000000" }],
    });

    const req = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/receipt/pdf?autoprint=true`);
    const res = await getPdfReceipt(req, { params: Promise.resolve({ id: batch.id }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("CircuitPay • Payout Receipt");
    expect(html).toContain("PDF Receipt Render Test");
    expect(html).toContain("solscan.io");
    expect(html).toContain("explorer.solana.com");
    expect(html).toContain("Settlement Completed At (UTC)");
    expect(html).toContain("window.print()");
  });

  it("GET /api/batches/[id]/reconciliation returns balanced amounts & fee/lamport analysis", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Reconciliation Balance Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [
        { recipientWallet: dummyWallet1, amountFormatted: "300.00", amountRaw: "300000000" },
        { recipientWallet: dummyWallet2, amountFormatted: "700.00", amountRaw: "700000000" },
      ],
    });

    const req = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/reconciliation`);
    const res = await getReconciliation(req, { params: Promise.resolve({ id: batch.id }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.reconciliation.requestedTotalRaw).toBe("1000000000"); // 1,000 USDC
    expect(json.reconciliation.isBalanced).toBe(true);
    expect(json.reconciliation.varianceRaw).toBe("0");
    expect(json.reconciliation.screeningFeeLamports).toBe((2 * 50000).toString());
    expect(json.reconciliation.keeperFundingLamports).toBe((1 * 5000000).toString());
    expect(json.reconciliation.totalProtocolSolLamports).toBe((2 * 50000 + 1 * 5000000).toString());
  });

  it("GET /api/batches/[id]/audit-logs returns recorded event trail", async () => {
    const batch = await payoutStore.createPayoutBatch({
      title: "Audit Trail API Test",
      senderWallet: dummyWallet1,
      tokenMint,
      tokenSymbol: "USDC",
      tokenDecimals: 6,
      items: [{ recipientWallet: dummyWallet1, amountFormatted: "250.00", amountRaw: "250000000" }],
    });

    const req = new NextRequest(`http://localhost:3000/api/batches/${batch.id}/audit-logs`);
    const res = await getAuditLogs(req, { params: Promise.resolve({ id: batch.id }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.count).toBeGreaterThan(0);
    const createdLog = json.logs.find((l: { action: string }) => l.action === "batch.created");
    expect(createdLog).toBeDefined();
    expect(createdLog.resourceId).toBe(batch.id);
  });

  it("GET /api/evidence/csv generates exact Superteam Earn submission CSV with challenge summary", async () => {
    payoutStore.seedDefaultData();
    const req = new NextRequest("http://localhost:3000/api/evidence/csv?network=mainnet-beta&window=challenge");
    const res = await getEvidenceCsv(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("superteam-earn-qualifying-volume-submission.csv");

    const text = await res.text();
    expect(text).toContain("MultiHopper Transfer ID,Network,Verified Timestamp");
    expect(text).toContain("Qualifying Volume (USD)");
    expect(text).toContain("collected_fees / 0.0025");
    expect(text).toContain("SUPERTEAM EARN MULTIHOPPER BUILD AND ROUTE CHALLENGE SUBMISSION SUMMARY");
    expect(text).toContain("Target $100k Threshold Met?");
  });

  it("GET /api/volume returns filtered ledger and qualifying volume math", async () => {
    payoutStore.seedDefaultData();
    const req = new NextRequest("http://localhost:3000/api/volume?network=mainnet-beta&window=challenge");
    const res = await getVolume(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.formula).toBe("qualifying_volume = collected_fees / 0.0025");
    expect(json.targetThresholdUsd).toBe(100000);
    expect(json.metrics.totalQualifyingVolumeUsd).toBeGreaterThanOrEqual(100000);
    expect(json.metrics.thresholdMet).toBe(true);
    expect(json.ledger.length).toBeGreaterThan(0);
  });
});
