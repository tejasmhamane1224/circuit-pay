"use client";

import React from "react";
import { formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MULTIHOPPER_RULES } from "@/lib/constants";
import { Layers, Route, Clock, ChevronRight } from "lucide-react";

interface FeeRoutePreviewProps {
  recipientCount: number;
  totalAmountFormatted: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  hops: number;
  arrivalSeconds: number;
  onHopsChange: (hops: number) => void;
  onArrivalSecondsChange: (seconds: number) => void;
}

interface EstimateApiData {
  tier: string;
  percentFeeBps: number;
  percentFeeRaw: string;
  totalFlatFeeLamports: string;
  integratorPercentShare: string;
  integratorFlatShare: string;
  hopAmountRaw: string;
  priceSource: string;
  sol: {
    requiredSolUpFrontLamports: string;
    breakdown: {
      screeningFeeLamports: string;
      keeperFundingLamports: string;
    };
  };
}

export function FeeRoutePreview({
  recipientCount,
  totalAmountFormatted,
  tokenSymbol = "USDC",
  tokenDecimals = 6,
  hops,
  arrivalSeconds,
  onHopsChange,
  onArrivalSecondsChange,
}: FeeRoutePreviewProps) {
  const [estimateData, setEstimateData] = React.useState<EstimateApiData | null>(null);
  const [isEstimating, setIsEstimating] = React.useState(false);

  const totalAmount = parseFloat(totalAmountFormatted) || 0;
  const chunkCount = Math.ceil(recipientCount / MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK) || 1;

  // Live fee estimation via POST /api/transfers/estimate
  React.useEffect(() => {
    let isCancelled = false;
    const fetchEstimate = async () => {
      if (recipientCount <= 0 || totalAmount <= 0) {
        setEstimateData(null);
        return;
      }

      setIsEstimating(true);
      try {
        const parts = totalAmountFormatted.split(".");
        const integerPart = BigInt(parts[0] || "0");
        const fractionalStr = (parts[1] || "").padEnd(tokenDecimals, "0").slice(0, tokenDecimals);
        const fractionalPart = BigInt(fractionalStr || "0");
        const amountRaw = (integerPart * (BigInt(10) ** BigInt(tokenDecimals)) + fractionalPart).toString();

        const tokenMint =
          tokenSymbol === "SOL"
            ? "So11111111111111111111111111111111111111112"
            : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

        const res = await fetch("/api/transfers/estimate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-integration-id": "circuitpay_treasury_v1",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            tokenMint,
            tokenSymbol,
            tokenDecimals,
            amountRaw: amountRaw !== "0" ? amountRaw : "1000000",
            hops,
            arrivalSeconds,
          }),
        });

        const data = await res.json();
        if (!isCancelled && data.success) {
          setEstimateData(data);
        }
      } catch {
        // Fallback to local calculation if network error
      } finally {
        if (!isCancelled) setIsEstimating(false);
      }
    };

    fetchEstimate();
    return () => {
      isCancelled = true;
    };
  }, [recipientCount, totalAmountFormatted, tokenSymbol, tokenDecimals, hops, arrivalSeconds, totalAmount]);

  // Derived or live values
  const percentFee = estimateData
    ? Number(estimateData.percentFeeRaw) / 10 ** tokenDecimals
    : totalAmount * 0.005;
  const integratorShare = estimateData
    ? Number(estimateData.integratorPercentShare) / 10 ** tokenDecimals
    : percentFee * 0.5;
  const screeningSol = estimateData
    ? Number(estimateData.sol.breakdown.screeningFeeLamports) / 1e9
    : recipientCount * MULTIHOPPER_RULES.SCREENING_FEE_SOL;
  const protocolRequiredSol = estimateData
    ? Number(estimateData.sol.requiredSolUpFrontLamports) / 1e9
    : screeningSol + 0.005 * chunkCount;
  const flatFeeLamports = estimateData ? estimateData.totalFlatFeeLamports : (375000 * hops).toString();

  const solUsdRate = 150;
  const totalCostSol =
    tokenSymbol === "SOL"
      ? totalAmount + percentFee + protocolRequiredSol
      : protocolRequiredSol;
  const totalCostUsd =
    tokenSymbol === "SOL"
      ? (totalAmount + percentFee) * solUsdRate + protocolRequiredSol * solUsdRate
      : totalAmount + percentFee + protocolRequiredSol * solUsdRate;

  // Quick timing presets
  const timingPresets = [
    { label: "Express", seconds: 300, desc: "~5 min" },
    { label: "Standard", seconds: 900, desc: "~15 min" },
    { label: "Stealth", seconds: 3600, desc: "~1 hour" },
  ];

  return (
    <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-white">MultiHopper Route &amp; Fee Architecture</h3>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] font-mono">
            {tokenSymbol}
          </Badge>
          <Badge variant="info" className="font-mono text-[10px] flex items-center gap-1">
            {isEstimating ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
            0.5% Customer Fee (Live MultiHopper API)
          </Badge>
        </div>
      </div>

      {/* Real Payout Fee & Cost Summary Banner (Phase 2 Spec) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800">
        <div>
          <span className="text-[10px] text-zinc-400 block font-medium">Customer Fee (0.5%)</span>
          <span className="text-sm font-bold text-emerald-400 font-mono">
            {tokenSymbol === "SOL" ? `${percentFee.toFixed(4)} SOL` : formatUsd(percentFee)}
          </span>
          <span className="text-[10px] text-zinc-500 block">50 bps protocol fee</span>
        </div>
        <div>
          <span className="text-[10px] text-zinc-400 block font-medium">Estimated Arrival</span>
          <span className="text-sm font-bold text-white font-mono">
            ~{Math.round(arrivalSeconds / 60)} min
          </span>
          <span className="text-[10px] text-zinc-500 block">{arrivalSeconds}s target</span>
        </div>
        <div>
          <span className="text-[10px] text-zinc-400 block font-medium">Hop Count</span>
          <span className="text-sm font-bold text-indigo-400 font-mono">{hops} Hops</span>
          <span className="text-[10px] text-zinc-500 block">Multi-hop route</span>
        </div>
        <div>
          <span className="text-[10px] text-zinc-400 block font-medium">Total Cost in SOL</span>
          <span className="text-sm font-bold text-amber-400 font-mono">{totalCostSol.toFixed(4)} SOL</span>
          <span className="text-[10px] text-zinc-500 block">{tokenSymbol === "SOL" ? "Principal + Fee + Gas" : "Screening + Gas"}</span>
        </div>
        <div>
          <span className="text-[10px] text-zinc-400 block font-medium">Total Cost in USD</span>
          <span className="text-sm font-bold text-cyan-300 font-mono">{formatUsd(totalCostUsd)}</span>
          <span className="text-[10px] text-zinc-500 block">All-in Payout Cost</span>
        </div>
      </div>

      {/* Grid of detailed calculations */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
          <span className="text-[10px] text-zinc-400 block font-medium">Protocol Routing Fee (0.50%)</span>
          <span className="text-sm font-bold text-emerald-400">{formatUsd(percentFee)}</span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">50 bps + {Number(flatFeeLamports).toLocaleString()} lamports</span>
        </div>

        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
          <span className="text-[10px] text-zinc-400 block font-medium">Integrator Revenue Share (50%)</span>
          <span className="text-sm font-bold text-cyan-400">{formatUsd(integratorShare)}</span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Your treasury split</span>
        </div>

        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
          <span className="text-[10px] text-zinc-400 block font-medium">TRM Screening SOL</span>
          <span className="text-sm font-bold text-amber-400">{screeningSol.toFixed(3)} SOL</span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">0.002 SOL / dest</span>
        </div>

        <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
          <span className="text-[10px] text-zinc-400 block font-medium">Required SOL Up-Front</span>
          <span className="text-sm font-bold text-white">{protocolRequiredSol.toFixed(3)} SOL</span>
          <span className="text-[10px] text-zinc-500 block mt-0.5">Screening + Keeper gas</span>
        </div>
      </div>

      {/* 20-Destination Chunking Guard Notification */}
      <div className="p-3 rounded-lg bg-indigo-950/20 border border-indigo-900/60 flex items-start gap-2.5">
        <Layers className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-indigo-200">
              MultiHopper 20-Destination Partitioning Guard:
            </span>
            <Badge variant="info" className="text-[10px] py-0 font-mono">
              {chunkCount} {chunkCount === 1 ? "Transfer" : "Chunked Transfers"}
            </Badge>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            MultiHopper smart contracts strictly limit dispersion to $\le 20$ destination accounts per transfer.
            This batch of <strong className="text-zinc-200">{recipientCount} recipients</strong> will automatically deploy across{" "}
            <strong className="text-indigo-300">{chunkCount} independent on-chain dispersion sessions</strong>.
          </p>
        </div>
      </div>

      {/* Route Parameters Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        {/* Hop Count (3 to 10) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-zinc-300 flex items-center gap-1.5">
              <Route className="h-3.5 w-3.5 text-indigo-400" /> Multi-Hop Anonymization Length
            </label>
            <span className="font-mono text-indigo-400 font-semibold">{hops} Hops</span>
          </div>

          <div className="flex items-center gap-2">
            {[3, 4, 6, 8, 10].map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onHopsChange(h)}
                className={`flex-1 py-1.5 text-xs font-mono rounded-lg border transition-all ${
                  hops === h
                    ? "bg-indigo-600 text-white border-indigo-500 font-semibold shadow-md shadow-indigo-600/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                {h} Hops
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-500 block">
            MultiHopper protocol supports 3 to 10 intermediary smart contract hops.
          </span>
        </div>

        {/* Arrival Seconds Presets */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <label className="font-medium text-zinc-300 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-indigo-400" /> Arrival Timing Schedule
            </label>
            <span className="font-mono text-zinc-300">
              {arrivalSeconds >= 60 ? `${Math.round(arrivalSeconds / 60)} min` : `${arrivalSeconds}s`}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {timingPresets.map((preset) => (
              <button
                key={preset.seconds}
                type="button"
                onClick={() => onArrivalSecondsChange(preset.seconds)}
                className={`py-1 px-2 text-xs rounded-lg border transition-all text-center ${
                  arrivalSeconds === preset.seconds
                    ? "bg-indigo-600 text-white border-indigo-500 font-semibold shadow-md shadow-indigo-600/30"
                    : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-zinc-700 hover:text-zinc-200"
                }`}
              >
                <div className="font-medium">{preset.label}</div>
                <div className="text-[10px] opacity-75 font-mono">{preset.desc}</div>
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-500 block">
            MultiHopper keepers stagger hops over this duration to decorrelate tx graphs.
          </span>
        </div>
      </div>

      {/* Visual Dynamic Route Pipeline */}
      <div className="pt-2">
        <span className="text-xs font-medium text-zinc-400 block mb-2">Simulated Multi-Hop Graph</span>
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {/* Source Treasury */}
          <div className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-center shrink-0">
            <span className="text-[9px] text-zinc-500 uppercase block">Treasury</span>
            <span className="text-xs font-mono font-semibold text-white">Sender</span>
          </div>

          <ChevronRight className="h-4 w-4 text-zinc-600 shrink-0" />

          {/* Dynamic Hops */}
          {Array.from({ length: hops }, (_, i) => (
            <React.Fragment key={i}>
              <div className="px-2 py-1.5 rounded-lg bg-indigo-950/40 border border-indigo-800/60 text-center shrink-0">
                <span className="text-[9px] text-indigo-400 uppercase block font-mono">Hop #{i + 1}</span>
                <span className="text-[11px] font-mono text-zinc-300">
                  {i === 0 ? "Orchestrator" : i === hops - 1 ? "Dispersion" : `Node ${i + 1}`}
                </span>
              </div>
              {i < hops - 1 && <ChevronRight className="h-3 w-3 text-zinc-700 shrink-0" />}
            </React.Fragment>
          ))}

          <ChevronRight className="h-4 w-4 text-zinc-600 shrink-0" />

          {/* Destinations */}
          <div className="px-2.5 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-center shrink-0">
            <span className="text-[9px] text-emerald-400 uppercase block font-mono">
              {recipientCount} Recipients
            </span>
            <span className="text-xs font-mono font-semibold text-emerald-300">Disbursed</span>
          </div>
        </div>
      </div>
    </div>
  );
}
