# CircuitPay — Technical Architecture & Cryptographic Specification

## Abstract

CircuitPay is a production non-custodial multi-destination treasury and confidential payroll protocol constructed on Solana. By leveraging MultiHopper's multi-hop liquidity routing and dispersion engine, CircuitPay enables organizations to execute high-volume contributor compensation batches while preserving recipient financial confidentiality, eliminating manual multi-transaction signing overhead, and enforcing strict non-custodial safety.

This document details the architectural topology, cryptographic primitives, client-side transaction signing mechanisms, idempotency protocols, qualifying volume mathematics, and defense-in-depth safety layers implemented across the system.

---

## 1. Architectural Topology & End-to-End Data Flow

CircuitPay follows a decoupled, non-custodial multi-tier architecture designed for horizontal scalability, sub-second reactivity, and zero trust.

```
+----------------------------------------------------------------------------------------------------+
|                                      CLIENT BROWSER LAYER                                          |
|  +-------------------------+   +----------------------------+   +-------------------------------+  |
|  | Multi-Wallet Adapter    |   | SIWS Non-Custodial Session |   | RFC 4180 CSV & Base58 Parser  |  |
|  | (Phantom/Solflare/Back) |   | (Ed25519 Message Signing)  |   | (Streaming 500-Row Validator) |  |
|  +-------------------------+   +----------------------------+   +-------------------------------+  |
|                                                |                                                   |
|                +-------------------------------+-------------------------------+                   |
|                | Client-Side Deserializer & Sequential Broadcast Orchestrator  |                   |
+----------------+---------------------------------------------------------------+-------------------+
                                                 | HTTPS (Session Cookie + TLS 1.3)
                                                 v
+----------------------------------------------------------------------------------------------------+
|                                    CIRCUITPAY NEXT.JS 15 ENGINE                                    |
|  +-----------------------+     +--------------------------+     +-------------------------------+  |
|  | Sliding-Window Rate   | --> | Dual-Role Multisig Guard | --> | 20-Cap Destination Chunker    |  |
|  | Limiter (30-120/min)  |     | (Approver/Signer Quorum) |     | (Atomic Routing Partitioner)  |  |
|  +-----------------------+     +--------------------------+     +-------------------------------+  |
|                                                |                                                   |
|  +---------------------------------------------v------------------------------------------------+  |
|  | MultiHopper Protocol Client (Idempotency Engine, 3x Exponential Backoff, Error Code Mapper)  |  |
|  +----------------------------------------------------------------------------------------------+  |
|            |                                   |                                   |               |
|            v                                   v                                   v               |
|  +-------------------+               +--------------------+              +----------------------+  |
|  | Payout Repository |               | HMAC Webhook Ingest|              | Signed Outbound ERP  |  |
|  | (Postgres/Parity) |               | (Timing-Safe SHA256|              | Webhook Dispatcher   |  |
|  +-------------------+               +--------------------+              +----------------------+  |
+------------------------------------------------|---------------------------------------------------+
                                                 |
                                                 v
+----------------------------------------------------------------------------------------------------+
|                                     SOLANA ON-CHAIN INFRASTRUCTURE                                  |
|  +---------------------------------+  +----------------------------------+  +-------------------+  |
|  | MultiHopper Dynamic Contract   |  | MultiHopper Keeper Orchestrator  |  | Transfer Hook     |  |
|  | (Resolved via Prepare API)      |  | (Dynamic Mesh Liquidity Hops)    |  | (Token-2022 Guard)|  |
|  +---------------------------------+  +----------------------------------+  +-------------------+  |
|                                                |                                                   |
|                                                v                                                   |
|                     +------------------------------------------------------+                       |
|                     | MultiHopper Keeper Mesh (3-10 Randomized Obfuscation |                       |
|                     | Liquidity Hops with Jittered Arrival Delay)          |                       |
|                     +------------------------------------------------------+                       |
|                                                |                                                   |
|                                                v                                                   |
|                     +------------------------------------------------------+                       |
|                     | Contributor Personal Wallets (Unlinked Settlement)   |                       |
|                     +------------------------------------------------------+                       |
+----------------------------------------------------------------------------------------------------+
```

