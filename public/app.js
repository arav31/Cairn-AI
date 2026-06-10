const app = {
  listings: [],
  selectedSlug: null,
  query: "",
  category: "All",
  sortMode: "Popular",
  paymentMode: "tokens",
  latestPayment: null,
  latestResult: null,
  latestTokenPurchase: null,
  stripeConfig: null,
  tokenConfig: null,
  catalogStorage: null,
  wallet: null,
  walletLedger: [],
  accountId: "demo-user",
  agentKey: null
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents, currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format((cents || 0) / 100);
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact" }).format(value || 0);
}

function tokenLabel(count) {
  const value = Number(count || 0);
  return `${value} token${value === 1 ? "" : "s"}`;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function selectedListing() {
  return app.listings.find((listing) => listing.slug === app.selectedSlug) || app.listings[0];
}

function generatedAccountId() {
  const suffix = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8);
  return `acct_${suffix}`;
}

function authHeaders(headers = {}) {
  return app.agentKey
    ? { ...headers, Authorization: `Bearer ${app.agentKey}` }
    : headers;
}

function saveAgentSession(accountId, agentKey) {
  app.accountId = accountId;
  if (agentKey) app.agentKey = agentKey;
  localStorage.setItem("cairnAccountId", app.accountId);
  if (app.agentKey) localStorage.setItem("cairnAgentKey", app.agentKey);
}

function applyAgentAuth(payload) {
  const agentKey = payload && payload.agentAuth && payload.agentAuth.agentKey;
  if (agentKey) {
    saveAgentSession(payload.account.accountId || payload.account.id, agentKey);
  }
}

function filteredListings() {
  const query = app.query.toLowerCase();
  const matches = app.listings.filter((listing) => {
    const tags = Array.isArray(listing.tags) ? listing.tags : [];
    const haystack = [
      listing.title,
      listing.tagline,
      listing.category,
      listing.publisher,
      tags.join(" ")
    ].join(" ").toLowerCase();
    const categoryMatches = app.category === "All" || listing.category === app.category;
    return categoryMatches && (!query || haystack.includes(query));
  });

  if (app.sortMode === "Popular") {
    return matches;
  }

  return matches.sort((a, b) => {
    if (app.sortMode === "Lowest token cost") {
      return a.pricing.tokenCost - b.pricing.tokenCost;
    }
    if (app.sortMode === "Newest") {
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    }
    return b.stats.callCount - a.stats.callCount;
  });
}

function categoryIcon(listing) {
  if (listing.category === "Insurance") return "SH";
  if (listing.category === "Real estate") return "HM";
  if (listing.category === "Business") return "BK";
  return listing.icon || "API";
}

function latestOutput() {
  return app.latestResult && app.latestResult.payload && app.latestResult.payload.result
    ? app.latestResult.payload.result.output
    : null;
}

async function fetchCatalog() {
  const response = await fetch("/api/catalog");
  const catalog = await response.json();
  app.listings = catalog.listings;
  app.catalogStorage = catalog.storage || null;
  app.selectedSlug = app.selectedSlug || (app.listings[0] && app.listings[0].slug);
  const stripeResponse = await fetch("/api/payments/stripe-config");
  app.stripeConfig = await stripeResponse.json();
  const tokenConfigResponse = await fetch("/api/tokens/config");
  app.tokenConfig = await tokenConfigResponse.json();
  await ensureAccountSession();
  await refreshWallet();
  render();
}

