import { NextRequest, NextResponse } from "next/server";
import { retryItem } from "@/lib/multihopper/retry";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimit = checkRequestRateLimit(req, "retry");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const { id } = await context.params;
    let body: { idempotencyKey?: string; actorWallet?: string } = {};

    try {
      const text = await req.text();
      if (text) {
        body = JSON.parse(text);
      }
    } catch {
      // empty body acceptable
    }

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const idempotencyKey = body.idempotencyKey || idempotencyHeader || undefined;

    const result = await retryItem(id, {
      idempotencyKey,
      actorWallet: body.actorWallet,
    });

    return NextResponse.json(
      {
        success: true,
        item: result.item,
        transferId: result.transferId,
        idempotencyKey: result.idempotencyKey,
      },
      { headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/items/:id/retry", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Retry item failed";
    const status = errorMsg.includes("not found") ? 404 : 400;
    return NextResponse.json({ success: false, error: errorMsg }, { status });
  }
}
