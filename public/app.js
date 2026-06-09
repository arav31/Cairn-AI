const app = {
  listings: [],
  selectedSlug: null,
  query: "",
  category: "All",
  latestPayment: null,
  latestResult: null,
  latestTokenPurchase: null,
  stripeConfig: null,
  tokenConfig: null,
  wallet: null,
  accountId: "demo-user"
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

function filteredListings() {
  const query = app.query.toLowerCase();
  return app.listings.filter((listing) => {
    const haystack = [
      listing.title,
      listing.tagline,
      listing.category,
      listing.publisher,
      listing.tags.join(" ")
    ].join(" ").toLowerCase();
    const categoryMatches = app.category === "All" || listing.category === app.category;
    return categoryMatches && (!query || haystack.includes(query));
  });
}

async function fetchCatalog() {
  let catalog = { listings: [] };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch("/api/catalog");
    catalog = await response.json();
    if (catalog.listings.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  app.listings = catalog.listings;
  app.selectedSlug = app.selectedSlug || (app.listings[0] && app.listings[0].slug);
  const stripeResponse = await fetch("/api/payments/stripe-config");
  app.stripeConfig = await stripeResponse.json();
  const tokenConfigResponse = await fetch("/api/tokens/config");
  app.tokenConfig = await tokenConfigResponse.json();
  await refreshWallet();
  render();
}

async function refreshWallet() {
  const response = await fetch(`/api/tokens/wallet?accountId=${encodeURIComponent(app.accountId)}`);
  const payload = await response.json();
  app.wallet = payload.wallet;
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { ok: response.ok, status: response.status, payload };
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
      id: "demo-agent",
      scopes: listing.scopes
    }
  });
  app.latestResult = result;
  renderDetail();
}

async function invokeSelectedWithTokens() {
  const listing = selectedListing();
  if (!listing) return;
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
  $("token-status").textContent = checkoutResult.ok
    ? "Tokens added to your wallet."
    : "Could not buy tokens.";
  render();
}

function renderStats() {
  const calls = app.listings.reduce((sum, listing) => sum + listing.stats.callCount, 0);
  const uptime = app.listings.length
    ? app.listings.reduce((sum, listing) => sum + listing.stats.uptimePct, 0) / app.listings.length
    : 0;
  $("stat-tools").textContent = app.listings.length;
  $("stat-calls").textContent = compactNumber(calls);
  $("stat-uptime").textContent = `${uptime.toFixed(1)}%`;
}

function renderWallet() {
  $("token-balance").textContent = app.wallet ? app.wallet.balance : 0;
  const packs = app.tokenConfig ? app.tokenConfig.packs : [];
  $("token-pack-select").innerHTML = packs.map((pack) => `
    <option value="${escapeHtml(pack.id)}">${escapeHtml(pack.title)} - ${pack.tokens} tokens / ${money(pack.priceCents, "usd")}</option>
  `).join("");
}

function renderFilters() {
  const categories = ["All", ...new Set(app.listings.map((listing) => listing.category))];
  $("category-filters").innerHTML = categories.map((category) => `
    <button class="filter-chip ${category === app.category ? "active" : ""}" data-category="${escapeHtml(category)}" type="button">${escapeHtml(category)}</button>
  `).join("");
  for (const button of document.querySelectorAll("[data-category]")) {
    button.addEventListener("click", () => {
      app.category = button.dataset.category;
      render();
    });
  }
}

function renderListings() {
  const listings = filteredListings();
  $("listing-grid").innerHTML = listings.map((listing) => `
    <button class="listing-card ${listing.slug === app.selectedSlug ? "selected" : ""}" data-slug="${escapeHtml(listing.slug)}" type="button">
      <span class="api-icon ${escapeHtml(listing.accent)}">${escapeHtml(listing.icon)}</span>
      <span class="listing-body">
        <span class="listing-title">${escapeHtml(listing.title)}</span>
        <span class="listing-copy">${escapeHtml(listing.tagline)}</span>
        <span class="client-row">${listing.clients.slice(0, 4).map((client) => `<span>${escapeHtml(client)}</span>`).join("")}</span>
        <span class="tag-row">${listing.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</span>
      </span>
      <span class="listing-meta">
        <strong>${tokenLabel(listing.pricing.tokenCost)}</strong>
        <small>or ${money(listing.pricing.priceCents, listing.pricing.currency)}</small>
        <small>${compactNumber(listing.stats.callCount)} uses</small>
        <em>Add to toolbox</em>
      </span>
    </button>
  `).join("") || "<p class='empty'>No workflow APIs match this search.</p>";

  for (const card of document.querySelectorAll("[data-slug]")) {
    card.addEventListener("click", () => {
      app.selectedSlug = card.dataset.slug;
      app.latestPayment = null;
      app.latestResult = null;
      render();
    });
  }
}

