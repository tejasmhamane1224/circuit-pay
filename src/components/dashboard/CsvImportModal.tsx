"use client";

import React, { useState, useId, useRef } from "react";
import { parseRecipientCsv, type ParsedCsvRecipient } from "@/lib/csv/parser";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";
import { MULTIHOPPER_RULES } from "@/lib/constants";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  X,
  Layers,
  ArrowRight,
} from "lucide-react";
import { trackEvent } from "@/lib/analytics/posthog";

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenDecimals?: number;
  onImport: (validRecipients: Array<{ recipientWallet: string; amountFormatted: string; recipientName?: string }>) => void;
}

export function CsvImportModal({
  isOpen,
  onClose,
  tokenDecimals = 6,
  onImport,
}: CsvImportModalProps) {
  const [activeTab, setActiveTab] = useState<"paste" | "upload">("paste");
  const [csvText, setCsvText] = useState("");
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  if (!isOpen) return null;

  const parsed = parseRecipientCsv(csvText, { tokenDecimals });
  const displayRows = filterErrorsOnly ? parsed.invalidRows : parsed.rows;

  const processFile = (file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setCsvText(content);
        setActiveTab("paste");
      }
    };
    reader.readAsText(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleLoadDemo = (type: "standard" | "chunks25" | "invalid") => {
    if (type === "standard") {
      setCsvText(`Wallet,Amount,Name
3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4,250.00,Alice Developer
7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u,350.50,Bob Security
DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj,120.00,Carol Frontend`);
    } else if (type === "chunks25") {
      // 25 recipients to demonstrate 20-destination chunking
      const baseWallets = [
        "3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4",
        "7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u",
        "DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj",
        "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
      ];
      let rows = "wallet,amount,name\n";
      for (let i = 0; i < 25; i++) {
        const base = baseWallets[i % baseWallets.length];
        const addr = `${base.slice(0, 38)}${i.toString().padStart(4, "0")}`;
        rows += `${addr},${(100 + i * 15).toFixed(2)},Contributor #${i + 1}\n`;
      }
      setCsvText(rows.trim());
    } else {
      // Corrupted / testing edge cases
      setCsvText(`wallet,amount,name
3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4,100.00,Valid Dev
3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4,200.00,Duplicate Address
11111111111111111111111111111111,50.00,Off-curve PDA Program Key
7pBqizvE8vQZ29F49NWSu9cho3s7M9SqJyNN1UoQyQ2u,-40.00,Negative Amount
NotAValidBase58SolanaAddress,300.00,Malformed Base58
DQTf1yf1YM4B48PqJyQ53SEWGDM6ib4YBV7P3wm2MCxj,12.1234567,Exceeds 6 Decimals`);
    }
  };

  const handleApply = () => {
    if (parsed.validCount === 0) return;
    trackEvent("csv_imported", {
      recipientCount: parsed.validCount,
      totalAmount: parsed.totalAmountFormatted,
      tokenSymbol: "USDC",
      hasInvalidRows: parsed.errorCount > 0,
    });
    onImport(
      parsed.validRows.map((r) => ({
        recipientWallet: r.wallet,
        amountFormatted: r.amountFormatted,
        recipientName: r.recipientName,
      }))
    );
    onClose();
  };

  const totalNum = parseFloat(parsed.totalAmountFormatted) || 0;
  const percentFee = totalNum * 0.005;
  const integratorShare = percentFee * 0.5;
  const screeningSol = parsed.validCount * MULTIHOPPER_RULES.SCREENING_FEE_SOL;
  const chunksCount = Math.ceil(parsed.validCount / MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK) || 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="csv-import-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-50"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-indigo-950 border border-indigo-800 flex items-center justify-center">
              <Upload className="h-5 w-5 text-indigo-400" />
            </div>
            <div>
              <h2 id="csv-import-modal-title" className="text-base font-semibold text-white">Import CSV &amp; Recipient Parser</h2>
              <p className="text-xs text-zinc-400">
                Strict Base58 verification, on-curve checking, and duplicate prevention
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

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Quick Demo Templates */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl">
            <span className="text-xs text-zinc-400 font-medium">Quick Test Templates:</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleLoadDemo("standard")}
                className="px-2.5 py-1 text-xs font-mono bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-lg transition-colors"
              >
                3 Recipients
              </button>
              <button
                type="button"
                onClick={() => handleLoadDemo("chunks25")}
                className="px-2.5 py-1 text-xs font-mono bg-indigo-950/80 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/60 rounded-lg transition-colors flex items-center gap-1"
              >
                <Layers className="h-3 w-3" /> 25 Recipients (2 Chunks)
              </button>
              <button
                type="button"
                onClick={() => handleLoadDemo("invalid")}
                className="px-2.5 py-1 text-xs font-mono bg-red-950/60 hover:bg-red-900/60 text-red-300 border border-red-800/60 rounded-lg transition-colors"
              >
                Test Error Detection
              </button>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex gap-2 border-b border-zinc-800 pb-2">
            <button
              type="button"
              onClick={() => setActiveTab("paste")}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === "paste"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <FileText className="h-3.5 w-3.5" /> Paste Raw CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("upload");
                fileInputRef.current?.click();
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
                activeTab === "upload"
                  ? "bg-indigo-600 text-white"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              <Upload className="h-3.5 w-3.5" /> Upload File (.csv)
            </button>
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>

          {/* Input & Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative rounded-xl border-2 transition-all duration-200 ${
              isDragging
                ? "border-indigo-500 bg-indigo-950/40 ring-4 ring-indigo-500/20"
                : "border-zinc-800 bg-zinc-950"
            }`}
          >
            {isDragging && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-zinc-900/90 rounded-xl backdrop-blur-sm pointer-events-none text-indigo-400">
                <Upload className="h-8 w-8 mb-2 animate-bounce" />
                <span className="text-sm font-semibold text-white">Drop CSV File Here</span>
                <span className="text-xs text-zinc-400">Auto-parse recipients, amounts & memos</span>
              </div>
            )}
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder="Paste recipient CSV here, or drag & drop a .csv file. Format: wallet,amount,name"
              rows={5}
              className="w-full p-3 font-mono text-xs bg-transparent rounded-xl text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Validation Metrics Strip */}
          {parsed.totalRecipients > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block font-medium">Valid Recipients</span>
                <span className="text-sm font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {parsed.validCount} / {parsed.totalRecipients}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block font-medium">Issues Detected</span>
                <span
                  className={`text-sm font-bold flex items-center gap-1 ${
                    parsed.errorCount > 0 ? "text-red-400" : "text-zinc-400"
                  }`}
                >
                  <AlertCircle className="h-3.5 w-3.5" /> {parsed.errorCount} Rows
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800">
                <span className="text-[10px] text-zinc-400 block font-medium">Valid Batch Volume</span>
                <span className="text-sm font-bold text-white">{formatUsd(totalNum)}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-indigo-950/30 border border-indigo-900/50">
                <span className="text-[10px] text-indigo-300 block font-medium">Chunk Requirement</span>
                <span className="text-sm font-bold text-indigo-400 flex items-center gap-1">
                  <Layers className="h-3.5 w-3.5" /> {chunksCount} {chunksCount === 1 ? "Chunk" : "Chunks"}
                </span>
              </div>
            </div>
          )}

          {/* 500 Recipient Cap UI Banner */}
          {parsed.totalRecipients > 500 && (
            <div className="p-3 rounded-xl bg-red-950/50 border border-red-800 text-xs text-red-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-white block">Batch Recipient Cap Exceeded (Max 500)</span>
                <span className="text-[11px] text-red-300">
                  You have uploaded {parsed.totalRecipients} recipients. CircuitPay strictly enforces a maximum of 500 recipients per payout batch UI-side.
                </span>
              </div>
            </div>
          )}

          {/* Duplicate Wallets Warning */}
          {parsed.duplicateWallets.length > 0 && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800 text-xs text-amber-200 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-amber-300 block">Duplicate Recipient Addresses Detected ({parsed.duplicateWallets.length})</span>
                <span className="text-[11px] text-zinc-300">
                  MultiHopper requires unique recipient addresses. Duplicate addresses are flagged below and must be deduplicated before import.
                </span>
              </div>
            </div>
          )}

          {/* Live Line-by-Line Validation Table */}
          {parsed.rows.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-200">
                  Recipient Line Items ({parsed.rows.length})
                </span>
                {parsed.errorCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilterErrorsOnly(!filterErrorsOnly)}
                    className="text-xs text-red-400 hover:text-red-300 font-mono underline"
                  >
                    {filterErrorsOnly ? "Show All Rows" : `Show Only ${parsed.errorCount} Errors`}
                  </button>
                )}
              </div>

              <div className="max-h-56 overflow-y-auto border border-zinc-800 rounded-xl divide-y divide-zinc-800/80 bg-zinc-950/40">
                {displayRows.map((row: ParsedCsvRecipient) => (
                  <div
                    key={row.rowNumber}
                    className={`p-2.5 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors ${
                      row.isValid ? "hover:bg-zinc-900/60" : "bg-red-950/20 hover:bg-red-950/30"
                    }`}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-zinc-500 font-mono text-[11px] w-6">#{row.rowNumber}</span>
                        <span className="font-mono text-zinc-200 text-xs truncate max-w-[240px] sm:max-w-[320px]">
                          {row.wallet || "(empty address)"}
                        </span>
                        {row.recipientName && (
                          <span className="text-zinc-400 text-[11px]">({row.recipientName})</span>
                        )}
                      </div>

                      {/* Line Errors */}
                      {row.errors.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-8">
                          {row.errors.map((err, i) => (
                            <span
                              key={i}
                              className="text-[10px] text-red-400 bg-red-950/50 px-2 py-0.5 rounded border border-red-800/60 flex items-center gap-1"
                            >
                              <AlertCircle className="h-3 w-3" /> {err}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pl-8 sm:pl-0">
                      <span className="font-mono text-zinc-100 font-semibold text-xs">
                        {row.amountFormatted ? `${row.amountFormatted} USDC` : "-"}
                      </span>
                      {row.isValid ? (
                        <Badge variant="success" className="text-[10px] py-0">
                          Valid
                        </Badge>
                      ) : (
                        <Badge variant="danger" className="text-[10px] py-0">
                          Invalid
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fee & Chunk Preview Footer */}
          {parsed.validCount > 0 && (
            <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs space-y-1.5">
              <div className="flex items-center justify-between text-zinc-400">
                <span>MultiHopper 0.50% Routing Fee:</span>
                <span className="font-mono text-emerald-400 font-semibold">{formatUsd(percentFee)}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>Integrator 50% Revenue Share Split:</span>
                <span className="font-mono text-cyan-400 font-semibold">{formatUsd(integratorShare)}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>TRM Screening SOL (0.002 SOL/dest):</span>
                <span className="font-mono text-amber-400 font-semibold">{screeningSol.toFixed(3)} SOL</span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-zinc-400">
            Cancel
          </Button>

          <Button
            variant="primary"
            size="md"
            onClick={handleApply}
            disabled={parsed.validCount === 0 || parsed.validCount > 500 || parsed.duplicateWallets.length > 0}
            className="gap-2"
          >
            <span>
              {parsed.totalRecipients > 500
                ? "Exceeds 500 Recipient Cap"
                : parsed.duplicateWallets.length > 0
                ? "Resolve Duplicate Addresses"
                : `Import ${parsed.validCount} Valid Recipients`}
            </span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
