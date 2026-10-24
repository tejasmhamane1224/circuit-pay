"use client";

import React, { useSyncExternalStore } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useSIWS } from "@/hooks/useSIWS";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { truncateAddress } from "@/lib/utils";
import { Shield, CheckCircle2, AlertTriangle, ArrowRight, LogOut, Lock, LayoutDashboard, Award, BookOpen } from "lucide-react";
import { trackEvent, identifyWalletUser, resetAnalyticsUser } from "@/lib/analytics/posthog";

// Dynamically import WalletMultiButton without SSR
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

function useIsMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

export function Header() {
  const { connected, publicKey } = useWallet();
  const { isAuthenticated, isLoading, error, signIn, signOut } = useSIWS();
  const mounted = useIsMounted();

  const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";

  React.useEffect(() => {
    if (connected && publicKey) {
      const address = publicKey.toBase58();
      identifyWalletUser(address);
      trackEvent("wallet_connected", {
        wallet: address,
        network,
      });
    } else {
      resetAnalyticsUser();
    }
  }, [connected, publicKey, network]);

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand & Nav */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-md shadow-indigo-500/20">
              <Lock className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-white tracking-tight">CircuitPay</span>
                <Badge variant="info" className="text-[10px] uppercase font-mono py-0">
                  MultiHopper Powered
                </Badge>
              </div>
              <p className="text-[11px] text-zinc-400">Non-Custodial Routed Solana Treasury & Payroll</p>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1 border-l border-zinc-800 pl-4">
            <Link
              href="/"
              className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white rounded-md hover:bg-zinc-900 transition-colors flex items-center gap-1.5 min-h-[44px]"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>Dashboard</span>
            </Link>
            <Link
              href="/docs"
              className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white rounded-md hover:bg-zinc-900 transition-colors flex items-center gap-1.5 min-h-[44px]"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>API Docs</span>
            </Link>
            <Link
              href="/evidence"
              className="px-3 py-1.5 text-xs font-medium text-indigo-400 hover:text-indigo-300 rounded-md hover:bg-zinc-900 transition-colors flex items-center gap-1.5 min-h-[44px]"
            >
              <Award className="h-3.5 w-3.5" />
              <span>$50k Earn Evidence</span>
            </Link>
          </nav>
        </div>

        {/* Network & Wallet Controls */}
        <div className="flex items-center gap-3">
          <Badge
            variant={network === "mainnet-beta" ? "success" : "warning"}
            className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-1"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                network === "mainnet-beta" ? "bg-emerald-400 animate-pulse" : "bg-amber-400 animate-pulse"
              }`}
            />
            <span>{network === "mainnet-beta" ? "MAINNET" : "DEVNET"}</span>
          </Badge>

          {mounted && (
            <div className="flex items-center gap-2">
              <WalletMultiButton className="!bg-zinc-800 hover:!bg-zinc-700 !h-9 !rounded-lg !text-xs !font-medium !transition-colors !font-sans" />

              {connected && publicKey && (
                <>
                  {isAuthenticated ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="success" className="py-1 px-2.5 gap-1.5">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="font-mono text-xs">SIWS Verified: {truncateAddress(publicKey.toBase58())}</span>
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={signOut}
                        className="text-zinc-400 hover:text-red-400 h-8 px-2"
                        title="Sign Out"
                      >
                        <LogOut className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={signIn}
                      disabled={isLoading}
                      className="gap-1.5 shadow-md shadow-indigo-600/30"
                    >
                      <Shield className="h-3.5 w-3.5" />
                      {isLoading ? "Signing..." : "Sign-In With Solana (SIWS)"}
                      <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-950/60 border-t border-b border-red-800/80 px-4 py-2 text-xs text-red-300 flex items-center justify-between">
          <div className="flex items-center gap-2 max-w-7xl mx-auto w-full">
            <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
            <span>Authentication Error: {error}</span>
          </div>
        </div>
      )}
    </header>
  );
}
