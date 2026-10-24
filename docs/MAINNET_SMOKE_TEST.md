# CircuitPay — Solana Mainnet-Beta Micro-Amount Smoke Test Guide

> **CRITICAL NON-CUSTODIAL SAFETY DIRECTIVE**
> CircuitPay is strictly non-custodial. The backend server NEVER holds private keys or executes mainnet transactions autonomously.
> **DO NOT** execute large volumes during initial smoke testing. Perform all steps manually using micro amounts (**1.00 USDC** or **0.01 SOL**) with your browser wallet (Phantom, Solflare, or Backpack) to verify on-chain MultiHopper routing before scaling treasury volume.

---

## 1. Required Production Environment Variables (Vercel)

Ensure every single environment variable below is configured in your **Vercel Project Settings &rarr; Environment Variables** before running the test:

| Variable | Description | Exposure | Recommended Mainnet Value |
| :--- | :--- | :--- | :--- |
| `MULTIHOPPER_API_KEY` | MultiHopper Production API Key | Server-Only | `mh_live_...` |
| `MULTIHOPPER_WEBHOOK_SECRET` | HMAC-SHA256 Webhook Secret | Server-Only | `whsec_...` |
| `MULTIHOPPER_REWARDS_WALLET` | Integrator Revenue Split Wallet | Server-Only | `3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh` |
| `NEXT_PUBLIC_MULTIHOPPER_CORE_PROGRAM` | MultiHopper Core Program ID | Public | `3jLoS2wbNgtKzieUUxwg6Xhdv6gbZkHDtPWA9ZAgspFh` |
| `NEXT_PUBLIC_MULTIHOPPER_ORCHESTRATOR_PROGRAM` | MultiHopper Orchestrator Program ID | Public | `4TPCmR2uN3hDM1FbTsf7ZtFXwXGSz4u1Kxv5YHj6eruX` |
| `NEXT_PUBLIC_MULTIHOPPER_HOOK_GUARD_PROGRAM` | MultiHopper Hook Guard Program ID | Public | `2JEv3pD6nczEvn1xDXaEzehkJofPPjoQQpnW5nGY3r52` |
| `NEXT_PUBLIC_SOLANA_NETWORK` | Target Solana Network | Public | `mainnet-beta` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | High-Throughput Solana RPC | Public | `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` |
| `HELIUS_API_KEY` | Dedicated RPC Key | Server-Only | `your-helius-key` |
| `DATABASE_URL` | PostgreSQL Connection String | Server-Only | `postgresql://postgres:...@.../postgres?sslmode=require` |
| `SUPABASE_URL` | Supabase Project URL | Server-Only | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | Server-Only | `eyJhbGciOi...` |
| `SESSION_SECRET` | 32+ byte SIWS session secret | Server-Only | Strong random entropy |
| `NEXT_PUBLIC_APP_DOMAIN` | Production App Domain | Public | `circuitpay.vercel.app` (or custom domain) |
| `SENTRY_DSN` | Server Sentry DSN | Server-Only | `https://...ingest.sentry.io/...` |
| `NEXT_PUBLIC_SENTRY_DSN` | Client Sentry DSN | Public | `https://...ingest.sentry.io/...` |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog Project API Key | Public | `phc_...` |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog Ingestion Host | Public | `https://us.i.posthog.com` |
| `RATE_LIMIT_BATCHES_PER_MIN` | Batch Creation Rate Limit | Server-Only | `30` |
| `RATE_LIMIT_WEBHOOKS_PER_MIN` | Webhook Ingestion Limit | Server-Only | `120` |
| `RATE_LIMIT_RETRY_PER_MIN` | Batch Retry Rate Limit | Server-Only | `10` |
| `MAX_BATCH_AMOUNT_USD` | Single Batch Amount Cap | Server-Only | `100000` |
| `MAX_RECIPIENTS_PER_BATCH` | Recipient Cap per Batch | Server-Only | `500` |
| `DAILY_ORG_VOLUME_LIMIT_USD` | Daily Organization Volume Cap | Server-Only | `500000` |
| `SOL_USD_RATE` | Valuation Rate for SOL in USD | Server-Only | `150` |
| `MULTIHOPPER_USE_MOCK` | Mock Mode Override (must be false on mainnet) | Server-Only | `false` |

---

## 2. Step-by-Step Micro-Amount Smoke Test

### Step 1: Pre-Flight Wallet & Balance Verification
1. Open your browser wallet extension (**Phantom**, **Solflare**, or **Backpack**).
2. Switch network settings to **Solana Mainnet-Beta**.
3. Verify test wallet balances:
   - **SOL balance:** At least `0.05 SOL` (to cover network fees, keeper funding, and rent).
   - **USDC balance:** At least `1.00 USDC` (or use `0.01 SOL` for SOL transfers).
4. Navigate to your deployed production URL: `https://<your-vercel-deployment>.vercel.app`.
5. Check top header indicator:
   - Must display `MAINNET-BETA` with green pulsating badge.
   - Sentry and PostHog are initialized in the background (no console errors).

### Step 2: SIWS Authentication Handshake
1. Click **Select Wallet** in the top-right header and connect your Phantom/Backpack wallet.
2. Click **Sign-In With Solana (SIWS)**.
3. Your wallet will prompt you to sign a standardized SIWS message containing:
   - Domain (`circuitpay.vercel.app`)
   - Address (`<your_wallet_pubkey>`)
   - Nonce and expiration timestamp.
4. Verify signature in wallet: zero SOL or token transfer requested. Approve signature.
5. Header updates to: `SIWS Verified: <pubkey>` with green checkmark.

