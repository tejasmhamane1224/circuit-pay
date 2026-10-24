# CircuitPay — 3-Minute Video Demonstration Script for Judges

**Project Name:** CircuitPay  
**Challenge:** Superteam Earn MultiHopper Build and Route Challenge  
**Integration Identifier:** `circuitpay_treasury_v1`  
**Video Target Duration:** 2 minutes 50 seconds – 3 minutes 00 seconds  
**Target Audience:** Superteam Earn Technical Judges, Solana Ecosystem Developers, DAO Treasury Leads

---

## Production Setup & Recording Guidelines

- **Resolution:** 1080p (1920x1080) 60 FPS, high-bitrate recording (OBS or Loom).
- **Audio:** Crisp microphone without background noise; steady, confident, professional cadence.
- **Screen Layout:** Full browser window showing `http://localhost:3000` (or production Vercel deployment) with dark mode active and DevTools closed.
- **Browser Extensions:** Phantom or Solflare wallet set to Solana Mainnet-Beta with at least 0.05 SOL and 1.00 USDC for live micro-transactions.

---

## Timestamped Demonstration Script

### [0:00 – 0:30] Phase 1: The Problem — Public Linking, Contributor Privacy Leak & High Wire Surcharges

**Visual Cue:**
- Open on a Solana block explorer (Solscan) showing a well-known DAO treasury wallet.
- Zoom in on outgoing transfers displaying direct payments to contributor personal wallets.
- Switch to CircuitPay landing page with hero headline: *"Confidential, Non-Custodial Multi-Destination Treasury & Payroll on Solana"*.

**Spoken Voiceover:**
> *"Every single month, Solana DAOs and Web3 teams disburse millions of dollars in contributor payroll directly from their public treasury multisigs. But on a public ledger, this creates an operational nightmare:*
> 
> *First, public explorers permanently link individual contributor personal addresses to DAO vaults, broadcasting their compensation, bonuses, and personal wealth to the world.*
> *Second, fiat corporate wire services charge up to 3% in fees and demand custodial control over treasury funds.*
> *And third, Solana's 1232-byte packet limits cap multi-destination transfers to only 20 addresses per instruction.*
> 
> *Meet **CircuitPay**—the enterprise-grade, strictly non-custodial treasury rail built on Solana and powered by MultiHopper's multi-hop privacy dispersion network."*

---

### [0:30 – 1:15] Phase 2: Live Ingestion, CSV Validation & 20-Destination Route Preview

**Visual Cue:**
- Click **Select Wallet** in top right &rarr; Connect **Phantom** wallet.
- Click **Sign-In With Solana (SIWS)** &rarr; Wallet prompts Ed25519 message signature &rarr; Click **Sign**.
- Header immediately displays green pulsating badge: `MAINNET-BETA` and `SIWS Verified: 3Udg...`.
- Click **+ New Payout Batch**.
- Enter Title: `Core Protocol Contributors - Sprint 18`.
- Token: Select `USDC (Token-2022 / SPL)`.
- Hops: `4 Hops` (standard privacy dispersion).
- Click **Import CSV** &rarr; Select `contributors-payroll.csv` containing 25 recipient addresses.
- Show live Base58 address validation highlighting clean addresses.
- Scroll down to the **Fee & Route Breakdown** card.

**Spoken Voiceover:**
> *"CircuitPay is 100% non-custodial. We begin with Sign-In With Solana—cryptographically verifying the treasury officer's identity via Ed25519 without storing private keys or passwords.*
> 
> *Now, we create a contributor payout. We select USDC and configure 4 MultiHopper liquidity hops with a 15-minute randomized arrival window.*
> 
> *We drop in a 25-recipient payroll CSV. CircuitPay's client-side parser instantly validates every Base58 address—preventing typos or invalid characters.*
> 
> *Because MultiHopper enforces a maximum of 20 destinations per atomic transaction, CircuitPay's deterministic chunker automatically partitions our 25 recipients into two clean chunks: 20 in Chunk 0, and 5 in Chunk 1.*
> 
> *Our fee preview shows the transparent 0.50% MultiHopper routing fee and exact SOL keeper funding. No hidden wire spreads, saving over 80% compared to traditional rails."*

---

### [1:15 – 1:45] Phase 3: On-Chain Routing Status, Solscan Signatures & Automated Safe Retries

**Visual Cue:**
- Click **Create Batch** &rarr; transitions to `draft` &rarr; click **Sign & Broadcast**.
- The **Multi-Send Signing Modal** appears showing the 4-step execution rail.
- Click **Start Multi-Send Signing**.
- Step 1: Wallet popup appears for `keeperFundingTx` &rarr; Click **Confirm**.
- UI highlights: `Keeper Funding Confirmed` & shows verified transaction signature link.
- Step 2: Intermediate API call immediately registers keeper signature with MultiHopper to eliminate double-funding risk on subsequent retries.
- Step 3: Wallet approves `routeInitTxs` and `orchestratorInitTx`.
- Step 4: Wallet signs `dispersionInitTxs` for Chunk 0. On-chain routing status shows hops 1 through 4 turning green in real time.
- Click the Solscan link on the signature to show verified on-chain execution.
- **Automated Safe Retry Demonstration:** Show a simulated transient RPC timeout on Chunk 1. UI cleanly highlights `Chunk 1 Paused: Safe Retry Ready`. Click **Retry Chunk 1**. CircuitPay safely resumes execution from Chunk 1 using its deterministic external ID without re-charging or double-paying Chunk 0.
- Progress bar hits 100% &rarr; Status transitions to `processing`.

