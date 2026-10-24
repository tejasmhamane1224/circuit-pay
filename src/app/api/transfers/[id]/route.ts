import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const transfer = await payoutStore.getTransferByIdOrExternal(id);

    if (!transfer) {
      return NextResponse.json(
        { success: false, error: `Transfer ${id} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      transfer: {
        id: transfer.id,
        batchId: transfer.batchId,
        chunkIndex: transfer.chunkIndex,
        externalId: transfer.externalId,
        multihopperId: transfer.multihopperId,
        hops: transfer.hops,
        arrivalSeconds: transfer.arrivalSeconds,
        status: transfer.status,
        chunkAmountRaw: transfer.chunkAmountRaw,
        recipientCount: transfer.recipientCount,
        keeperFundingSignature: transfer.keeperFundingSignature,
        routeInitSignatures: transfer.routeInitSignatures,
        percentFeeRaw: transfer.percentFeeRaw,
        flatFeeLamports: transfer.flatFeeLamports,
        integratorFeeShareRaw: transfer.integratorFeeShareRaw,
        items: transfer.items,
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
