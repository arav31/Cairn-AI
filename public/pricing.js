const pricingState = {
  listings: [],
  tokenConfig: null,
  wallet: null,
  accountId: "demo-user"
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

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { ok: response.ok, payload: await response.json() };
}

async function refreshWallet() {
  const response = await fetch(`/api/tokens/wallet?accountId=${encodeURIComponent(pricingState.accountId)}`);
  const payload = await response.json();
  pricingState.wallet = payload.wallet;
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
  renderTokenPacks(checkoutResult.ok ? "Tokens added to your demo wallet." : "Could not start checkout.");
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
        <a href="/#catalog">Open</a>
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
  await refreshWallet();
  renderTokenPacks();
  renderApiPrices();
}

initPricing();
