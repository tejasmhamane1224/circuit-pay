import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";

export async function GET(
  _req: NextRequest,
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

    return NextResponse.json({
      success: true,
      batch: {
        id: batch.id,
        title: batch.title,
        tokenSymbol: batch.tokenSymbol,
        tokenDecimals: batch.tokenDecimals,
        tokenMint: batch.tokenMint,
        totalAmountFormatted: batch.totalAmountFormatted,
        totalAmountRaw: batch.totalAmountRaw,
        recipientCount: batch.items.length,
        status: batch.status,
        network: batch.network,
        hops: batch.hops,
        arrivalSeconds: batch.arrivalSeconds,
        senderWallet: batch.senderWallet,
        chunksCount: batch.transfers.length,
        chunks: batch.transfers.map((t) => ({
          id: t.id,
          chunkIndex: t.chunkIndex,
          externalId: t.externalId,
          recipientCount: t.recipientCount,
          amountRaw: t.chunkAmountRaw,
          status: t.status,
          multihopperId: t.multihopperId,
          keeperFundingSignature: t.keeperFundingSignature,
          routeInitSignatures: t.routeInitSignatures,
          attempts: t.attempts || 1,
        })),
        items: batch.items.map((i) => ({
          id: i.id,
          transferId: i.transferId,
          recipientWallet: i.recipientWallet,
          recipientName: i.recipientName,
          amountFormatted: i.amountFormatted,
          amountRaw: i.amountRaw,
          status: i.status,
          screeningStatus: i.screeningStatus,
          payoutSignature: i.payoutSignature,
        })),
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        approvals: payoutStore.getBatchApprovals(batch.id),
        approvalEvaluation: payoutStore.getBatchApprovalEvaluation(batch.id),
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
