import { NextRequest, NextResponse } from "next/server";
import { outboundWebhookManager } from "@/lib/webhooks/outbound";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("organizationId") || undefined;
    const subscriptionId = searchParams.get("subscriptionId") || undefined;

    const webhooks = outboundWebhookManager.listWebhooks(orgId);
    const deliveries = outboundWebhookManager.getDeliveries(subscriptionId);

    return NextResponse.json({
      success: true,
      count: webhooks.length,
      webhooks,
      recentDeliveries: deliveries,
    });
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/webhooks/outbound", method: "GET" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateLimit = checkRequestRateLimit(req, "webhooks");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const body = await req.json();

    // Support test dispatch: { action: "test", subscriptionId?: string, event?: string }
    if (body.action === "test") {
      const event = body.event || "batch.completed";
      const samplePayload = {
        event,
        eventId: `cp_test_${Date.now()}`,
        test: true,
        message: "Test webhook dispatch from CircuitPay engine",
        timestamp: new Date().toISOString(),
        data: {
          batchId: "batch-test-demo",
          title: "Test Payroll Settlement",
          totalAmountFormatted: "5,000.00",
          tokenSymbol: "USDC",
          recipientCount: 5,
        },
      };

      const deliveries = await outboundWebhookManager.dispatchOutboundEvent(
        event,
        samplePayload,
        body.organizationId
      );

      return NextResponse.json(
        {
          success: true,
          action: "test_dispatched",
          deliveriesCount: deliveries.length,
          deliveries,
        },
        { headers: rateLimit.headers }
      );
    }

    const { organizationId, url, secret, events, description } = body;

    if (!url || typeof url !== "string" || (!url.startsWith("http://") && !url.startsWith("https://"))) {
      return NextResponse.json(
        { success: false, error: "Missing or invalid webhook URL (must be valid HTTP/HTTPS URL)" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const webhook = outboundWebhookManager.registerWebhook({
      organizationId,
      url,
      secret,
      events,
      description,
    });

    return NextResponse.json(
      {
        success: true,
        webhook,
      },
      { status: 201, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/webhooks/outbound", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { success: false, error: "Missing required query parameter: id" },
        { status: 400 }
      );
    }

    const deleted = outboundWebhookManager.deleteWebhook(id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: `Webhook subscription ${id} not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Webhook subscription ${id} deleted successfully`,
    });
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/webhooks/outbound", method: "DELETE" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
