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

const MIGRATION_FILES = [
  "001_initial_schema.sql",
  "002_private_apis_no_payments.sql"
];

async function migrate() {
  if (!isDatabaseConfigured()) return false;
  if (!migratePromise) {
    migratePromise = (async () => {
      const activePool = getPool();
      const migrationsDir = path.join(__dirname, "..", "..", "migrations");
      for (const file of MIGRATION_FILES) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
        await activePool.query(sql);
      }
      return true;
    })();
  }
  return migratePromise;
}

async function upsertApi({ operation, skill, api, verificationRecord }) {
  if (!isDatabaseConfigured()) return false;
  await ensureAccountRow(api.ownerAccountId, { source: "api_owner" });
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
      `INSERT INTO apis(
         id, slug, skill_id, operation_id, title, owner_account_id, visibility,
         quality_gate, verification_freshness, listing
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         slug = EXCLUDED.slug,
         skill_id = EXCLUDED.skill_id,
         operation_id = EXCLUDED.operation_id,
         title = EXCLUDED.title,
         owner_account_id = EXCLUDED.owner_account_id,
         visibility = EXCLUDED.visibility,
         quality_gate = EXCLUDED.quality_gate,
         verification_freshness = EXCLUDED.verification_freshness,
         listing = EXCLUDED.listing,
         updated_at = now()`,
      [
        api.id,
        api.slug,
        skill.id,
        operation.id,
        api.title,
        api.ownerAccountId,
        api.visibility || "private",
        api.qualityGate || "verified",
        api.verificationFreshness || "fresh",
        JSON.stringify(api)
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

async function listApis(accountId = null) {
  if (!isDatabaseConfigured()) return [];
  const params = [];
  let ownerClause = "";
  if (accountId) {
    params.push(accountId);
    ownerClause = "WHERE api.owner_account_id = $1";
  }
  const result = await query(
    `SELECT
       api.listing AS api,
       operation.definition AS operation,
       skill.manifest AS skill,
       latest.record AS verification_record
     FROM apis api
     JOIN api_operations operation ON operation.id = api.operation_id
     JOIN skill_manifests skill ON skill.id = api.skill_id
     LEFT JOIN LATERAL (
       SELECT record
       FROM verification_records
       WHERE operation_id = operation.id
       ORDER BY created_at DESC
       LIMIT 1
     ) latest ON true
     ${ownerClause}
     ORDER BY api.created_at ASC`,
    params
  );
  return result.rows.map((row) => ({
    api: rowJson(row.api),
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
  const [account, invocations, submissions] = await Promise.all([
    query("SELECT * FROM accounts WHERE id = $1", [accountId]),
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
    invocationLogs: invocations.rows,
    workflowSubmissions: submissions.rows
  };
}

async function recordInvocationLog(log, apiSlug) {
  if (!isDatabaseConfigured() || !log) return false;
  await query(
    `INSERT INTO invocation_logs(
       id, skill_id, api_slug, caller_id, status, input_hash, output_hash,
       policy_decision, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       api_slug = COALESCE(EXCLUDED.api_slug, invocation_logs.api_slug),
       metadata = invocation_logs.metadata || EXCLUDED.metadata`,
    [
      log.id,
      log.skillId || null,
      apiSlug || null,
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
  listApis,
  migrate,
  query,
  recordInvocationLog,
  recordWorkflowSubmission,
  upsertApi,
  withTransaction
};
