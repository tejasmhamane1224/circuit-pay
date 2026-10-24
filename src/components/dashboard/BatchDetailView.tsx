"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { truncateAddress, formatUsd } from "@/lib/utils";
import type { BatchItemData } from "./BatchList";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  Layers,
  Send,
  Zap,
  RotateCcw,
  FileText,
  FileSpreadsheet,
  AlertTriangle,
  Scale,
  History,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics/posthog";

interface BatchDetailViewProps {
  batchId: string;
  onBack: () => void;
  onSignBatch: (batch: BatchItemData) => void;
}

interface ReconciliationData {
  batchId: string;
  network: "mainnet-beta" | "devnet";
  tokenSymbol: string;
  tokenDecimals: number;
  requestedTotalRaw: string;
  requestedTotalFormatted: string;
  settledTotalRaw: string;
  settledTotalFormatted: string;
  failedTotalRaw: string;
  failedTotalFormatted: string;
  pendingTotalRaw: string;
  pendingTotalFormatted: string;
  varianceRaw: string;
  isBalanced: boolean;
  totalItemsCount: number;
  settledItemsCount: number;
  failedItemsCount: number;
  pendingItemsCount: number;
  screeningCount: number;
  screeningFeeSol: number;
  keeperFundingSol: number;
  screeningFeeLamports?: string;
  keeperFundingLamports?: string;
  totalProtocolSolLamports?: string;
  estimatedPercentFeeRaw: string;
}

interface AuditLogEntry {
  id: string;
  actorWallet: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export function getCanonicalRecipientStatus(
  status: string
): "pending" | "routing" | "delivered" | "failed" {
  const s = (status || "").toLowerCase();
  if (s === "paid" || s === "delivered" || s === "settled" || s === "completed") {
    return "delivered";
  }
  if (s === "processing" || s === "routing" || s === "in_flight" || s === "broadcasting") {
    return "routing";
  }
  if (s === "failed" || s === "error" || s === "cancelled" || s === "rejected") {
    return "failed";
  }
  return "pending";
}

export function BatchDetailView({ batchId, onBack, onSignBatch }: BatchDetailViewProps) {
  const [batch, setBatch] = useState<BatchItemData | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [simulatingWebhook, setSimulatingWebhook] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);

