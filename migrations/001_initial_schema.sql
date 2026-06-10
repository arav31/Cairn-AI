CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_operations (
  id text PRIMARY KEY,
  name text NOT NULL,
  title text NOT NULL,
  target text NOT NULL,
  version text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skill_manifests (
  id text PRIMARY KEY,
  operation_id text NOT NULL REFERENCES api_operations(id) ON DELETE CASCADE,
  owner text NOT NULL,
  risk_tier text NOT NULL,
  manifest jsonb NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  skill_id text NOT NULL REFERENCES skill_manifests(id) ON DELETE CASCADE,
  operation_id text NOT NULL REFERENCES api_operations(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  publisher text NOT NULL,
  visibility text NOT NULL,
  quality_gate text NOT NULL,
  verification_freshness text NOT NULL,
  price_cents integer NOT NULL DEFAULT 0,
  token_cost integer NOT NULL DEFAULT 0,
  listing jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketplace_listings_category_idx ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS marketplace_listings_visibility_idx ON marketplace_listings(visibility);

CREATE TABLE IF NOT EXISTS verification_records (
  id bigserial PRIMARY KEY,
  operation_id text NOT NULL REFERENCES api_operations(id) ON DELETE CASCADE,
  target text NOT NULL,
  status text NOT NULL,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workflow_submissions (
  id text PRIMARY KEY,
  account_id text,
  title text NOT NULL,
  target_url text,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_wallets (
  account_id text PRIMARY KEY,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_purchased integer NOT NULL DEFAULT 0 CHECK (lifetime_purchased >= 0),
  lifetime_spent integer NOT NULL DEFAULT 0 CHECK (lifetime_spent >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS token_ledger (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES token_wallets(account_id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('grant', 'credit', 'debit', 'refund', 'adjustment')),
  token_delta integer NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS token_ledger_account_created_idx ON token_ledger(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_events (
  id text PRIMARY KEY,
  account_id text,
  listing_slug text NOT NULL,
  invocation_id text,
  payment_method text NOT NULL,
  token_cost integer NOT NULL DEFAULT 0,
  stripe_customer_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_listing_created_idx ON usage_events(listing_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_account_created_idx ON usage_events(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  account_id text,
  provider text NOT NULL,
  provider_reference text,
  status text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  tokens integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_account_created_idx ON payments(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invocation_logs (
  id text PRIMARY KEY,
  skill_id text,
  listing_slug text,
  caller_id text,
  status text NOT NULL,
  input_hash text,
  output_hash text,
  policy_decision jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invocation_logs_skill_created_idx ON invocation_logs(skill_id, created_at DESC);

INSERT INTO schema_migrations(version)
VALUES ('001_initial_schema')
ON CONFLICT (version) DO NOTHING;
