import { NextRequest, NextResponse } from "next/server";
import { retryBatch } from "@/lib/multihopper/retry";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 1. Sliding window rate limit on retries (e.g. 10/min)
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
      // empty body is acceptable
    }

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const idempotencyKey = body.idempotencyKey || idempotencyHeader || undefined;

    const result = await retryBatch(id, {
      idempotencyKey,
      actorWallet: body.actorWallet,
    });

    return NextResponse.json(
      {
        success: true,
        batchId: result.batchId,
        status: result.newStatus,
        previousStatus: result.previousStatus,
        idempotencyKey: result.idempotencyKey,
        retriedChunksCount: result.retriedChunksCount,
        totalUnsettledItemsRetried: result.totalUnsettledItemsRetried,
        totalSettledItemsPreserved: result.totalSettledItemsPreserved,
        alreadyFullySettled: result.alreadyFullySettled,
        chunks: result.chunks,
      },
      { headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/batches/:id/retry", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Retry failed";
    const status = errorMsg.includes("not found") ? 404 : 500;
    return NextResponse.json({ success: false, error: errorMsg }, { status });
  }
}
