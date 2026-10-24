"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatUsd } from "@/lib/utils";
import {
  ShieldCheck,
  Download,
  Filter,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  TrendingUp,
  Coins,
  Calculator,
  ArrowLeft,
  Calendar,
  Layers,
  AlertTriangle,
} from "lucide-react";

interface VolumeLedgerRow {
  id: string;
  multihopperId: string;
  network: "mainnet-beta" | "devnet";
  isMainnet: boolean;
  tokenMint: string;
  tokenSymbol: string;
  principalAmountRaw: string;
  principalAmountUsd: string;
  collectedFeeRaw: string;
  collectedFeeUsd: string;
  qualifyingVolumeUsd: string;
  integratorFeeShareUsd: string;
  verifiedAt: string;
}

interface VolumeMetricsResponse {
  success: boolean;
  challenge: string;
  deadline: string;
  formula: string;
  targetThresholdUsd: number;
  metrics: {
    totalQualifyingVolumeUsd: number;
    totalCollectedFeesUsd: number;
    totalIntegratorFeeShareUsd: number;
    totalPrincipalVolumeUsd: number;
    progressPercent: number;
    thresholdMet: boolean;
    productionMainnetTransfersCount: number;
    totalEntriesCount: number;
  };
  ledger: VolumeLedgerRow[];
}