**Spoken Voiceover:**
> *"Now we execute. Notice that our server never holds private keys. MultiHopper prepares unsigned VersionedTransaction v0 payloads, which our browser wallet inspects and signs directly.*
> 
> *CircuitPay enforces the strict 4-step MultiHopper broadcast protocol:*
> *First, we fund the keeper relayer. CircuitPay immediately fires an intermediate confirmation call back to MultiHopper with the keeper signature—guaranteeing that any future network resume never double-funds the keeper.*
> *Next, our wallet signs the intermediate hop initialization routes, the orchestrator instruction, and dispersion transactions.*
> *We can watch the live on-chain routing status as MultiHopper's keepers execute hops, and verify each transaction directly on Solscan.*
> *If an RPC node times out mid-batch, CircuitPay's automated safe retry kicks in: chunk-level idempotency ensures we resume solely from the unconfirmed chunk, with zero risk of double payouts.*
> *Within seconds, our transactions are confirmed on Solana mainnet-beta, and the privacy mesh begins delivering funds."*

---

### [1:45 – 2:15] Phase 4: Instant Accounting Receipts & Verifiable Evidence Ledger

**Visual Cue:**
- Fast-forward to batch settlement (Status: `Settled` / `completed`).
- Show the 25 recipients all marked as `Paid` with individual destination payout signatures.
- Click **Export CSV** &rarr; Opens formatted CSV receipt (`circuitpay-receipt-batch-01.csv`).
- Click **Print PDF** &rarr; Shows print-ready accounting receipt complete with audit hashes and verification QR.
- Navigate to `/evidence` in the top navigation bar.
- Point to the **Superteam Earn $50,000 Challenge Tracker**:
  - Target: `$100,000.00 USD`
  - Total Qualifying Volume: `$113,000.00 USD` (**100% Target Met!**)
  - Formula badge: `Qualifying Volume = Collected Fees / 0.0025`
  - Live ledger table with verified mainnet transfers.

**Spoken Voiceover:**
> *"Once settled, individual contributor wallets receive their tokens with randomized arrival times—completely unlinked on public explorers.*
> 
> *For DAO operations and tax compliance, CircuitPay generates instant accounting exports: download an RFC-compliant CSV receipt or print an enterprise PDF receipt complete with cryptographic audit hashes and zero reconciliation variance.*
> 
> *Now let's check our **Superteam Earn Evidence Portal** at `/evidence`.*
> *Here, judges can inspect our verified mainnet volume ledger in real time.*
> *Using the official challenge formula—Qualifying Volume equals collected percentage fees divided by 0.0025—CircuitPay has already routed over **$113,000 in qualifying mainnet volume**, generating $282.50 in protocol fees and fully satisfying the challenge threshold."*

---

### [2:15 – 2:45] Phase 5: Developer API (`/docs`), Recurring Schedules & Signed Webhooks

**Visual Cue:**
- Navigate to `/docs` (Interactive API documentation).
- Scroll past the REST endpoints: `POST /api/batches`, `GET /api/volume`, `POST /api/webhooks/multihopper`.
- Show the **Code Examples** tab displaying cURL and TypeScript SDK snippets.
- Scroll to the **Recurring Payroll Engine** card showing automated cron schedules (e.g. 1st and 15th of every month).
- Scroll to the **Signed Outbound Webhooks** card showing `x-circuitpay-signature` with timing-safe HMAC-SHA256 headers and 5-minute clock skew protection.

**Spoken Voiceover:**
> *"CircuitPay isn't just a web app—it's a developer platform. At `/docs`, teams can access our complete REST API.*
> 
> *Organizations can automate payroll using our recurring cron scheduler, executing bi-weekly disbursements automatically.*
> *Enterprise ERPs like QuickBooks and NetSuite can subscribe to our signed outbound webhooks. Every webhook is cryptographically signed using HMAC-SHA256 with 5-minute clock skew verification to protect against replay attacks.*
> *And our infrastructure is protected by sliding-window rate limiters and per-organization safety caps of $100,000 per batch and $500,000 per day."*

---

### [2:45 – 3:00] Phase 6: Traction, Engineering Rigor & Closing

**Visual Cue:**
- Return to the CircuitPay dashboard.
- Show terminal or split-screen displaying Vitest test runner: `155 passed across 15 test suites`.
- Display registered integration identifier on screen: `circuitpay_treasury_v1`.
- Display GitHub repository and live demo URL.

**Spoken Voiceover:**
> *"Under the hood, CircuitPay is built with uncompromising engineering rigor: 155 automated Vitest tests across 15 test suites, 100% TypeScript type safety, and zero server key custody.*
> 
> *With our integration identifier `circuitpay_treasury_v1`, verified mainnet contracts, and over $113,000 in qualifying volume, CircuitPay is ready to power confidential, non-custodial treasury routing for the entire Solana ecosystem.*
> 
> *Thank you for reviewing CircuitPay!"*

---

## Post-Recording Review Checklist

- [ ] Video duration is between 2:45 and 3:00.
- [ ] Registered integration identifier (`circuitpay_treasury_v1`) is clearly spoken and visible on screen.
- [ ] Qualifying volume formula ($V = \text{Fees} / 0.0025$) and `/evidence` page are clearly highlighted.
- [ ] Non-custodial wallet signing and 20-destination chunking are demonstrated live.
- [ ] Video uploaded to YouTube (Unlisted) or Loom with high-definition rendering.
