const fs = require("node:fs");
const path = require("node:path");

let pool;
let migratePromise;

function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPg() {
  try {
    return require("pg");
  } catch (error) {
    const install = "Install dependencies with `npm install` so the optional `pg` package is available.";
    throw new Error(`${install} Original error: ${error.message}`);
  }
}

function sslConfig() {
  if (process.env.DATABASE_SSL === "false" || process.env.PGSSLMODE === "disable") {
    return false;
  }
  return {
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true"
  };
}

function getPool() {
  if (!isDatabaseConfigured()) return null;
  if (!pool) {
    const { Pool } = getPg();
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX || 3),
      ssl: sslConfig()
    });
  }
  return pool;
}

async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) return null;
  await migrate();
  return activePool.query(text, params);
}

async function withTransaction(callback) {
  const activePool = getPool();
  if (!activePool) return null;
  await migrate();
  const client = await activePool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function migrate() {
  if (!isDatabaseConfigured()) return false;
  if (!migratePromise) {
    migratePromise = (async () => {
      const activePool = getPool();
      const migrationPath = path.join(__dirname, "..", "..", "migrations", "001_initial_schema.sql");
      const sql = fs.readFileSync(migrationPath, "utf8");
      await activePool.query(sql);
      return true;
    })();
  }
  return migratePromise;
}

async function upsertPublishedApi({ operation, skill, listing, verificationRecord }) {
  if (!isDatabaseConfigured()) return false;
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO api_operations(id, name, title, target, version, definition)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         title = EXCLUDED.title,
         target = EXCLUDED.target,
         version = EXCLUDED.version,
         definition = EXCLUDED.definition,
         updated_at = now()`,
      [operation.id, operation.name, operation.title, operation.target, operation.version, JSON.stringify(operation)]
    );
    await client.query(
      `INSERT INTO skill_manifests(id, operation_id, owner, risk_tier, manifest)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         operation_id = EXCLUDED.operation_id,
         owner = EXCLUDED.owner,
         risk_tier = EXCLUDED.risk_tier,
         manifest = EXCLUDED.manifest,
         updated_at = now()`,
      [skill.id, operation.id, skill.owner, skill.riskTier, JSON.stringify(skill)]
    );
    await client.query(
      `INSERT INTO marketplace_listings(
         id, slug, skill_id, operation_id, title, category, publisher, visibility,
         quality_gate, verification_freshness, price_cents, token_cost, listing
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         skill_id = EXCLUDED.skill_id,
         operation_id = EXCLUDED.operation_id,
         title = EXCLUDED.title,
         category = EXCLUDED.category,
         publisher = EXCLUDED.publisher,
         visibility = EXCLUDED.visibility,
         quality_gate = EXCLUDED.quality_gate,
         verification_freshness = EXCLUDED.verification_freshness,
         price_cents = EXCLUDED.price_cents,
         token_cost = EXCLUDED.token_cost,
         listing = EXCLUDED.listing,
         updated_at = now()`,
      [
        listing.id,
        listing.slug,
        skill.id,
        operation.id,
        listing.title,
        listing.category,
        listing.publisher,
        listing.visibility,
        listing.qualityGate,
        listing.verificationFreshness,
        listing.pricing.priceCents,
        listing.pricing.tokenCost,
        JSON.stringify(listing)
      ]
    );
    if (verificationRecord) {
      await client.query(
        `INSERT INTO verification_records(operation_id, target, status, record)
         VALUES ($1, $2, $3, $4)`,
        [
          operation.id,
          verificationRecord.target,
          verificationRecord.latest && verificationRecord.latest.passed ? "passed" : "failed",
          JSON.stringify(verificationRecord)
        ]
      );
    }
  });
  return true;
}

function rowJson(value) {
  return value || null;
}

async function listPublishedApis() {
  if (!isDatabaseConfigured()) return [];
  const result = await query(
    `SELECT
       listing.listing,
       operation.definition AS operation,
       skill.manifest AS skill,
       latest.record AS verification_record
     FROM marketplace_listings listing
     JOIN api_operations operation ON operation.id = listing.operation_id
     JOIN skill_manifests skill ON skill.id = listing.skill_id
     LEFT JOIN LATERAL (
       SELECT record
       FROM verification_records
       WHERE operation_id = operation.id
       ORDER BY created_at DESC
       LIMIT 1
     ) latest ON true
     WHERE listing.visibility IN ('public', 'internal')
     ORDER BY listing.created_at ASC`
  );
  return result.rows.map((row) => ({
    listing: rowJson(row.listing),
    operation: rowJson(row.operation),
    skill: rowJson(row.skill),
    verificationRecord: rowJson(row.verification_record)
  }));
}

async function ensureAccountRow(accountId, metadata = {}) {
  if (!isDatabaseConfigured() || !accountId) return false;
  await query(
    `INSERT INTO accounts(id, status, metadata)
     VALUES ($1, 'active', $2)
     ON CONFLICT (id) DO UPDATE SET
       last_seen_at = now(),
       updated_at = now(),
       metadata = accounts.metadata || EXCLUDED.metadata`,
    [accountId, JSON.stringify(metadata)]
  );
  return true;
}

async function recordUsageEvent({
  id,
  accountId,
  listingSlug,
  invocationId,
  paymentMethod,
  tokenCost = 0,
  stripeCustomerId,
  metadata = {}
}) {
  if (!isDatabaseConfigured() || !listingSlug) return false;
  await ensureAccountRow(accountId, { source: "usage_event" });
  await query(
    `INSERT INTO usage_events(
       id, account_id, listing_slug, invocation_id, payment_method,
       token_cost, stripe_customer_id, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       account_id = COALESCE(EXCLUDED.account_id, usage_events.account_id),
       listing_slug = EXCLUDED.listing_slug,
       invocation_id = COALESCE(EXCLUDED.invocation_id, usage_events.invocation_id),
       payment_method = EXCLUDED.payment_method,
       token_cost = EXCLUDED.token_cost,
       stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, usage_events.stripe_customer_id),
       metadata = usage_events.metadata || EXCLUDED.metadata`,
    [
      id,
      accountId || null,
      listingSlug,
      invocationId || null,
      paymentMethod || "unknown",
      tokenCost,
      stripeCustomerId || null,
      JSON.stringify(metadata)
    ]
  );
  return true;
}

async function recordWorkflowSubmission({
  id,
  accountId,
  title,
  targetUrl,
  goal,
  artifacts = [],
  status = "submitted"
}) {
  if (!isDatabaseConfigured()) return false;
  await ensureAccountRow(accountId, { source: "workflow_submission" });
  await query(
    `INSERT INTO workflow_submissions(
       id, account_id, title, target_url, goal, status, artifacts
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       account_id = COALESCE(EXCLUDED.account_id, workflow_submissions.account_id),
       title = EXCLUDED.title,
       target_url = EXCLUDED.target_url,
       goal = EXCLUDED.goal,
       status = EXCLUDED.status,
       artifacts = EXCLUDED.artifacts,
       updated_at = now()`,
    [
      id,
      accountId || null,
      title,
      targetUrl || null,
      goal,
      status,
      JSON.stringify(artifacts)
    ]
  );
  return true;
}

async function accountUsageSummary(accountId, limit = 50) {
  if (!isDatabaseConfigured() || !accountId) return null;
  await ensureAccountRow(accountId, { source: "usage_summary" });
  const [account, wallet, ledger, usage, payments, invocations, submissions] = await Promise.all([
    query("SELECT * FROM accounts WHERE id = $1", [accountId]),
    query("SELECT * FROM token_wallets WHERE account_id = $1", [accountId]),
    query(
      `SELECT * FROM token_ledger
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, limit]
    ),
    query(
      `SELECT * FROM usage_events
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, limit]
    ),
    query(
      `SELECT * FROM payments
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, limit]
    ),
    query(
      `SELECT * FROM invocation_logs
       WHERE caller_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, limit]
    ),
    query(
      `SELECT * FROM workflow_submissions
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [accountId, limit]
    )
  ]);
  return {
    account: account.rows[0] || null,
    wallet: wallet.rows[0] || null,
    ledger: ledger.rows,
    usageEvents: usage.rows,
    payments: payments.rows,
    invocationLogs: invocations.rows,
    workflowSubmissions: submissions.rows
  };
}

async function recordInvocationLog(log, listingSlug) {
  if (!isDatabaseConfigured() || !log) return false;
  await query(
    `INSERT INTO invocation_logs(
       id, skill_id, listing_slug, caller_id, status, input_hash, output_hash,
       policy_decision, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       listing_slug = COALESCE(EXCLUDED.listing_slug, invocation_logs.listing_slug),
       metadata = invocation_logs.metadata || EXCLUDED.metadata`,
    [
      log.id,
      log.skillId || null,
      listingSlug || null,
      log.callerId || null,
      log.status,
      log.inputHash || null,
      log.outputHash || null,
      log.policyDecision ? JSON.stringify(log.policyDecision) : null,
      JSON.stringify(log)
    ]
  );
  return true;
}

module.exports = {
  accountUsageSummary,
  ensureAccountRow,
  getPool,
  isDatabaseConfigured,
  listPublishedApis,
  migrate,
  query,
  recordInvocationLog,
  recordUsageEvent,
  recordWorkflowSubmission,
  upsertPublishedApi,
  withTransaction
};