### Data Flow Stages

1. **Ingestion & Validation:** Contributor CSV files (wallet, amount, name) are streamed into memory. Each destination wallet is validated against Solana's Base58 alphabet (preventing invalid characters `0`, `O`, `I`, `l` and verifying exact 32-byte public key decoding via `@solana/web3.js`).
2. **Chunking & Quoting:** Destination lists are chunked into atomic batches of at most 20 accounts. The backend issues quotes to MultiHopper via `POST /transfers/estimate` and `POST /transfers` using unique per-chunk idempotency keys.
3. **Transaction Preparation:** MultiHopper synthesizes the transaction vector for each chunk:
   - `keeperFundingTx`: Versioned transaction funding the off-chain keeper network.
   - `routeInitTxs`: Array of versioned transactions initializing intermediate hop accounts.
   - `orchestratorInitTx`: Legacy transaction binding routing parameters to the orchestrator program.
   - `dispersionInitTxs`: Versioned transactions encoding multi-destination dispersion up to 20 accounts.
4. **Client-Side Non-Custodial Signing:** The client wallet deserializes base64 wire formats into `VersionedTransaction` and legacy `Transaction` objects and requests sequential user approval via standard wallet popups.
5. **Execution & Webhook Settlement:** As keepers complete intermediate hops, signed webhook notifications update batch progress, write to the verifiable volume ledger, and notify external enterprise accounting systems.

---

## 2. Non-Custodial Security Model

### Strict Prohibition of Server-Side Key Material
CircuitPay strictly forbids storing, handling, or importing private keys, secret keypairs, mnemonic seed phrases, or custody vaults on the server.
- **Why?** Custodial architectures introduce single-point-of-failure counterparty risks, trigger onerous custodian licensing requirements, and represent high-value honeypots for exploiters.
- **How CircuitPay Guarantees Non-Custodial Operation:**
  - All transactions are built as **unsigned serialized payloads** by MultiHopper.
  - Payloads are passed directly to the browser runtime.
  - The browser requests cryptographic signing via the connected wallet provider (`window.solana`, `window.phantom.solana`, or `@solana/wallet-adapter`).
  - The server only ever receives **public transaction signatures** (`txSignature`) and never the underlying private key.

### Sign-In With Solana (SIWS) Nonce Authentication
User sessions are established via Ed25519 cryptographic signatures using the standardized SIWS pattern:
1. Client requests a cryptographic session challenge from `GET /api/auth/siws/nonce`.
2. Server generates a cryptographically random 32-byte hexadecimal nonce with a 10-minute expiration and associates it with the active session.
3. Client signs the human-readable SIWS message:
   ```text
   circuitpay.vercel.app wants you to sign in with your Solana account:
   3UdgSTpcUbiBSmgdPBiVHRMbcDS731kMT6bAQQZgE3c4

   Sign in to CircuitPay Non-Custodial Treasury Portal

   URI: https://circuitpay.vercel.app
   Version: 1
   Chain ID: mainnet-beta
   Nonce: a94f71ec923a10...
   Issued At: 2026-10-23T18:00:00.000Z
   ```
4. Server verifies the Ed25519 signature using `tweetnacl` or `@solana/web3.js` against the declared public key.
5. On verification, a signed, encrypted HTTP-only session cookie is issued (`SESSION_SECRET`).

---

## 3. The 20-Destination Chunker & 4-Step Broadcast Sequence

### Solana Packet Constraint & MultiHopper Invariant
A Solana IPv6 MTU limits raw transaction packet sizes to **1232 bytes**. Multi-destination token dispersion instructions require accounts for:
- Source token account
- MultiHopper program state PDA
- System program & Token program
- Destination token accounts & associated token account metadata

Consequently, MultiHopper enforces an absolute maximum of **20 destinations per dispersion chunk** (`MULTIHOPPER_RULES.MAX_DESTINATIONS_PER_CHUNK = 20`).

