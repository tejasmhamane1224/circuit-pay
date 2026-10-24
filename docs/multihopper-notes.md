# MultiHopper Protocol Integration Notes & Official Specs

**Source Bounty**: [Superteam Earn MultiHopper Build and Route Challenge](https://superteam.fun/earn/listing/multihopper-build-and-route-challenge-up-to-dollar50000-revenue-share-1)  
**MultiHopper Portal**: https://multihopper.com  
**Devnet Sandbox**: https://devnet.multihopper.com  
**Telegram Builders**: https://t.me/multihopperbuilderportal  
**Registered Integration Identifier**: `circuitpay_treasury_v1`  

---

## 1. On-Chain Protocol Addresses & Rail Configuration

- **Registered Integration Identifier**: `circuitpay_treasury_v1`
- **Integrator Rewards Wallet**: `7NWNAxaNXHstZbfVqHqwL1kDHKwJmb9HtZTfBZDREWUJ`
- **Dynamic Program Resolution**: MultiHopper's `POST /transfers/:id/prepare` server-side vector generator generates compiled transaction instructions containing certified program IDs. On-chain addresses can also be configured via `.env` with `NEXT_PUBLIC_MULTIHOPPER_CONTRACT`.

---

## 2. Protocol Invariants & Rules

1. **20-Destination Cap**:
   - Single dispersion transaction vector supports between 1 and 20 destinations: `destinations: [{ wallet, amountRaw }]`.
   - Batches with >20 recipients MUST be partitioned deterministically into chunks of $\le 20$ destinations.

2. **Sequential Multi-Call Broadcast Sequence**:
   - Step 1: `keeperFundingTx` (VersionedTransaction, v0). Must be broadcast and confirmed first via an intermediate call to `POST /transfers/:id/confirm-broadcast` with `{ keeperFundingSignature }`. This prevents double-funding keeper nodes.
   - Step 2: Route initialization transactions (`routeInitTxs`, VersionedTransaction v0).
   - Step 3: Orchestrator initialization (`orchestratorInitTx`, Legacy Transaction).
   - Step 4: Dispersion initialization (`dispersionInitTxs`, VersionedTransaction v0).
   - Final Step: Second call to `POST /transfers/:id/confirm-broadcast` with all signatures.

3. **Signature Preservation**:
   - Unsigned transaction base64 strings returned by MultiHopper contain pre-signed ephemeral route signatures.
   - User wallet adapters MUST deserialize into `VersionedTransaction` or `Transaction` and sign without overwriting existing ephemeral signatures.

4. **Webhooks & HMAC Verification**:
   - Inbound webhook payloads are signed via HMAC-SHA256 (`x-multihopper-signature: sha256=...` or raw hex).
   - Must use timing-safe comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
   - Webhook events are deduplicated by `eventId`.

5. **Qualifying Volume Formula**:
   $$\text{Qualifying Volume (USD)} = \frac{\text{Collected MultiHopper Percentage Fees}}{0.0025}$$
   - Only Solana Mainnet-Beta transfers count.
   - Devnet transfers yield \$0.00 qualifying volume.
   - Principal counted ONCE.
   - Failed, refunded, and wash-trading transfers excluded.
