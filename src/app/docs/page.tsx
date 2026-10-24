"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Header } from "@/components/dashboard/Header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Code2,
  Copy,
  Check,
  ShieldCheck,
  Webhook,
  RefreshCw,
  Layers,
  Send,
  BookOpen,
  Key,
} from "lucide-react";

interface CodeBlockProps {
  code: string;
  language?: string;
  label?: string;
}

function CodeBlock({ code, language = "typescript", label }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="relative rounded-xl border border-zinc-800 bg-zinc-950/80 font-mono text-xs overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/50">
        <span className="text-zinc-400 font-sans text-xs font-medium">{label || language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors min-h-[36px] px-2.5 py-1 rounded hover:bg-zinc-800"
          aria-label={`Copy ${label || language} code to clipboard`}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-[11px] text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="text-[11px]">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-zinc-300 leading-relaxed font-mono">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<"quickstart" | "estimate" | "batches" | "get-batch" | "retry" | "webhooks">("quickstart");

  const estimateCurl = `curl -X POST https://app.circuitpay.io/api/transfers/estimate \\
  -H "Content-Type: application/json" \\
  -d '{
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "tokenSymbol": "USDC",
    "tokenDecimals": 6,
    "hops": 4,
    "arrivalSeconds": 900,
    "items": [
      { "recipientWallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "amountFormatted": "1500.00" },
      { "recipientWallet": "Bob4hYq7B98gD74G123kLMNop987654321ZYXwvutsr", "amountFormatted": "950.00" }
    ]
  }'`;

  const estimateTs = `const res = await fetch("https://circuitpay.vercel.app/api/transfers/estimate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tokenSymbol: "USDC",
    items: [
      { recipientWallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", amountFormatted: "1500.00" },
      { recipientWallet: "Bob4hYq7B98gD74G123kLMNop987654321ZYXwvutsr", amountFormatted: "950.00" },
    ],
    hops: 4,
  }),
});

const estimate = await res.json();
console.log("Estimated Fee:", estimate.estimatedFeeUsd);
console.log("Route Chunks:", estimate.chunksCount);`;

  const createBatchCurl = `curl -X POST https://app.circuitpay.io/api/batches \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer cp_live_..." \\
  -d '{
    "title": "Weekly Dev Stipends",
    "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "tokenSymbol": "USDC",
    "tokenDecimals": 6,
    "network": "mainnet-beta",
    "hops": 4,
    "items": [
      { "recipientWallet": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "amountFormatted": "1200.00" }
    ]
  }'`;

  const getBatchCurl = `curl -X GET https://app.circuitpay.io/api/batches/batch-core-dev-01 \\
  -H "Authorization: Bearer cp_live_..."`;

  const retryBatchCurl = `curl -X POST https://app.circuitpay.io/api/batches/batch-core-dev-01/retry \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer cp_live_..." \\
  -d '{
    "failedChunkIndexes": [0],
    "reason": "Solana RPC timeout during chunk dispersion"
  }'`;

  const webhookVerifyTs = `import crypto from "node:crypto";

/**
 * Verifies the HMAC-SHA256 signature from CircuitPay outbound webhooks
 */
export function verifyCircuitPayWebhook(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSeconds = 300
): boolean {
  // Header format: t={timestamp},v1={hex_signature}
  const parts = signatureHeader.split(",");
  let timestampStr = "";
  let receivedSig = "";

  for (const part of parts) {
    const [k, v] = part.trim().split("=");
    if (k === "t") timestampStr = v;
    if (k === "v1") receivedSig = v;
  }

  if (!timestampStr || !receivedSig) return false;

  // 1. Enforce 5-minute replay prevention window
  const timestamp = parseInt(timestampStr, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false; // Clock skew exceeded
  }

  // 2. Compute timing-safe HMAC-SHA256
  const expectedSig = crypto
    .createHmac("sha256", webhookSecret)
    .update(\`\${timestampStr}.\${rawBody}\`)
    .digest("hex");

  if (receivedSig.length !== expectedSig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expectedSig));
}`;

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header Hero */}
        <div className="rounded-2xl border border-indigo-900/60 bg-gradient-to-r from-indigo-950/40 via-zinc-900/80 to-zinc-950 p-6 sm:p-8 space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="info" className="font-mono text-xs">
              Developer Documentation
            </Badge>
            <span className="text-xs text-zinc-400">v1.0.0 Public REST Spec</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            CircuitPay REST API Reference
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400 max-w-3xl leading-relaxed">
            Integrate non-custodial multi-hop payroll directly into your dApp, backend server, or
            accounting systems. Build automated recurring disbursements, listen to HMAC-signed
            settlement webhooks, and enforce multi-approval rules.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3">
          {[
            { id: "quickstart", label: "REST API Access", icon: Code2 },
            { id: "estimate", label: "Estimate Fees", icon: Layers },
            { id: "batches", label: "Create Batch", icon: Send },
            { id: "get-batch", label: "Get Batch Status", icon: BookOpen },
            { id: "retry", label: "Retry Failed Chunks", icon: RefreshCw },
            { id: "webhooks", label: "Outbound Webhooks", icon: Webhook },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors min-h-[44px] ${
                  isActive
                    ? "bg-indigo-600 text-white font-semibold shadow-md shadow-indigo-600/30"
                    : "bg-zinc-900/80 text-zinc-400 hover:text-white hover:bg-zinc-800"
                }`}
                aria-selected={isActive}
                role="tab"
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        {activeTab === "quickstart" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Code2 className="h-5 w-5 text-indigo-400" />
                <span>REST API Access</span>
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Connect directly using standard REST HTTP requests authenticated with your organization API credentials.
                The API automatically handles 20-destination chunking, Base58 validation, and MultiHopper route preparation.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-3">
              <h3 className="text-sm font-semibold text-white">REST API Access</h3>
              <p className="text-sm text-zinc-300">
                REST API access is available to integration partners. Contact us to request your API key.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
              <Card className="border-zinc-800 bg-zinc-900/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-indigo-400">
                    <Key className="h-4 w-4" />
                    <CardTitle className="text-xs font-semibold">Zero Key Custody</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400">
                    Server-side secrets are never required for signing. Transactions are prepared into unsigned vectors and authorized via browser wallets.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-900/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-cyan-400">
                    <Layers className="h-4 w-4" />
                    <CardTitle className="text-xs font-semibold">Automatic Chunking</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400">
                    Batches with &gt;20 recipients are deterministically partitioned into 20-destination chunks adhering to MultiHopper protocol limits.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-900/40">
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 text-emerald-400">
                    <ShieldCheck className="h-4 w-4" />
                    <CardTitle className="text-xs font-semibold">Compliance Screening</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-zinc-400">
                    Each payout item is automatically evaluated against sanctions curves (0.00005 SOL fee), preventing treasury contamination.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === "estimate" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="info" className="font-mono text-xs">
                  POST
                </Badge>
                <span className="font-mono text-sm text-zinc-200">/api/transfers/estimate</span>
              </div>
              <p className="text-xs text-zinc-400">
                Compute deterministic protocol fees, screening fees, keeper funding SOL, and chunk counts prior to submitting a batch.
              </p>
            </div>

            <CodeBlock language="bash" label="cURL Request" code={estimateCurl} />
            <CodeBlock language="typescript" label="Client Fetch Example" code={estimateTs} />

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Parameters
              </h3>
              <div className="text-xs space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-indigo-300">tokenMint</span>
                  <span className="text-zinc-500 font-mono text-[11px]">(string, required)</span>
                  <span className="text-zinc-400">— Solana SPL token mint address (e.g. USDC).</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-indigo-300">items</span>
                  <span className="text-zinc-500 font-mono text-[11px]">(array, required)</span>
                  <span className="text-zinc-400">— Array of recipients with recipientWallet and amountFormatted.</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-indigo-300">hops</span>
                  <span className="text-zinc-500 font-mono text-[11px]">(integer, optional)</span>
                  <span className="text-zinc-400">— Number of intermediate multi-hop routing accounts (default: 4).</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "batches" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="info" className="font-mono text-xs">
                  POST
                </Badge>
                <span className="font-mono text-sm text-zinc-200">/api/batches</span>
              </div>
              <p className="text-xs text-zinc-400">
                Create a draft payout batch. Enforces per-organization safety caps, Base58 recipient checks, and partition chunk generation.
              </p>
            </div>

            <CodeBlock language="bash" label="cURL Request" code={createBatchCurl} />

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Multi-Approval Rules
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Batches totaling $\ge \$10,000$ USD enter an <code>awaiting_approval</code> state.
                Two distinct administrative approvals (owner or admin role) must be submitted via{" "}
                <code>POST /api/batches/:id/approve</code> before transaction vectors can be authorized.
              </p>
            </div>
          </div>
        )}

        {activeTab === "get-batch" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="success" className="font-mono text-xs">
                  GET
                </Badge>
                <span className="font-mono text-sm text-zinc-200">/api/batches/:id</span>
              </div>
              <p className="text-xs text-zinc-400">
                Retrieve live execution status, chunk settlement signatures, recipient items, and approval evaluation.
              </p>
            </div>

            <CodeBlock language="bash" label="cURL Request" code={getBatchCurl} />
          </div>
        )}

        {activeTab === "retry" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="warning" className="font-mono text-xs">
                  POST
                </Badge>
                <span className="font-mono text-sm text-zinc-200">/api/batches/:id/retry</span>
              </div>
              <p className="text-xs text-zinc-400">
                Re-dispatch partially failed chunks with exponential backoff and updated blockhash signatures.
              </p>
            </div>

            <CodeBlock language="bash" label="cURL Request" code={retryBatchCurl} />
          </div>
        )}

        {activeTab === "webhooks" && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Webhook className="h-5 w-5 text-indigo-400" />
                <span>Signed Outbound Webhooks &amp; HMAC Verification</span>
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                When a payout batch completes or encounters an error, CircuitPay delivers signed
                payloads to your customer webhook URL. Payloads include <code>x-circuitpay-signature</code>{" "}
                (<code>t=...,v1=...</code>) and <code>x-circuitpay-timestamp</code> headers.
              </p>
            </div>

            <CodeBlock
              language="typescript"
              label="Node.js HMAC Signature Verification"
              code={webhookVerifyTs}
            />

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider font-mono">
                Webhook Event Types
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 space-y-1">
                  <span className="font-mono text-emerald-400 font-semibold">batch.completed</span>
                  <p className="text-zinc-500 text-[11px]">All chunks confirmed and settled on-chain.</p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 space-y-1">
                  <span className="font-mono text-red-400 font-semibold">batch.failed</span>
                  <p className="text-zinc-500 text-[11px]">Terminal execution or keeper funding failure.</p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800 space-y-1">
                  <span className="font-mono text-amber-400 font-semibold">batch.awaiting_approval</span>
                  <p className="text-zinc-500 text-[11px]">Batch exceeds $10k multi-approval threshold.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-6 text-center text-xs text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>CircuitPay Developer Documentation • Non-Custodial Multi-Hop Protocol</span>
          <Link href="/" className="text-indigo-400 hover:text-indigo-300">
            &larr; Back to App Dashboard
          </Link>
        </div>
      </footer>
    </div>
  );
}
