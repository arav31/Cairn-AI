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

async function recordInvocationLog(log, listingSlug) {
  if (!isDatabaseConfigured() || !log) return false;
  await query(
    `INSERT INTO invocation_logs(
       id, skill_id, listing_slug, caller_id, status, input_hash, output_hash,
       policy_decision, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO NOTHING`,
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
  getPool,
  isDatabaseConfigured,
  migrate,
  query,
  recordInvocationLog,
  upsertPublishedApi,
  withTransaction
};