### Deterministic Chunking Algorithm
Given a batch with $N$ recipients, CircuitPay's chunker partitions the list into $M = \lceil N / 20 \rceil$ chunks:

```typescript
export function chunkPayoutDestinations(
  batchId: string,
  destinations: PayoutDestinationInput[],
  maxChunkSize: number = 20
): PayoutChunk[] {
  const chunks: PayoutChunk[] = [];
  for (let i = 0; i < destinations.length; i += maxChunkSize) {
    const chunkIndex = Math.floor(i / maxChunkSize);
    const slice = destinations.slice(i, i + maxChunkSize);
    const externalId = `${batchId}_chunk_${chunkIndex}`;
    
    const chunkAmountRaw = slice
      .reduce((sum, item) => sum + BigInt(item.amountRaw), BigInt(0))
      .toString();

    chunks.push({
      chunkIndex,
      externalId,
      destinations: slice,
      chunkAmountRaw,
      recipientCount: slice.length,
    });
  }
  return chunks;
}
```

### The 4-Step Sequential Broadcast Protocol

MultiHopper requires a precise on-chain initialization sequence. Deviations result in failed route deployment (`MH_039`) or double-funded keeper escrows.

```
+--------------------------------------------------------------------------------------------------+
| STEP 1: Keeper Funding Transaction (VersionedTransaction v0)                                      |
| - Action: Funds keeper relayer rent and gas incentives.                                          |
| - Broadcast: Client wallet signs and broadcasts to Solana RPC.                                   |
| - CRITICAL PROTOCOL RULE: Immediate intermediate API call:                                      |
|     POST /transfers/:id/confirm-broadcast { keeperFundingSignature: "sig..." }                   |
|   Prevents double-funding keeper accounts if route initiation fails or retries later.             |
+--------------------------------------------------------------------------------------------------+
                                               | (3000ms protocol delay)
                                               v
+--------------------------------------------------------------------------------------------------+
| STEP 2: Route Initialization Transactions (Array of VersionedTransaction v0)                     |
| - Action: Initializes intermediate hop PDAs across 3 to 10 routing accounts.                     |
| - Broadcast: Serialized and confirmed sequentially.                                              |
+--------------------------------------------------------------------------------------------------+
                                               | (3000ms protocol delay)
                                               v
+--------------------------------------------------------------------------------------------------+
| STEP 3: Orchestrator Initialization Transaction (Legacy Transaction)                             |
| - Action: Binds route parameters, token vaults, and transfer invariants to MultiHopper program.   |
| - Broadcast: Serialized and confirmed on-chain.                                                  |
+--------------------------------------------------------------------------------------------------+
                                               |
                                               v
+--------------------------------------------------------------------------------------------------+
| STEP 4: Dispersion Initialization Transactions (VersionedTransaction v0)                         |
| - Action: Atomically registers destination splits (<= 20 addresses per chunk).                   |
| - Broadcast: Confirmed on-chain.                                                                 |
| - FINAL CALL:                                                                                    |
|     POST /transfers/:id/confirm-broadcast { routeInitSignatures, orchestratorInitSignature, ... } |
|   MultiHopper marks transfer status as 'processing' and begins keeper dispatch.                   |
+--------------------------------------------------------------------------------------------------+
```

---

## 4. Idempotency & Concurrency Locking

In high-value financial routing, network drops, browser refreshes, or user duplicate clicks must never trigger duplicate token debits or multiple payouts to the same contributor. CircuitPay implements defense-in-depth idempotency and concurrency locking at every layer:

