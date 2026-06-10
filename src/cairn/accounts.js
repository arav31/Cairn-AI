const { isDatabaseConfigured, query } = require("./database");
const { now } = require("./utils");

function normalizeAccountId(value) {
  return String(value || "demo-user").trim() || "demo-user";
}

function publicAccount(account) {
  return {
    id: account.id,
    accountId: account.accountId || account.id,
    displayName: account.displayName || account.display_name || null,
    status: account.status || "active",
    metadata: account.metadata || {},
    createdAt: account.createdAt || account.created_at || null,
    updatedAt: account.updatedAt || account.updated_at || null,
    lastSeenAt: account.lastSeenAt || account.last_seen_at || null
  };
}

function accountFromRow(row) {
  return publicAccount({
    id: row.id,
    accountId: row.id,
    displayName: row.display_name,
    status: row.status,
    metadata: row.metadata || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    lastSeenAt: row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : row.last_seen_at
  });
}

function ensureAccount(state, accountId, metadata = {}) {
  const normalized = normalizeAccountId(accountId);
  if (!state.accounts) state.accounts = {};
  if (!state.accounts[normalized]) {
    const timestamp = now();
    state.accounts[normalized] = {
      id: normalized,
      accountId: normalized,
      displayName: metadata.displayName || null,
      status: "active",
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSeenAt: timestamp
    };
  } else {
    state.accounts[normalized].lastSeenAt = now();
    state.accounts[normalized].updatedAt = now();
    state.accounts[normalized].metadata = {
      ...(state.accounts[normalized].metadata || {}),
      ...metadata
    };
  }
  return publicAccount(state.accounts[normalized]);
}

async function ensureAccountPersistent(state, accountId, metadata = {}) {
  if (!isDatabaseConfigured()) {
    return ensureAccount(state, accountId, metadata);
  }
  const normalized = normalizeAccountId(accountId);
  const result = await query(
    `INSERT INTO accounts(id, display_name, status, metadata)
     VALUES ($1, $2, 'active', $3)
     ON CONFLICT (id) DO UPDATE SET
       last_seen_at = now(),
       updated_at = now(),
       display_name = COALESCE(EXCLUDED.display_name, accounts.display_name),
       metadata = accounts.metadata || EXCLUDED.metadata
     RETURNING *`,
    [normalized, metadata.displayName || null, JSON.stringify(metadata)]
  );
  return accountFromRow(result.rows[0]);
}

module.exports = {
  accountFromRow,
  ensureAccount,
  ensureAccountPersistent,
  normalizeAccountId,
  publicAccount
};
