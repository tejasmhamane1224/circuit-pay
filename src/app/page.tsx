"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { StatsOverview } from "@/components/dashboard/StatsOverview";
import { RouteVisualizer } from "@/components/dashboard/RouteVisualizer";
import { BatchList, type BatchItemData } from "@/components/dashboard/BatchList";
import { CreateBatchModal } from "@/components/dashboard/CreateBatchModal";
import { BatchSigningModal } from "@/components/dashboard/BatchSigningModal";
import { BatchDetailView } from "@/components/dashboard/BatchDetailView";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsd } from "@/lib/utils";
import {
  Lock,
  Database,
  RefreshCw,
  LayoutDashboard,
  Sparkles,
  TrendingUp,
  Coins,
  ArrowRight,
  Layers,
  FileCheck2,
  Server,
  CheckCircle2,
  Loader2,
} from "lucide-react";

/**
 * EDIT 4 Helper: Spinner component for stat cards
 */
function Spinner() {
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-500 text-sm font-sans">
      <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      <span>Loading...</span>
    </span>
  );
}

/**
 * Homepage Landing Section with the 4 Live Real-Data Stats
 */
function HomepageLanding({
  onLaunchDashboard,
  onOpenCreateBatch,
}: {
  onLaunchDashboard?: () => void;
  onOpenCreateBatch?: () => void;
}) {
  // EDIT 4 — Stat 1: Real Volume Processed (8-second fallback timeout)
  const [realVolume, setRealVolume] = useState<string | null>(null);
  useEffect(() => {
    const timeout = setTimeout(() => setRealVolume("$0"), 8000); // fallback
    fetch("/api/volume")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        clearTimeout(timeout);
        const v = data?.metrics?.volumeProcessedUsd;
        setRealVolume(v && v > 0 ? formatUsd(v) : "$0");
      })
      .catch((err) => {
        console.error("Failed to fetch Real Volume Processed:", err);
        clearTimeout(timeout);
        setRealVolume("$0");
      });
    return () => clearTimeout(timeout);
  }, []);

  // EDIT 4 — Stat 2: Treasury Fees Saved (8-second fallback timeout)
  const [feesSaved, setFeesSaved] = useState<string | null>(null);
  useEffect(() => {
    const timeout = setTimeout(() => setFeesSaved("$0"), 8000); // fallback
    fetch("/api/volume")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        clearTimeout(timeout);
        const v = data?.metrics?.feesSavedUsd;
        setFeesSaved(v && v > 0 ? formatUsd(v) : "$0");
      })
      .catch((err) => {
        console.error("Failed to fetch Treasury Fees Saved:", err);
        clearTimeout(timeout);
        setFeesSaved("$0");
      });
    return () => clearTimeout(timeout);
  }, []);

  // EDIT 4 — Stat 3: Payout Batches Settled (8-second fallback timeout)
  const [batchesSettled, setBatchesSettled] = useState<string | null>(null);
  useEffect(() => {
    const timeout = setTimeout(() => setBatchesSettled("0"), 8000); // fallback
    fetch("/api/batches")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        clearTimeout(timeout);
        const count = data?.batches?.length;
        setBatchesSettled(count && count > 0 ? count.toLocaleString() : "0");
      })
      .catch((err) => {
        console.error("Failed to fetch Payout Batches Settled:", err);
        clearTimeout(timeout);
        setBatchesSettled("0");
      });
    return () => clearTimeout(timeout);
  }, []);

  // EDIT 4 — Stat 4: Unique Destinations (8-second fallback timeout)
  const [uniqueDestinations, setUniqueDestinations] = useState<string | null>(null);
  useEffect(() => {
    const timeout = setTimeout(() => setUniqueDestinations("0"), 8000); // fallback
    fetch("/api/volume")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        clearTimeout(timeout);
        const count = data?.metrics?.recipientsCount;
        setUniqueDestinations(count && count > 0 ? count.toLocaleString() : "0");
      })
      .catch((err) => {
        console.error("Failed to fetch Unique Destinations:", err);
        clearTimeout(timeout);
        setUniqueDestinations("0");
      });
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="space-y-12">
      {/* 1. Value Proposition Hero */}
      <section
        aria-label="Hero Overview"
        className="relative overflow-hidden rounded-3xl border border-indigo-900/40 bg-gradient-to-b from-indigo-950/40 via-zinc-900/60 to-zinc-950 p-6 sm:p-10 lg:p-12 shadow-2xl"
      >
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 w-64 h-64 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl mx-auto text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 text-xs font-medium">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
            <span>Superteam Earn $50,000 MultiHopper Build & Route Engine</span>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight">
            Non-Custodial Multi-Hop <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-indigo-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">
              Solana Payout & Treasury Rail
            </span>
          </h1>

          <p className="text-sm sm:text-base lg:text-lg text-zinc-300 max-w-2xl mx-auto leading-relaxed">
            Execute mass token distributions with zero server key custody. Partition 20-destination
            protocol caps automatically, preview deterministic route fees, and receive HMAC-signed
            outbound webhook notifications upon block finality.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            {onOpenCreateBatch && (
              <Button
                variant="primary"
                size="lg"
                onClick={onOpenCreateBatch}
                className="gap-2 shadow-xl shadow-indigo-600/30 text-sm font-semibold min-h-[44px] px-6"
              >
                <span>Launch New Batch</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {onLaunchDashboard && (
              <Button
                variant="outline"
                size="lg"
                onClick={onLaunchDashboard}
                className="gap-2 border-zinc-700 text-zinc-200 hover:text-white min-h-[44px] px-6"
              >
                <span>Active Batches Table &rarr;</span>
              </Button>
            )}
            <Link href="/docs">
              <Button
                variant="outline"
                size="lg"
                className="gap-2 border-zinc-700 text-zinc-200 hover:text-white min-h-[44px] px-6"
              >
                <Server className="h-4 w-4 text-cyan-400" />
                <span>API & SDK Documentation</span>
              </Button>
            </Link>
            <Link href="/evidence">
              <Button
                variant="outline"
                size="lg"
                className="gap-2 border-indigo-700/60 text-indigo-300 hover:text-white min-h-[44px] px-6"
              >
                <span>$50k Challenge Evidence &rarr;</span>
              </Button>
            </Link>
          </div>
        </div>

        {/* 2. Real-Data Live Fintech Counters (EDIT 4: 8s fallback timeout, never spins forever) */}
        <div className="mt-12 pt-8 border-t border-zinc-800/80">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
              <span className="text-xs uppercase tracking-wider font-mono font-semibold text-zinc-400">
                Live On-Chain Telemetry (Strictly Real Data from Postgres & Ledger)
              </span>
            </div>
            <Badge variant="success" className="font-mono text-[11px] py-0.5">
              100% Real-Time
            </Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Stat 1: Real Volume Processed */}
            <Card className="border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium">Real Volume Processed</span>
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                  {realVolume === null ? <Spinner /> : <span>{realVolume}</span>}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {realVolume === null
                    ? "Querying ledger..."
                    : realVolume === "$0"
                    ? "No transfers yet"
                    : "Strictly ledger-verified Solana principal payouts"}
                </p>
              </CardContent>
            </Card>

            {/* Stat 2: Treasury Fees Saved */}
            <Card className="border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium">Treasury Fees Saved</span>
                  <Coins className="h-4 w-4 text-cyan-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-cyan-300 font-mono tracking-tight">
                  {feesSaved === null ? <Spinner /> : <span>{feesSaved}</span>}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {feesSaved === null
                    ? "Querying ledger..."
                    : feesSaved === "$0"
                    ? "No transfers yet"
                    : "2.00% net savings vs legacy custodial wire fee (2.50%)"}
                </p>
              </CardContent>
            </Card>

            {/* Stat 3: Payout Batches Settled */}
            <Card className="border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium">Payout Batches Settled</span>
                  <FileCheck2 className="h-4 w-4 text-indigo-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                  {batchesSettled === null ? <Spinner /> : <span>{batchesSettled}</span>}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {batchesSettled === null
                    ? "Querying ledger..."
                    : batchesSettled === "0"
                    ? "No transfers yet"
                    : "Active organizational treasury disbursements"}
                </p>
              </CardContent>
            </Card>

            {/* Stat 4: Unique Destinations */}
            <Card className="border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center justify-between text-zinc-400">
                  <span className="text-xs font-medium">Unique Destinations</span>
                  <Layers className="h-4 w-4 text-amber-400" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-amber-300 font-mono tracking-tight">
                  {uniqueDestinations === null ? <Spinner /> : <span>{uniqueDestinations}</span>}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {uniqueDestinations === null
                    ? "Querying ledger..."
                    : uniqueDestinations === "0"
                    ? "No transfers yet"
                    : "Individual contributor wallets funded"}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* 3. 3-Step "How It Works" Visual Lifecycle */}
      <section aria-label="How It Works" className="space-y-6">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <Badge variant="info" className="font-mono text-xs uppercase">
            3-Step Protocol Flow
          </Badge>
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            How MultiHopper Payroll Works
          </h2>
          <p className="text-xs sm:text-sm text-zinc-400">
            From CSV upload to cryptographically signed webhooks in three strictly non-custodial phases.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Step 1 */}
          <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col justify-between space-y-4 hover:border-indigo-700/50 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="h-9 w-9 rounded-xl bg-indigo-950 border border-indigo-700/60 flex items-center justify-center font-mono font-bold text-indigo-400 text-sm">
                  01
                </span>
                <Badge variant="default" className="text-[10px] font-mono">
                  Client & API
                </Badge>
              </div>
              <h3 className="text-base font-semibold text-white">Prepare & Partition</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Ingest recipient wallets via drag-and-drop CSV or REST API. Addresses are strictly
                validated against Base58 public key curves, and partitioned into chunks of $\le 20$
                destinations with UUID idempotency keys.
              </p>
            </div>
            <div className="pt-2 border-t border-zinc-800/80 flex items-center gap-2 text-[11px] text-zinc-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Base58 verification &amp; 20-cap safety partitioning</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col justify-between space-y-4 hover:border-cyan-700/50 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="h-9 w-9 rounded-xl bg-cyan-950 border border-cyan-700/60 flex items-center justify-center font-mono font-bold text-cyan-400 text-sm">
                  02
                </span>
                <Badge variant="info" className="text-[10px] font-mono">
                  Smart Contracts
                </Badge>
              </div>
              <h3 className="text-base font-semibold text-white">Client Sign & Multi-Hop Route</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                The treasury wallet authorizes transactions directly from Phantom, Solflare, or Backpack.
                Server keys are never held. Instructions invoke MultiHopper Orchestrator and Transfer
                Hook Guard over 1 to 4 privacy hops.
              </p>
            </div>
            <div className="pt-2 border-t border-zinc-800/80 flex items-center gap-2 text-[11px] text-zinc-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Multi-approval thresholds for batches &gt; $10k USD</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="relative rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col justify-between space-y-4 hover:border-emerald-700/50 transition-all">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="h-9 w-9 rounded-xl bg-emerald-950 border border-emerald-700/60 flex items-center justify-center font-mono font-bold text-emerald-400 text-sm">
                  03
                </span>
                <Badge variant="success" className="text-[10px] font-mono">
                  Settlement & Webhooks
                </Badge>
              </div>
              <h3 className="text-base font-semibold text-white">Settle, Deduplicate & Notify</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                As Solana keepers confirm chunk dispersions on-chain, incoming events are HMAC-verified
                and deduplicated. Outbound signed webhooks (HMAC-SHA256) and Telegram/Email alerts
                dispatch immediately to partners.
              </p>
            </div>
            <div className="pt-2 border-t border-zinc-800/80 flex items-center gap-2 text-[11px] text-zinc-500">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              <span>Signed outbound webhooks &amp; Resend / Telegram dispatch</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Non-Custodial Transparency Disclaimer & Compliance Screening */}
      {/* EDIT 1 NOTE: Verified On-Chain MultiHopper Contracts section is permanently deleted */}
      <section
        aria-label="Security and Compliance"
        className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 sm:p-8 space-y-6"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 text-indigo-400 text-xs font-mono font-semibold uppercase">
              <Lock className="h-4 w-4" />
              <span>Non-Custodial Architecture Policy</span>
            </div>
            <h3 className="text-xl font-bold text-white tracking-tight">
              Strict Non-Custodial Key Architecture
            </h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              CircuitPay operates under a strict zero-custody mandate. Neither the web server,
              database, nor any background workers store, generate, or transmit sender private keys.
              All instruction vectors and route seeds are constructed in client-side memory and signed
              using the user&apos;s connected wallet (Phantom, Solflare, Backpack).
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-200">Compliance &amp; OFAC Screening</span>
              <Badge variant="info" className="text-[10px] font-mono">
                0.00005 SOL / Recipient
              </Badge>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Every payout destination is screened on-chain prior to chunk dispersion. Wallets flagged
              for sanctions or high-risk activity are automatically segregated into failed queues,
              protecting organizational treasuries from contamination without blocking legitimate transfers.
            </p>
            <div className="flex items-center gap-4 pt-1 text-[11px] text-zinc-500 font-mono">
              <span>Fee: 0.00005 SOL</span>
              <span>•</span>
              <span>Timing-safe HMAC-SHA256</span>
              <span>•</span>
              <span>Sliding Window Rate-Limits</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || process.env.NEXT_PUBLIC_NETWORK || "devnet";
  const [viewMode, setViewMode] = useState<"overview" | "batches">("overview");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [signingBatch, setSigningBatch] = useState<BatchItemData | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchItemData[]>([]);

  const fetchBatches = React.useCallback(async () => {
    try {
      const res = await fetch("/api/batches");
      if (!res.ok) {
        throw new Error(`Failed to fetch /api/batches: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data.success && data.batches) {
        setBatches(data.batches);
      }
    } catch (err) {
      console.error("Failed to fetch /api/batches in Home page:", err);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const res = await fetch("/api/batches");
        if (!res.ok) {
          throw new Error(`Failed to load /api/batches: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        if (isMounted && data.success && data.batches) {
          setBatches(data.batches);
        }
      } catch (err) {
        console.error("Failed to load /api/batches in Home page:", err);
      }
    };

    load();
    const interval = setInterval(() => {
      fetchBatches();
    }, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchBatches]);

  // Totals calculations
  const totalVolumeUsd = batches.reduce(
    (sum, b) => sum + (parseFloat(b.totalAmountFormatted.replace(/,/g, "")) || 0),
    0
  );
  // Fees = 0.50%
  const collectedFeesUsd = totalVolumeUsd * 0.005;
  // Challenge formula: collected_fees / 0.0025
  const qualifyingVolumeUsd = collectedFeesUsd / 0.0025;
  // Integrator revenue share: 50%
  const integratorShareUsd = collectedFeesUsd * 0.5;

  const totalDestinationsCount = batches.reduce((sum, b) => sum + b.recipientCount, 0);
  const chunksCount = batches.reduce((sum, b) => sum + b.chunksCount, 0);

  const handleBatchCreated = (newBatch: BatchItemData) => {
    fetchBatches();
    const totalUsd = parseFloat(newBatch.totalAmountFormatted.replace(/,/g, "")) || 0;
    if (totalUsd >= 10000) {
      // Threshold batches require approval first
      setSelectedBatchId(newBatch.id);
    } else {
      // Standard batches can proceed to signing
      setSigningBatch(newBatch);
    }
  };

  const handleSigningComplete = () => {
    fetchBatches();
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Banner: Superteam Earn MultiHopper Challenge */}
        <div className="rounded-2xl border border-indigo-900/60 bg-gradient-to-r from-indigo-950/60 via-zinc-900/80 to-zinc-950 p-5 sm:p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="info" className="font-mono text-xs">
                Superteam Earn $50,000 Challenge
              </Badge>
              {/* EDIT 3 — Identical MAINNET / DEVNET badge matching docs page */}
              <Badge
                variant={network === "mainnet-beta" ? "success" : "warning"}
                className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-0.5"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    network === "mainnet-beta"
                      ? "bg-emerald-400 animate-pulse"
                      : "bg-amber-400 animate-pulse"
                  }`}
                />
                <span>{network === "mainnet-beta" ? "MAINNET" : "DEVNET"}</span>
              </Badge>
              <span className="text-xs text-zinc-400">Deadline: Dec 14, 2026, 9:59 PM UTC</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
              CircuitPay Treasury & Routed Multi-Hop Payroll
            </h1>
            <p className="text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Non-custodial Solana payout engine powered by MultiHopper smart contracts.
              Strict 20-destination cap partitioning, CSV parser with Base58 validation, live fee & route previews, and webhook deduplication.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link href="/evidence">
              <Button
                variant="outline"
                size="md"
                className="gap-2 border-indigo-700/60 text-indigo-300 hover:text-white"
              >
                <span>View Evidence Page &rarr;</span>
              </Button>
            </Link>
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsCreateModalOpen(true)}
              className="gap-2 shadow-lg shadow-indigo-600/30"
            >
              <span>+ New Payout Batch</span>
            </Button>
          </div>
        </div>

        {/* View Switcher: Overview Landing vs Treasury Batches */}
        {!selectedBatchId && (
          <div className="flex items-center gap-2 border-b border-zinc-800 pb-3">
            <button
              onClick={() => setViewMode("overview")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] ${
                viewMode === "overview"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                  : "bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
              aria-selected={viewMode === "overview"}
              role="tab"
            >
              <Sparkles className="h-4 w-4" />
              <span>Fintech Landing &amp; Live Real-Data Counters</span>
            </button>
            <button
              onClick={() => setViewMode("batches")}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all min-h-[44px] ${
                viewMode === "batches"
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                  : "bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800"
              }`}
              aria-selected={viewMode === "batches"}
              role="tab"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Active Payout Batches ({batches.length})</span>
            </button>
          </div>
        )}

        {/* If a batch is selected, show detail view */}
        {selectedBatchId ? (
          <BatchDetailView
            batchId={selectedBatchId}
            onBack={() => setSelectedBatchId(null)}
            onSignBatch={(b) => setSigningBatch(b)}
          />
        ) : viewMode === "overview" ? (
          <HomepageLanding
            onOpenCreateBatch={() => setIsCreateModalOpen(true)}
            onLaunchDashboard={() => setViewMode("batches")}
          />
        ) : (
          <>
            {/* 1. KPIs & Superteam Earn Volume Tracker */}
            <StatsOverview
              qualifyingVolumeUsd={qualifyingVolumeUsd}
              collectedFeesUsd={collectedFeesUsd}
              integratorShareUsd={integratorShareUsd}
              totalBatchesCount={batches.length}
              totalDestinationsCount={totalDestinationsCount}
              chunksCount={chunksCount}
            />

            {/* 2. MultiHopper 4-Step Non-Custodial Transfer Lifecycle */}
            <RouteVisualizer />

            {/* 3. Batches & Chunks Table */}
            <BatchList
              batches={batches}
              onCreateBatch={() => setIsCreateModalOpen(true)}
              onSelectBatch={(id) => setSelectedBatchId(id)}
              onSignBatch={(b) => setSigningBatch(b)}
            />

            {/* 4. Architecture & Security Specifications */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <Card className="border-zinc-800/80 bg-zinc-900/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-indigo-400">
                    <Lock className="h-4 w-4" />
                    <CardTitle className="text-sm font-semibold">Strictly Non-Custodial</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Users sign transactions directly from Phantom, Solflare, or Backpack. Server-side keys are NEVER held; funds are routed exclusively via MultiHopper on-chain protocol contracts.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-zinc-800/80 bg-zinc-900/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <RefreshCw className="h-4 w-4" />
                    <CardTitle className="text-sm font-semibold">20-Cap Automatic Chunking</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    All transfers enforce UUID idempotency keys preventing duplicate debits. Batches with &gt;20 destinations are deterministically partitioned into chunks of $\le 20$ destinations matching MultiHopper limits.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-zinc-800/80 bg-zinc-900/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Database className="h-4 w-4" />
                    <CardTitle className="text-sm font-semibold">HMAC Replay Deduplication</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    MultiHopper webhooks are cryptographically authenticated via HMAC-SHA256 timing-safe comparison and deduplicated by unique event ID in PostgreSQL.
                  </p>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </main>

      {/* EDIT 2 — Delete fake addresses from footer */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>CircuitPay • Built for Superteam Earn MultiHopper Build and Route Challenge</span>
          <span className="font-mono text-[11px]">Integration ID: circuitpay_treasury_v1 | MultiHopper Protocol Rail</span>
        </div>
      </footer>

      {/* Batch Creation Modal with CSV & Route Preview */}
      <CreateBatchModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onBatchCreated={handleBatchCreated}
      />

      {/* Batch Signing & Multi-Send Flow Modal */}
      <BatchSigningModal
        isOpen={!!signingBatch}
        batch={signingBatch}
        onClose={() => setSigningBatch(null)}
        onComplete={handleSigningComplete}
      />
    </div>
  );
}
