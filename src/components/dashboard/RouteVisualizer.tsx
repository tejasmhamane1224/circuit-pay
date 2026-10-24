"use client";

import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, CheckCircle2, Zap, RefreshCw } from "lucide-react";

export function RouteVisualizer() {
  const steps = [
    {
      num: 1,
      title: "Keeper Funding",
      tx: "keeperFundingTx",
      format: "VersionedTransaction v0",
      description: "Funds protocol keepers for automated on-chain hop transitions and rent.",
      status: "First Broadcast & Confirm",
    },
    {
      num: 2,
      title: "Route Initialization",
      tx: "routeInitTxs[]",
      format: "VersionedTransaction v0",
      description: "Deploys intermediate hop accounts with Permanent Delegate PDA [b'delegate', route_id].",
      status: "Wait 3s after RPC confirm",
    },
    {
      num: 3,
      title: "Orchestrator State Machine",
      tx: "orchestratorInitTx",
      format: "Legacy Transaction (partialSign)",
      description: "Deploys multi-step route state machine via audited MultiHopper program.",
      status: "Wait 3s after RPC confirm",
    },
    {
      num: 4,
      title: "Dispersion & Hook Guard",
      tx: "dispersionInitTxs[]",
      format: "Token2022 Extension",
      description: "Binds up to 20 destinations. Transfer Hook Guard enforces route integrity.",
      status: "Final Confirm Broadcast",
    },
  ];

  return (
    <Card className="border-zinc-800/80 bg-zinc-900/60">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-400" />
              <CardTitle>Non-Custodial Multi-Hop Transfer Lifecycle</CardTitle>
            </div>
            <CardDescription className="pt-1">
              MultiHopper 4-step state machine broadcast protocol. Zero server custody; sender signs with own wallet.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[11px] gap-1 text-emerald-400 border-emerald-900/50">
              <Shield className="h-3 w-3" /> Non-Custodial
            </Badge>
            <Badge variant="outline" className="font-mono text-[11px] gap-1 text-cyan-400 border-cyan-900/50">
              <RefreshCw className="h-3 w-3" /> Idempotent
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative">
          {steps.map((step) => (
            <div
              key={step.num}
              className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-950/40 flex flex-col justify-between space-y-2 relative"
            >
              <div>
                <div className="flex items-center justify-between pb-1">
                  <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-900/50">
                    Step {step.num}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">{step.format}</span>
                </div>
                <h4 className="text-sm font-semibold text-white pt-1">{step.title}</h4>
                <p className="text-xs font-mono text-cyan-400/90 pt-0.5">{step.tx}</p>
                <p className="text-[11px] text-zinc-400 pt-2 leading-relaxed">{step.description}</p>
              </div>
              <div className="pt-2 border-t border-zinc-800/60">
                <span className="text-[10px] text-amber-400/90 font-mono flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-amber-400" />
                  {step.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