async function refreshWallet() {
  const response = await fetch(`/api/tokens/wallet?accountId=${encodeURIComponent(app.accountId)}`, {
    headers: authHeaders()
  });
  const payload = await response.json();
  if (response.ok) {
    app.wallet = payload.wallet;
    app.walletLedger = payload.ledger || [];
  } else {
    app.wallet = null;
    app.walletLedger = [];
    $("token-status").textContent = payload.message || "Create an account before using wallet credits.";
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
  const payload = await response.json();
  return { ok: response.ok, status: response.status, payload };
}

async function ensureAccountSession() {
  if (app.agentKey) return;
  if (app.accountId === "demo-user") {
    app.accountId = generatedAccountId();
  }
  const result = await postJson("/api/accounts", { accountId: app.accountId });
  if (result.ok) {
    applyAgentAuth(result.payload);
    app.wallet = result.payload.wallet;
    app.walletLedger = result.payload.ledger || [];
  }
}

async function quoteSelected() {
  const listing = selectedListing();
  if (!listing) return;
  const result = await postJson(`/api/tools/${listing.slug}/quote`, {
    input: listing.sampleInput
  });
  app.latestPayment = result.payload;
  renderDetail();
}

async function checkoutSelected() {
  const listing = selectedListing();
  if (!listing) return;
  const quote = app.latestPayment && app.latestPayment.quote
    ? app.latestPayment.quote
    : null;
  const result = await postJson(`/api/tools/${listing.slug}/checkout`, {
    input: listing.sampleInput,
    quote,
    buyer: {
      accountId: app.accountId,
      agent: "demo-agent",
      sharedPaymentToken: "spt_test_from_agent"
    }
  });
  app.latestPayment = result.payload;
  renderDetail();
}

async function invokeSelected() {
  const listing = selectedListing();
  if (!listing) return;
  const checkout = app.latestPayment && app.latestPayment.checkout;
  const payment = checkout ? checkout.payment : { status: "authorized", provider: "stripe" };
  const result = await postJson(`/api/tools/${listing.slug}/invoke`, {
    input: listing.sampleInput,
    payment,
    caller: {
      id: app.accountId,
      scopes: listing.scopes
    }
  });
  app.latestResult = result;
  renderDetail();
}

async function invokeSelectedWithTokens() {
  const listing = selectedListing();
  if (!listing) return;
  const balanceBefore = app.wallet ? app.wallet.balance : null;
  $("token-status").textContent = "Running workflow with tokens...";
  const result = await postJson(`/api/tools/${listing.slug}/invoke`, {
    input: listing.sampleInput,
    paymentMethod: "tokens",
    tokenAccountId: app.accountId,
    caller: {
      id: app.accountId,
      scopes: listing.scopes
    }
  });
  app.latestResult = result;
  await refreshWallet();
  if (result.ok && result.payload.tokenDebit && result.payload.tokenDebit.ok) {
    const debit = result.payload.tokenDebit;
    $("token-status").textContent = `Completed. Spent ${tokenLabel(debit.tokenCost)}. Balance ${balanceBefore} -> ${debit.wallet.balance}.`;
  } else if (result.payload && result.payload.error === "insufficient_tokens") {
    $("token-status").textContent = "Not enough tokens. Buy a pack, then run the workflow again.";
  } else {
    $("token-status").textContent = result.ok ? "Workflow completed." : "Workflow could not run.";
  }
  render();
}

async function runSelectedWithPaymentMode() {
  if (app.paymentMode === "tokens") {
    await invokeSelectedWithTokens();
    return;
  }

  $("token-status").textContent = app.paymentMode === "card"
    ? "Creating Stripe payment..."
    : "Authorizing pay-per-run...";
  await quoteSelected();
  await checkoutSelected();

  const checkout = app.latestPayment && app.latestPayment.checkout;
  if (checkout && checkout.checkoutUrl) {
    $("token-status").textContent = "Stripe Checkout is ready. Open the checkout URL in the selected API panel.";
    renderDetail();
    return;
  }

  await invokeSelected();
  $("token-status").textContent = "Workflow completed with pay-per-run authorization.";
  render();
}

async function createOrLoadAccount() {
  const nextAccountId = ($("account-id-input").value || "demo-user").trim() || "demo-user";
  const sameAccount = nextAccountId === app.accountId;
  const result = await postJson("/api/accounts", {
    accountId: nextAccountId
  }, { auth: sameAccount });
  if (result.ok) {
    applyAgentAuth(result.payload);
    app.accountId = nextAccountId;
    app.wallet = result.payload.wallet;
    app.walletLedger = result.payload.ledger || [];
    if (!result.payload.agentAuth.agentKey && app.agentKey) {
      saveAgentSession(app.accountId, app.agentKey);
    }
    $("token-status").textContent = `Account ready: ${app.accountId}.`;
  } else if (result.status === 409 || result.status === 401) {
    $("token-status").textContent = "That account already needs its saved agent key. Create a new account ID or use this browser's saved account.";
  } else {
    $("token-status").textContent = "Could not load that account.";
  }
  render();
}

async function buySelectedTokenPack() {
  const packId = $("token-pack-select").value;
  const quoteResult = await postJson("/api/tokens/quote", {
    packId,
    accountId: app.accountId
  });
  const checkoutResult = await postJson("/api/tokens/checkout", {
    packId,
    quote: quoteResult.payload.quote,
    accountId: app.accountId,
    buyer: {
      accountId: app.accountId,
      agent: "demo-agent"
    }
  });
  app.latestTokenPurchase = checkoutResult.payload;
  await refreshWallet();
  const checkout = checkoutResult.payload.checkout;
  if (checkout && checkout.checkoutUrl) {
    $("token-status").textContent = "Opening Stripe Checkout...";
    window.location.href = checkout.checkoutUrl;
    return;
  } else {
    $("token-status").textContent = checkoutResult.ok
      ? `Tokens added. Balance is now ${app.wallet.balance}.`
      : "Could not buy tokens.";
  }
  render();
}

function renderStats() {
  const calls = app.listings.reduce((sum, listing) => sum + ((listing.stats && listing.stats.callCount) || 0), 0);
  const uptime = app.listings.length
    ? app.listings.reduce((sum, listing) => sum + ((listing.stats && listing.stats.uptimePct) || 0), 0) / app.listings.length
    : 0;
  $("stat-tools").textContent = app.listings.length;
  $("stat-calls").textContent = compactNumber(calls);
  $("stat-uptime").textContent = `${uptime.toFixed(1)}%`;
}

function renderWallet() {
  $("token-balance").textContent = app.wallet ? app.wallet.balance : 0;
  $("account-id-input").value = app.accountId;
  const packs = app.tokenConfig ? app.tokenConfig.packs : [];
  $("token-pack-select").innerHTML = packs.map((pack) => `
    <option value="${escapeHtml(pack.id)}">${escapeHtml(pack.title)} - ${pack.tokens} tokens / ${money(pack.priceCents, "usd")}</option>
  `).join("");
  $("token-ledger").innerHTML = (app.walletLedger || []).slice(0, 4).map((entry) => {
    const fallbackDelta = entry.type === "debit" ? -Number(entry.tokens || 0) : Number(entry.tokens || 0);
    const delta = entry.tokenDelta == null ? fallbackDelta : Number(entry.tokenDelta);
    return `
      <li>
        <strong>${delta > 0 ? "+" : ""}${delta} token${Math.abs(delta) === 1 ? "" : "s"}</strong>
        <span>${escapeHtml(entry.reason || entry.type)}</span>
        <small>${escapeHtml(entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "")}</small>
      </li>
    `;
  }).join("") || "<li><span>No token activity yet.</span></li>";
}

function renderFilters() {
  const categories = ["All", ...new Set(app.listings.map((listing) => listing.category))];
  $("category-filters").innerHTML = categories.map((category) => `
    <button class="filter-chip ${category === app.category ? "active" : ""}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>
  `).join("");
  for (const button of document.querySelectorAll("[data-category]")) {
    button.addEventListener("click", () => {
      app.category = button.dataset.category;
      $("category-select").value = app.category === "All" ? "All categories" : app.category;
      render();
    });
  }

  const select = $("category-select");
  select.innerHTML = ["All categories", ...categories.filter((category) => category !== "All")]
    .map((category) => `<option>${escapeHtml(category)}</option>`)
    .join("");
  select.value = app.category === "All" ? "All categories" : app.category;
}

function renderPaymentModes() {
  for (const button of document.querySelectorAll("[data-payment-mode]")) {
    const selected = button.dataset.paymentMode === app.paymentMode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  }
}

function renderListings() {
  const listings = filteredListings();
  $("listing-grid").innerHTML = listings.map((listing) => `
    <article class="listing-card ${listing.slug === app.selectedSlug ? "selected" : ""}">
      <span class="api-icon ${escapeHtml(listing.accent)}">${escapeHtml(categoryIcon(listing))}</span>
      <div class="listing-body">
        <h2>${escapeHtml(listing.title)}</h2>
        <p>${escapeHtml(listing.tagline)}</p>
        <div class="tag-row">${(listing.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="verified-line">
          <span>Verified</span>
          <small>${escapeHtml(listing.operationVersion)}</small>
          <small>${((listing.stats && listing.stats.healthScore) || 0) / 20 >= 4.8 ? "4.9" : "4.7"} (${Math.round(((listing.stats && listing.stats.installCount) || 0) / 4)})</small>
        </div>
        <div class="price-strip">
          <strong>${tokenLabel(listing.pricing.tokenCost)}</strong>
          <span>${money(listing.pricing.priceCents, listing.pricing.currency)} / run</span>
          <span>${compactNumber(listing.stats && listing.stats.callCount)} runs</span>
        </div>
      </div>
      <button class="detail-button" data-slug="${escapeHtml(listing.slug)}" type="button">View details</button>
    </article>
  `).join("") || emptyCatalogHtml();

  for (const button of document.querySelectorAll("[data-slug]")) {
    button.addEventListener("click", () => {
      app.selectedSlug = button.dataset.slug;
      app.latestPayment = null;
      app.latestResult = null;
      render();
      $("detail-pane").scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
}

function renderDetail() {
  const listing = selectedListing();
  if (!listing) {
    $("detail-pane").innerHTML = `
      <section class="empty-panel">
        <h2>No API selected</h2>
        <p>Published workflow APIs will appear here after they are stored and verified.</p>
        <a href="#publish">Submit the first workflow</a>
      </section>
    `;
    return;
  }
  const origin = window.location.origin;
  const curl = `curl -X POST ${origin}${listing.invokePath} \\
  -H "Authorization: Bearer $CAIRN_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ input: listing.sampleInput, paymentMethod: "tokens", tokenAccountId: app.accountId })}'`;
  const sdkSnippet = `const { CairnClient } = require("cairn");
const cairn = new CairnClient({
  baseUrl: "${origin}",
  accountId: "${app.accountId}",
  agentKey: process.env.CAIRN_AGENT_KEY
});

const account = await cairn.createAccount();
await cairn.buyTokens("starter");
const result = await cairn.invoke("${listing.slug}", {
  input: ${JSON.stringify(listing.sampleInput, null, 2).replace(/\n/g, "\n  ")},
  paymentMethod: "tokens"
});`;
  const output = latestOutput();
  const checkoutUrl = app.latestPayment && app.latestPayment.checkout && app.latestPayment.checkout.checkoutUrl;
  const modeLabel = app.paymentMode === "tokens"
    ? `Run for ${tokenLabel(listing.pricing.tokenCost)}`
    : `Run for ${money(listing.pricing.priceCents, listing.pricing.currency)}`;

  $("detail-pane").innerHTML = `
    <div class="detail-header">
      <span class="api-icon large ${escapeHtml(listing.accent)}">${escapeHtml(categoryIcon(listing))}</span>
      <div>
        <p class="eyebrow">${escapeHtml(listing.category)}</p>
        <h2>${escapeHtml(listing.title)}</h2>
        <p>${escapeHtml(listing.description)}</p>
      </div>
    </div>

    <div class="metric-grid">
      <article><strong>${listing.stats.healthScore}/100</strong><span>Health</span></article>
      <article><strong>${listing.stats.uptimePct}%</strong><span>Uptime</span></article>
      <article><strong>${listing.stats.latencyMsP50}ms</strong><span>p50</span></article>
      <article><strong>${compactNumber(listing.stats.installCount)}</strong><span>Installs</span></article>
    </div>

    <section class="detail-section">
      <h3>Use this API</h3>
      <div class="endpoint-list compact">
        <span>MCP</span><code>${origin}/mcp</code>
        <span>OpenAPI</span><code>${origin}${listing.openapiPath}</code>
        <span>README</span><code>${origin}${listing.readmePath}</code>
      </div>
      <button id="run-selected-button" type="button">${escapeHtml(modeLabel)}</button>
      <div class="action-row">
        <button id="quote-button" class="secondary-button" type="button">Get price</button>
        <button id="checkout-button" class="secondary-button" type="button">Create payment</button>
        <button id="token-invoke-button" class="secondary-button" type="button">Use tokens</button>
      </div>
      ${checkoutUrl ? `<a class="checkout-link" href="${escapeHtml(checkoutUrl)}" target="_blank" rel="noreferrer">Open Stripe Checkout</a>` : ""}
    </section>

    <section class="detail-section">
      <h3>README for agents</h3>
      <pre>${escapeHtml(listing.readme)}</pre>
    </section>

    <details class="detail-section" open>
      <summary>Quick start</summary>
      <pre>${escapeHtml(sdkSnippet)}</pre>
      <pre>${escapeHtml(curl)}</pre>
    </details>

    <details class="detail-section">
      <summary>Input schema</summary>
      <pre>${escapeHtml(pretty(listing.inputSchema))}</pre>
    </details>

    <details class="detail-section" ${output ? "open" : ""}>
      <summary>Latest run</summary>
      <pre>${escapeHtml(pretty(output || app.latestResult || { status: "Run this API to see the response here." }))}</pre>
    </details>
  `;
  $("run-selected-button").addEventListener("click", runSelectedWithPaymentMode);
  $("quote-button").addEventListener("click", quoteSelected);
  $("checkout-button").addEventListener("click", checkoutSelected);
  $("token-invoke-button").addEventListener("click", invokeSelectedWithTokens);
}

function emptyCatalogHtml() {
  if (app.listings.length > 0) {
    return "<p class='empty'>No workflow APIs match this search.</p>";
  }
  const storage = app.catalogStorage || {};
  const storageLabel = storage.databaseConfigured
    ? "The database is connected, but no APIs have been published yet."
    : "Persistent database storage is not connected, so no published APIs are available.";
  return `
    <section class="empty-panel">
      <h2>No APIs published yet</h2>
      <p>${escapeHtml(storageLabel)}</p>
      <div class="empty-actions">
        <a href="#publish">Submit a workflow</a>
        <a href="/api/catalog">View catalog API</a>
      </div>
    </section>
  `;
}

function render() {
  renderStats();
  renderWallet();
  renderFilters();
  renderPaymentModes();
  renderListings();
  renderDetail();
}

function bind() {
  const savedAccountId = localStorage.getItem("cairnAccountId");
  const savedAgentKey = localStorage.getItem("cairnAgentKey");
  if (savedAccountId) {
    app.accountId = savedAccountId;
  }
  if (savedAgentKey) {
    app.agentKey = savedAgentKey;
  }
  $("integration-guide-url").textContent = `${window.location.origin}/api/integrations`;
  $("search-input").addEventListener("input", (event) => {
    app.query = event.target.value;
    renderListings();
  });
  $("clear-search").addEventListener("click", () => {
    app.query = "";
    $("search-input").value = "";
    renderListings();
  });
  $("category-select").addEventListener("change", (event) => {
    app.category = event.target.value === "All categories" ? "All" : event.target.value;
    render();
  });
  $("sort-select").addEventListener("change", (event) => {
    app.sortMode = event.target.value;
    renderListings();
  });
  for (const button of document.querySelectorAll("[data-payment-mode]")) {
    button.addEventListener("click", () => {
      app.paymentMode = button.dataset.paymentMode;
      renderPaymentModes();
      renderDetail();
    });
  }
  $("contribute-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const result = await postJson("/api/workflows/recordings", {
      accountId: app.accountId,
      title: form.title,
      targetUrl: form.targetUrl,
      goal: form.goal,
      artifacts: []
    });
    $("contribute-status").textContent = result.ok
      ? "Workflow submitted. The API team can verify it and publish it to the marketplace."
      : "Something went wrong. Please try again.";
    event.currentTarget.reset();
  });
  $("use-account-button").addEventListener("click", createOrLoadAccount);
  $("buy-tokens-button").addEventListener("click", buySelectedTokenPack);
}

bind();
fetchCatalog();
