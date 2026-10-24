import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import { getMultiHopperClient } from "@/lib/multihopper/service";
import crypto from "node:crypto";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimit = checkRequestRateLimit(req, "transfers");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const { id } = await context.params;
    const transfer = await payoutStore.getTransferByIdOrExternal(id);

    if (!transfer) {
      return NextResponse.json(
        { success: false, error: `Transfer ${id} not found` },
        { status: 404, headers: rateLimit.headers }
      );
    }

    const batch = await payoutStore.getPayoutBatch(transfer.batchId);
    const network = batch?.network || "devnet";
    const client = getMultiHopperClient(network);

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const idempotencyKey = idempotencyHeader || transfer.idempotencyKey || crypto.randomUUID();

    const reqBody = await req.json().catch(() => ({}));
    const payerWallet = reqBody.payerWallet || batch?.senderWallet || "7NWNAxaNXHstZbfVqHqwL1kDHKwJmb9HtZTfBZDREWUJ";

    // 1. Ensure transfer exists on MultiHopper
    let mhTransferId = transfer.multihopperId;
    if (!mhTransferId) {
      const dests = (transfer.items || []).map((it) => ({
        wallet: it.recipientWallet,
        amountRaw: it.amountRaw,
      }));

      const createRes = await client.createTransfer(
        {
          inputMint: batch?.tokenMint || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenMint: batch?.tokenMint || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountRaw: transfer.chunkAmountRaw,
          sourceWallet: payerWallet,
          sourceOwner: payerWallet,
          hops: transfer.hops,
          arrivalSeconds: transfer.arrivalSeconds,
          externalId: transfer.externalId,
          destinations: dests,
        },
        idempotencyKey
      );

      mhTransferId = createRes.id;
    }

    // 2. Prepare transaction bundle server-side with MultiHopper
    const prepareIdempotencyKey = `${idempotencyKey}_prepare`;
    const prepareRes = await client.prepareTransfer(mhTransferId, prepareIdempotencyKey);

    // 3. Update transfer status
    await payoutStore.updateTransfer(transfer.id, {
      status: "awaiting_signature",
      multihopperId: mhTransferId,
    });

    const routeInitFirst =
      Array.isArray(prepareRes.preparedTxs?.routeInitTxs) && prepareRes.preparedTxs.routeInitTxs[0]
        ? typeof prepareRes.preparedTxs.routeInitTxs[0] === "string"
          ? prepareRes.preparedTxs.routeInitTxs[0]
          : (prepareRes.preparedTxs.routeInitTxs[0] as { base64: string }).base64
        : "";

    const dispersionFirst =
      Array.isArray(prepareRes.preparedTxs?.dispersionInitTxs) && prepareRes.preparedTxs.dispersionInitTxs[0]
        ? prepareRes.preparedTxs.dispersionInitTxs[0]
        : "";

    const transactions = {
      keeperFundingTx: prepareRes.preparedTxs?.keeperFundingTx || "",
      routeInitTx: routeInitFirst,
      orchestratorInitTx: prepareRes.preparedTxs?.orchestratorInitTx || "",
      dispersionTx: dispersionFirst,
    };

    return NextResponse.json(
      {
        success: true,
        transferId: transfer.id,
        multihopperId: mhTransferId,
        preparedTxs: prepareRes.preparedTxs,
        transactions,
        resume: prepareRes.resume,
      },
      { headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/transfers/:id/prepare", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Prepare transfer failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
