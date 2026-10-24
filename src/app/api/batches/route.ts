import { NextRequest, NextResponse } from "next/server";
import { createPayoutBatchSchema } from "@/lib/validations/batches";
import { payoutStore } from "@/lib/db/payout-store";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { validateBatchLimits } from "@/lib/security/limits";
import { captureException } from "@/lib/monitoring/sentry";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const orgId = searchParams.get("organizationId") || undefined;

    const batches = await payoutStore.listPayoutBatches(orgId);

    return NextResponse.json(
      {
        success: true,
        count: batches.length,
        batches: batches.map((b) => ({
          id: b.id,
          title: b.title,
          tokenSymbol: b.tokenSymbol,
          tokenDecimals: b.tokenDecimals,
          totalAmountFormatted: b.totalAmountFormatted,
          totalAmountRaw: b.totalAmountRaw,
          recipientCount: b.items.length,
          status: b.status,
          network: b.network,
          hops: b.hops,
          arrivalSeconds: b.arrivalSeconds,
          chunksCount: b.transfers.length,
          chunks: b.transfers.map((t) => ({
            id: t.id,
            chunkIndex: t.chunkIndex,
            externalId: t.externalId,
            recipientCount: t.recipientCount,
            amountRaw: t.chunkAmountRaw,
            status: t.status,
            multihopperId: t.multihopperId,
            attempts: t.attempts || 1,
          })),
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        })),
      }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/batches", method: "GET" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Sliding window rate limiting
    const rateLimit = checkRequestRateLimit(req, "batches");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const body = await req.json();
    const parsed = createPayoutBatchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Validation error",
          details: parsed.error.format(),
        },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const {
      organizationId,
      title,
      tokenMint,
      network,
      hops,
      arrivalSeconds,
      senderWallet = "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
      items,
    } = parsed.data;

    const isNativeSol = tokenMint === "So11111111111111111111111111111111111111112";
    const tokenSymbol = isNativeSol && (!body.tokenSymbol || body.tokenSymbol === "USDC") ? "SOL" : parsed.data.tokenSymbol;
    const tokenDecimals = isNativeSol && (!body.tokenDecimals || body.tokenDecimals === 6) ? 9 : parsed.data.tokenDecimals;

    const orgId = organizationId || "00000000-0000-0000-0000-000000000001";

    // 2. Enforce Per-Organization Safety Caps (batch amount, recipient count, daily org volume)
    const limitsCheck = await validateBatchLimits({
      organizationId: orgId,
      tokenSymbol,
      tokenDecimals,
      items,
    });

    if (!limitsCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: limitsCheck.error,
          code: limitsCheck.errorCode,
          details: limitsCheck.details,
        },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const batch = await payoutStore.createPayoutBatch({
      organizationId: orgId,
      title,
      senderWallet,
      tokenMint,
      tokenSymbol,
      tokenDecimals,
      network,
      hops,
      arrivalSeconds,
      items,
    });

    return NextResponse.json(
      {
        success: true,
        batch: {
          id: batch.id,
          title: batch.title,
          tokenSymbol: batch.tokenSymbol,
          tokenDecimals: batch.tokenDecimals,
          totalAmountFormatted: batch.totalAmountFormatted,
          totalAmountRaw: batch.totalAmountRaw,
          recipientCount: batch.items.length,
          status: batch.status,
          network: batch.network,
          hops: batch.hops,
          arrivalSeconds: batch.arrivalSeconds,
          chunksCount: batch.transfers.length,
          chunks: batch.transfers.map((t) => ({
            id: t.id,
            chunkIndex: t.chunkIndex,
            externalId: t.externalId,
            recipientCount: t.recipientCount,
            amountRaw: t.chunkAmountRaw,
            status: t.status,
          })),
          items: batch.items.map((i) => ({
            id: i.id,
            recipientWallet: i.recipientWallet,
            recipientName: i.recipientName,
            amountFormatted: i.amountFormatted,
            amountRaw: i.amountRaw,
            status: i.status,
          })),
          createdAt: batch.createdAt,
        },
      },
      { status: 201, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/batches", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