export default function EvidencePage() {
  const [data, setData] = useState<VolumeMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkFilter, setNetworkFilter] = useState<string>("mainnet-beta");
  const [windowFilter, setWindowFilter] = useState<string>("challenge");
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  const fetchVolumeData = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const params = new URLSearchParams();
        if (networkFilter !== "all") params.set("network", networkFilter);
        if (windowFilter !== "all") params.set("window", windowFilter);

        const res = await fetch(`/api/volume?${params.toString()}`);
        const json = await res.json();
        if (json.success) {
          setData(json);
        }
      } catch {
        // ignore
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [networkFilter, windowFilter]
  );

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (networkFilter !== "all") params.set("network", networkFilter);
        if (windowFilter !== "all") params.set("window", windowFilter);

        const res = await fetch(`/api/volume?${params.toString()}`);
        const json = await res.json();
        if (isMounted && json.success) {
          setData(json);
        }
      } catch {
        // ignore
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [networkFilter, windowFilter]);

  const handleExportEarnCsv = () => {
    setDownloadingCsv(true);
    const params = new URLSearchParams();
    if (networkFilter !== "all") params.set("network", networkFilter);
    if (windowFilter !== "all") params.set("window", windowFilter);

    const a = document.createElement("a");
    a.href = `/api/evidence/csv?${params.toString()}`;
    a.download = "superteam-earn-qualifying-volume-submission.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => setDownloadingCsv(false), 2000);
  };

  const metrics = data?.metrics || {
    totalQualifyingVolumeUsd: 0,
    totalCollectedFeesUsd: 0,
    totalIntegratorFeeShareUsd: 0,
    totalPrincipalVolumeUsd: 0,
    progressPercent: 0,
    thresholdMet: false,
    productionMainnetTransfersCount: 0,
    totalEntriesCount: 0,
  };

  const ledger = data?.ledger || [];

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Navigation & Title Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Dashboard</span>
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Superteam Earn Evidence & Volume Ledger
                </h1>
                <Badge variant="success" className="font-mono text-xs">
                  $50k Challenge
                </Badge>
              </div>
              <p className="text-xs text-zinc-400">
                Cryptographically verified production transaction signatures and qualifying volume ledger.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchVolumeData()}
              disabled={loading}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              <span>Refresh</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleExportEarnCsv}
              disabled={downloadingCsv}
              className="gap-1.5 shadow-md shadow-indigo-600/30 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{downloadingCsv ? "Exporting..." : "Export Earn Submission CSV"}</span>
            </Button>
          </div>
        </div>

        {/* Formula Explainer Callout Card */}
        <div className="rounded-2xl border border-indigo-900/60 bg-gradient-to-r from-indigo-950/40 via-zinc-900/70 to-zinc-950 p-5 space-y-3 shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400">
                <Calculator className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Official Qualifying Volume Formula</h2>
                <p className="text-xs text-indigo-300 font-mono">
                  Qualifying Volume (USD) = Collected MultiHopper Fees / 0.0025
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="info" className="text-xs font-mono">
                Threshold: $100,000 USD
              </Badge>
              <Badge variant="warning" className="text-xs font-mono">
                Deadline: Dec 14, 2026
              </Badge>
            </div>
          </div>

          <p className="text-xs text-zinc-400 leading-relaxed">
            Per Superteam Earn MultiHopper Challenge rules, qualifying volume is derived strictly from real percentage fees collected on Solana Mainnet. Each transfer incurs a 0.50% MultiHopper fee. Dividing collected fees by 0.0025 (25 bps) provides accurate qualifying volume verification while guaranteeing zero wash-trading credit. Devnet, circular, or refunded transactions are strictly excluded ($0).
          </p>
        </div>

        {/* 4 Metric KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-zinc-400">Mainnet Qualifying Volume</CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold font-mono text-emerald-400">
                {formatUsd(metrics.totalQualifyingVolumeUsd)}
              </div>
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-[11px] text-zinc-400 font-mono">
                  <span>Target: $100,000</span>
                  <span className="text-emerald-400 font-semibold">{metrics.progressPercent.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                    style={{ width: `${metrics.progressPercent}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-zinc-400">Protocol Fees Collected</CardTitle>
              <Coins className="h-4 w-4 text-indigo-400" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold font-mono text-white">
                {formatUsd(metrics.totalCollectedFeesUsd)}
              </div>
              <p className="text-[11px] text-zinc-400 mt-2 font-mono">
                Formula Divisor: 0.0025
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-zinc-400">Integrator Share (50%)</CardTitle>
              <ShieldCheck className="h-4 w-4 text-cyan-400" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold font-mono text-cyan-400">
                {formatUsd(metrics.totalIntegratorFeeShareUsd)}
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">
                50% MultiHopper Revenue Share
              </p>
            </CardContent>
          </Card>

          <Card className="border-zinc-800 bg-zinc-900/50">
            <CardHeader className="pb-1 pt-4 px-4 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-zinc-400">Production Mainnet Transfers</CardTitle>
              <Layers className="h-4 w-4 text-amber-400" />
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="text-2xl font-bold font-mono text-white">
                {metrics.productionMainnetTransfersCount}
              </div>
              <div className="flex items-center gap-1.5 mt-2 text-[11px] font-mono">
                {metrics.thresholdMet ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    <span>Target Met ($100k+)</span>
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    <span>In Progress ({metrics.progressPercent.toFixed(0)}%)</span>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters Toolbar */}
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-indigo-400" />
              Filter By:
            </span>

            {/* Network Selector */}
            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => setNetworkFilter("all")}
                aria-pressed={networkFilter === "all"}
                className={`px-3 py-2 text-xs rounded-md transition-colors min-h-[44px] ${
                  networkFilter === "all"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                All Networks
              </button>
              <button
                type="button"
                onClick={() => setNetworkFilter("mainnet-beta")}
                aria-pressed={networkFilter === "mainnet-beta"}
                className={`px-3 py-2 text-xs rounded-md transition-colors min-h-[44px] ${
                  networkFilter === "mainnet-beta"
                    ? "bg-emerald-600 text-white font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Solana Mainnet
              </button>
              <button
                type="button"
                onClick={() => setNetworkFilter("devnet")}
                aria-pressed={networkFilter === "devnet"}
                className={`px-3 py-2 text-xs rounded-md transition-colors min-h-[44px] ${
                  networkFilter === "devnet"
                    ? "bg-amber-600 text-white font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Devnet
              </button>
            </div>

            {/* Window Selector */}
            <div className="flex flex-wrap items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
              <button
                type="button"
                onClick={() => setWindowFilter("challenge")}
                aria-pressed={windowFilter === "challenge"}
                className={`px-3 py-2 text-xs rounded-md transition-colors flex items-center gap-1 min-h-[44px] ${
                  windowFilter === "challenge"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                <Calendar className="h-3.5 w-3.5" />
                <span>Challenge Window</span>
              </button>
              <button
                type="button"
                onClick={() => setWindowFilter("30d")}
                aria-pressed={windowFilter === "30d"}
                className={`px-3 py-2 text-xs rounded-md transition-colors min-h-[44px] ${
                  windowFilter === "30d"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => setWindowFilter("all")}
                aria-pressed={windowFilter === "all"}
                className={`px-3 py-2 text-xs rounded-md transition-colors min-h-[44px] ${
                  windowFilter === "all"
                    ? "bg-indigo-600 text-white font-semibold"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                All Time
              </button>
            </div>
          </div>

          <div className="text-xs text-zinc-400 font-mono">
            Showing {ledger.length} verified transactions
          </div>
        </div>

        {/* Production Transaction Proofs Table */}
        <div
          tabIndex={0}
          role="region"
          aria-label="Production Transaction Proofs Table"
          className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-900/30 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[700px]">
              <thead className="bg-zinc-950 text-zinc-400 font-semibold border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">MultiHopper Transfer ID</th>
                  <th className="py-3 px-4">Network</th>
                  <th className="py-3 px-4">Verified At (UTC)</th>
                  <th className="py-3 px-4">Principal (USD)</th>
                  <th className="py-3 px-4">Fee Collected (USD)</th>
                  <th className="py-3 px-4">Qualifying Volume (USD)</th>
                  <th className="py-3 px-4">Integrator 50% Share</th>
                  <th className="py-3 px-4">Eligibility Status</th>
                  <th className="py-3 px-4 text-right">Explorer Proof</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/80">
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-zinc-400">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <AlertTriangle className="h-8 w-8 text-amber-500/80 mb-1" />
                        <p className="font-semibold text-sm text-zinc-200">No mainnet transfers yet</p>
                        <p className="text-xs text-zinc-500 max-w-md">
                          Execute and broadcast your first live Solana Mainnet-Beta multi-send batch to record verifiable qualifying volume on the official ledger.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  ledger.map((row) => (
                  <tr key={row.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-white">
                      {row.multihopperId}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant={row.isMainnet ? "success" : "warning"}
                        className="font-mono text-[10px] uppercase"
                      >
                        {row.network}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-zinc-400 font-mono text-[11px]">
                      {new Date(row.verifiedAt).toISOString().replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="py-3 px-4 font-mono text-zinc-200">
                      {formatUsd(parseFloat(row.principalAmountUsd))}
                    </td>
                    <td className="py-3 px-4 font-mono text-indigo-400">
                      {formatUsd(parseFloat(row.collectedFeeUsd))}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-emerald-400">
                      {formatUsd(parseFloat(row.qualifyingVolumeUsd))}
                    </td>
                    <td className="py-3 px-4 font-mono text-cyan-400">
                      {formatUsd(parseFloat(row.integratorFeeShareUsd))}
                    </td>
                    <td className="py-3 px-4">
                      {row.isMainnet ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Qualified Mainnet</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-zinc-500 font-mono">
                          Excluded (Devnet)
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <a
                          href={`https://solscan.io/account/${row.multihopperId}${
                            row.isMainnet ? "" : "?cluster=devnet"
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs text-indigo-400 hover:text-indigo-300 font-mono hover:underline"
                        >
                          <span>Solscan</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        <span className="text-zinc-600">•</span>
                        <a
                          href={`https://explorer.solana.com/address/${row.multihopperId}${
                            row.isMainnet ? "" : "?cluster=devnet"
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-xs text-zinc-400 hover:text-zinc-300 font-mono hover:underline"
                        >
                          <span>Explorer</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      <footer className="border-t border-zinc-800 bg-zinc-950 py-6 text-center text-xs text-zinc-500 mt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>CircuitPay • Built for Superteam Earn MultiHopper Challenge ($50,000 USD Bounty)</span>
          <span className="font-mono text-[11px]">Formula: Qualifying Volume = Fees / 0.0025</span>
        </div>
      </footer>
    </div>
  );
}
