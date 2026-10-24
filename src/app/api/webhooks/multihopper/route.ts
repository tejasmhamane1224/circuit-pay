import { NextRequest, NextResponse } from "next/server";
import { verifyMultiHopperWebhook } from "@/lib/multihopper/webhook";
import { multihopperWebhookPayloadSchema } from "@/lib/validations/webhooks";
import { calculateQualifyingVolume } from "@/lib/multihopper/volume";
import { payoutStore } from "@/lib/db/payout-store";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { trackEvent } from "@/lib/analytics/posthog";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(req: NextRequest) {
  try {
    // 1. Sliding window rate limit on webhook ingestion
    const rateLimit = checkRequestRateLimit(req, "webhooks");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-multihopper-signature");
    const secret =
      process.env.MULTIHOPPER_WEBHOOK_SECRET || "whsec_test_secret_for_local_hmac";

    if (!signature) {
      return NextResponse.json(
        { success: false, error: "Missing x-multihopper-signature header" },
        { status: 401, headers: rateLimit.headers }
      );
    }

    const isValid = verifyMultiHopperWebhook(rawBody, signature, secret);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: "Invalid webhook HMAC signature" },
        { status: 401, headers: rateLimit.headers }
      );
    }

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { success: false, error: "Malformed JSON payload" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const parsed = multihopperWebhookPayloadSchema.safeParse(payloadJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid webhook payload structure",
          details: parsed.error.format(),
        },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const event = parsed.data;
    const { eventId, eventType, data } = event;

    // 2. Reject replays older than 5 minutes (300 seconds)
    const eventTimestamp = event.timestamp;
    const eventTimeMs =
      typeof eventTimestamp === "number"
        ? eventTimestamp < 1e11
          ? eventTimestamp * 1000
          : eventTimestamp
        : new Date(eventTimestamp).getTime();
    const now = Date.now();
    const FIVE_MINUTES_MS = 5 * 60 * 1000;

    if (isNaN(eventTimeMs) || Math.abs(now - eventTimeMs) > FIVE_MINUTES_MS) {
      return NextResponse.json(
        {
          success: false,
          error: "Webhook timestamp expired or exceeds 5-minute replay window",
          timestamp: eventTimestamp,
        },
        { status: 401, headers: rateLimit.headers }
      );
    }

    // 3. Idempotency Deduplication Check (by eventId)
    const { existing, event: storedEvent } = await payoutStore.registerWebhookEvent(
      eventId,
      eventType,
      payloadJson as Record<string, unknown>,
      signature
    );

    if (existing && storedEvent.processed) {
      return NextResponse.json(
        {
          success: true,
          deduplicated: true,
          eventId,
          eventType,
          message: "Webhook event already processed (replay ignored)",
        },
        { headers: rateLimit.headers }
      );
    }

    // Find corresponding transfer record in database / store
    let transfer = data.externalId
      ? await payoutStore.getTransferByIdOrExternal(data.externalId)
      : null;
    if (!transfer && data.id) {
      transfer = await payoutStore.getTransferByIdOrExternal(data.id);
    }

    let volumeCalculation = null;

    if (transfer) {
      // Advance State Machine based on Lifecycle Event
      // Payout items: pending -> routing -> delivered | failed
      switch (eventType) {
        case "transfer.quote_created":
          await payoutStore.updateTransfer(transfer.id, {
            status: "quote",
            multihopperId: data.id,
          });
          break;

        case "transfer.deposit_confirmed":
          await payoutStore.updateTransfer(transfer.id, {
            status: "processing",
            multihopperId: data.id,
          });
          if (transfer.items) {
            for (const item of transfer.items) {
              await payoutStore.updatePayoutItem(item.id, { status: "routing" });
            }
          }
          break;

        case "transfer.processing":
        case "transfer.hop_complete":
          await payoutStore.updateTransfer(transfer.id, {
            status: "active",
          });
          if (transfer.items) {
            for (const item of transfer.items) {
              if (item.status === "pending") {
                await payoutStore.updatePayoutItem(item.id, { status: "routing" });
              }
            }
          }
          break;

        case "transfer.completed":
          if (
            transfer.status === "created" ||
            transfer.status === "quote" ||
            transfer.status === "awaiting_signature"
          ) {
            await payoutStore.updateTransfer(transfer.id, { status: "processing" });
          }
          await payoutStore.updateTransfer(transfer.id, {
            status: "completed",
            multihopperId: data.id,
          });

          // Mark destination items as delivered / paid
          if (transfer.items) {
            for (const item of transfer.items) {
              // Match destination payoutSignature if sent by MultiHopper
              const destMatch = data.destinations?.find(
                (d) => d.wallet === item.recipientWallet
              );
              const itemStatus = destMatch?.status === "paid" ? "paid" : "delivered";
              await payoutStore.updatePayoutItem(item.id, {
                status: itemStatus,
                payoutSignature: destMatch?.payoutSignature || `5w${Math.random().toString(36).substring(2, 10)}sol`,
              });
            }
          }

          // Mainnet challenge volume tracking
          {
            const network = data.network || "devnet";
            const isMainnet = network === "mainnet-beta";
            const percentFeeRaw = BigInt(data.percentFeeRaw || "0");
            const collectedFeeUsd = Number(percentFeeRaw) / 10 ** 6;
            volumeCalculation = calculateQualifyingVolume(collectedFeeUsd, network, isMainnet);

            await payoutStore.recordVolumeLedger({
              transferId: transfer.id,
              multihopperId: data.id,
              network,
              isMainnet,
              tokenMint: data.tokenMint || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              tokenSymbol: data.tokenSymbol || "USDC",
              principalAmountRaw: data.amountRaw || transfer.chunkAmountRaw,
              principalAmountUsd: (Number(data.amountRaw || transfer.chunkAmountRaw) / 10 ** 6).toFixed(4),
              collectedFeeRaw: percentFeeRaw.toString(),
              collectedFeeUsd: collectedFeeUsd.toFixed(4),
              qualifyingVolumeUsd: volumeCalculation.qualifyingVolumeUsd.toFixed(4),
              integratorFeeShareUsd: volumeCalculation.integratorFeeShareUsd.toFixed(4),
              verifiedAt: new Date().toISOString(),
            });

            // Track webhook_settled funnel analytics
            trackEvent("webhook_settled", {
              eventId,
              transferId: transfer.id,
              eventType,
              qualifyingVolumeUsd: volumeCalculation.qualifyingVolumeUsd.toFixed(4),
            });
          }
          break;

        case "transfer.failed":
          await payoutStore.updateTransfer(transfer.id, {
            status: "failed",
          });
          if (transfer.items) {
            for (const item of transfer.items) {
              await payoutStore.updatePayoutItem(item.id, { status: "failed" });
            }
          }
          break;

        case "transfer.refunded":
          await payoutStore.updateTransfer(transfer.id, {
            status: "refunded",
          });
          if (transfer.items) {
            for (const item of transfer.items) {
              await payoutStore.updatePayoutItem(item.id, { status: "refunded" });
            }
          }
          break;

        default:
          break;
      }

      await payoutStore.recordAuditLog({
        actorWallet: "system",
        action: `webhook.${eventType}`,
        resourceType: "multihopper_transfer",
        resourceId: transfer.id,
        details: {
          eventId,
          eventType,
          batchId: transfer.batchId,
          status: data.status,
          multihopperId: data.id,
        },
      });
    }

    // Mark event processed successfully
    await payoutStore.markWebhookProcessed(eventId, true);

    return NextResponse.json(
      {
        success: true,
        received: true,
        eventId,
        eventType,
        status: data.status,
        volumeCalculation,
      },
      { headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/webhooks/multihopper", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
