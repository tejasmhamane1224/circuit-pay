import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const reconciliation = await payoutStore.getSettlementReconciliation(id);

    if (!reconciliation) {
      return NextResponse.json(
        { success: false, error: `Batch ${id} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      reconciliation,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Reconciliation query failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
