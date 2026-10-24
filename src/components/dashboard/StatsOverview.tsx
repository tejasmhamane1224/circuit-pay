"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/utils";
import { Trophy, Coins, Share2, Layers, ArrowUpRight } from "lucide-react";

interface StatsOverviewProps {
  qualifyingVolumeUsd: number;
  collectedFeesUsd: number;
  integratorShareUsd: number;
  totalBatchesCount: number;
  totalDestinationsCount: number;
  chunksCount: number;
}

export function StatsOverview({
  qualifyingVolumeUsd,
  collectedFeesUsd,
  integratorShareUsd,
  totalBatchesCount,
  totalDestinationsCount,
  chunksCount,
}: StatsOverviewProps) {
  const targetThreshold = 100000;
  const progressPercent = Math.min(100, Math.round((qualifyingVolumeUsd / targetThreshold) * 100));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Superteam Earn Challenge Volume */}
      <Card className="border-indigo-800/40 bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-zinc-900/80 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-3 opacity-10">
          <Trophy className="h-20 w-20 text-indigo-400" />
        </div>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
              <Trophy className="h-3.5 w-3.5 text-indigo-400" />
              Superteam Earn Volume
            </span>
            <Badge variant="info" className="text-[10px] py-0 font-mono">
              Mainnet
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold text-white pt-1">
            {formatUsd(qualifyingVolumeUsd)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>Target: $100,000</span>
              <span className="text-indigo-300 font-medium">{progressPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 pt-1 font-mono">
              formula: fees / 0.0025 {qualifyingVolumeUsd === 0 ? "• No transfers yet" : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 2. Collected MultiHopper Fees */}
      <Card className="border-zinc-800/80 bg-zinc-900/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Coins className="h-3.5 w-3.5 text-emerald-400" />
              MultiHopper Protocol Fees
            </span>
            <Badge variant="success" className="text-[10px] py-0 font-mono">
              0.50%
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold text-white pt-1">
            {formatUsd(collectedFeesUsd)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-zinc-400">
            Atomic on-chain wrap/unwrap fee collected via Token2022 Transfer Hook.
          </p>
        </CardContent>
      </Card>

      {/* 3. Integrator 50% Share */}
      <Card className="border-zinc-800/80 bg-zinc-900/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5 text-cyan-400" />
              CircuitPay 50% Revenue
            </span>
            <span className="text-emerald-400 text-xs flex items-center font-mono">
              <ArrowUpRight className="h-3 w-3" /> 50% split
            </span>
          </div>
          <CardTitle className="text-2xl font-bold text-white pt-1">
            {formatUsd(integratorShareUsd)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-zinc-400">
            Paid directly on-chain to integrator rewards wallet on route initialization.
          </p>
        </CardContent>
      </Card>

      {/* 4. MultiHopper 20-Cap Chunking */}
      <Card className="border-zinc-800/80 bg-zinc-900/60">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-violet-400" />
              Transfers & Chunking
            </span>
            <Badge variant="outline" className="text-[10px] py-0 font-mono">
              Max 20/chunk
            </Badge>
          </div>
          <CardTitle className="text-2xl font-bold text-white pt-1">
            {totalDestinationsCount}{" "}
            <span className="text-sm font-normal text-zinc-400">recipients</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>{totalBatchesCount} batches created</span>
            <span className="text-violet-300 font-mono">{chunksCount} MultiHopper chunks</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
