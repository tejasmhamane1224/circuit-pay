import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import { getMultiHopperClient } from "@/lib/multihopper/service";
import { confirmBroadcastSchema } from "@/lib/validations/transfers";
import crypto from "node:crypto";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const rateLimit = checkRequestRateLimit(req, "transfers");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const { id } = await context.params;
    const body = await req.json();
    const parsed = confirmBroadcastSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.format() },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const transfer = await payoutStore.getTransferByIdOrExternal(id);
    const batch = transfer ? await payoutStore.getPayoutBatch(transfer.batchId) : null;
    const network = batch?.network || "devnet";
    const client = getMultiHopperClient(network);

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const idempotencyKey = idempotencyHeader || transfer?.idempotencyKey || crypto.randomUUID();

    const targetTransferId = transfer?.multihopperId || id;

    // Call MultiHopper confirm-broadcast
    const res = await client.confirmBroadcast(targetTransferId, parsed.data, idempotencyKey);

    // Update store state if transfer is found
    if (transfer) {
      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };

      if (parsed.data.keeperFundingSignature) {
        updates.keeperFundingSignature = parsed.data.keeperFundingSignature;
      }
      if (parsed.data.routeInitSignatures && parsed.data.routeInitSignatures.length > 0) {
        updates.routeInitSignatures = parsed.data.routeInitSignatures;
      }
      if (parsed.data.orchestratorInitSignature) {
        updates.orchestratorInitSignature = parsed.data.orchestratorInitSignature;
      }
      if (parsed.data.sessionInitSignatures && parsed.data.sessionInitSignatures.length > 0) {
        updates.sessionInitSignatures = parsed.data.sessionInitSignatures;
      }
      if (parsed.data.dispersionInitSignatures && parsed.data.dispersionInitSignatures.length > 0) {
        updates.dispersionInitSignatures = parsed.data.dispersionInitSignatures;
      }

      if (parsed.data.routeInitSignatures?.length || parsed.data.keeperFundingSignature) {
        updates.status = "processing";
      }

      await payoutStore.updateTransfer(transfer.id, updates);

      if (transfer.items && updates.status === "processing") {
        for (const item of transfer.items) {
          await payoutStore.updatePayoutItem(item.id, { status: "routing" });
        }
      }
    }

    const updatedTransfer = transfer ? await payoutStore.getTransferByIdOrExternal(transfer.id) : null;

    return NextResponse.json(
      {
        success: true,
        status: res.status || "received",
        transfer: updatedTransfer,
      },
      { headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/transfers/:id/confirm-broadcast", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Confirm broadcast failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
