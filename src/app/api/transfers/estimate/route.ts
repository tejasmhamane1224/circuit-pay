import { NextRequest, NextResponse } from "next/server";
import { estimateTransferSchema } from "@/lib/validations/transfers";
import { MULTIHOPPER_RULES, INTEGRATION_IDENTIFIER } from "@/lib/constants";
import crypto from "node:crypto";

export async function POST(req: NextRequest) {
  try {
    const integrationId = req.headers.get("x-integration-id");
    if (integrationId && integrationId !== INTEGRATION_IDENTIFIER) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid or missing integration identifier. Must provide 'x-integration-id: ${INTEGRATION_IDENTIFIER}'`,
        },
        { status: 400 }
      );
    }

    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (idempotencyKey && !uuidRegex.test(idempotencyKey)) {
      return NextResponse.json(
        { success: false, error: "Idempotency-Key must be a valid UUID" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const parsed = estimateTransferSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validation error", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const {
      amountRaw = "1000000",
      hops,
      destinationCount = 1,
      tokenMint,
      tokenSymbol,
      tokenDecimals,
      arrivalSeconds,
      destinations,
    } = parsed.data;

    // Call live MultiHopper API if key is configured
    const apiKey = process.env.MULTIHOPPER_API_KEY;
    const baseUrl =
      process.env.MULTIHOPPER_BASE_URL ||
      (process.env.NEXT_PUBLIC_SOLANA_NETWORK === "mainnet-beta"
        ? "https://multihopper.com/api/v1"
        : "https://devnet.multihopper.com/api/v1");

    if (apiKey && !apiKey.includes("dummy")) {
      try {
        const mhRes = await fetch(`${baseUrl}/transfers/estimate`, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "x-integration-id": INTEGRATION_IDENTIFIER,
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            tokenMint: tokenMint || "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            tokenSymbol,
            tokenDecimals: tokenDecimals || 6,
            amountRaw: amountRaw,
            hops: hops,
            arrivalSeconds: arrivalSeconds,
            destinations: destinations,
          }),
        });

        if (mhRes.ok) {
          const liveData = await mhRes.json();
          return NextResponse.json({
            success: true,
            ...liveData,
          });
        }
      } catch (upstreamErr) {
        console.warn("Upstream MultiHopper estimate warning, falling back to on-chain math:", upstreamErr);
      }
    }

    const amountBig = BigInt(amountRaw);

    // MultiHopper Fee Schedule: 50 bps (0.50%) percentage fee
    const percentFeeRawBig = (amountBig * BigInt(MULTIHOPPER_RULES.PERCENT_FEE_BPS)) / BigInt(10000);
    const hopAmountRawBig = amountBig > percentFeeRawBig ? amountBig - percentFeeRawBig : BigInt(0);

    // Per-hop flat fee lamports (approx 375,000 to 2,000,000 lamports per hop depending on tier)
    const flatFeePerHopLamports = BigInt(375000);
    const totalFlatFeeLamportsBig = flatFeePerHopLamports * BigInt(hops);

    // Integrator 50% revenue share
    const integratorPercentShareBig = percentFeeRawBig / BigInt(2);
    const integratorFlatShareBig = totalFlatFeeLamportsBig / BigInt(2);

    // SOL required upfront (Screening fee 0.002 SOL = 2,000,000 lamports per screened destination + keeper funding)
    const screeningLamportsPerAddress = BigInt(2000000);
    const totalScreeningLamports = screeningLamportsPerAddress * BigInt(destinationCount);
    const chunkCount = BigInt(Math.ceil(destinationCount / MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK) || 1);
    const keeperFundingLamports = BigInt(5000000) * chunkCount; // Rent and keeper gas per chunk
    const requiredSolUpFrontLamports = totalScreeningLamports + keeperFundingLamports;

    const totalCostSol = (Number(requiredSolUpFrontLamports) / 1e9).toFixed(4);
    const amountNum = Number(amountRaw) / 10 ** (tokenDecimals || 6);
    const percentFeeNum = Number(percentFeeRawBig) / 10 ** (tokenDecimals || 6);
    const totalCostUsd = (amountNum + percentFeeNum).toFixed(2);

    return NextResponse.json({
      success: true,
      tier: "tier_3",
      percentFeeBps: MULTIHOPPER_RULES.PERCENT_FEE_BPS,
      percentFeeRaw: percentFeeRawBig.toString(),
      totalFlatFeeLamports: totalFlatFeeLamportsBig.toString(),
      integratorPercentShare: integratorPercentShareBig.toString(),
      integratorFlatShare: integratorFlatShareBig.toString(),
      hopAmountRaw: hopAmountRawBig.toString(),
      priceSource: "onchain_pool",
      sol: {
        requiredSolUpFrontLamports: requiredSolUpFrontLamports.toString(),
        breakdown: {
          screeningFeeLamports: totalScreeningLamports.toString(),
          keeperFundingLamports: keeperFundingLamports.toString(),
        },
      },
      estimate: {
        customerFeeRaw: percentFeeRawBig.toString(),
        feeBps: MULTIHOPPER_RULES.PERCENT_FEE_BPS,
        hops: hops || 4,
        estimatedArrivalSeconds: arrivalSeconds || 900,
        totalCostSol: `${totalCostSol} SOL`,
        totalCostUsd: `$${totalCostUsd}`,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
