"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CsvImportModal } from "./CsvImportModal";
import { FeeRoutePreview } from "./FeeRoutePreview";
import { chunkPayoutDestinations } from "@/lib/multihopper/chunker";
import { MULTIHOPPER_RULES } from "@/lib/constants";
import { formatUsd } from "@/lib/utils";
import { X, Plus, Trash2, Zap, Layers, Upload, Loader2 } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { trackEvent } from "@/lib/analytics/posthog";
import type { BatchItemData } from "./BatchList";

interface CreateBatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBatchCreated: (batch: BatchItemData) => void;
}

export function CreateBatchModal({ isOpen, onClose, onBatchCreated }: CreateBatchModalProps) {
  const [title, setTitle] = useState("Engineering Sprint Payout");
  const [tokenSymbol, setTokenSymbol] = useState("USDC");
  const [hops, setHops] = useState(4);
  const [arrivalSeconds, setArrivalSeconds] = useState(900);
  const [recipients, setRecipients] = useState<Array<{ recipientWallet: string; amountFormatted: string; recipientName?: string }>>([
    { recipientWallet: "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4", amountFormatted: "250.00", recipientName: "Alice" },
    { recipientWallet: "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u", amountFormatted: "350.00", recipientName: "Bob" },
  ]);

  const [isCsvModalOpen, setIsCsvModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalAmount = recipients.reduce((sum, r) => sum + (parseFloat(r.amountFormatted) || 0), 0);

  // Auto-chunking
  const destinationInputs = recipients.map((r) => ({
    wallet: r.recipientWallet,
    amountRaw: Math.round((parseFloat(r.amountFormatted) || 0) * 10 ** 6).toString(),
    recipientName: r.recipientName,
  }));

  const chunks = chunkPayoutDestinations(
    "temp_batch",
    destinationInputs,
    MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK
  );

  const handleAddRecipient = () => {
    if (recipients.length >= 500) {
      setError("Batch recipient cap reached (maximum 500 recipients allowed per batch).");
      return;
    }
    setRecipients([
      ...recipients,
      { recipientWallet: "", amountFormatted: "100.00", recipientName: "" },
    ]);
  };

  const handleRemoveRecipient = (idx: number) => {
    setRecipients(recipients.filter((_, i) => i !== idx));
  };

  const handleCsvImport = (validRecipients: Array<{ recipientWallet: string; amountFormatted: string; recipientName?: string }>) => {
    if (validRecipients.length > 500) {
      setError("Imported recipients exceed the 500 recipient cap per batch. Truncated to 500.");
      setRecipients(validRecipients.slice(0, 500));
    } else {
      setRecipients(validRecipients);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (recipients.length === 0) return;

    if (recipients.length > 500) {
      setError("Maximum 500 recipients allowed per batch UI-side. Please reduce recipient count.");
      return;
    }

    // 1. Base58 validation
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const addr = r.recipientWallet.trim();
      if (!addr) {
        setError(`Row #${i + 1}: Missing recipient wallet address.`);
        return;
      }
      try {
        new PublicKey(addr);
      } catch {
        setError(`Row #${i + 1}: Invalid Solana Base58 public key format ('${addr}').`);
        return;
      }
    }

    // 2. Reject duplicate recipient addresses UI-side
    const walletMap = new Map<string, number[]>();
    for (let i = 0; i < recipients.length; i++) {
      const addr = recipients[i].recipientWallet.trim();
      const existing = walletMap.get(addr) || [];
      existing.push(i + 1);
      walletMap.set(addr, existing);
    }

    for (const [wallet, rows] of walletMap.entries()) {
      if (rows.length > 1) {
        setError(`Duplicate recipient address detected: ${wallet} (on rows ${rows.join(", ")}). Each recipient address must be unique.`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          tokenMint:
            tokenSymbol === "SOL"
              ? "So11111111111111111111111111111111111111112"
              : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          tokenSymbol,
          tokenDecimals: tokenSymbol === "SOL" ? 9 : 6,
          network: process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet",
          hops,
          arrivalSeconds,
          items: recipients,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Failed to create payout batch");
      }

      trackEvent("batch_created", {
        batchId: data.batch.id,
        totalAmount: data.batch.totalAmountFormatted,
        recipientCount: data.batch.recipientCount,
        hops,
        tokenSymbol,
      });

      onBatchCreated(data.batch);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-batch-modal-title"
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-50"
      >
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center">
                <Layers className="h-5 w-5 text-indigo-400" />
              </div>
              <div>
                <h2 id="create-batch-modal-title" className="text-base font-semibold text-white">Create MultiHopper Payout Batch</h2>
                <p className="text-xs text-zinc-400">
                  Non-custodial routing with automatic 20-destination smart contract partitioning
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="text-zinc-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-zinc-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">Batch Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. October Contractor Payroll"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">Token</label>
                <select
                  value={tokenSymbol}
                  onChange={(e) => setTokenSymbol(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-700 bg-zinc-950 text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="USDC">USDC (Token2022 / SPL)</option>
                  <option value="SOL">SOL (SolVault)</option>
                </select>
              </div>
            </div>

            {/* CSV Import Banner */}
            <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white block">CSV Recipient Import</span>
                <span className="text-[11px] text-zinc-400">
                  Upload CSV or paste addresses with strict line-by-line Base58 validation
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCsvModalOpen(true)}
                className="gap-1.5 text-xs font-mono"
              >
                <Upload className="h-3.5 w-3.5 text-indigo-400" />
                <span>Import CSV / Paste</span>
              </Button>
            </div>

            {/* Fee & Route Preview Component */}
            <FeeRoutePreview
              recipientCount={recipients.length}
              totalAmountFormatted={totalAmount.toFixed(2)}
              tokenSymbol={tokenSymbol}
              tokenDecimals={tokenSymbol === "SOL" ? 9 : 6}
              hops={hops}
              arrivalSeconds={arrivalSeconds}
              onHopsChange={setHops}
              onArrivalSecondsChange={setArrivalSeconds}
            />

            {/* Recipients List Editor */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-200">
                  Payout Recipients ({recipients.length})
                </label>
                <div className="flex items-center gap-2">
                  {recipients.length >= 500 && (
                    <span className="text-[11px] font-mono text-amber-400">Cap Reached (500 max)</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleAddRecipient}
                    disabled={recipients.length >= 500}
                    className="text-xs gap-1 text-indigo-400 hover:text-indigo-300"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Row
                  </Button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {recipients.map((recipient, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-zinc-500 font-mono w-5">{idx + 1}.</span>
                    <Input
                      value={recipient.recipientWallet}
                      onChange={(e) => {
                        const updated = [...recipients];
                        updated[idx].recipientWallet = e.target.value;
                        setRecipients(updated);
                      }}
                      placeholder="Solana Base58 Wallet Address"
                      className="font-mono text-xs flex-1"
                      required
                    />
                    <Input
                      value={recipient.recipientName || ""}
                      onChange={(e) => {
                        const updated = [...recipients];
                        updated[idx].recipientName = e.target.value;
                        setRecipients(updated);
                      }}
                      placeholder="Name"
                      className="text-xs w-24 hidden sm:block"
                    />
                    <Input
                      value={recipient.amountFormatted}
                      onChange={(e) => {
                        const updated = [...recipients];
                        updated[idx].amountFormatted = e.target.value;
                        setRecipients(updated);
                      }}
                      placeholder="Amount"
                      className="font-mono text-xs w-28 text-right"
                      required
                    />
                    {recipients.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveRecipient(idx)}
                        className="text-zinc-500 hover:text-red-400 h-9 w-9 shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-lg text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
              <span className="text-xs text-zinc-400">
                Total: <strong className="text-white">{formatUsd(totalAmount)}</strong> ({chunks.length} {chunks.length === 1 ? "Chunk" : "Chunks"})
              </span>

              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSubmitting} className="gap-2">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Creating Batch...</span>
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      <span>Create Batch & Partition Chunks</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        tokenDecimals={tokenSymbol === "SOL" ? 9 : 6}
        onImport={handleCsvImport}
      />
    </>
  );
}
