const { id, now, stableHash } = require("./utils");
const { isDatabaseConfigured, withTransaction, query } = require("./database");
const { ensureAccount, ensureAccountPersistent, normalizeAccountId } = require("./accounts");

const TOKEN_ENV = {
  secretKey: "STRIPE_SECRET_KEY",
  publicUrl: "CAIRN_PUBLIC_URL",
  starterPrice: "STRIPE_PRICE_TOKENS_STARTER",
  builderPrice: "STRIPE_PRICE_TOKENS_BUILDER",
  teamPrice: "STRIPE_PRICE_TOKENS_TEAM"
};

const TOKEN_PACKS = [
  {
    id: "starter",
    title: "Starter",
    tokens: 250,
    priceCents: 99,
    stripePriceEnv: TOKEN_ENV.starterPrice
  },
  {
    id: "builder",
    title: "Builder",
    tokens: 1500,
    priceCents: 499,
    stripePriceEnv: TOKEN_ENV.builderPrice
  },
  {
    id: "team",
    title: "Team",
    tokens: 7500,
    priceCents: 1999,
    stripePriceEnv: TOKEN_ENV.teamPrice
  }
];

function accountIdFrom(value) {
  return normalizeAccountId(value);
}

function publicWallet(wallet) {
  return {
    accountId: wallet.accountId,
    balance: wallet.balance,
    lifetimePurchased: wallet.lifetimePurchased,
    lifetimeSpent: wallet.lifetimeSpent,
    updatedAt: wallet.updatedAt
  };
}

