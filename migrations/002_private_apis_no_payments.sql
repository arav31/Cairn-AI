-- Cairn repositioning: marketplace + payments -> private, owned, reusable APIs.
-- Drops every credit/payment table, turns marketplace_listings into a private
-- per-account `apis` table, and renames the invocation audit column.
-- Safe to re-run: every step is guarded.

-- 1. Remove credit/payment tables (no tokens, wallets, ledger, Stripe usage).
DROP TABLE IF EXISTS token_ledger CASCADE;
DROP TABLE IF EXISTS token_wallets CASCADE;
DROP TABLE IF EXISTS usage_events CASCADE;
DROP TABLE IF EXISTS payments CASCADE;

-- 2. Rename marketplace_listings -> apis (only if not already renamed).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'marketplace_listings')
     AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'apis') THEN
    ALTER TABLE marketplace_listings RENAME TO apis;
  END IF;
END $$;

-- 3. Add owner scoping; backfill from the skill manifest owner.
ALTER TABLE apis ADD COLUMN IF NOT EXISTS owner_account_id text;
UPDATE apis
   SET owner_account_id = sm.owner
  FROM skill_manifests sm
 WHERE sm.id = apis.skill_id
   AND apis.owner_account_id IS NULL;

-- 4. Drop marketplace/pricing-only columns.
ALTER TABLE apis DROP COLUMN IF EXISTS price_cents;
ALTER TABLE apis DROP COLUMN IF EXISTS token_cost;
ALTER TABLE apis DROP COLUMN IF EXISTS category;
ALTER TABLE apis DROP COLUMN IF EXISTS publisher;

-- 5. Re-point indexes: drop catalog browse indexes, add an owner index.
DROP INDEX IF EXISTS marketplace_listings_category_idx;
DROP INDEX IF EXISTS marketplace_listings_visibility_idx;
CREATE INDEX IF NOT EXISTS apis_owner_idx ON apis(owner_account_id);

-- 6. Rename the invocation audit column listing_slug -> api_slug.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invocation_logs' AND column_name = 'listing_slug'
  ) THEN
    ALTER TABLE invocation_logs RENAME COLUMN listing_slug TO api_slug;
  END IF;
END $$;

INSERT INTO schema_migrations(version)
VALUES ('002_private_apis_no_payments')
ON CONFLICT (version) DO NOTHING;
