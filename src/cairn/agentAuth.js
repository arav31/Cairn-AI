const crypto = require("node:crypto");
const { isDatabaseConfigured, query } = require("./database");
const { ensureAccountPersistent, normalizeAccountId } = require("./accounts");
const { id, now } = require("./utils");

const AGENT_KEY_PREFIX = "cairn_agent_";

function generateAgentKey() {
  return `${AGENT_KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
}

function hashAgentKey(agentKey) {
  return crypto.createHash("sha256").update(String(agentKey || "")).digest("hex");
}

function keyPrefix(agentKey) {
  return String(agentKey || "").slice(0, 20);
}

function publicAgentKey(record) {
  if (!record) return null;
  return {
    id: record.id,
    accountId: record.accountId || record.account_id,
    label: record.label || null,
    prefix: record.prefix || null,
    status: record.status || "active",
    createdAt: record.createdAt || record.created_at || null,
    lastUsedAt: record.lastUsedAt || record.last_used_at || null
  };
}

function keyRecordFromRow(row) {
  return publicAgentKey({
    id: row.id,
    accountId: row.account_id,
    label: row.label,
    prefix: row.prefix,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    lastUsedAt: row.last_used_at instanceof Date ? row.last_used_at.toISOString() : row.last_used_at
  });
}

function ensureStateStore(state) {
  if (!state.agentApiKeys) state.agentApiKeys = {};
  return state.agentApiKeys;
}

async function issueAgentKeyPersistent(state, accountId, metadata = {}) {
  const normalized = normalizeAccountId(accountId);
  const agentKey = generateAgentKey();
  const record = {
    id: id("agent_key"),
    accountId: normalized,
    keyHash: hashAgentKey(agentKey),
    prefix: keyPrefix(agentKey),
    label: metadata.label || "Default agent key",
    status: "active",
    createdAt: now(),
    lastUsedAt: null
  };
  await ensureAccountPersistent(state, normalized, { source: "agent_key", displayName: metadata.displayName });
  if (isDatabaseConfigured()) {
    const result = await query(
      `INSERT INTO agent_api_keys(id, account_id, key_hash, prefix, label, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [record.id, normalized, record.keyHash, record.prefix, record.label]
    );
    return {
      agentKey,
      key: keyRecordFromRow(result.rows[0])
    };
  }
  ensureStateStore(state)[record.keyHash] = record;
  return {
    agentKey,
    key: publicAgentKey(record)
  };
}

function agentKeyFromRequest(req) {
  const authorization = req.headers.authorization || req.headers.Authorization || "";
  const bearer = String(authorization).match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return String(req.headers["x-cairn-agent-key"] || req.headers["X-Cairn-Agent-Key"] || "").trim();
}

async function authenticateAgentRequest(req, state) {
  const agentKey = agentKeyFromRequest(req);
  if (!agentKey) {
    return { ok: false, status: 401, error: "agent_auth_required" };
  }
  const keyHash = hashAgentKey(agentKey);
  if (isDatabaseConfigured()) {
    const result = await query(
      `UPDATE agent_api_keys
       SET last_used_at = now()
       WHERE key_hash = $1 AND status = 'active'
       RETURNING *`,
      [keyHash]
    );
    if (!result.rows[0]) {
      return { ok: false, status: 401, error: "invalid_agent_key" };
    }
    return {
      ok: true,
      key: keyRecordFromRow(result.rows[0]),
      accountId: normalizeAccountId(result.rows[0].account_id)
    };
  }
  const record = ensureStateStore(state)[keyHash];
  if (!record || record.status !== "active") {
    return { ok: false, status: 401, error: "invalid_agent_key" };
  }
  record.lastUsedAt = now();
  return {
    ok: true,
    key: publicAgentKey(record),
    accountId: normalizeAccountId(record.accountId)
  };
}

function accountMatchesAuth(auth, accountId) {
  return Boolean(auth && auth.ok && normalizeAccountId(auth.accountId) === normalizeAccountId(accountId));
}

module.exports = {
  accountMatchesAuth,
  agentKeyFromRequest,
  authenticateAgentRequest,
  generateAgentKey,
  hashAgentKey,
  issueAgentKeyPersistent,
  publicAgentKey
};