function publicWalletFromRow(row) {
  return {
    accountId: row.account_id,
    balance: row.balance,
    lifetimePurchased: row.lifetime_purchased,
    lifetimeSpent: row.lifetime_spent,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function ledgerFromRow(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.entry_type,
    tokens: Math.abs(row.token_delta),
    tokenDelta: row.token_delta,
    balanceAfter: row.balance_after,
    reason: row.reason,
    metadata: row.metadata || {},
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

function ensureWallet(state, accountId) {
  const normalized = accountIdFrom(accountId);
  ensureAccount(state, normalized);
  if (!state.tokenWallets[normalized]) {
    state.tokenWallets[normalized] = {
      accountId: normalized,
      balance: normalized === "demo-user" ? 50 : 0,
      lifetimePurchased: normalized === "demo-user" ? 50 : 0,
      lifetimeSpent: 0,
      updatedAt: now()
    };
    if (normalized === "demo-user") {
      state.tokenLedger.unshift({
        id: id("ledger"),
        accountId: normalized,
        type: "grant",
        tokens: 50,
        balanceAfter: 50,
        reason: "demo_starting_balance",
        createdAt: now()
      });
    }
  }
  return state.tokenWallets[normalized];
}

async function ensureWalletPersistent(state, accountId) {
  if (!isDatabaseConfigured()) {
    return publicWallet(ensureWallet(state, accountId));
  }
  const normalized = accountIdFrom(accountId);
  await ensureAccountPersistent(state, normalized, { source: "wallet" });
  const startingBalance = normalized === "demo-user" ? 50 : 0;
  const result = await query(
    `INSERT INTO token_wallets(account_id, balance, lifetime_purchased, lifetime_spent)
     VALUES ($1, $2, $2, 0)
     ON CONFLICT (account_id) DO NOTHING
     RETURNING *`,
    [normalized, startingBalance]
  );
  if (result && result.rows[0] && startingBalance > 0) {
    await query(
      `INSERT INTO token_ledger(
         id, account_id, entry_type, token_delta, balance_after, reason, metadata, idempotency_key
       )
       VALUES ($1, $2, 'grant', $3, $3, 'demo_starting_balance', $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [id("ledger"), normalized, startingBalance, JSON.stringify({ source: "database_bootstrap" }), `demo_starting_balance:${normalized}`]
    );
    return publicWalletFromRow(result.rows[0]);
  }
  const wallet = await query("SELECT * FROM token_wallets WHERE account_id = $1", [normalized]);
  return publicWalletFromRow(wallet.rows[0]);
}

function tokenConfig() {
  return {
    currency: "usd",
    tokenName: "Cairn token",
    defaultAccountId: "demo-user",
    mode: process.env.STRIPE_SECRET_KEY ? "configured" : "stub",
    packs: TOKEN_PACKS.map((pack) => ({
      ...pack,
      stripePriceId: process.env[pack.stripePriceEnv] || null
    })),
    requiredEnv: [TOKEN_ENV.secretKey, TOKEN_ENV.publicUrl],
    optionalEnv: [TOKEN_ENV.starterPrice, TOKEN_ENV.builderPrice, TOKEN_ENV.teamPrice]
  };
}

function findPack(packId) {
  return TOKEN_PACKS.find((pack) => pack.id === packId) || TOKEN_PACKS[0];
}

function createTokenQuote(packId, accountId = "demo-user") {
  const pack = findPack(packId);
  return {
    id: id("token_quote"),
    accountId: accountIdFrom(accountId),
    packId: pack.id,
    title: `${pack.title} token pack`,
    tokens: pack.tokens,
    currency: "usd",
    total: pack.priceCents,
    unitPriceCents: Math.round((pack.priceCents / pack.tokens) * 100) / 100,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    stripe: {
      mode: process.env.STRIPE_SECRET_KEY ? "configured" : "stub_until_keys_configured",
      priceId: process.env[pack.stripePriceEnv] || null
    }
  };
}

function formBody(entries) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  return body;
}

function publicBaseUrl(value) {
  return String(value || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

async function createStripeTokenCheckoutSession(quote, buyer = {}) {
  const pack = findPack(quote.packId);
  const publicUrl = publicBaseUrl(buyer.returnBaseUrl || process.env[TOKEN_ENV.publicUrl]);
  const stripePriceId = process.env[pack.stripePriceEnv];
  const lineItem = stripePriceId
    ? {
        "line_items[0][price]": stripePriceId,
        "line_items[0][quantity]": 1
      }
    : {
        "line_items[0][price_data][currency]": quote.currency,
        "line_items[0][price_data][unit_amount]": quote.total,
        "line_items[0][price_data][product_data][name]": quote.title,
        "line_items[0][price_data][product_data][description]": `${quote.tokens} Cairn tokens`,
        "line_items[0][quantity]": 1
      };
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formBody({
      mode: "payment",
      success_url: `${publicUrl}/marketplace?token_checkout=success&session_id={CHECKOUT_SESSION_ID}&pack=${encodeURIComponent(pack.id)}`,
      cancel_url: `${publicUrl}/marketplace?token_checkout=cancelled&pack=${encodeURIComponent(pack.id)}`,
      client_reference_id: quote.accountId,
      "metadata[kind]": "token_pack",
      "metadata[account_id]": quote.accountId,
      "metadata[pack_id]": pack.id,
      "metadata[token_quote_id]": quote.id,
      "metadata[tokens]": quote.tokens,
      ...lineItem
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    return {
      error: "stripe_token_checkout_failed",
      statusCode: response.status,
      stripe: payload
    };
  }
  return payload;
}

async function createTokenCheckout(state, quote, buyer = {}) {
  const accountId = accountIdFrom(buyer.accountId || quote.accountId);
  await ensureAccountPersistent(state, accountId, { source: "token_checkout" });
  if (process.env.STRIPE_SECRET_KEY) {
    const session = await createStripeTokenCheckoutSession({ ...quote, accountId }, buyer);
    if (!session.error) {
      return {
        id: session.id,
        status: "requires_payment",
        mode: "stripe_checkout",
        accountId,
        quoteId: quote.id,
        tokens: quote.tokens,
        amount: quote.total,
        currency: quote.currency,
        checkoutUrl: session.url
      };
    }
    return {
      id: id("token_checkout"),
      status: "stripe_error",
      mode: "stripe_checkout",
      accountId,
      quoteId: quote.id,
      error: session
    };
  }
  const grant = await grantTokensPersistent(state, accountId, quote.tokens, "token_pack_stub_checkout", {
    quoteId: quote.id,
    packId: quote.packId,
    amount: quote.total,
    idempotencyKey: `token_pack_stub_checkout:${quote.id}`
  });
  return {
    id: id("token_checkout"),
    status: "test_authorized",
    mode: "stub",
    accountId,
    quoteId: quote.id,
    tokens: quote.tokens,
    amount: quote.total,
    currency: quote.currency,
    grant: grant.ledgerEntry || grant,
    wallet: grant.wallet || publicWallet(ensureWallet(state, accountId))
  };
}

async function fulfillTokenCheckoutSession(state, session = {}) {
  const metadata = session.metadata || {};
  if (metadata.kind !== "token_pack") {
    return {
      ok: false,
      skipped: true,
      reason: "not_token_pack"
    };
  }
  if (session.payment_status && session.payment_status !== "paid") {
    return {
      ok: false,
      skipped: true,
      reason: "payment_not_paid",
      paymentStatus: session.payment_status
    };
  }
  const accountId = accountIdFrom(metadata.account_id || session.client_reference_id);
  const pack = findPack(metadata.pack_id);
  const tokens = Math.max(0, Number(metadata.tokens || pack.tokens || 0));
  if (tokens <= 0) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_token_amount"
    };
  }
  const sessionId = session.id || id("stripe_session");
  const paymentRecord = {
    provider: "stripe",
    providerReference: sessionId,
    paymentStatus: session.payment_status || "paid",
    checkoutStatus: session.status || "complete",
    amountTotal: session.amount_total || 0,
    currency: session.currency || "usd",
    packId: metadata.pack_id || pack.id,
    quoteId: metadata.token_quote_id || null
  };
  const grant = await grantTokensPersistent(state, accountId, tokens, "stripe_token_pack_paid", {
    ...paymentRecord,
    idempotencyKey: `stripe_token_checkout:${sessionId}`
  });
  if (isDatabaseConfigured()) {
    await query(
      `INSERT INTO payments(
         id, account_id, provider, provider_reference, status,
         amount_cents, currency, tokens, metadata
       )
       VALUES ($1, $2, 'stripe', $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         amount_cents = EXCLUDED.amount_cents,
         currency = EXCLUDED.currency,
         tokens = EXCLUDED.tokens,
         metadata = EXCLUDED.metadata,
         updated_at = now()`,
      [
        sessionId,
        accountId,
        sessionId,
        session.payment_status || session.status || "paid",
        session.amount_total || 0,
        session.currency || "usd",
        tokens,
        JSON.stringify(paymentRecord)
      ]
    );
  }
  return {
    ok: true,
    accountId,
    tokens,
    wallet: grant.wallet,
    ledgerEntry: grant.ledgerEntry,
    alreadyApplied: Boolean(grant.alreadyApplied),
    payment: paymentRecord
  };
}

function grantTokens(state, accountId, tokens, reason = "manual_grant", metadata = {}) {
  const wallet = ensureWallet(state, accountId);
  const amount = Math.max(0, Number(tokens || 0));
  wallet.balance += amount;
  wallet.lifetimePurchased += amount;
  wallet.updatedAt = now();
  const entry = {
    id: id("ledger"),
    accountId: wallet.accountId,
    type: "credit",
    tokens: amount,
    balanceAfter: wallet.balance,
    reason,
    metadata,
    createdAt: now()
  };
  state.tokenLedger.unshift(entry);
  return entry;
}

async function grantTokensPersistent(state, accountId, tokens, reason = "manual_grant", metadata = {}) {
  if (!isDatabaseConfigured()) {
    const entry = grantTokens(state, accountId, tokens, reason, metadata);
    return {
      ok: true,
      wallet: publicWallet(ensureWallet(state, accountId)),
      ledgerEntry: entry
    };
  }
  const normalized = accountIdFrom(accountId);
  const amount = Math.max(0, Number(tokens || 0));
  const idempotencyKey = metadata.idempotencyKey || `${reason}:${stableHash({ normalized, amount, metadata })}`;
  await ensureAccountPersistent(state, normalized, { source: "token_grant" });
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO token_wallets(account_id, balance, lifetime_purchased, lifetime_spent)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [normalized]
    );
    const existing = await client.query(
      "SELECT * FROM token_ledger WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    if (existing.rows[0]) {
      const wallet = await client.query("SELECT * FROM token_wallets WHERE account_id = $1", [normalized]);
      return {
        ok: true,
        alreadyApplied: true,
        wallet: publicWalletFromRow(wallet.rows[0]),
        ledgerEntry: ledgerFromRow(existing.rows[0])
      };
    }
    const updated = await client.query(
      `UPDATE token_wallets
       SET balance = balance + $2,
           lifetime_purchased = lifetime_purchased + $2,
           updated_at = now()
       WHERE account_id = $1
       RETURNING *`,
      [normalized, amount]
    );
    const wallet = updated.rows[0];
    const ledger = await client.query(
      `INSERT INTO token_ledger(
         id, account_id, entry_type, token_delta, balance_after, reason, metadata, idempotency_key
       )
       VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id("ledger"),
        normalized,
        amount,
        wallet.balance,
        reason,
        JSON.stringify(metadata),
        idempotencyKey
      ]
    );
    return {
      ok: true,
      wallet: publicWalletFromRow(wallet),
      ledgerEntry: ledgerFromRow(ledger.rows[0])
    };
  });
}

function previewTokenDebit(state, accountId, listing) {
  const wallet = ensureWallet(state, accountId);
  const tokenCost = listing.pricing.tokenCost || 1;
  return {
    ok: wallet.balance >= tokenCost,
    accountId: wallet.accountId,
    tokenCost,
    wallet: publicWallet(wallet),
    shortfall: Math.max(0, tokenCost - wallet.balance)
  };
}

async function previewTokenDebitPersistent(state, accountId, listing) {
  if (!isDatabaseConfigured()) {
    return previewTokenDebit(state, accountId, listing);
  }
  const wallet = await ensureWalletPersistent(state, accountId);
  const tokenCost = listing.pricing.tokenCost || 1;
  return {
    ok: wallet.balance >= tokenCost,
    accountId: wallet.accountId,
    tokenCost,
    wallet,
    shortfall: Math.max(0, tokenCost - wallet.balance)
  };
}

function spendTokens(state, accountId, listing, metadata = {}) {
  const wallet = ensureWallet(state, accountId);
  const tokenCost = listing.pricing.tokenCost || 1;
  if (wallet.balance < tokenCost) {
    return {
      ok: false,
      error: "insufficient_tokens",
      tokenCost,
      wallet: publicWallet(wallet),
      shortfall: tokenCost - wallet.balance
    };
  }
  wallet.balance -= tokenCost;
  wallet.lifetimeSpent += tokenCost;
  wallet.updatedAt = now();
  const entry = {
    id: id("ledger"),
    accountId: wallet.accountId,
    type: "debit",
    tokens: tokenCost,
    balanceAfter: wallet.balance,
    reason: "tool_invocation",
    metadata: {
      toolId: listing.slug,
      invocationHash: stableHash(metadata),
      ...metadata
    },
    createdAt: now()
  };
  state.tokenLedger.unshift(entry);
  return {
    ok: true,
    tokenCost,
    wallet: publicWallet(wallet),
    ledgerEntry: entry
  };
}

async function spendTokensPersistent(state, accountId, listing, metadata = {}) {
  if (!isDatabaseConfigured()) {
    return spendTokens(state, accountId, listing, metadata);
  }
  const normalized = accountIdFrom(accountId);
  const tokenCost = listing.pricing.tokenCost || 1;
  const idempotencyKey = metadata.idempotencyKey || `tool_invocation:${listing.slug}:${metadata.invocationId || stableHash(metadata)}`;
  await ensureAccountPersistent(state, normalized, { source: "token_spend" });
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO token_wallets(account_id, balance, lifetime_purchased, lifetime_spent)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (account_id) DO NOTHING`,
      [normalized]
    );
    const existing = await client.query(
      "SELECT * FROM token_ledger WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    if (existing.rows[0]) {
      const wallet = await client.query("SELECT * FROM token_wallets WHERE account_id = $1", [normalized]);
      return {
        ok: true,
        alreadyDebited: true,
        tokenCost,
        wallet: publicWalletFromRow(wallet.rows[0]),
        ledgerEntry: ledgerFromRow(existing.rows[0])
      };
    }
    const walletResult = await client.query(
      "SELECT * FROM token_wallets WHERE account_id = $1 FOR UPDATE",
      [normalized]
    );
    const wallet = walletResult.rows[0];
    if (!wallet || wallet.balance < tokenCost) {
      return {
        ok: false,
        error: "insufficient_tokens",
        tokenCost,
        wallet: wallet ? publicWalletFromRow(wallet) : { accountId: normalized, balance: 0, lifetimePurchased: 0, lifetimeSpent: 0 },
        shortfall: tokenCost - (wallet ? wallet.balance : 0)
      };
    }
    const updated = await client.query(
      `UPDATE token_wallets
       SET balance = balance - $2,
           lifetime_spent = lifetime_spent + $2,
           updated_at = now()
       WHERE account_id = $1
       RETURNING *`,
      [normalized, tokenCost]
    );
    const nextWallet = updated.rows[0];
    const metadataWithTool = {
      toolId: listing.slug,
      invocationHash: stableHash(metadata),
      ...metadata
    };
    const ledger = await client.query(
      `INSERT INTO token_ledger(
         id, account_id, entry_type, token_delta, balance_after, reason, metadata, idempotency_key
       )
       VALUES ($1, $2, 'debit', $3, $4, 'tool_invocation', $5, $6)
       RETURNING *`,
      [
        id("ledger"),
        normalized,
        -tokenCost,
        nextWallet.balance,
        JSON.stringify(metadataWithTool),
        idempotencyKey
      ]
    );
    await client.query(
      `INSERT INTO usage_events(
         id, account_id, listing_slug, invocation_id, payment_method, token_cost, metadata
       )
       VALUES ($1, $2, $3, $4, 'tokens', $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        metadata.invocationId || id("usage"),
        normalized,
        listing.slug,
        metadata.invocationId || null,
        tokenCost,
        JSON.stringify(metadataWithTool)
      ]
    );
    return {
      ok: true,
      tokenCost,
      wallet: publicWalletFromRow(nextWallet),
      ledgerEntry: ledgerFromRow(ledger.rows[0])
    };
  });
}

function walletLedger(state, accountId, limit = 20) {
  const normalized = accountIdFrom(accountId);
  return state.tokenLedger
    .filter((entry) => entry.accountId === normalized)
    .slice(0, limit);
}

async function walletLedgerPersistent(state, accountId, limit = 20) {
  if (!isDatabaseConfigured()) {
    return walletLedger(state, accountId, limit);
  }
  const normalized = accountIdFrom(accountId);
  const result = await query(
    `SELECT * FROM token_ledger
     WHERE account_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [normalized, limit]
  );
  return result.rows.map(ledgerFromRow);
}

module.exports = {
  TOKEN_PACKS,
  createTokenCheckout,
  createTokenQuote,
  ensureWallet,
  ensureWalletPersistent,
  findPack,
  fulfillTokenCheckoutSession,
  grantTokens,
  grantTokensPersistent,
  accountIdFrom,
  previewTokenDebit,
  previewTokenDebitPersistent,
  publicWallet,
  spendTokens,
  spendTokensPersistent,
  tokenConfig,
  walletLedger,
  walletLedgerPersistent
};
