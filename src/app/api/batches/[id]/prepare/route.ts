import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import { getMultiHopperClient } from "@/lib/multihopper/service";
import { DEFAULT_APPROVAL_POLICY, evaluateBatchApprovals } from "@/lib/security/roles";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const batch = await payoutStore.getPayoutBatch(id);

    if (!batch) {
      return NextResponse.json(
        { success: false, error: `Batch ${id} not found` },
        { status: 404 }
      );
    }

    const reqBody = await req.json().catch(() => ({}));
    const payerWallet = reqBody.payerWallet || batch.senderWallet;

    // Enforce multi-approval policy on threshold batches
    const totalUsd = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    const roundedUsd = Math.round((totalUsd + Number.EPSILON) * 100) / 100;
    if (roundedUsd >= DEFAULT_APPROVAL_POLICY.thresholdUsd) {
      const approvals = payoutStore.getBatchApprovals(id);
      const evaluation = evaluateBatchApprovals(roundedUsd, approvals);
      if (!evaluation.isApproved) {
        return NextResponse.json(
          {
            success: false,
            error: `Batch requires multi-approval before preparation/signing. ${evaluation.rejectionReason}`,
            evaluation,
          },
          { status: 403 }
        );
      }
    }

    const client = getMultiHopperClient(batch.network);

    const preparedChunks = [];

    for (const transfer of batch.transfers) {
      // 1. Create transfer on MultiHopper if not yet created
      let mhTransferId = transfer.multihopperId;
      if (!mhTransferId) {
        const dests = (transfer.items || []).map((it) => ({
          wallet: it.recipientWallet,
          amountRaw: it.amountRaw,
        }));

        const createRes = await client.createTransfer(
          {
            inputMint: batch.tokenMint,
            tokenMint: batch.tokenMint,
            sourceWallet: payerWallet,
            sourceOwner: payerWallet,
            amountRaw: transfer.chunkAmountRaw,
            amountTokens: (Number(transfer.chunkAmountRaw) / 10 ** batch.tokenDecimals).toString(),
            tokenDecimals: batch.tokenDecimals,
            tokenSymbol: batch.tokenSymbol,
            hops: transfer.hops,
            arrivalSeconds: transfer.arrivalSeconds,
            externalId: transfer.externalId,
            destinations: dests,
          },
          transfer.idempotencyKey
        );

        mhTransferId = createRes.id;
      }

      // 2. Prepare transaction bundle
      const prepareRes = await client.prepareTransfer(mhTransferId);

      // 3. Update transfer status in store
      await payoutStore.updateTransfer(transfer.id, {
        status: "awaiting_signature",
        multihopperId: mhTransferId,
      });

      preparedChunks.push({
        chunkId: transfer.id,
        chunkIndex: transfer.chunkIndex,
        externalId: transfer.externalId,
        multihopperId: mhTransferId,
        preparedTxs: prepareRes.preparedTxs,
      });
    }

    // Refresh batch status
    const updatedBatch = await payoutStore.getPayoutBatch(id);

    return NextResponse.json({
      success: true,
      batchId: id,
      status: updatedBatch?.status,
      preparedChunks,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
