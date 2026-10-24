"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";

interface SolanaWalletProviderProps {
  children: React.ReactNode;
}

export function SolanaWalletProvider({ children }: SolanaWalletProviderProps) {
  // Support devnet or mainnet-beta via env
  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK as "devnet" | "mainnet-beta") || "devnet";
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (customRpc && !(network === "mainnet-beta" && customRpc.includes("devnet"))) {
      return customRpc;
    }
    return clusterApiUrl(network);
  }, [network]);

  // Backpack implements the Solana Wallet Standard and is auto-detected.
  // Explicitly instantiate Phantom and Solflare for full backwards compatibility.
  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter(),
  ], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
