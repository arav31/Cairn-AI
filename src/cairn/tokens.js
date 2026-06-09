const { id, now, stableHash } = require("./utils");

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
  return String(value || "demo-user").trim() || "demo-user";
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

function ensureWallet(state, accountId) {
  const normalized = accountIdFrom(accountId);
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

async function createStripeTokenCheckoutSession(quote, buyer = {}) {
  const pack = findPack(quote.packId);
  const publicUrl = buyer.returnBaseUrl || process.env[TOKEN_ENV.publicUrl] || "http://localhost:3000";
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
      success_url: `${publicUrl}/?token_checkout=success&pack=${encodeURIComponent(pack.id)}`,
      cancel_url: `${publicUrl}/?token_checkout=cancelled&pack=${encodeURIComponent(pack.id)}`,
      "metadata[kind]": "token_pack",
      "metadata[account_id]": quote.accountId,
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
  const grant = grantTokens(state, accountId, quote.tokens, "token_pack_stub_checkout", {
    quoteId: quote.id,
    packId: quote.packId,
    amount: quote.total
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
    grant,
    wallet: publicWallet(ensureWallet(state, accountId))
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

function walletLedger(state, accountId, limit = 20) {
  const normalized = accountIdFrom(accountId);
  return state.tokenLedger
    .filter((entry) => entry.accountId === normalized)
    .slice(0, limit);
}

module.exports = {
  TOKEN_PACKS,
  createTokenCheckout,
  createTokenQuote,
  ensureWallet,
  findPack,
  grantTokens,
  previewTokenDebit,
  publicWallet,
  spendTokens,
  tokenConfig,
  walletLedger
};
