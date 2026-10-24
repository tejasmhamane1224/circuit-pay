import { NextRequest, NextResponse } from "next/server";
import { calculateQualifyingVolume } from "@/lib/multihopper/volume";
import { MULTIHOPPER_RULES } from "@/lib/constants";
import { payoutStore } from "@/lib/db/payout-store";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
  const networkParam = searchParams.get("network") || "all";
  const windowParam = searchParams.get("window") || "all";
  const feeUsdParam = searchParams.get("feeUsd");

  // If a specific feeUsd was passed, calculate custom qualifying volume directly
  if (feeUsdParam !== null) {
    const feeUsd = parseFloat(feeUsdParam || "250");
    const network = searchParams.get("network") || "mainnet-beta";
    const result = calculateQualifyingVolume(feeUsd, network, true);

    return NextResponse.json({
      success: true,
      challenge: "Superteam Earn MultiHopper Build and Route Challenge",
      targetThresholdUsd: MULTIHOPPER_RULES.MIN_QUALIFYING_VOLUME_USD,
      formula: "qualifying_volume = collected_fees / 0.0025",
      network,
      metrics: result,
    });
  }

  // Fetch actual volume ledger
  let ledger = payoutStore.getVolumeLedger();

  // Filter by network
  if (networkParam === "mainnet-beta") {
    ledger = ledger.filter((l) => l.isMainnet);
  } else if (networkParam === "devnet") {
    ledger = ledger.filter((l) => !l.isMainnet);
  }

  // Filter by measurement window
  const now = Date.now();
  if (windowParam === "7d") {
    const cutoff = now - 7 * 86400000;
    ledger = ledger.filter((l) => new Date(l.verifiedAt).getTime() >= cutoff);
  } else if (windowParam === "30d") {
    const cutoff = now - 30 * 86400000;
    ledger = ledger.filter((l) => new Date(l.verifiedAt).getTime() >= cutoff);
  } else if (windowParam === "challenge") {
    // Challenge Window: Oct 1, 2026 to Dec 14, 2026
    const start = new Date("2026-10-01T00:00:00Z").getTime();
    const end = new Date("2026-12-14T21:59:59Z").getTime();
    ledger = ledger.filter((l) => {
      const t = new Date(l.verifiedAt).getTime();
      return t >= start && t <= end;
    });
  }

  // Aggregate qualifying volume math:
  // Mainnet only counts toward Qualifying Volume = collected_fees / 0.0025
  const mainnetEntries = ledger.filter((l) => l.isMainnet);
  const totalCollectedFeesUsd = mainnetEntries.reduce(
    (sum, l) => sum + (parseFloat(l.collectedFeeUsd) || 0),
    0
  );
  const totalQualifyingVolumeUsd = totalCollectedFeesUsd / MULTIHOPPER_RULES.QUALIFYING_VOLUME_FEE_DIVISOR;
  const totalIntegratorFeeShareUsd = totalCollectedFeesUsd * MULTIHOPPER_RULES.INTEGRATOR_SHARE_PERCENT;
  const totalPrincipalVolumeUsd = ledger.reduce(
    (sum, l) => sum + (parseFloat(l.principalAmountUsd) || 0),
    0
  );

  const targetThresholdUsd = MULTIHOPPER_RULES.MIN_QUALIFYING_VOLUME_USD;
  const progressPercent = Math.min(100, (totalQualifyingVolumeUsd / targetThresholdUsd) * 100);
  const thresholdMet = totalQualifyingVolumeUsd >= targetThresholdUsd;

  const batches = await payoutStore.listPayoutBatches();
  const batchesVolumeUsd = batches.reduce(
    (sum, b) => sum + (parseFloat(b.totalAmountFormatted.replace(/,/g, "")) || 0),
    0
  );
  const totalVolumeProcessedUsd = Math.max(totalPrincipalVolumeUsd, batchesVolumeUsd);
  // Fees saved vs standard 2.50% custodial wire rail (2.50% - 0.50% = 2.00% net saved)
  const feesSavedUsd = totalVolumeProcessedUsd * 0.02;
  const totalRecipientsCount = batches.reduce((sum, b) => sum + b.items.length, 0);

  return NextResponse.json({
    success: true,
    challenge: "Superteam Earn MultiHopper Build and Route Challenge",
    deadline: "2026-12-14T21:59:59Z",
    formula: "qualifying_volume = collected_fees / 0.0025",
    targetThresholdUsd,
    metrics: {
      volumeProcessedUsd: totalVolumeProcessedUsd,
      feesSavedUsd,
      batchesCount: batches.length,
      recipientsCount: totalRecipientsCount,
      totalQualifyingVolumeUsd,
      totalCollectedFeesUsd,
      totalIntegratorFeeShareUsd,
      totalPrincipalVolumeUsd,
      progressPercent,
      thresholdMet,
      productionMainnetTransfersCount: mainnetEntries.length,
      totalEntriesCount: ledger.length,
    },
    ledger,
  });
  } catch (err: unknown) {
    console.error("Error in /api/volume GET handler:", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