1. **Per-Batch Idempotency:** Every payout batch is assigned a persistent UUID v4 (`batch.id`) upon creation. Subsequent modifications operate strictly against this identifier.
2. **Per-Chunk Deterministic ID:** Every chunk derives a deterministic identifier `externalId = ${batchId}_chunk_${index}`. MultiHopper guarantees that repeated creations with the same `externalId` return the identical transfer entity without re-quoting or creating duplicate routes.
3. **Per-Recipient Deterministic Idempotency Key:** Each individual recipient line item is assigned an immutable deterministic key (`itemId` or UUID derived from `sha256(batchId + ":" + chunkIndex + ":" + recipientWallet + ":" + amountRaw)`). In-flight deduplication caches ensure that identical recipient entries within the same batch or across retry chunks cannot be executed more than once.
4. **Concurrency Locking & Double-Payout Prevention:**
   - **Database-Level Row Locking:** When an officer initiates signing, the backend obtains an exclusive lock (`SELECT ... FOR UPDATE` in PostgreSQL or an atomic in-memory mutex flag `isSigningLocked`).
   - **Optimistic Concurrency Control:** Each batch record tracks a monotonic `version` counter. State transitions assert `WHERE id = :batchId AND version = :currentVersion`. Any concurrent signing attempt by a second officer is rejected immediately with HTTP 409 Conflict: `Batch is currently being signed or broadcast by another session`.
5. **HTTP `Idempotency-Key` Header:** All mutation requests (`POST /transfers`, `POST /transfers/:id/prepare`, `POST /transfers/:id/confirm-broadcast`) include an `Idempotency-Key: <UUID>` header.
6. **Mismatched Payload Defense (MH_071):** If a client reuses an idempotency key with modified parameters (e.g., changed destination wallet or altered amount), MultiHopper immediately halts execution and returns error code `MH_071` (Idempotency key payload mismatch).
7. **Guarded State Machine DAG:** Batch status transitions are strictly linear and guarded:
   ```text
   draft -> awaiting_approval -> approved -> awaiting_signature -> processing -> completed
                                                                               \-> failed / refunded
   ```
   Transitions violating the directed acyclic graph (DAG) throw an `InvalidBatchStatusTransitionError` and roll back any pending transaction state.

---

## 5. Qualifying Volume Mathematics & Superteam Earn Proof

The Superteam Earn MultiHopper Challenge establishes a strict formula for measuring authentic protocol integration volume:

### Formula Derivation

$$\text{Qualifying Volume (USD)} = \frac{\text{Collected MultiHopper Percentage Fees (USD)}}{0.0025}$$

- **MultiHopper Protocol Commercial Fee:** 50 basis points ($0.50\% = 0.0050$) on principal amount $P$.
- **Integrator Revenue Share:** MultiHopper splits protocol fees 50/50 with CircuitPay:
  $$\text{Integrator Share} = \text{Collected Fees} \times 0.50 = P \times 0.0025$$
- **Qualifying Volume Equivalence:**
  $$\text{Qualifying Volume} = \frac{P \times 0.0050}{0.0025} = 2 \times P$$

### Worked Example
For a contributor batch of **\$50,000.00 USDC**:
1. Principal Volume: $\$50,000.00$
2. Collected 50 bps Fee: $\$50,000.00 \times 0.0050 = \$250.00\text{ USD}$
3. Integrator 50% Share: $\$250.00 \times 0.50 = \$125.00\text{ USD}$
4. Qualifying Volume:
   $$\text{Qualifying Volume} = \frac{\$250.00}{0.0025} = \$100,000.00\text{ USD}$$

### Challenge Compliance Rules Enforced in Code
- **Rule 1 (Mainnet-Beta Only):** Transfers on Devnet or local test validators yield strictly **\$0.00 Qualifying Volume**.
- **Rule 2 (Single Principal Accounting):** Principal is counted exactly once per dispersion item. Intermediate hops (e.g. 4 hops) and chunk partitions do not multiply volume.
- **Rule 3 (Exclusion of Failed or Circular Transfers):** Any transfer marked `failed`, `refunded`, or identified as circular/wash-trading is flagged with `disqualificationReason` and yields strictly **$0.00**. CircuitPay's volume verification pipeline implements `isCircularOrWashTransfer(sender, recipients)` to detect self-dealing loops where sender address matches recipient wallets, guaranteeing that circular transactions cannot game the volume threshold.

---

## 6. Cryptographic Webhook Security

