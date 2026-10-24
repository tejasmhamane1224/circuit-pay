import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { payoutStore } from "@/lib/db/payout-store";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { batchId, eventType = "transfer.completed" } = body;

    const batch = await payoutStore.getPayoutBatch(batchId);
    if (!batch || batch.transfers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Batch or transfers not found" },
        { status: 404 }
      );
    }

    const secret =
      process.env.MULTIHOPPER_WEBHOOK_SECRET || "whsec_test_secret_for_local_hmac";

    const results = [];

    // Dispatch webhook for each transfer chunk in the batch
    for (const targetTransfer of batch.transfers) {
      const eventId = `evt_sim_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const payload = {
        eventId,
        eventType,
        timestamp: new Date().toISOString(),
        data: {
          id: targetTransfer.multihopperId || `mh_sim_${Date.now()}`,
          externalId: targetTransfer.externalId,
          status: eventType === "transfer.completed" ? "completed" : "processing",
          network: batch.network,
          tokenMint: batch.tokenMint,
          amountRaw: targetTransfer.chunkAmountRaw,
          percentFeeRaw: ((BigInt(targetTransfer.chunkAmountRaw || "0") * BigInt(50)) / BigInt(10000)).toString(),
          destinations: (targetTransfer.items || []).map((it) => ({
            wallet: it.recipientWallet,
            amountRaw: it.amountRaw,
            status: eventType === "transfer.completed" ? "paid" : "pending",
            payoutSignature: `5wSimSig${Math.random().toString(36).substring(2, 8)}Sol`,
          })),
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const webhookUrl = new URL("/api/webhooks/multihopper", req.url).toString();
      const webhookRes = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-multihopper-signature": signature,
        },
        body: rawBody,
      });

      const webhookJson = await webhookRes.json();
      results.push({ eventId, webhookJson });
    }

    return NextResponse.json({
      success: true,
      simulated: true,
      eventType,
      results,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
