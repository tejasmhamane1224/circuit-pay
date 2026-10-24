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
import { LandingSection } from "@/components/dashboard/LandingSection";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, Database, RefreshCw, LayoutDashboard, Sparkles } from "lucide-react";

export default function Home() {
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
          <LandingSection
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
