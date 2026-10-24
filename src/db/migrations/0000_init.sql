-- ==============================================================================
-- CircuitPay Initial Database Migration (0000_init.sql)
-- MultiHopper Routed Non-Custodial Payroll & Treasury Management on Solana
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_slug_idx ON organizations(slug);

-- 2. Organization Members
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    wallet_address TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS member_org_idx ON members(organization_id);
CREATE INDEX IF NOT EXISTS member_wallet_idx ON members(wallet_address);
CREATE UNIQUE INDEX IF NOT EXISTS member_org_wallet_unique ON members(organization_id, wallet_address);

-- 3. Payout Batches
CREATE TABLE IF NOT EXISTS payout_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    token_mint TEXT NOT NULL,
    token_symbol TEXT NOT NULL DEFAULT 'USDC',
    token_decimals INTEGER NOT NULL DEFAULT 6,
    total_amount_raw TEXT NOT NULL,
    total_amount_formatted TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_signature', 'processing', 'completed', 'partially_failed', 'failed', 'cancelled')),
    sender_wallet TEXT NOT NULL,
    network TEXT NOT NULL DEFAULT 'devnet' CHECK (network IN ('mainnet-beta', 'devnet')),
    hops INTEGER NOT NULL DEFAULT 4 CHECK (hops BETWEEN 3 AND 10),
    arrival_seconds INTEGER NOT NULL DEFAULT 900,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS batch_org_idx ON payout_batches(organization_id);
CREATE INDEX IF NOT EXISTS batch_status_idx ON payout_batches(status);
CREATE INDEX IF NOT EXISTS batch_sender_idx ON payout_batches(sender_wallet);

-- 4. MultiHopper Transfers (Chunking table handling 20-destination cap)
CREATE TABLE IF NOT EXISTS multihopper_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    external_id TEXT NOT NULL UNIQUE,
    multihopper_id TEXT,
    hops INTEGER NOT NULL DEFAULT 4 CHECK (hops BETWEEN 3 AND 10),
    arrival_seconds INTEGER NOT NULL DEFAULT 900,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'quote', 'awaiting_signature', 'processing', 'active', 'completed', 'failed', 'expired', 'refunded', 'recoverable')),
    chunk_amount_raw TEXT NOT NULL,
    recipient_count INTEGER NOT NULL CHECK (recipient_count BETWEEN 1 AND 20),
    keeper_funding_tx TEXT,
    keeper_funding_signature TEXT,
    route_init_signatures JSONB,
    final_signatures JSONB,
    percent_fee_raw TEXT,
    flat_fee_lamports TEXT,
    integrator_fee_share_raw TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transfer_batch_idx ON multihopper_transfers(batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS transfer_ext_id_idx ON multihopper_transfers(external_id);
CREATE INDEX IF NOT EXISTS transfer_mh_id_idx ON multihopper_transfers(multihopper_id);
CREATE INDEX IF NOT EXISTS transfer_status_idx ON multihopper_transfers(status);

-- 5. Payout Items (Recipients)
CREATE TABLE IF NOT EXISTS payout_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
    transfer_id UUID REFERENCES multihopper_transfers(id) ON DELETE SET NULL,
    recipient_wallet TEXT NOT NULL,
    recipient_name TEXT,
    amount_raw TEXT NOT NULL,
    amount_formatted TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'paid', 'failed', 'refunded')),
    payout_signature TEXT,
    screening_status TEXT NOT NULL DEFAULT 'clean' CHECK (screening_status IN ('clean', 'flagged', 'exempt')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS item_batch_idx ON payout_items(batch_id);
CREATE INDEX IF NOT EXISTS item_transfer_idx ON payout_items(transfer_id);
CREATE INDEX IF NOT EXISTS item_recipient_idx ON payout_items(recipient_wallet);

-- 6. Webhook Events
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    signature TEXT NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_event_id_idx ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS webhook_event_type_idx ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS webhook_processed_idx ON webhook_events(processed);

-- 7. Volume Ledger (Superteam Earn challenge volume verification)
CREATE TABLE IF NOT EXISTS volume_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id UUID REFERENCES multihopper_transfers(id) ON DELETE SET NULL,
    multihopper_id TEXT NOT NULL,
    network TEXT NOT NULL CHECK (network IN ('mainnet-beta', 'devnet')),
    is_mainnet BOOLEAN NOT NULL,
    token_mint TEXT NOT NULL,
    token_symbol TEXT NOT NULL,
    principal_amount_raw TEXT NOT NULL,
    principal_amount_usd NUMERIC(18, 4) NOT NULL,
    collected_fee_raw TEXT NOT NULL,
    collected_fee_usd NUMERIC(18, 4) NOT NULL,
    qualifying_volume_usd NUMERIC(18, 4) NOT NULL,
    integrator_fee_share_usd NUMERIC(18, 4) NOT NULL,
    verified_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_mh_id_idx ON volume_ledger(multihopper_id);
CREATE INDEX IF NOT EXISTS ledger_is_mainnet_idx ON volume_ledger(is_mainnet);
CREATE INDEX IF NOT EXISTS ledger_verified_at_idx ON volume_ledger(verified_at);

-- 8. Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    actor_wallet TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    details JSONB,
    ip_address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_log(organization_id);
CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_log(actor_wallet);
CREATE INDEX IF NOT EXISTS audit_action_idx ON audit_log(action);