### Step 3: Preparing a Micro-Amount Payout Batch
1. Click **+ New Payout Batch** in the dashboard.
2. Enter the following parameters:
   - **Batch Title:** `Mainnet Micro Smoke Test 001`
   - **Token:** `USDC (Token2022 / SPL)` (or `SOL`)
   - **Hops:** `4` (standard MultiHopper obfuscation)
   - **Arrival Window:** `900` seconds (15 minutes)
3. Add Recipient:
   - Option A: Click **Add Recipient** manually and input a secondary personal Solana address you own.
   - Option B: Click **Import CSV** and paste:
     ```csv
     wallet,amount,name
     <YOUR_SECONDARY_SOLANA_WALLET>,1.00,Smoke Test Destination
     ```
4. Verify the **Fee & Route Preview**:
   - Total Batch Volume: `$1.00 USD`
   - MultiHopper 0.50% routing fee: `$0.0050 USD`
   - Integrator 50% revenue share: `$0.0025 USD`
   - TRM screening fee: `0.002 SOL`
   - Keeper funding: `0.005 SOL`
   - Partitioning: `1 Chunk` ($\le 20$ destinations)
5. Click **Create Batch**. The batch transitions to `draft`.

### Step 4: Non-Custodial Multi-Send Wallet Signing
1. The **Multi-Send Wallet Signing Modal** will open automatically (or click **Sign & Broadcast** on the batch).
2. Click **Start Multi-Send Signing**.
3. Inspect your wallet popup carefully:
   - **Interacting Programs:** MultiHopper Core (`3jLoS2wb...`) and MultiHopper Orchestrator (`4TPCmR2u...`).
   - **Authorized Debit:** Exactly `1.00 USDC` + protocol SOL fees.
   - **DO NOT** approve if any unexpected permissions or unauthorized tokens appear.
4. Click **Confirm** in your wallet.
5. The modal will display live execution steps:
   - Step 1: Prepared 1 transfer chunk for signing
   - Step 2: Keeper Funding Confirmed (Signature visible)
   - Step 3: Route Init Hops Deployed (Signature visible)
   - Step 4: Dispersion Program Instantiated (Signature visible)
   - Step 5: Signatures Verified & Broadcast Confirmed

### Step 5: Explorer & Route Verification
1. Click on the transaction signature links displayed in the modal or batch detail view.
2. In **Solana Explorer** or **Solscan**, verify:
   - Transaction status: `Success`
   - Confirmations: `Finalized`
   - Core and Orchestrator instructions executed cleanly.
3. The batch status in CircuitPay transitions from `draft` &rarr; `awaiting_signature` &rarr; `processing`.

### Step 6: MultiHopper Webhook & Challenge Volume Settlement
1. As the MultiHopper keeper routes the funds through intermediate hops, MultiHopper posts cryptographically signed webhooks to `/api/webhooks/multihopper`.
2. Upon destination settlement:
   - Webhook event: `transfer.completed`.
   - Webhook HMAC signature is verified using `MULTIHOPPER_WEBHOOK_SECRET`.
   - Replay deduplication prevents duplicate credits.
   - Payout item marks status as `paid` with destination `payoutSignature`.
   - Batch status updates to `completed` (`Settled`).
3. Check the **Superteam Earn $50,000 Challenge Tracker** at `/evidence`:
   - Qualifying Volume formula:
     $$\text{Qualifying Volume} = \frac{\text{Collected Fees}}{0.0025}$$
   - On a `$1.00 USDC` transfer with 50 bps fee ($0.0050):
     $$\text{Qualifying Volume} = \frac{\$0.0050}{0.0025} = \$2.00\text{ USD}$$
   - Integrator revenue share: `$0.0025 USD`.

### Step 7: Receipt & Accounting Audit Export
1. On the Batch Detail page, click **Export CSV**.
   - Download the DAO bookkeeping CSV receipt (`circuitpay-receipt-<batchId>.csv`).
   - Verify all columns: `Batch ID`, `Recipient Wallet`, `Amount`, `Status (paid)`, `Payout Signature`, `Variance (0)`.
2. Click **Print PDF**.
   - Review printable PDF receipt formatted with verification QR code and cryptographic audit hashes.

---

## 3. Emergency Contingency & Troubleshooting Runbook

| Incident | Cause | Immediate Action |
| :--- | :--- | :--- |
| **HTTP 429 Too Many Requests** | Exceeded sliding window rate limit (30 batches/min, 10 retries/min). | Check `Retry-After` header. Wait 60 seconds before retrying. |
| **HTTP 400 Batch Amount Exceeded** | Batch amount exceeds `MAX_BATCH_AMOUNT_USD` ($100,000 USD default). | Partition payouts across multiple batches or adjust env var. |
| **HTTP 400 Daily Volume Exceeded** | Organization daily limit exceeds `DAILY_ORG_VOLUME_LIMIT_USD` ($500,000 USD). | Wait until next 24h rolling window or contact treasury admin. |
| **RPC Timeout / Blockhash Expired** | Solana network congestion on public RPC. | Ensure `NEXT_PUBLIC_SOLANA_RPC_URL` points to a dedicated Helius/Triton endpoint. Click **Idempotent Retry Batch** in dashboard. |
| **Stuck Transfer in Keeper Hop** | Keeper node delayed during off-peak hours. | Wait until arrival window (900s). If expired, click **Manual Reconciliation** in batch detail view to record audit resolution. |

---

## 4. Post-Test Scaling Sign-Off

Once your micro-amount smoke test of 1.00 USDC or 0.01 SOL has settled with 0 variance and valid signatures on Solscan:
1. Confirm receipt in destination wallet.
2. Report the transaction signature to the team.
3. Proceed to execute standard contributor payroll batches.