CircuitPay processes both inbound MultiHopper keeper notifications and dispatches outbound ERP notifications to partner accounting platforms. Both directions enforce bank-grade cryptographic standards.

### Inbound MultiHopper Webhook Ingestion (`/api/webhooks/multihopper`)
1. **Timing-Safe HMAC Verification:** Inbound payloads are verified using SHA-256 HMAC against `MULTIHOPPER_WEBHOOK_SECRET`. CircuitPay prevents timing side-channel attacks by comparing byte buffers with `crypto.timingSafeEqual`:
   ```typescript
   export function verifyMultiHopperWebhook(rawBody: string, signature: string, secret: string): boolean {
     const cleanSig = signature.replace(/^sha256[=:]/i, "").trim().toLowerCase();
     if (cleanSig.length !== 64) return false;
     
     const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
     return crypto.timingSafeEqual(Buffer.from(cleanSig, "hex"), Buffer.from(expected, "hex"));
   }
   ```
2. **Replay Deduplication:** Every webhook event carries a unique `eventId`. The event is stored with a unique database index. Replayed events are acknowledged with HTTP 200 `{ deduplicated: true }` without triggering duplicate ledger credits.

### Outbound Partner Webhook Dispatcher
For enterprise accounting systems (e.g., Quickbooks, Netsuite, SubQuery), CircuitPay dispatches signed event notifications (`batch.completed`, `batch.settled`, `batch.failed`).
- **Signature Header:** `x-circuitpay-signature: t=1730000000,v1=9f82d1c67...`
- **Clock Skew Mitigation:** The receiver validates that $|t_{\text{current}} - t_{\text{header}}| \le 300\text{ seconds}$ (5 minutes). Stale requests are rejected.

---

## 7. Rate Limiting & Safety Boundaries

To protect treasury infrastructure from denial-of-service and unauthorized volumetric exposure, CircuitPay implements a multi-layer throttle and limit model:

| Layer | Limit Parameter | Default Value | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **IP Sliding Window** | Batch Creation | 30 requests / min | In-memory sliding window, returns HTTP 429 + `Retry-After` |
| **IP Sliding Window** | Webhook Ingestion | 120 requests / min | In-memory sliding window, returns HTTP 429 |
| **IP Sliding Window** | Batch Retry | 10 requests / min | Prevents RPC flood on transient network partitions |
| **Single Batch Cap** | `MAX_BATCH_AMOUNT_USD` | \$100,000.00 USD | Zod schema validation; rejects batch creation with HTTP 400 |
| **Recipient Cap** | `MAX_RECIPIENTS_PER_BATCH` | 500 recipients | Strict CSV row cap |
| **Daily Org Cap** | `DAILY_ORG_VOLUME_LIMIT_USD` | \$500,000.00 USD / 24h | Rolling 24h ledger aggregation per organization ID |

---

## 8. Failure Modes & Automatic Recovery

CircuitPay is built for mission-critical reliability on Solana:

1. **Transient RPC Blockhash Expiration:** If Solana cluster congestion delays transaction inclusion beyond 150 blocks (~60 seconds), the client orchestrator detects blockhash expiration, refetches fresh blockhashes via `prepareTransfer`, and resumes broadcast without recreating the quote.
2. **Partial Chunk Success:** If chunk 1 of 3 confirms on-chain but chunk 2 encounters an RPC timeout, CircuitPay marks chunk 1 as `processing` and chunk 2 as `awaiting_signature`. The dashboard enables an **Idempotent Safe Retry**, which resumes solely from the unconfirmed chunk without re-debiting chunk 1.
3. **Automated Error Mapping:** MultiHopper error codes are strongly typed into actionable UI feedback:
   - `MH_001`: Authentication / API Key error.
   - `MH_013`: Hop count out of bounds ($3 \le \text{hops} \le 10$).
   - `MH_017`: Destination count exceeds 20 (handled transparently by chunker).
   - `MH_039`: Missing intermediate keeper funding confirmation.
   - `MH_071`: Idempotency key payload mismatch.
