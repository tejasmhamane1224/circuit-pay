import { NextRequest, NextResponse } from "next/server";
import { createTransferSchema } from "@/lib/validations/transfers";
import { getMultiHopperClient } from "@/lib/multihopper/service";
import { INTEGRATION_IDENTIFIER } from "@/lib/constants";
import { checkRequestRateLimit } from "@/lib/security/rate-limit";
import { captureException } from "@/lib/monitoring/sentry";

export async function POST(req: NextRequest) {
  try {
    const rateLimit = checkRequestRateLimit(req, "transfers");
    if (!rateLimit.allowed && rateLimit.response) {
      return rateLimit.response;
    }

    const integrationId = req.headers.get("x-integration-id");
    if (!integrationId || integrationId !== INTEGRATION_IDENTIFIER) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid or missing integration identifier. Must provide 'x-integration-id: ${INTEGRATION_IDENTIFIER}'`,
        },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const idempotencyHeader = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!idempotencyHeader || !uuidRegex.test(idempotencyHeader)) {
      return NextResponse.json(
        { success: false, error: "Idempotency-Key must be a valid UUID" },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const idempotencyKey = idempotencyHeader;

    const body = await req.json();
    const parsed = createTransferSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.format() },
        { status: 400, headers: rateLimit.headers }
      );
    }

    const client = getMultiHopperClient(
      (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet-beta") || "devnet"
    );

    const transfer = await client.createTransfer(parsed.data, idempotencyKey);

    return NextResponse.json(
      {
        success: true,
        transfer,
      },
      { status: 201, headers: rateLimit.headers }
    );
  } catch (err: unknown) {
    captureException(err, { endpoint: "/api/transfers", method: "POST" });
    const errorMsg = err instanceof Error ? err.message : "Create transfer failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
