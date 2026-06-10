const pricingState = {
  listings: [],
  tokenConfig: null,
  wallet: null,
  accountId: "demo-user",
  agentKey: null
};

const byId = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase()
  }).format((cents || 0) / 100);
}

function perToken(pack) {
  const cents = pack.priceCents / pack.tokens;
  return `${cents.toFixed(cents < 1 ? 2 : 1)} cents per token`;
}

function tokenLabel(count) {
  const value = Number(count || 0);
  return `${value} token${value === 1 ? "" : "s"}`;
}

function generatedAccountId() {
  const suffix = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8);
  return `acct_${suffix}`;
}

function authHeaders(headers = {}) {
  return pricingState.agentKey
    ? { ...headers, Authorization: `Bearer ${pricingState.agentKey}` }
    : headers;
}

function saveAgentSession(accountId, agentKey) {
  pricingState.accountId = accountId;
  if (agentKey) pricingState.agentKey = agentKey;
  localStorage.setItem("cairnAccountId", pricingState.accountId);
  if (pricingState.agentKey) localStorage.setItem("cairnAgentKey", pricingState.agentKey);
}

function applyAgentAuth(payload) {
  const agentKey = payload && payload.agentAuth && payload.agentAuth.agentKey;
  if (agentKey) {
    saveAgentSession(payload.account.accountId || payload.account.id, agentKey);
  }
}

async function postJson(path, body, options = {}) {
  const headers = options.auth === false
    ? { "Content-Type": "application/json" }
    : authHeaders({ "Content-Type": "application/json" });
  const response = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  return { ok: response.ok, payload: await response.json() };
}

async function ensureAccountSession() {
  if (pricingState.agentKey) return;
  if (pricingState.accountId === "demo-user") {
    pricingState.accountId = generatedAccountId();
  }
  const result = await postJson("/api/accounts", { accountId: pricingState.accountId }, { auth: false });
  if (result.ok) {
    applyAgentAuth(result.payload);
    pricingState.wallet = result.payload.wallet;
  }
}

async function refreshWallet() {
  const response = await fetch(`/api/tokens/wallet?accountId=${encodeURIComponent(pricingState.accountId)}`, {
    headers: authHeaders()
  });
  const payload = await response.json();
  pricingState.wallet = response.ok ? payload.wallet : null;
}

async function buyPack(packId) {
  const quoteResult = await postJson("/api/tokens/quote", {
    packId,
    accountId: pricingState.accountId
  });
  const checkoutResult = await postJson("/api/tokens/checkout", {
    packId,
    quote: quoteResult.payload.quote,
    accountId: pricingState.accountId,
    buyer: {
      accountId: pricingState.accountId,
      agent: "pricing-page-demo"
    }
  });
  if (checkoutResult.payload.checkout && checkoutResult.payload.checkout.checkoutUrl) {
    window.location.href = checkoutResult.payload.checkout.checkoutUrl;
    return;
  }
  await refreshWallet();
    renderTokenPacks(checkoutResult.ok ? "Tokens added to your wallet." : "Could not start checkout.");
}

function renderTokenPacks(status = "") {
  const packs = pricingState.tokenConfig ? pricingState.tokenConfig.packs : [];
  const walletBalance = pricingState.wallet ? pricingState.wallet.balance : 0;
  byId("pricing-token-grid").innerHTML = packs.map((pack) => `
    <article class="pricing-card ${pack.id === "builder" ? "featured" : ""}">
      <div>
        <p class="eyebrow">${escapeHtml(pack.title)}</p>
        <h3>${pack.tokens.toLocaleString()} tokens</h3>
      </div>
      <div class="pricing-amount">
        <strong>${money(pack.priceCents, "usd")}</strong>
        <span>${escapeHtml(perToken(pack))}</span>
      </div>
      <p>Use this balance across every Cairn skill. Agents spend tokens only after a successful API run.</p>
      <button data-pack-id="${escapeHtml(pack.id)}" type="button">Buy tokens</button>
    </article>
  `).join("");
  byId("pricing-token-grid").insertAdjacentHTML("beforeend", `
    <article class="pricing-card wallet-overview">
      <p class="eyebrow">Demo wallet</p>
      <h3>${walletBalance.toLocaleString()} tokens</h3>
      <p>Account: ${escapeHtml(pricingState.accountId)}</p>
      <small>${escapeHtml(status || "Use the buttons to test token checkout locally.")}</small>
    </article>
  `);
  for (const button of document.querySelectorAll("[data-pack-id]")) {
    button.addEventListener("click", () => buyPack(button.dataset.packId));
  }
}

function renderApiPrices() {
  byId("pricing-api-table").innerHTML = `
    <div class="pricing-table-row heading">
      <span>API</span>
      <span>Token price</span>
      <span>Direct price</span>
      <span>Use it</span>
    </div>
    ${pricingState.listings.map((listing) => `
      <div class="pricing-table-row">
        <span>
          <strong>${escapeHtml(listing.title)}</strong>
          <small>${escapeHtml(listing.tagline)}</small>
        </span>
        <span>${escapeHtml(tokenLabel(listing.pricing.tokenCost))}</span>
        <span>${money(listing.pricing.priceCents, listing.pricing.currency)}</span>
        <a href="/marketplace#catalog">Open</a>
      </div>
    `).join("")}
  `;
}

async function initPricing() {
  const [catalogResponse, tokenResponse] = await Promise.all([
    fetch("/api/catalog"),
    fetch("/api/tokens/config")
  ]);
  const catalog = await catalogResponse.json();
  pricingState.listings = catalog.listings || [];
  pricingState.tokenConfig = await tokenResponse.json();
  pricingState.accountId = localStorage.getItem("cairnAccountId") || pricingState.accountId;
  pricingState.agentKey = localStorage.getItem("cairnAgentKey") || pricingState.agentKey;
  await ensureAccountSession();
  await refreshWallet();
  renderTokenPacks();
  renderApiPrices();
}

initPricing();
