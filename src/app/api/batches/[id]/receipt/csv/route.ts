import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const batch = await payoutStore.getPayoutBatch(id);

    if (!batch) {
      return NextResponse.json(
        { success: false, error: `Batch ${id} not found` },
        { status: 404 }
      );
    }

    // Record audit log for DAO accounting export
    await payoutStore.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet: batch.senderWallet,
      action: "receipt.export_csv",
      resourceType: "payout_batch",
      resourceId: batch.id,
      details: {
        exportType: "csv_dao_reconciliation",
        recipientCount: batch.items.length,
        totalAmountFormatted: batch.totalAmountFormatted,
      },
    });

    const isMainnet = batch.network === "mainnet-beta";
    const explorerCluster = isMainnet ? "mainnet" : "devnet";
    const solscanCluster = isMainnet ? "" : "?cluster=devnet";

    const recon = await payoutStore.getSettlementReconciliation(batch.id);

    // CSV Header formatted for DAO Bookkeeping & ERP reconciliation
    const headers = [
      "Batch ID",
      "Batch Title",
      "Network",
      "Status",
      "Token Symbol",
      "Token Mint",
      "Total Batch Amount",
      "Created At (UTC)",
      "Updated At (UTC)",
      "Sender Wallet",
      "Sender Solscan Link",
      "Chunk Index",
      "MultiHopper Transfer ID",
      "Chunk Status",
      "Keeper Tx Signature",
      "Keeper Solscan Link",
      "Recipient Wallet",
      "Recipient Name",
      "Amount Formatted",
      "Amount Raw",
      "Disbursement Status",
      "Payout Tx Signature",
      "Solscan Link",
      "Solana Explorer Link",
      "Screening Status",
    ];

    const rows: string[][] = [];

    // Map each payout item with its associated chunk details
    for (const item of batch.items) {
      const parentChunk = batch.transfers.find((t) => t.id === item.transferId);
      const chunkIdx = parentChunk ? (parentChunk.chunkIndex + 1).toString() : "1";
      const mhId = parentChunk?.multihopperId || "N/A";
      const chunkStatus = parentChunk?.status || "N/A";
      const keeperSig = parentChunk?.keeperFundingSignature || "N/A";
      const keeperSolscan = parentChunk?.keeperFundingSignature
        ? `https://solscan.io/tx/${parentChunk.keeperFundingSignature}${solscanCluster}`
        : "N/A";
      const payoutSig = item.payoutSignature || "N/A";
      const payoutSolscan = item.payoutSignature
        ? `https://solscan.io/tx/${item.payoutSignature}${solscanCluster}`
        : "N/A";
      const explorerLink = item.payoutSignature
        ? `https://explorer.solana.com/tx/${item.payoutSignature}?cluster=${explorerCluster}`
        : "N/A";
      const senderSolscan = `https://solscan.io/account/${batch.senderWallet}${solscanCluster}`;

      rows.push([
        `"${batch.id}"`,
        `"${batch.title.replace(/"/g, '""')}"`,
        `"${batch.network}"`,
        `"${batch.status}"`,
        `"${batch.tokenSymbol}"`,
        `"${batch.tokenMint}"`,
        `"${batch.totalAmountFormatted}"`,
        `"${batch.createdAt}"`,
        `"${batch.updatedAt}"`,
        `"${batch.senderWallet}"`,
        `"${senderSolscan}"`,
        `"${chunkIdx}"`,
        `"${mhId}"`,
        `"${chunkStatus}"`,
        `"${keeperSig}"`,
        `"${keeperSolscan}"`,
        `"${item.recipientWallet}"`,
        `"${(item.recipientName || "").replace(/"/g, '""')}"`,
        `"${item.amountFormatted}"`,
        `"${item.amountRaw}"`,
        `"${item.status}"`,
        `"${payoutSig}"`,
        `"${payoutSolscan}"`,
        `"${explorerLink}"`,
        `"${item.screeningStatus}"`,
      ]);
    }

    // Append DAO Accounting Summary Section
    const summaryLines = [
      "",
      "# ==========================================================================",
      "# DAO TREASURY RECONCILIATION & AUDIT SUMMARY",
      "# ==========================================================================",
      `# Batch ID,${batch.id}`,
      `# Batch Title,"${batch.title.replace(/"/g, '""')}"`,
      `# Batch Status,${batch.status}`,
      `# Total Requested Amount,${recon?.requestedTotalFormatted || batch.totalAmountFormatted} ${batch.tokenSymbol}`,
      `# Total Settled Amount,${recon?.settledTotalFormatted || "0.00"} ${batch.tokenSymbol}`,
      `# Total Failed Amount,${recon?.failedTotalFormatted || "0.00"} ${batch.tokenSymbol}`,
      `# Total Pending Amount,${recon?.pendingTotalFormatted || "0.00"} ${batch.tokenSymbol}`,
      `# Reconciliation Variance (Delta Raw),${recon?.varianceRaw || "0"} (Balanced: ${recon?.isBalanced ?? true})`,
      `# MultiHopper Protocol Fee (0.50%),${recon ? (Number(recon.estimatedPercentFeeRaw) / 10 ** (batch.tokenDecimals ?? 6)).toFixed(4) : "0.0000"} ${batch.tokenSymbol}`,
      `# Recipient Screening SOL,${recon?.screeningFeeSol ?? 0} SOL (${recon?.screeningFeeLamports ?? "0"} lamports)`,
      `# Keeper Funding SOL,${recon?.keeperFundingSol ?? 0} SOL (${recon?.keeperFundingLamports ?? "0"} lamports)`,
      `# Total Protocol Gas Lamports,${recon?.totalProtocolSolLamports ?? "0"} lamports`,
      `# Settlement Completed Timestamp (UTC),${batch.status === "completed" ? batch.updatedAt : "Pending Settlement"}`,
    ];

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(",")), ...summaryLines].join("\r\n");

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="circuitpay-receipt-${batch.id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "CSV generation failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
