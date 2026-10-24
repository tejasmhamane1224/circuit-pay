import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "50", 10);

    const logs = payoutStore.listAuditLogs(id, limit);

    return NextResponse.json({
      success: true,
      batchId: id,
      count: logs.length,
      logs,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Audit log query failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
