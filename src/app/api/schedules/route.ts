import { NextRequest, NextResponse } from "next/server";
import { scheduleManager, type ScheduleFrequency } from "@/lib/schedules/schedule-manager";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("organizationId") || undefined;
    const schedules = scheduleManager.listSchedules(orgId);

    return NextResponse.json({
      success: true,
      count: schedules.length,
      schedules,
    });
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/schedules", method: "GET" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimit = checkRequestRateLimit(req, "schedules");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const body = await req.json();

    // Support action: "trigger" directly on schedule if id is passed in body
    if (body.action === "trigger" && body.scheduleId) {
      const result = await scheduleManager.triggerSchedule(body.scheduleId);
      return NextResponse.json(
        {
          success: true,
          action: "triggered",
          schedule: result.schedule,
          batch: result.batch,
        },
        { headers: rateLimit.headers }
      );
    }

    // Validate schedule creation fields
    const {
      organizationId,
      title,
      frequency,
      cronExpression,
      tokenMint,
      tokenSymbol = "USDC",
      tokenDecimals = 6,
      senderWallet = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      network = "devnet",
      hops = 4,
      arrivalSeconds = 900,
      items,
      startDate,
    } = body;

    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing or invalid schedule title" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const validFrequencies: ScheduleFrequency[] = ["weekly", "bi-weekly", "monthly"];
    if (!frequency || !validFrequencies.includes(frequency)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid frequency: must be one of ${validFrequencies.join(", ")}`,
        },
        { status: 400, headers: rateLimit.headers }
      );
    }

    if (!tokenMint || typeof tokenMint !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing tokenMint" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "Schedule must include at least one payout item recipient" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const schedule = scheduleManager.createSchedule({
      organizationId,
      title,
      frequency,
      cronExpression,
      tokenMint,
      tokenSymbol,
      tokenDecimals,
      senderWallet,
      network,
      hops,
      arrivalSeconds,
      items,
      startDate,
    });

    return NextResponse.json(
      {
        success: true,
        schedule,
      },
      { status: 201, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/schedules", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
