import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import { MULTIHOPPER_RULES } from "@/lib/constants";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const networkFilter = searchParams.get("network") || "all";
    const windowFilter = searchParams.get("window") || "all";

    let ledger = payoutStore.getVolumeLedger();

    if (networkFilter === "mainnet-beta") {
      ledger = ledger.filter((l) => l.isMainnet);
    } else if (networkFilter === "devnet") {
      ledger = ledger.filter((l) => !l.isMainnet);
    }

    const now = Date.now();
    if (windowFilter === "7d") {
      const cutoff = now - 7 * 86400000;
      ledger = ledger.filter((l) => new Date(l.verifiedAt).getTime() >= cutoff);
    } else if (windowFilter === "30d") {
      const cutoff = now - 30 * 86400000;
      ledger = ledger.filter((l) => new Date(l.verifiedAt).getTime() >= cutoff);
    } else if (windowFilter === "challenge") {
      const start = new Date("2026-10-01T00:00:00Z").getTime();
      const end = new Date("2026-12-14T21:59:59Z").getTime();
      ledger = ledger.filter((l) => {
        const t = new Date(l.verifiedAt).getTime();
        return t >= start && t <= end;
      });
    }

    // Record audit log for official Earn CSV export
    await payoutStore.recordAuditLog({
      actorWallet: "system",
      action: "evidence.export_earn_csv",
      resourceType: "volume_ledger",
      resourceId: "superteam_earn_submission",
      details: {
        networkFilter,
        windowFilter,
        exportedEntriesCount: ledger.length,
      },
    });

    const headers = [
      "MultiHopper Transfer ID",
      "Network",
      "Verified Timestamp (UTC)",
      "Token Mint",
      "Token Symbol",
      "Principal Volume (USD)",
      "Collected MultiHopper Fee (USD)",
      "Challenge Formula",
      "Qualifying Volume (USD)",
      "Integrator Share 50% (USD)",
      "Eligibility Status",
      "Transaction Signatures",
      "Solscan Link",
      "Solana Explorer Link",
    ];

    const rows: string[][] = await Promise.all(
      ledger.map(async (entry) => {
        const isMainnet = entry.isMainnet;
        const cluster = isMainnet ? "" : "?cluster=devnet";
        const eligibility = isMainnet
          ? "QUALIFIED - Solana Mainnet Production Transfer"
          : "EXCLUDED - Devnet Transfer ($0 Qualifying Volume)";
        const solscanLink = isMainnet
          ? `https://solscan.io/account/${entry.multihopperId}`
          : `https://solscan.io/account/${entry.multihopperId}?cluster=devnet`;
        const explorerLink = `https://explorer.solana.com/address/${entry.multihopperId}${cluster}`;

        // Collect transaction signatures if available
        const txSignatures: string[] = [];
        if (entry.transferId) {
          const transfer = await payoutStore.getTransferByIdOrExternal(entry.transferId);
          if (transfer) {
            if (transfer.keeperFundingSignature) txSignatures.push(`keeper:${transfer.keeperFundingSignature}`);
            if (transfer.routeInitSignatures) {
              txSignatures.push(...transfer.routeInitSignatures.map((s: string) => `route:${s}`));
            }
            if (transfer.items) {
              for (const it of transfer.items) {
                if (it.payoutSignature) txSignatures.push(`payout:${it.payoutSignature}`);
              }
            }
          }
        }
        const signaturesStr = txSignatures.length > 0 ? txSignatures.join("; ") : "N/A";

        return [
          `"${entry.multihopperId}"`,
          `"${entry.network}"`,
          `"${entry.verifiedAt}"`,
          `"${entry.tokenMint}"`,
          `"${entry.tokenSymbol}"`,
          `"${entry.principalAmountUsd}"`,
          `"${entry.collectedFeeUsd}"`,
          `"collected_fees / ${MULTIHOPPER_RULES.QUALIFYING_VOLUME_FEE_DIVISOR}"`,
          `"${entry.qualifyingVolumeUsd}"`,
          `"${entry.integratorFeeShareUsd}"`,
          `"${eligibility}"`,
          `"${signaturesStr}"`,
          `"${solscanLink}"`,
          `"${explorerLink}"`,
        ];
      })
    );

    // Summary calculations for Superteam Earn judges
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
    const thresholdMet = totalQualifyingVolumeUsd >= MULTIHOPPER_RULES.MIN_QUALIFYING_VOLUME_USD;

    const summaryLines = [
      "",
      "# ==========================================================================",
      "# SUPERTEAM EARN MULTIHOPPER BUILD AND ROUTE CHALLENGE SUBMISSION SUMMARY",
      "# ==========================================================================",
      "# Challenge Name,Superteam Earn MultiHopper Build and Route Challenge ($50,000 Bounty)",
      "# Official Formula,qualifying_volume = collected_fees / 0.0025",
      `# Target Qualifying Volume Threshold,$${MULTIHOPPER_RULES.MIN_QUALIFYING_VOLUME_USD.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`,
      `# Total Mainnet Qualifying Volume (USD),$${totalQualifyingVolumeUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`,
      `# Total Collected Protocol Fees (USD),$${totalCollectedFeesUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`,
      `# Total Integrator 50% Share (USD),$${totalIntegratorFeeShareUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`,
      `# Total Production Principal Volume (USD),$${totalPrincipalVolumeUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} USD`,
      `# Target $100k Threshold Met?,${thresholdMet ? "YES (QUALIFIED FOR $50,000 BOUNTY POOL)" : "NO"}`,
      `# Verified Mainnet Production Transfers Count,${mainnetEntries.length}`,
      `# Export Timestamp (UTC),${new Date().toISOString()}`,
    ];

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(",")), ...summaryLines].join("\r\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="superteam-earn-qualifying-volume-submission.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Evidence CSV generation failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
