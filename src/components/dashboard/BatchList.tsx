"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, ChevronRight, Key, Eye } from "lucide-react";

export interface PayoutItemDetailData {
  id: string;
  recipientWallet: string;
  recipientName?: string;
  amountFormatted: string;
  amountRaw: string;
  status: string;
  screeningStatus?: string;
  payoutSignature?: string;
}

export interface BatchItemData {
  id: string;
  title: string;
  tokenSymbol: string;
  tokenDecimals?: number;
  tokenMint?: string;
  totalAmountFormatted: string;
  totalAmountRaw?: string;
  recipientCount: number;
  status: string;
  network: string;
  hops?: number;
  arrivalSeconds?: number;
  chunksCount: number;
  chunks: Array<{
    id?: string;
    chunkIndex: number;
    externalId: string;
    recipientCount: number;
    amountRaw: string;
    status: string;
    multihopperId?: string;
    keeperFundingSignature?: string;
    attempts?: number;
  }>;
  items?: PayoutItemDetailData[];
  createdAt: string;
  updatedAt?: string;
  approvals?: Array<{
    id: string;
    batchId: string;
    approverWallet: string;
    role: string;
    approvedAt: string;
    notes?: string;
  }>;
  approvalEvaluation?: {
    isApproved: boolean;
    requiredApprovals: number;
    currentCount: number;
    remainingApprovals: number;
    approverWallets: string[];
    rejectionReason?: string;
  } | null;
}

interface BatchListProps {
  batches: BatchItemData[];
  onCreateBatch: () => void;
  onSelectBatch?: (batchId: string) => void;
  onSignBatch?: (batch: BatchItemData) => void;
}

export function BatchList({
  batches,
  onCreateBatch,
  onSelectBatch,
  onSignBatch,
}: BatchListProps) {
  const getStatusBadge = (batch: BatchItemData) => {
    if (batch.approvalEvaluation && !batch.approvalEvaluation.isApproved && batch.status === "draft") {
      return (
        <Badge variant="warning" className="text-[11px]">
          Awaiting Approval ({batch.approvalEvaluation.currentCount}/{batch.approvalEvaluation.requiredApprovals})
        </Badge>
      );
    }

    switch (batch.status) {
      case "completed":
        return <Badge variant="success">Completed</Badge>;
      case "processing":
      case "active":
        return <Badge variant="info">Processing Hops</Badge>;
      case "awaiting_signature":
      case "pending_signature":
        return <Badge variant="warning">Awaiting Signature</Badge>;
      case "failed":
        return <Badge variant="danger">Failed</Badge>;
      default:
        return <Badge variant="outline">{batch.status}</Badge>;
    }
  };

  return (
    <Card className="border-zinc-800/80 bg-zinc-900/60">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-400" />
              <CardTitle>Treasury Payout Batches & Transfer Chunks</CardTitle>
            </div>
            <CardDescription className="pt-1">
              Batches exceeding 20 destinations are automatically partitioned into discrete MultiHopper transfers.
            </CardDescription>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={onCreateBatch}
            className="gap-1.5 self-start sm:self-auto shadow-md shadow-indigo-600/30"
          >
            <span>+ New Payout Batch</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {batches.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-zinc-800 rounded-lg">
            <Layers className="h-8 w-8 text-zinc-500 mx-auto mb-2 opacity-50" />
            <p className="text-sm text-zinc-400 font-medium">No payout batches created yet</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
              Create a batch or upload a recipient CSV to test MultiHopper&apos;s automatic 20-destination chunking.
            </p>
            <Button variant="outline" size="sm" onClick={onCreateBatch} className="mt-4">
              Create First Batch
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => (
              <div
                key={batch.id}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/40 hover:border-zinc-700/80 transition-colors cursor-pointer group"
                onClick={() => onSelectBatch?.(batch.id)}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-white text-sm group-hover:text-indigo-300 transition-colors">
                        {batch.title}
                      </span>
                      {getStatusBadge(batch)}
                      <Badge variant="outline" className="text-[10px] uppercase font-mono py-0">
                        {batch.network}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-400">
                      <span>
                        Total: <strong className="text-white">{batch.totalAmountFormatted} {batch.tokenSymbol}</strong>
                      </span>
                      <span>•</span>
                      <span>{batch.recipientCount} Recipients</span>
                      <span>•</span>
                      <span className="text-indigo-400 font-medium">
                        {batch.chunksCount} MultiHopper {batch.chunksCount === 1 ? "Chunk" : "Chunks"}
                      </span>
                    </div>
                  </div>

                  {/* Chunks overview & Action buttons */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {batch.chunks.map((chk) => (
                        <div
                          key={chk.chunkIndex}
                          className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-mono flex items-center gap-1"
                        >
                          <span className="text-zinc-500">#{chk.chunkIndex + 1}</span>
                          <span className="text-zinc-300">{chk.recipientCount} dests</span>
                          <span className="text-emerald-400">({chk.status})</span>
                        </div>
                      ))}
                    </div>

                    {batch.approvalEvaluation && !batch.approvalEvaluation.isApproved ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectBatch?.(batch.id);
                        }}
                        className="gap-1.5 text-xs min-h-[44px] px-3 border-amber-600/60 bg-amber-950/20 text-amber-300 hover:bg-amber-900/40"
                        aria-label={`Review and approve batch ${batch.title}`}
                      >
                        <span>Approve ({batch.approvalEvaluation.currentCount}/{batch.approvalEvaluation.requiredApprovals})</span>
                      </Button>
                    ) : (batch.status === "draft" || batch.status === "awaiting_signature") && onSignBatch && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSignBatch(batch);
                        }}
                        className="gap-1.5 text-xs min-h-[44px] px-3 font-semibold"
                        aria-label={`Sign batch ${batch.title}`}
                      >
                        <Key className="h-3.5 w-3.5" />
                        <span>Sign</span>
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectBatch?.(batch.id);
                      }}
                      className="text-zinc-300 hover:text-white text-xs min-h-[44px] px-3 gap-1.5 hover:bg-zinc-800"
                      aria-label={`View details for batch ${batch.title}`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>View</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