function renderDetail() {
  const listing = selectedListing();
  if (!listing) {
    $("detail-pane").innerHTML = "<p class='empty'>No API selected.</p>";
    return;
  }
  const origin = window.location.origin;
  const curl = `curl -X POST ${origin}${listing.invokePath} -H "Content-Type: application/json" -d '${JSON.stringify({ input: listing.sampleInput, demo: true })}'`;
  const mcpCall = {
    jsonrpc: "2.0",
    id: "call-1",
    method: "tools/call",
    params: {
      name: listing.operationName,
      arguments: listing.sampleInput,
      demo: true
    }
  };
  $("detail-pane").innerHTML = `
    <div class="detail-header">
      <span class="api-icon large ${escapeHtml(listing.accent)}">${escapeHtml(listing.icon)}</span>
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
      <h3>Connect your AI</h3>
      <div class="code-tabs">
        <article>
          <span>Discovery</span>
          <code>${origin}/.well-known/cairn.json</code>
        </article>
        <article>
          <span>MCP Endpoint</span>
          <code>${origin}/mcp</code>
        </article>
        <article>
          <span>OpenAPI</span>
          <code>${origin}${listing.openapiPath}</code>
        </article>
        <article>
          <span>README</span>
          <code>${origin}${listing.readmePath}</code>
        </article>
      </div>
    </section>

    <section class="detail-section">
      <h3>Quick start</h3>
      <pre>${escapeHtml(curl)}</pre>
      <pre>${escapeHtml(pretty(mcpCall))}</pre>
    </section>

    <section class="detail-section">
      <h3>Pay per run</h3>
      <div class="price-line">
        <strong>${tokenLabel(listing.pricing.tokenCost)}</strong>
        <span>or ${money(listing.pricing.priceCents, listing.pricing.currency)} per ${escapeHtml(listing.pricing.billingUnit)}</span>
      </div>
      <div class="action-row">
        <button id="quote-button" type="button">Quote</button>
        <button id="checkout-button" type="button">Authorize</button>
        <button id="invoke-button" type="button">Invoke paid</button>
        <button id="token-invoke-button" type="button">Use tokens</button>
      </div>
    </section>

    <section class="detail-section">
      <h3>README for agents</h3>
      <pre>${escapeHtml(listing.readme)}</pre>
    </section>

    <section class="detail-section">
      <h3>Stripe setup</h3>
      <pre>${escapeHtml(pretty({
        mode: app.stripeConfig ? app.stripeConfig.mode : "loading",
        requiredEnv: app.stripeConfig ? app.stripeConfig.requiredEnv : [],
        optionalEnv: app.stripeConfig ? app.stripeConfig.optionalEnv : [],
        priceEnvForThisAPI: listing.pricing.stripePriceEnv,
        meterEventName: listing.pricing.stripeMeterEventName
      }))}</pre>
    </section>

    <section class="detail-section">
      <h3>Token wallet</h3>
      <pre>${escapeHtml(pretty({
        accountId: app.accountId,
        balance: app.wallet ? app.wallet.balance : 0,
        tokenCost: listing.pricing.tokenCost,
        latestTokenPurchase: app.latestTokenPurchase || { status: "none" }
      }))}</pre>
    </section>

    <section class="detail-section">
      <h3>Input Schema</h3>
      <pre>${escapeHtml(pretty(listing.inputSchema))}</pre>
    </section>

    <section class="detail-section">
      <h3>Latest Payment</h3>
      <pre>${escapeHtml(pretty(app.latestPayment || { status: "none" }))}</pre>
    </section>

    <section class="detail-section">
      <h3>Latest Invocation</h3>
      <pre>${escapeHtml(pretty(app.latestResult || { status: "none" }))}</pre>
    </section>
  `;
  $("quote-button").addEventListener("click", quoteSelected);
  $("checkout-button").addEventListener("click", checkoutSelected);
  $("invoke-button").addEventListener("click", invokeSelected);
  $("token-invoke-button").addEventListener("click", invokeSelectedWithTokens);
}

function renderPublishSnippet() {
  return null;
}

function render() {
  renderStats();
  renderWallet();
  renderFilters();
  renderListings();
  renderDetail();
}

function bind() {
  $("search-input").addEventListener("input", (event) => {
    app.query = event.target.value;
    renderListings();
  });
  $("clear-search").addEventListener("click", () => {
    app.query = "";
    $("search-input").value = "";
    renderListings();
  });
  $("contribute-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const result = await postJson("/api/workflows/recordings", {
      title: form.title,
      targetUrl: form.targetUrl,
      goal: form.goal,
      artifacts: []
    });
    $("contribute-status").textContent = result.ok
      ? "Workflow submitted. The API team can now turn it into a marketplace endpoint."
      : "Something went wrong. Please try again.";
    event.currentTarget.reset();
  });
  $("buy-tokens-button").addEventListener("click", buySelectedTokenPack);
}

bind();
fetchCatalog();
