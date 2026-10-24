"use client";

import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { createSIWSMessage } from "@/lib/siws/message";
import type { SessionPayload } from "@/lib/siws/session";

export function useSIWS() {
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch current session once on mount using async lifecycle
  useEffect(() => {
    let isCancelled = false;

    async function fetchSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const data = await res.json();
          if (!isCancelled && data.authenticated && data.session) {
            setSession(data.session);
          }
        }
      } catch {
        // No session active
      }
    }

    fetchSession();

    return () => {
      isCancelled = true;
    };
  }, []);

  const signIn = async () => {
    if (!connected || !publicKey) {
      setError("Wallet is not connected. Please connect your wallet first.");
      return false;
    }

    if (!signMessage) {
      setError("Connected wallet does not support cryptographic message signing.");
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Fetch fresh nonce from server
      const nonceRes = await fetch("/api/auth/nonce", { method: "POST" });
      if (!nonceRes.ok) {
        throw new Error("Failed to obtain authentication nonce from server");
      }
      const { nonce, issuedAt } = await nonceRes.json();

      // 2. Format standard SIWS message
      const domain = typeof window !== "undefined" ? window.location.host : "circuitpay.app";
      const uri = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
      const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
      const expirationTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      const message = createSIWSMessage({
        domain,
        address: publicKey.toBase58(),
        statement: "Sign in with Solana to authenticate with CircuitPay treasury portal.",
        uri,
        chainId: `solana:${network}`,
        nonce,
        issuedAt,
        expirationTime,
      });

      // 3. User signs cryptographic message via wallet
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signatureBase58 = bs58.encode(signatureBytes);

      // 4. Verify signature on backend
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          signature: signatureBase58,
          publicKey: publicKey.toBase58(),
          nonce,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.success) {
        throw new Error(verifyData.error || "Cryptographic SIWS verification rejected by server");
      }

      // 5. Update session in state
      const sessionRes = await fetch("/api/auth/session");
      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();
        if (sessionData.authenticated && sessionData.session) {
          setSession(sessionData.session);
        }
      }

      setIsLoading(false);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sign in with Solana";
      setError(msg);
      setIsLoading(false);
      return false;
    }
  };

  const signOut = async () => {
    setIsLoading(true);
    try {
      await fetch("/api/auth/session", { method: "DELETE" });
      setSession(null);
      await disconnect();
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  };

  const effectiveSession = connected ? session : null;

  return {
    session: effectiveSession,
    isAuthenticated: !!effectiveSession && effectiveSession.address === publicKey?.toBase58(),
    isLoading,
    error,
    signIn,
    signOut,
  };
}