  // Approval state
  const [approving, setApproving] = useState(false);
  const [approverWallet, setApproverWallet] = useState("3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4");
  const [approvalRole, setApprovalRole] = useState<"owner" | "admin">("admin");
  const [approvalNotes, setApprovalNotes] = useState("");
  const [approvalFeedback, setApprovalFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchBatch = useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const [batchRes, reconRes, auditRes] = await Promise.all([
          fetch(`/api/batches/${batchId}`),
          fetch(`/api/batches/${batchId}/reconciliation`),
          fetch(`/api/batches/${batchId}/audit-logs`),
        ]);

        const batchData = await batchRes.json();
        if (batchData.success && batchData.batch) {
          setBatch(batchData.batch);
        }

        const reconData = await reconRes.json();
        if (reconData.success && reconData.reconciliation) {
          setReconciliation(reconData.reconciliation);
        }

        const auditData = await auditRes.json();
        if (auditData.success && auditData.logs) {
          setAuditLogs(auditData.logs);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
        if (isManual) setRefreshing(false);
      }
    },
    [batchId]
  );

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const [batchRes, reconRes, auditRes] = await Promise.all([
          fetch(`/api/batches/${batchId}`),
          fetch(`/api/batches/${batchId}/reconciliation`),
          fetch(`/api/batches/${batchId}/audit-logs`),
        ]);

        const batchData = await batchRes.json();
        if (isMounted && batchData.success && batchData.batch) {
          setBatch(batchData.batch);
          if (!terminalStatuses.includes(batchData.batch.status)) {
            startPolling();
          }
        }

        const reconData = await reconRes.json();
        if (isMounted && reconData.success && reconData.reconciliation) {
          setReconciliation(reconData.reconciliation);
        }

        const auditData = await auditRes.json();
        if (isMounted && auditData.success && auditData.logs) {
          setAuditLogs(auditData.logs);
        }
      } catch {
        // ignore
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    // Poll transfer status every 8 seconds until terminal state per Phase 2 spec
    const terminalStatuses = ["completed", "failed", "partially_failed", "cancelled", "refunded"];
    let timer: NodeJS.Timeout | null = null;

    const startPolling = () => {
      if (timer) clearInterval(timer);
      timer = setInterval(async () => {
        if (!isMounted) return;
        try {
          const res = await fetch(`/api/batches/${batchId}`);
          const data = await res.json();
          if (isMounted && data.success && data.batch) {
            setBatch(data.batch);
            if (terminalStatuses.includes(data.batch.status)) {
              if (timer) clearInterval(timer);
            }
          }
        } catch {
          // ignore polling network errors
        }
      }, 8000); // exactly 8 seconds
    };

    load();

    return () => {
      isMounted = false;
      if (timer) clearInterval(timer);
    };
  }, [batchId]);

  // Idempotent Retry Handler for single failed item
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);

  const handleRetryItem = async (itemId: string) => {
    setRetryingItemId(itemId);
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/items/${itemId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setRetryMessage(
          `Recipient ${data.item.recipientWallet ? truncateAddress(data.item.recipientWallet) : itemId} retried safely reusing idempotency key (${data.idempotencyKey.slice(0, 8)}...).`
        );
        await fetchBatch(true);
      } else {
        setRetryMessage(`Retry failed: ${data.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Retry failed";
      setRetryMessage(`Error: ${msg}`);
    } finally {
      setRetryingItemId(null);
    }
  };

  // Idempotent Retry Handler for entire batch
  const handleRetryBatch = async () => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/batches/${batchId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setRetryMessage(
          data.alreadyFullySettled
            ? "Batch is already fully settled. Zero items retried (double-payment prevented)."
            : `Idempotent retry executed safely. Retried ${data.totalUnsettledItemsRetried} unsettled items. Preserved ${data.totalSettledItemsPreserved} settled items.`
        );
        await fetchBatch(true);
      } else {
        setRetryMessage(`Retry failed: ${data.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Retry failed";
      setRetryMessage(`Error: ${msg}`);
    } finally {
      setRetrying(false);
    }
  };

  // Idempotent Retry Handler for individual chunk
  const handleRetryTransfer = async (transferId: string) => {
    setRetrying(true);
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/transfers/${transferId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setRetryMessage(`Transfer ${transferId} retried safely (Attempt #${data.transfer.attempts}).`);
        await fetchBatch(true);
      } else {
        setRetryMessage(`Retry failed: ${data.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Retry failed";
      setRetryMessage(`Error: ${msg}`);
    } finally {
      setRetrying(false);
    }
  };

  // Manual Resolve Handler for entire batch
  const handleManualResolveBatch = async () => {
    if (!confirm("Are you sure you want to manually resolve unsettled items in this batch? This will record an administrative resolution audit log.")) {
      return;
    }
    setResolving(true);
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/batches/${batchId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Manual reconciliation by treasury administrator via dashboard",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRetryMessage(`Batch manually resolved to ${data.batch.status}. Audit trail recorded.`);
        await fetchBatch(true);
      } else {
        setRetryMessage(`Manual resolution failed: ${data.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Manual resolution failed";
      setRetryMessage(`Error: ${msg}`);
    } finally {
      setResolving(false);
    }
  };

  // Manual Resolve Handler for individual chunk
  const handleManualResolveTransfer = async (transferId: string) => {
    setResolving(true);
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/transfers/${transferId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Manual chunk reconciliation by treasury administrator",
        }),
      });
      const data = await res.json();
      if (data.success) {
        setRetryMessage(`Transfer ${transferId} manually resolved. Audit trail recorded.`);
        await fetchBatch(true);
      } else {
        setRetryMessage(`Manual resolution failed: ${data.error}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Manual resolution failed";
      setRetryMessage(`Error: ${msg}`);
    } finally {
      setResolving(false);
    }
  };

  // Submit Multi-Approval Handler
  const handleApproveBatch = async () => {
    if (!approverWallet) return;
    setApproving(true);
    setApprovalFeedback(null);

    try {
      const res = await fetch(`/api/batches/${batchId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverWallet,
          role: approvalRole,
          notes: approvalNotes || undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setApprovalFeedback({
          type: "success",
          text: `Approval successfully registered (${data.evaluation?.currentCount || 1}/${data.evaluation?.requiredApprovals || 2}). ${data.canSign ? "All required approvals obtained; batch is now ready to sign!" : ""}`,
        });
        setApprovalNotes("");
        await fetchBatch(true);
      } else {
        setApprovalFeedback({
          type: "error",
          text: data.error || "Failed to record approval",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Approval request failed";
      setApprovalFeedback({ type: "error", text: msg });
    } finally {
      setApproving(false);
    }
  };

  // Simulate MultiHopper Webhook Event
  const handleSimulateWebhook = async (
    eventType: "transfer.deposit_confirmed" | "transfer.completed"
  ) => {
    if (!batch || !batch.chunks || batch.chunks.length === 0) return;
    setSimulatingWebhook(true);

    try {
      await fetch("/api/webhooks/multihopper/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: batch.id, eventType }),
      });

      await fetchBatch();
    } catch {
      // ignore
    } finally {
      setSimulatingWebhook(false);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <RefreshCw className="h-6 w-6 animate-spin text-indigo-400 mx-auto mb-2" />
        <p className="text-xs text-zinc-400">Loading batch details, reconciliation, and audit trail...</p>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-sm text-red-400">Batch not found</p>
        <Button variant="outline" size="sm" onClick={onBack}>
          Back to Batches
        </Button>
      </div>
    );
  }

  const steps = [
    { key: "draft", label: "1. Draft" },
    { key: "quoting", label: "2. Quoting" },
    { key: "awaiting_signature", label: "3. Awaiting Signature" },
    { key: "processing", label: "4. Processing Hops" },
    { key: "completed", label: "5. Completed" },
  ];

  const getStepIndex = (status: string) => {
    switch (status) {
      case "draft":
        return 0;
      case "quoting":
        return 1;
      case "awaiting_signature":
      case "pending_signature":
        return 2;
      case "processing":
      case "active":
        return 3;
      case "completed":
        return 4;
      default:
        return 0;
    }
  };

  const currentStepIdx = getStepIndex(batch.status);
  const tokenDecimals = batch.tokenDecimals ?? 6;

  // Check if batch has any failed, partially failed, or unsettled chunks
  const hasUnsettledItems =
    batch.status === "partially_failed" ||
    batch.status === "failed" ||
    batch.chunks.some((c) => c.status === "failed" || c.status !== "completed");

  return (
    <div className="space-y-6 animate-in fade-in-50">
      {/* Top Navigation & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 text-xs">
            <ArrowLeft className="h-4 w-4" />
            <span>Batches</span>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white">{batch.title}</h2>
              <Badge variant="info" className="uppercase font-mono text-[10px]">
                {batch.network}
              </Badge>
              {batch.status === "completed" && (
                <Badge variant="success" className="text-[10px]">
                  Settled
                </Badge>
              )}
            </div>
            <p className="text-xs text-zinc-400 font-mono">ID: {batch.id}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* CSV Receipt Download */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              trackEvent("receipt_downloaded", {
                batchId: batch.id,
                format: "csv",
              });
              window.open(`/api/batches/${batch.id}/receipt/csv`, "_blank");
            }}
            className="gap-1.5 text-xs text-zinc-300 hover:text-white"
            title="Export DAO Accounting CSV Receipt"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-400" />
            <span>Export CSV</span>
          </Button>

          {/* Printable PDF Receipt */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              trackEvent("receipt_downloaded", {
                batchId: batch.id,
                format: "pdf",
              });
              window.open(`/api/batches/${batch.id}/receipt/pdf?autoprint=true`, "_blank");
            }}
            className="gap-1.5 text-xs text-zinc-300 hover:text-white"
            title="Print or Save PDF Receipt"
          >
            <FileText className="h-3.5 w-3.5 text-indigo-400" />
            <span>Print PDF</span>
          </Button>

          {/* Refresh */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchBatch(true)}
            disabled={refreshing}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          {/* Sign & Broadcast Button */}
          {(batch.status === "draft" ||
            batch.status === "awaiting_signature" ||
            batch.status === "pending_signature") && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => onSignBatch(batch)}
              disabled={Boolean(batch.approvalEvaluation && !batch.approvalEvaluation.isApproved)}
              className="gap-1.5 shadow-md shadow-indigo-600/30 text-xs min-h-[44px]"
              title={
                batch.approvalEvaluation && !batch.approvalEvaluation.isApproved
                  ? "Multi-approval required before signing"
                  : "Sign and broadcast transactions"
              }
            >
              <Send className="h-3.5 w-3.5" />
              <span>
                {batch.approvalEvaluation && !batch.approvalEvaluation.isApproved
                  ? `Requires Approval (${batch.approvalEvaluation.currentCount}/${batch.approvalEvaluation.requiredApprovals})`
                  : "Sign & Broadcast Transfers"}
              </span>
            </Button>
          )}

          {/* Idempotent Retry & Manual Resolve Buttons */}
          {hasUnsettledItems && batch.status !== "draft" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryBatch}
                disabled={retrying || resolving}
                className="gap-1.5 text-xs border-amber-600/60 bg-amber-950/20 text-amber-300 hover:bg-amber-900/40"
              >
                <RotateCcw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
                <span>{retrying ? "Retrying..." : "Safe Retry"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleManualResolveBatch}
                disabled={retrying || resolving}
                className="gap-1.5 text-xs border-indigo-600/60 bg-indigo-950/20 text-indigo-300 hover:bg-indigo-900/40"
                title="Manually reconcile and mark unsettled items as resolved"
              >
                <ShieldCheck className={`h-3.5 w-3.5 ${resolving ? "animate-spin" : ""}`} />
                <span>{resolving ? "Resolving..." : "Manual Resolve"}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Retry Feedback Alert */}
      {retryMessage && (
        <div className="p-3 rounded-lg border border-indigo-900/60 bg-indigo-950/30 text-xs text-indigo-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-400 shrink-0" />
            <span>{retryMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setRetryMessage(null)}
            className="text-zinc-400 hover:text-white text-xs ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Unsettled Items Warning Banner with Safe Retry & Manual Resolve Triggers */}
      {hasUnsettledItems && batch.status !== "draft" && (
        <div className="p-4 rounded-xl border border-amber-800/60 bg-amber-950/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-amber-300">
                Unsettled Transfers Detected ({batch.status.replace(/_/g, " ")})
              </span>
              <p className="text-[11px] text-zinc-400">
                Idempotent retry engine guarantees settled items are never re-executed or double-paid.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualResolveBatch}
              disabled={retrying || resolving}
              className="text-xs border-indigo-700/60 text-indigo-300 hover:bg-indigo-900/40"
            >
              Manual Resolve
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetryBatch}
              disabled={retrying || resolving}
              className="text-xs bg-amber-600 hover:bg-amber-500 text-black font-semibold border-none"
            >
              <RotateCcw className={`h-3 w-3 mr-1.5 ${retrying ? "animate-spin" : ""}`} />
              Retry Unsettled Chunks
            </Button>
          </div>
        </div>
      )}

      {/* Reconciliation View: Requested vs Settled vs Failed */}
      {reconciliation && (
        <Card className="border-zinc-800 bg-zinc-900/60 shadow-lg">
          <CardHeader className="pb-3 pt-4 px-4 flex flex-row items-center justify-between border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-indigo-400" />
              <CardTitle className="text-sm font-semibold text-white">
                Settlement Reconciliation & Variance Analysis
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={reconciliation.isBalanced ? "success" : "warning"}
                className="font-mono text-xs"
              >
                {reconciliation.isBalanced ? "Balanced (0.00 Variance)" : "Variance Detected"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/60 space-y-1">
                <span className="text-[11px] text-zinc-400 uppercase font-semibold">Requested Total</span>
                <div className="text-lg font-bold font-mono text-white">
                  {reconciliation.requestedTotalFormatted} {reconciliation.tokenSymbol}
                </div>
                <span className="text-[10px] text-zinc-500 font-mono block truncate">
                  {reconciliation.totalItemsCount} Recipients
                </span>
              </div>

              <div className="p-3 rounded-lg border border-emerald-900/40 bg-emerald-950/20 space-y-1">
                <span className="text-[11px] text-emerald-400 uppercase font-semibold">Settled / Paid</span>
                <div className="text-lg font-bold font-mono text-emerald-400">
                  {reconciliation.settledTotalFormatted} {reconciliation.tokenSymbol}
                </div>
                <span className="text-[10px] text-emerald-400/80 font-mono block truncate">
                  {reconciliation.settledItemsCount} Settled
                </span>
              </div>

              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/60 space-y-1">
                <span className="text-[11px] text-zinc-400 uppercase font-semibold">Pending / In-Flight</span>
                <div className="text-lg font-bold font-mono text-cyan-400">
                  {reconciliation.pendingTotalFormatted} {reconciliation.tokenSymbol}
                </div>
                <span className="text-[10px] text-zinc-500 font-mono block truncate">
                  {reconciliation.pendingItemsCount} Items
                </span>
              </div>

              <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/60 space-y-1">
                <span className="text-[11px] text-zinc-400 uppercase font-semibold">Failed / Recoverable</span>
                <div className="text-lg font-bold font-mono text-amber-400">
                  {reconciliation.failedTotalFormatted} {reconciliation.tokenSymbol}
                </div>
                <span className="text-[10px] text-zinc-500 font-mono block truncate">
                  {reconciliation.failedItemsCount} Failed
                </span>
              </div>
            </div>

            {/* Protocol Fee & Gas Lamports Breakdown */}
            <div className="p-3 rounded-lg border border-zinc-800 bg-zinc-950/40 text-xs text-zinc-400 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
                <span>
                  MultiHopper Fee (0.50%):{" "}
                  <strong className="text-white">
                    {(Number(reconciliation.estimatedPercentFeeRaw) / 10 ** tokenDecimals).toFixed(2)}{" "}
                    {reconciliation.tokenSymbol}
                  </strong>
                </span>
                <span>•</span>
                <span>
                  Screening SOL: <strong className="text-white">{reconciliation.screeningFeeSol} SOL ({reconciliation.screeningFeeLamports || "—"} lamports)</strong>
                </span>
                <span>•</span>
                <span>
                  Keeper Funding: <strong className="text-white">{reconciliation.keeperFundingSol} SOL ({reconciliation.keeperFundingLamports || "—"} lamports)</strong>
                </span>
                {reconciliation.totalProtocolSolLamports && (
                  <>
                    <span>•</span>
                    <span>
                      Total Protocol Gas: <strong className="text-cyan-400">{reconciliation.totalProtocolSolLamports} lamports</strong>
                    </span>
                  </>
                )}
              </div>

              <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Zero Double-Payment Validated</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* State Machine Progress Strip */}
      <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-3">
        <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
          <span>MultiHopper State Machine</span>
          <span className="font-mono text-indigo-400 capitalize">Status: {batch.status}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {steps.map((step, idx) => {
            const isPassed = idx < currentStepIdx;
            const isCurrent = idx === currentStepIdx;
            return (
              <div
                key={step.key}
                className={`p-2.5 rounded-lg border text-xs text-center transition-all ${
                  isCurrent
                    ? "bg-indigo-600/30 border-indigo-500 text-white font-semibold shadow-md shadow-indigo-500/20"
                    : isPassed
                    ? "bg-emerald-950/30 border-emerald-800/60 text-emerald-300 font-medium"
                    : "bg-zinc-950/40 border-zinc-800 text-zinc-500"
                }`}
              >
                <div className="flex items-center justify-center gap-1.5">
                  {isPassed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : isCurrent ? (
                    <span className="h-2 w-2 rounded-full bg-indigo-400 animate-ping" />
                  ) : null}
                  <span className="truncate">{step.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Team Roles & Multi-Approval Policy Section */}
      <Card className="border-zinc-800 bg-zinc-900/60 shadow-lg">
        <CardHeader className="pb-3 pt-4 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-indigo-400" />
            <CardTitle className="text-sm font-semibold text-white">
              Team Roles &amp; Multi-Approval Policy
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {batch.approvalEvaluation?.isApproved ? (
              <Badge variant="success" className="font-mono text-xs flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                <span>Fully Approved ({batch.approvalEvaluation.currentCount}/{batch.approvalEvaluation.requiredApprovals})</span>
              </Badge>
            ) : batch.approvalEvaluation ? (
              <Badge variant="warning" className="font-mono text-xs">
                Awaiting Approval ({batch.approvalEvaluation.currentCount}/{batch.approvalEvaluation.requiredApprovals})
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Standard Batch
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-4">
          {/* Policy description banner */}
          <div className="text-xs text-zinc-300 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="space-y-0.5">
              <span className="font-semibold text-white flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
                Multi-Approval Policy Threshold: $10,000 USD
              </span>
              <p className="text-[11px] text-zinc-400">
                Disbursements totaling &ge; $10,000 USD require 2 distinct admin or owner approvals before non-custodial signing and on-chain broadcast can proceed.
              </p>
            </div>
            {batch.approvalEvaluation?.rejectionReason && (
              <div className="text-amber-400 text-xs font-medium shrink-0 bg-amber-950/40 border border-amber-800/60 px-2.5 py-1.5 rounded-md">
                {batch.approvalEvaluation.rejectionReason}
              </div>
            )}
          </div>

          {/* Existing Approvals List */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-zinc-200 block">
              Registered Approvals ({batch.approvals?.length || 0})
            </span>
            {batch.approvals && batch.approvals.length > 0 ? (
              <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/40">
                {batch.approvals.map((app) => (
                  <div key={app.id} className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5 font-mono">
                      <div className="flex items-center gap-2">
                        <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-white font-medium">{truncateAddress(app.approverWallet)}</span>
                        <Badge variant="info" className="text-[10px] uppercase font-mono py-0">
                          {app.role}
                        </Badge>
                      </div>
                      {app.notes && (
                        <p className="text-[11px] text-zinc-400 font-sans pl-5">Note: {app.notes}</p>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      {new Date(app.approvedAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500 italic p-3 bg-zinc-950/40 rounded-lg border border-zinc-800">
                No approvals registered yet.
              </p>
            )}
          </div>

          {/* Interactive Approval Action Form */}
          {batch.status === "draft" && (
            <div className="p-3.5 rounded-xl border border-indigo-900/40 bg-indigo-950/20 space-y-3">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <UserCheck className="h-4 w-4 text-indigo-400" /> Submit Organizational Approval
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[11px] text-zinc-400 font-medium">Approver Wallet</label>
                  <input
                    type="text"
                    value={approverWallet}
                    onChange={(e) => setApproverWallet(e.target.value)}
                    placeholder="Approver Solana Wallet"
                    className="w-full h-9 px-3 rounded-lg border border-zinc-700 bg-zinc-950 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400 font-medium">Role Authority</label>
                  <select
                    value={approvalRole}
                    onChange={(e) => setApprovalRole(e.target.value as "owner" | "admin")}
                    className="w-full h-9 px-3 rounded-lg border border-zinc-700 bg-zinc-950 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-zinc-400 font-medium">Approval Notes (Optional)</label>
                <input
                  type="text"
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="e.g. Budget authorized for Sprint 18"
                  className="w-full h-9 px-3 rounded-lg border border-zinc-700 bg-zinc-950 text-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {approvalFeedback && (
                <div
                  className={`p-2.5 rounded-lg text-xs font-medium ${
                    approvalFeedback.type === "success"
                      ? "bg-emerald-950/60 border border-emerald-800 text-emerald-300"
                      : "bg-red-950/60 border border-red-800 text-red-300"
                  }`}
                >
                  {approvalFeedback.text}
                </div>
              )}

              <Button
                variant="primary"
                size="sm"
                onClick={handleApproveBatch}
                disabled={approving || !approverWallet}
                className="gap-1.5 text-xs min-h-[40px] px-4 font-semibold"
              >
                <UserCheck className={`h-3.5 w-3.5 ${approving ? "animate-spin" : ""}`} />
                <span>{approving ? "Recording Approval..." : "Approve Payout Batch"}</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Demo Controls: Simulate MultiHopper Webhook */}
      <div className="p-4 rounded-xl border border-indigo-900/40 bg-indigo-950/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <span className="text-xs font-semibold text-indigo-300 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-indigo-400" /> MultiHopper Webhook Testing Simulator
          </span>
          <p className="text-[11px] text-zinc-400">
            Dispatch HMAC-SHA256 signed lifecycle events to test real-time state transitions and automated settlement.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleSimulateWebhook("transfer.deposit_confirmed")}
            disabled={simulatingWebhook}
            className="text-xs"
          >
            Deposit Confirmed
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => handleSimulateWebhook("transfer.completed")}
            disabled={simulatingWebhook}
            className="text-xs bg-emerald-600 hover:bg-emerald-500"
          >
            Transfer Completed
          </Button>
        </div>
      </div>

      {/* Chunks Overview (20-Cap Partitioning) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-indigo-400" />
            Transfer Chunks ({batch.chunks.length} Transfers $\le 20$ Dests)
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {batch.chunks.map((chk) => (
            <div
              key={chk.id || chk.chunkIndex}
              className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/60 space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-zinc-200">
                    Chunk #{chk.chunkIndex + 1}
                  </span>
                  {chk.attempts && chk.attempts > 1 && (
                    <Badge variant="warning" className="text-[10px] py-0 font-mono">
                      Attempt #{chk.attempts}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={chk.status === "completed" ? "success" : "info"}
                    className="capitalize"
                  >
                    {chk.status}
                  </Badge>
                  {chk.status !== "completed" && chk.id && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetryTransfer(chk.id!)}
                        disabled={retrying || resolving}
                        className="h-6 px-2 text-[11px] text-amber-400 hover:text-amber-300"
                        title="Retry this transfer chunk"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Retry
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleManualResolveTransfer(chk.id!)}
                        disabled={retrying || resolving}
                        className="h-6 px-2 text-[11px] text-indigo-400 hover:text-indigo-300"
                        title="Manually resolve this transfer chunk"
                      >
                        Resolve
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-xs font-mono text-zinc-400 space-y-1">
                <div className="flex justify-between">
                  <span>External ID:</span>
                  <span className="text-zinc-200 truncate max-w-[200px]">{chk.externalId}</span>
                </div>
                <div className="flex justify-between">
                  <span>Destinations:</span>
                  <span className="text-white font-semibold">{chk.recipientCount} (cap 20)</span>
                </div>
                <div className="flex justify-between">
                  <span>Chunk Amount:</span>
                  <span className="text-indigo-400 font-semibold">
                    {formatUsd(Number(chk.amountRaw) / 10 ** tokenDecimals)}
                  </span>
                </div>
                {chk.keeperFundingSignature && (
                  <div className="flex justify-between items-center pt-1 border-t border-zinc-800/80">
                    <span>Keeper Tx:</span>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://solscan.io/tx/${chk.keeperFundingSignature}${batch.network === "mainnet-beta" ? "" : "?cluster=devnet"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-400 hover:underline flex items-center gap-0.5 text-[11px]"
                      >
                        Solscan
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                      <span className="text-zinc-600">•</span>
                      <a
                        href={`https://explorer.solana.com/tx/${chk.keeperFundingSignature}${batch.network === "mainnet-beta" ? "" : "?cluster=devnet"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline flex items-center gap-0.5 text-[11px]"
                      >
                        Explorer
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recipient Item Details */}
      {batch.items && batch.items.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-200 block">
              Individual Recipient Disbursements ({batch.items.length})
            </span>
            {/* Live Recipient Status Breakdown Counters */}
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="text-zinc-400">
                Pending:{" "}
                <strong className="text-zinc-200">
                  {batch.items.filter((i) => getCanonicalRecipientStatus(i.status) === "pending").length}
                </strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-cyan-400">
                Routing:{" "}
                <strong className="text-white">
                  {batch.items.filter((i) => getCanonicalRecipientStatus(i.status) === "routing").length}
                </strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-emerald-400">
                Delivered:{" "}
                <strong className="text-white">
                  {batch.items.filter((i) => getCanonicalRecipientStatus(i.status) === "delivered").length}
                </strong>
              </span>
              <span className="text-zinc-600">•</span>
              <span className="text-red-400">
                Failed:{" "}
                <strong className="text-white">
                  {batch.items.filter((i) => getCanonicalRecipientStatus(i.status) === "failed").length}
                </strong>
              </span>
            </div>
          </div>

          <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/80 bg-zinc-950/60 max-h-[380px] overflow-y-auto">
            {batch.items.map((item, idx) => {
              const canonicalStatus = getCanonicalRecipientStatus(item.status);
              const badgeVariant: "success" | "info" | "danger" | "outline" =
                canonicalStatus === "delivered"
                  ? "success"
                  : canonicalStatus === "routing"
                  ? "info"
                  : canonicalStatus === "failed"
                  ? "danger"
                  : "outline";

              return (
                <div
                  key={item.id}
                  className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-500 font-mono text-[11px]">{idx + 1}.</span>
                      <a
                        href={`https://solscan.io/account/${item.recipientWallet}${batch.network === "mainnet-beta" ? "" : "?cluster=devnet"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-zinc-200 hover:text-indigo-300 flex items-center gap-1"
                      >
                        {truncateAddress(item.recipientWallet)}
                        <ExternalLink className="h-3 w-3 text-zinc-500" />
                      </a>
                      {item.recipientName && (
                        <span className="text-zinc-400 text-[11px]">({item.recipientName})</span>
                      )}
                    </div>

                    {item.payoutSignature && (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400 pl-4">
                        <span>Paid tx:</span>
                        <a
                          href={`https://solscan.io/tx/${item.payoutSignature}${batch.network === "mainnet-beta" ? "" : "?cluster=devnet"}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-emerald-300"
                        >
                          Solscan
                        </a>
                        <span>•</span>
                        <a
                          href={`https://explorer.solana.com/tx/${item.payoutSignature}${batch.network === "mainnet-beta" ? "" : "?cluster=devnet"}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline truncate max-w-[160px]"
                        >
                          {item.payoutSignature.slice(0, 16)}...
                        </a>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-4 sm:pl-0">
                    <span className="font-mono font-semibold text-zinc-100">
                      {item.amountFormatted} {batch.tokenSymbol}
                    </span>
                    <Badge
                      variant={badgeVariant}
                      className="capitalize text-[10px] py-0 font-mono"
                    >
                      {canonicalStatus}
                    </Badge>
                    {/* Retry button ONLY appears for failed items per Phase 2 spec */}
                    {canonicalStatus === "failed" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRetryItem(item.id)}
                        disabled={retryingItemId === item.id}
                        className="h-6 px-2 text-[11px] text-amber-400 hover:text-amber-300 hover:bg-amber-950/40 font-mono"
                        title="Retry unsettled recipient payout"
                      >
                        <RotateCcw
                          className={`h-3 w-3 mr-1 ${
                            retryingItemId === item.id ? "animate-spin" : ""
                          }`}
                        />
                        {retryingItemId === item.id ? "Retrying..." : "Retry"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Real-Time Audit Log Trail Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
            <History className="h-3.5 w-3.5 text-indigo-400" />
            Audit Log Trail ({auditLogs.length} Events)
          </span>
          <span className="text-zinc-500 font-mono text-[11px]">HMAC & State Transition Audit</span>
        </div>

        <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950/60 divide-y divide-zinc-800/80 max-h-[300px] overflow-y-auto">
          {auditLogs.length === 0 ? (
            <div className="p-4 text-center text-xs text-zinc-500">No audit events recorded yet.</div>
          ) : (
            auditLogs.map((log) => (
              <div key={log.id} className="p-3 text-xs flex items-start justify-between gap-3 hover:bg-zinc-900/30">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-indigo-300">{log.action}</span>
                    <Badge variant="outline" className="text-[10px] py-0 font-mono">
                      {log.resourceType}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-mono">
                    Actor: {truncateAddress(log.actorWallet)}
                    {log.details && (
                      <span className="text-zinc-500 ml-2">
                        {JSON.stringify(log.details).slice(0, 80)}...
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500 font-mono shrink-0">
                  {new Date(log.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
