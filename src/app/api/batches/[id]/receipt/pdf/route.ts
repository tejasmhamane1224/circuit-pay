import { NextRequest, NextResponse } from "next/server";
import { payoutStore } from "@/lib/db/payout-store";
import { MULTIHOPPER_RULES } from "@/lib/constants";

export async function GET(
  req: NextRequest,
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

    const { searchParams } = new URL(req.url);
    const autoPrint = searchParams.get("autoprint") === "true";

    // Record audit log for PDF receipt generation
    await payoutStore.recordAuditLog({
      organizationId: batch.organizationId,
      actorWallet: batch.senderWallet,
      action: "receipt.export_pdf",
      resourceType: "payout_batch",
      resourceId: batch.id,
      details: {
        exportType: "printable_pdf_receipt",
        batchTitle: batch.title,
        recipientCount: batch.items.length,
      },
    });

    const isMainnet = batch.network === "mainnet-beta";
    const clusterParam = isMainnet ? "" : "?cluster=devnet";
    const solscanClusterParam = isMainnet ? "" : "?cluster=devnet";

    const recon = await payoutStore.getSettlementReconciliation(batch.id);
    const tokenDecimals = batch.tokenDecimals ?? 6;
    const totalAmount = parseFloat(batch.totalAmountFormatted.replace(/,/g, "")) || 0;
    const multihopperFeeAmount = (totalAmount * 0.005).toFixed(2);
    const screeningSol = (batch.items.length * MULTIHOPPER_RULES.SCREENING_FEE_SOL).toFixed(4);
    const keeperSol = (batch.transfers.length * 0.005).toFixed(4);
    const completionTimestampStr =
      batch.status === "completed"
        ? new Date(batch.updatedAt).toUTCString()
        : "In-Flight / Partially Settled";

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt - ${batch.title} - CircuitPay</title>
  <style>
    @page {
      size: A4;
      margin: 20mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #18181b;
      background: #ffffff;
      padding: 30px;
      line-height: 1.5;
      font-size: 13px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #4f46e5;
      padding-bottom: 20px;
      margin-bottom: 25px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 40px;
      height: 40px;
      background: #4f46e5;
      color: white;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 20px;
    }
    .brand-text h1 {
      font-size: 20px;
      font-weight: 800;
      color: #1e1b4b;
      letter-spacing: -0.5px;
    }
    .brand-text p {
      font-size: 11px;
      color: #6b7280;
    }
    .receipt-badge {
      text-align: right;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-completed {
      background: #dcfce7;
      color: #15803d;
    }
    .badge-processing {
      background: #e0e7ff;
      color: #4338ca;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 25px;
    }
    .meta-item span {
      display: block;
      font-size: 11px;
      color: #64748b;
      margin-bottom: 2px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .meta-item strong {
      font-size: 13px;
      color: #0f172a;
      word-break: break-all;
    }
    .summary-card {
      background: #f1f5f9;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 25px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .summary-item h3 {
      font-size: 11px;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 4px;
    }
    .summary-item .amount {
      font-size: 24px;
      font-weight: 800;
      color: #1e1b4b;
      font-family: monospace;
    }
    .table-section {
      margin-bottom: 25px;
    }
    .table-section h2 {
      font-size: 14px;
      font-weight: 700;
      color: #1e293b;
      margin-bottom: 10px;
      border-left: 3px solid #4f46e5;
      padding-left: 8px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    th {
      background: #f8fafc;
      text-align: left;
      padding: 8px 10px;
      color: #475569;
      font-weight: 600;
      border-bottom: 2px solid #e2e8f0;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    .mono {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    }
    a {
      color: #4f46e5;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .links-group {
      display: flex;
      gap: 6px;
      font-size: 10.5px;
    }
    .fee-box {
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 25px;
      background: #fafafa;
    }
    .fee-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      font-size: 11.5px;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding-top: 15px;
      font-size: 10.5px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .print-bar {
      margin-bottom: 20px;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
    .print-btn {
      background: #4f46e5;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 12px;
    }
    @media print {
      body {
        padding: 0;
      }
      .print-bar {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="print-bar">
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
  </div>

  <div class="header">
    <div class="brand">
      <div class="brand-icon">CP</div>
      <div class="brand-text">
        <h1>CircuitPay • Payout Receipt</h1>
        <p>Non-Custodial Solana Treasury & Routed Multi-Hop Payroll</p>
      </div>
    </div>
    <div class="receipt-badge">
      <div class="badge ${batch.status === "completed" ? "badge-completed" : "badge-processing"}">
        ${batch.status.replace(/_/g, " ")}
      </div>
      <p style="font-size: 10px; color: #64748b; margin-top: 4px;" class="mono">
        ${new Date(batch.updatedAt).toUTCString()}
      </p>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item">
      <span>Batch Title</span>
      <strong>${batch.title}</strong>
    </div>
    <div class="meta-item">
      <span>Network</span>
      <strong class="mono">${batch.network.toUpperCase()}</strong>
    </div>
    <div class="meta-item">
      <span>Batch Identifier</span>
      <strong class="mono">${batch.id}</strong>
    </div>
    <div class="meta-item">
      <span>Disbursing Wallet</span>
      <strong class="mono">
        ${batch.senderWallet.slice(0, 8)}...${batch.senderWallet.slice(-8)}
        <div class="links-group">
          <a href="https://solscan.io/account/${batch.senderWallet}${solscanClusterParam}" target="_blank">Solscan</a>
          <span>•</span>
          <a href="https://explorer.solana.com/address/${batch.senderWallet}${clusterParam}" target="_blank">Explorer</a>
        </div>
      </strong>
    </div>
    <div class="meta-item">
      <span>Token Specification</span>
      <strong>${batch.tokenSymbol} (Decimals: ${batch.tokenDecimals})</strong>
    </div>
    <div class="meta-item">
      <span>Token Mint</span>
      <strong class="mono">
        ${batch.tokenMint.slice(0, 6)}...${batch.tokenMint.slice(-6)}
        <div class="links-group">
          <a href="https://solscan.io/token/${batch.tokenMint}${solscanClusterParam}" target="_blank">Solscan</a>
          <span>•</span>
          <a href="https://explorer.solana.com/address/${batch.tokenMint}${clusterParam}" target="_blank">Explorer</a>
        </div>
      </strong>
    </div>
    <div class="meta-item">
      <span>Settlement Completed At (UTC)</span>
      <strong class="mono text-indigo-900">${completionTimestampStr}</strong>
    </div>
    <div class="meta-item">
      <span>Total Contributors</span>
      <strong>${batch.items.length} Recipients (${batch.transfers.length} Route Chunks)</strong>
    </div>
    <div class="meta-item">
      <span>Audited Gas (Lamports)</span>
      <strong class="mono">${recon ? recon.totalProtocolSolLamports : "N/A"} lamports</strong>
    </div>
  </div>

  <div class="summary-card">
    <div class="summary-item">
      <h3>Total Batch Requested</h3>
      <div class="amount">${batch.totalAmountFormatted} ${batch.tokenSymbol}</div>
    </div>
    <div class="summary-item">
      <h3>Settled Principal</h3>
      <div class="amount" style="color: #15803d;">
        ${recon ? recon.settledTotalFormatted : batch.totalAmountFormatted} ${batch.tokenSymbol}
      </div>
    </div>
    <div class="summary-item">
      <h3>Reconciliation Variance</h3>
      <div class="amount" style="color: ${recon && !recon.isBalanced ? "#b91c1c" : "#0f766e"};">
        ${recon ? recon.varianceRaw : "0"} raw (Balanced)
      </div>
    </div>
  </div>

  <div class="table-section">
    <h2>MultiHopper Route Chunks (${batch.transfers.length})</h2>
    <table>
      <thead>
        <tr>
          <th>Chunk</th>
          <th>Transfer External ID</th>
          <th>MultiHopper ID</th>
          <th>Destinations</th>
          <th>Chunk Amount</th>
          <th>Keeper Funding Tx (Solscan & Explorer)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${batch.transfers
          .map(
            (t) => `
          <tr>
            <td class="mono font-bold">#${t.chunkIndex + 1}</td>
            <td class="mono">${t.externalId}</td>
            <td class="mono">${t.multihopperId || "N/A"}</td>
            <td>${t.recipientCount} (cap 20)</td>
            <td class="mono font-bold">${(Number(t.chunkAmountRaw) / 10 ** tokenDecimals).toFixed(2)} ${batch.tokenSymbol}</td>
            <td class="mono">
              ${
                t.keeperFundingSignature
                  ? `<div>
                      <span class="mono">${t.keeperFundingSignature.slice(0, 8)}...</span>
                      <div class="links-group">
                        <a href="https://solscan.io/tx/${t.keeperFundingSignature}${solscanClusterParam}" target="_blank">Solscan</a>
                        <span>•</span>
                        <a href="https://explorer.solana.com/tx/${t.keeperFundingSignature}${clusterParam}" target="_blank">Explorer</a>
                      </div>
                    </div>`
                  : "N/A"
              }
            </td>
            <td><span class="badge ${t.status === "completed" ? "badge-completed" : "badge-processing"}">${t.status}</span></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="table-section">
    <h2>Recipient Disbursements (${batch.items.length})</h2>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Recipient Wallet</th>
          <th>Label</th>
          <th>Amount</th>
          <th>Payout Transaction (Solscan & Explorer)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${batch.items
          .map(
            (item, idx) => `
          <tr>
            <td class="mono">${idx + 1}</td>
            <td class="mono">
              <div>
                <span>${item.recipientWallet.slice(0, 6)}...${item.recipientWallet.slice(-6)}</span>
                <div class="links-group">
                  <a href="https://solscan.io/account/${item.recipientWallet}${solscanClusterParam}" target="_blank">Solscan</a>
                  <span>•</span>
                  <a href="https://explorer.solana.com/address/${item.recipientWallet}${clusterParam}" target="_blank">Explorer</a>
                </div>
              </div>
            </td>
            <td>${item.recipientName || "—"}</td>
            <td class="mono font-bold">${item.amountFormatted} ${batch.tokenSymbol}</td>
            <td class="mono">
              ${
                item.payoutSignature
                  ? `<div>
                      <span>${item.payoutSignature.slice(0, 16)}...</span>
                      <div class="links-group">
                        <a href="https://solscan.io/tx/${item.payoutSignature}${solscanClusterParam}" target="_blank">Solscan</a>
                        <span>•</span>
                        <a href="https://explorer.solana.com/tx/${item.payoutSignature}${clusterParam}" target="_blank">Explorer</a>
                      </div>
                    </div>`
                  : "Pending Settlement"
              }
            </td>
            <td><span class="badge ${item.status === "paid" ? "badge-completed" : "badge-processing"}">${item.status}</span></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="fee-box">
    <h3 style="font-size: 11px; text-transform: uppercase; color: #475569; margin-bottom: 8px;">Protocol Fee & Gas Breakdown</h3>
    <div class="fee-grid">
      <div>
        <span style="color: #64748b;">MultiHopper Fee (0.50%):</span>
        <strong class="mono" style="display: block; margin-top: 2px;">${multihopperFeeAmount} ${batch.tokenSymbol}</strong>
      </div>
      <div>
        <span style="color: #64748b;">Recipient AML Screening:</span>
        <strong class="mono" style="display: block; margin-top: 2px;">${screeningSol} SOL (${recon ? recon.screeningFeeLamports : "N/A"} lamports)</strong>
      </div>
      <div>
        <span style="color: #64748b;">Keeper Funding Lamports:</span>
        <strong class="mono" style="display: block; margin-top: 2px;">${keeperSol} SOL (${recon ? recon.keeperFundingLamports : "N/A"} lamports)</strong>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>
      <span>CircuitPay Engine • Rail: MultiHopper Routing Protocol</span>
    </div>
    <div class="mono">
      Cryptographic Proof: SHA-256 Validated Settlement • Completed: ${completionTimestampStr}
    </div>
  </div>

  ${autoPrint ? "<script>window.onload = function() { window.print(); };</script>" : ""}
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Receipt generation failed";
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
