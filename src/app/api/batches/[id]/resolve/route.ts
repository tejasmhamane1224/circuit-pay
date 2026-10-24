import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    let body: {
      actorWallet?: string;
      reason?: string;
      resolutionSignature?: string;
      status?: "completed" | "refunded";
    } = {};

    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty body
    }

    const reason = body.reason || "Manual resolution by treasury administrator";
    const resolvedBatch = await payoutStore.manualResolveBatch(id, {
      actorWallet: body.actorWallet,
      reason,
      resolutionSignature: body.resolutionSignature,
      status: body.status || "completed",
    });

    return NextResponse.json({
      success: true,
      batch: resolvedBatch,
      message: `Batch ${id} manually resolved to status ${resolvedBatch.status}`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Manual resolution failed";
    const status = errorMsg.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: errorMsg }, { status });
  }
}
