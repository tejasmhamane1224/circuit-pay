-- ==============================================================================
-- CircuitPay: Volume Ledger Schema, Indexes & Row-Level Security (RLS)
-- MultiHopper Build and Route Challenge Verifiable Mainnet Volume Rail
-- ==============================================================================

-- 1. Create volume_ledger table
CREATE TABLE IF NOT EXISTS volume_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES payout_batches(id) ON DELETE CASCADE,
    fees_collected NUMERIC(18, 4) NOT NULL,
    qualifying_volume NUMERIC(18, 4) NOT NULL, -- Computed as fees_collected / 0.0025
    network TEXT NOT NULL CHECK (network IN ('mainnet-beta', 'devnet')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    in_competition_window BOOLEAN NOT NULL DEFAULT true,
    transfer_id UUID REFERENCES multihopper_transfers(id) ON DELETE SET NULL,
    multihopper_id TEXT,
    is_mainnet BOOLEAN NOT NULL DEFAULT false,
    token_mint TEXT,
    token_symbol TEXT,
    principal_amount_raw TEXT,
    principal_amount_usd NUMERIC(18, 4),
    collected_fee_raw TEXT,
    collected_fee_usd NUMERIC(18, 4),
    qualifying_volume_usd NUMERIC(18, 4),
    integrator_fee_share_usd NUMERIC(18, 4),
    verified_at TIMESTAMPTZ
);

-- 2. Performance & Query Indexes
CREATE INDEX IF NOT EXISTS volume_ledger_batch_idx ON volume_ledger (batch_id);
CREATE INDEX IF NOT EXISTS volume_ledger_network_idx ON volume_ledger (network);
CREATE INDEX IF NOT EXISTS volume_ledger_created_at_idx ON volume_ledger (created_at);
CREATE INDEX IF NOT EXISTS volume_ledger_comp_window_idx ON volume_ledger (in_competition_window);

-- 3. Enable Row-Level Security (RLS)
ALTER TABLE volume_ledger ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy: Users can only read their own organization's volume data
-- Checks that the user's authenticated wallet address is an active member of the organization owning the batch
DROP POLICY IF EXISTS "Users can only read own organization volume ledger" ON volume_ledger;

CREATE POLICY "Users can only read own organization volume ledger"
ON volume_ledger
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM payout_batches pb
        JOIN members m ON m.organization_id = pb.organization_id
        WHERE pb.id = volume_ledger.batch_id
        AND m.wallet_address = auth.jwt() ->> 'wallet_address'
    )
    OR
    -- Allow service role access for backend webhook ingestion & synchronization
    (auth.role() = 'service_role')
);

-- 5. RLS Policy: Insert/Update restricted to service role / internal workers
DROP POLICY IF EXISTS "Service role manages volume ledger" ON volume_ledger;

CREATE POLICY "Service role manages volume ledger"
ON volume_ledger
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
