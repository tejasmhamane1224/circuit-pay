-- ==============================================================================
-- CircuitPay Row Level Security (RLS) Policies
-- Hardened multi-tenant access control for Supabase Postgres
-- ==============================================================================

-- 1. Helper function: Get current authenticated wallet address from JWT
CREATE OR REPLACE FUNCTION current_wallet()
RETURNS TEXT AS $$
BEGIN
  RETURN COALESCE(
    current_setting('request.jwt.claims', true)::json->>'wallet_address',
    current_setting('request.jwt.claims', true)::json->>'sub',
    NULL
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 2. Helper function: Check if current wallet is member of organization
CREATE OR REPLACE FUNCTION is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN TRUE;
  END IF;
  
  RETURN EXISTS (
    SELECT 1 FROM members
    WHERE organization_id = org_id
      AND wallet_address = current_wallet()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. Helper function: Check if current wallet has admin or owner role
CREATE OR REPLACE FUNCTION is_org_admin_or_owner(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM members
    WHERE organization_id = org_id
      AND wallet_address = current_wallet()
      AND role IN ('owner', 'admin')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ==============================================================================
-- Enable RLS on all 8 tables
-- ==============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE multihopper_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- Service Role Bypass (For server-side webhook processors & background workers)
-- ==============================================================================
CREATE POLICY "service_role_all_organizations" ON organizations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_members" ON members FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_payout_batches" ON payout_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_multihopper_transfers" ON multihopper_transfers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_payout_items" ON payout_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_webhook_events" ON webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_volume_ledger" ON volume_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_audit_log" ON audit_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==============================================================================
-- Organizations Policies
-- ==============================================================================
CREATE POLICY "members_read_organization" ON organizations
  FOR SELECT TO authenticated
  USING (is_org_member(id));

CREATE POLICY "authenticated_create_organization" ON organizations
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "admins_update_organization" ON organizations
  FOR UPDATE TO authenticated
  USING (is_org_admin_or_owner(id))
  WITH CHECK (is_org_admin_or_owner(id));

-- ==============================================================================
-- Members Policies
-- ==============================================================================
CREATE POLICY "members_read_members" ON members
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "admins_manage_members" ON members
  FOR INSERT TO authenticated
  WITH CHECK (is_org_admin_or_owner(organization_id));

CREATE POLICY "admins_update_members" ON members
  FOR UPDATE TO authenticated
  USING (is_org_admin_or_owner(organization_id))
  WITH CHECK (is_org_admin_or_owner(organization_id));

CREATE POLICY "admins_delete_members" ON members
  FOR DELETE TO authenticated
  USING (is_org_admin_or_owner(organization_id));

-- ==============================================================================
-- Payout Batches Policies
-- ==============================================================================
CREATE POLICY "members_read_batches" ON payout_batches
  FOR SELECT TO authenticated
  USING (is_org_member(organization_id));

CREATE POLICY "members_create_batches" ON payout_batches
  FOR INSERT TO authenticated
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY "members_update_batches" ON payout_batches
  FOR UPDATE TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY "admins_delete_batches" ON payout_batches
  FOR DELETE TO authenticated
  USING (is_org_admin_or_owner(organization_id));

-- ==============================================================================
-- MultiHopper Transfers Policies (Chunking Table)
-- ==============================================================================
CREATE POLICY "members_read_transfers" ON multihopper_transfers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payout_batches b
      WHERE b.id = multihopper_transfers.batch_id
        AND is_org_member(b.organization_id)
    )
  );

CREATE POLICY "members_manage_transfers" ON multihopper_transfers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payout_batches b
      WHERE b.id = multihopper_transfers.batch_id
        AND is_org_member(b.organization_id)
    )
  );

-- ==============================================================================
-- Payout Items Policies
-- ==============================================================================
CREATE POLICY "members_read_items" ON payout_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payout_batches b
      WHERE b.id = payout_items.batch_id
        AND is_org_member(b.organization_id)
    )
  );

CREATE POLICY "members_manage_items" ON payout_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM payout_batches b
      WHERE b.id = payout_items.batch_id
        AND is_org_member(b.organization_id)
    )
  );

-- ==============================================================================
-- Webhook Events Policies (Strictly Server-Only)
-- ==============================================================================
-- No authenticated public read/write allowed. Only service_role can interact.

-- ==============================================================================
-- Volume Ledger Policies
-- ==============================================================================
-- Authenticated users can view volume ledger records for verified production metrics
CREATE POLICY "authenticated_read_volume_ledger" ON volume_ledger
  FOR SELECT TO authenticated
  USING (true);

-- Insert/Update is strictly service_role only (tamper-proof financial accounting)

-- ==============================================================================
-- Audit Log Policies (Immutable)
-- ==============================================================================
CREATE POLICY "members_read_audit_log" ON audit_log
  FOR SELECT TO authenticated
  USING (organization_id IS NULL OR is_org_member(organization_id));

CREATE POLICY "authenticated_create_audit_log" ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_wallet = current_wallet());

-- No update or delete allowed on audit_log to guarantee audit trail integrity.
