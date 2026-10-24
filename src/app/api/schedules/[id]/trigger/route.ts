import { NextRequest, NextResponse } from "next/server";
import { scheduleManager } from "@/lib/schedules/schedule-manager";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const schedule = scheduleManager.getSchedule(id);

    if (!schedule) {
      return NextResponse.json(
        { success: false, error: `Schedule ${id} not found` },
        { status: 404 }
      );
    }

    const result = await scheduleManager.triggerSchedule(id);

    return NextResponse.json({
      success: true,
      message: `Successfully executed recurring schedule ${id}`,
      schedule: result.schedule,
      batch: {
        id: result.batch.id,
        title: result.batch.title,
        totalAmountFormatted: result.batch.totalAmountFormatted,
        tokenSymbol: result.batch.tokenSymbol,
        status: result.batch.status,
        recipientCount: result.batch.items.length,
        chunksCount: result.batch.transfers.length,
        createdAt: result.batch.createdAt,
      },
    });
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/schedules/[id]/trigger", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
