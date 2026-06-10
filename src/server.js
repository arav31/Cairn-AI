const { loadEnv } = require("./cairn/env");
loadEnv();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { EventBus } = require("./cairn/eventBus");
const {
  createState,
  invokeSkill,
  recordSynthesizeVerify,
  repairLatest,
  reverifyLatest
} = require("./cairn/pipeline");
const {
  bootstrapMarketplace,
  createCheckout,
  createQuote,
  findListing,
  hasPaymentAuthorization,
  integrationSnippet,
  openApiDocument,
  publicTool,
  recordUsage,
  stripeConfig
} = require("./cairn/marketplace");
const {
  createTokenCheckout,
  createTokenQuote,
  ensureWallet,
  previewTokenDebit,
  publicWallet,
  spendTokens,
  tokenConfig,
  walletLedger
} = require("./cairn/tokens");
const {
  customers,
  getCustomer,
  getCivicRecord,
  searchCustomers,
  searchCivicRecords
} = require("./data/seed");
const { htmlEscape, id } = require("./cairn/utils");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, body) {
  send(res, status, JSON.stringify(body, null, 2), {
    "Content-Type": "application/json; charset=utf-8"
  });
}

function html(res, body, status = 200) {
  send(res, status, body, {
    "Content-Type": "text/html; charset=utf-8"
  });
}

function redirect(res, location) {
  send(res, 303, "", { Location: location });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function parseBody(req) {
  const raw = await readBody(req);
  const type = req.headers["content-type"] || "";
  if (type.includes("application/json")) {
    return raw ? JSON.parse(raw) : {};
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw;
}

function setCookie(res, name, value) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`);
}

function requestOrigin(req, fallback) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return host ? `${proto}://${host}` : fallback;
}

function pathAfter(pathname, prefix, suffix) {
  if (!pathname.startsWith(prefix)) return null;
  if (suffix && !pathname.endsWith(suffix)) return null;
  const end = suffix ? pathname.length - suffix.length : pathname.length;
  const value = pathname.slice(prefix.length, end);
  return value ? decodeURIComponent(value.replace(/^\/+|\/+$/g, "")) : "";
}

function wantsTokenPayment(body) {
  return (
    body.paymentMethod === "tokens" ||
    body.useTokens === true ||
    Boolean(body.tokenAccountId) ||
    Boolean(body.payment && body.payment.method === "tokens")
  );
}

function tokenAccountFrom(body) {
  return (
    body.tokenAccountId ||
    body.accountId ||
    (body.payment && body.payment.tokenAccountId) ||
    (body.caller && body.caller.id) ||
    "demo-user"
  );
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="target-body">
${body}
</body>
</html>`;
}

function meridianApp() {
  return pageShell("Meridian CRM", `
<main class="target-app meridian-app">
  <header class="target-header">
    <div>
      <p class="eyebrow">Sandbox target A</p>
      <h1>Meridian CRM</h1>
    </div>
    <span class="target-badge">JSON REST</span>
  </header>
  <section class="target-panel" id="login-panel">
    <h2>Sign in</h2>
    <form id="login-form">
      <label>User <input name="user" value="demo"></label>
      <label>Password <input name="password" type="password" value="demo"></label>
      <button type="submit">Continue</button>
    </form>
  </section>
  <section class="target-panel hidden" id="otp-panel">
    <h2>Mock OTP</h2>
    <p class="hint">Simulated SMS code: 123456</p>
    <form id="otp-form">
      <label>Code <input name="code" value="123456"></label>
      <button type="submit">Verify</button>
    </form>
  </section>
  <section class="target-panel hidden" id="search-panel">
    <h2>Customer Search</h2>
    <form id="search-form">
      <label>Name <input id="meridian-search-name" name="name" value="Marjorie Tan"></label>
      <label>Status
        <select id="meridian-search-status" name="status">
          <option>Active</option>
          <option>Trial</option>
          <option>Inactive</option>
        </select>
      </label>
      <button type="submit" data-action="search">Search</button>
    </form>
    <div id="results" class="target-results"></div>
    <article id="customer-detail" class="target-detail"></article>
  </section>
</main>
<script>
const show = (id) => {
  for (const panel of document.querySelectorAll('.target-panel')) panel.classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
};
document.getElementById('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await fetch('/meridian/api/auth/login', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
  show('otp-panel');
});
document.getElementById('otp-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await fetch('/meridian/api/auth/otp', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
  show('search-panel');
});
document.getElementById('search-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.target));
  const query = new URLSearchParams(form);
  const response = await fetch('/meridian/api/customers?' + query.toString());
  const data = await response.json();
  document.getElementById('results').innerHTML = data.customers.map((customer) => '<button class="target-row" data-customer-id="' + customer.id + '">' + customer.full_name + '<span>' + customer.status + '</span></button>').join('');
});
document.getElementById('results').addEventListener('click', async (event) => {
  const row = event.target.closest('[data-customer-id]');
  if (!row) return;
  const response = await fetch('/meridian/api/customers/' + row.dataset.customerId);
  const data = await response.json();
  const customer = data.customer;
  document.getElementById('customer-detail').innerHTML = '<h3>' + customer.full_name + '</h3><dl><dt>ID</dt><dd>' + customer.id + '</dd><dt>Status</dt><dd>' + customer.status + '</dd><dt>Email</dt><dd>' + customer.email + '</dd><dt>Company</dt><dd>' + customer.company + '</dd></dl>';
});
</script>`);
}

function civicLoginPage() {
  return pageShell("Civic Records Portal", `
<main class="target-app civic-app">
  <header class="target-header">
    <div>
      <p class="eyebrow">Sandbox target B</p>
      <h1>Civic Records Portal</h1>
    </div>
    <span class="target-badge">Server HTML</span>
  </header>
  <section class="target-panel">
    <h2>Legacy Sign In</h2>
    <form method="post" action="/civic/login">
      <label>User <input name="user" value="demo"></label>
      <label>Password <input name="password" type="password" value="demo"></label>
      <button type="submit">Continue</button>
    </form>
  </section>
</main>`);
}

function civicOtpPage() {
  return pageShell("Civic Records Portal OTP", `
<main class="target-app civic-app">
  <header class="target-header">
    <div>
      <p class="eyebrow">Simulated second factor</p>
      <h1>Civic Records Portal</h1>
    </div>
  </header>
  <section class="target-panel">
    <h2>Mock OTP</h2>
    <p class="hint">Simulated SMS code: 123456</p>
    <form method="post" action="/civic/otp">
      <label>Code <input name="code" value="123456"></label>
      <button type="submit">Verify</button>
    </form>
  </section>
</main>`);
}

function tokenPair(tokenStore) {
  const csrf = id("csrf");
  const viewState = id("vs");
  tokenStore.add(csrf);
  tokenStore.add(viewState);
  return { csrf, viewState };
}

function consumeTokenPair(tokenStore, csrf, viewState) {
  const valid = tokenStore.has(csrf) && tokenStore.has(viewState);
  if (valid) {
    tokenStore.delete(csrf);
    tokenStore.delete(viewState);
  }
  return valid;
}

function civicSearchPage(tokenStore) {
  const { csrf, viewState } = tokenPair(tokenStore);
  return pageShell("Civic Records Search", `
<main class="target-app civic-app">
  <header class="target-header">
    <div>
      <p class="eyebrow">Legacy search</p>
      <h1>Civic Records Portal</h1>
    </div>
    <span class="target-badge">CSRF + ViewState</span>
  </header>
  <section class="target-panel">
    <h2>Record Search</h2>
    <form method="post" action="/civic/results">
      <input type="hidden" name="csrf" value="${csrf}">
      <input type="hidden" name="__VIEWSTATE" value="${viewState}">
      <label>Name <input id="civic-search-name" name="name" value="Marjorie Tan"></label>
      <button type="submit" data-action="search">Search</button>
    </form>
  </section>
</main>`);
}

function civicResultsPage(tokenStore, name, detailPath) {
  const { csrf, viewState } = tokenPair(tokenStore);
  const actionPath = detailPath || "/civic/detail";
  const rows = searchCivicRecords(name).map((record) => `
    <tr data-record-id="${htmlEscape(record.record_id)}">
      <td>${htmlEscape(record.full_name)}</td>
      <td>${htmlEscape(record.status)}</td>
      <td>
        <form method="post" action="${htmlEscape(actionPath)}">
          <input type="hidden" name="csrf" value="${csrf}">
          <input type="hidden" name="__VIEWSTATE" value="${viewState}">
          <input type="hidden" name="record_id" value="${htmlEscape(record.record_id)}">
          <button type="submit">Open</button>
        </form>
      </td>
    </tr>
  `).join("");
  return pageShell("Civic Records Results", `
<main class="target-app civic-app">
  <header class="target-header">
    <div>
      <p class="eyebrow">Search results</p>
      <h1>Civic Records Portal</h1>
    </div>
  </header>
  <section class="target-panel">
    <h2>Matching Records</h2>
    <input type="hidden" name="csrf" value="${csrf}">
    <input type="hidden" name="__VIEWSTATE" value="${viewState}">
    <table class="legacy-table">
      <thead><tr><th>Name</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${rows || "<tr><td colspan='3'>No records</td></tr>"}</tbody>
    </table>
  </section>
</main>`);
}

function civicDetailPage(record) {
  return pageShell("Civic Record Detail", `
<main class="target-app civic-app">
  <header class="target-header">
    <div>
      <p class="eyebrow">Detail record</p>
      <h1>Civic Records Portal</h1>
    </div>
  </header>
  <section class="target-panel" id="civic-detail">
    <h2>${htmlEscape(record.full_name)}</h2>
    <dl>
      <dt>record id</dt><dd>${htmlEscape(record.record_id)}</dd>
      <dt>full name</dt><dd>${htmlEscape(record.full_name)}</dd>
      <dt>status</dt><dd>${htmlEscape(record.status)}</dd>
      <dt>dob</dt><dd>${htmlEscape(record.dob)}</dd>
      <dt>case officer</dt><dd>${htmlEscape(record.case_officer)}</dd>
      <dt>last updated</dt><dd>${htmlEscape(record.last_updated)}</dd>
      <dt>notes</dt><dd>${htmlEscape(record.notes)}</dd>
    </dl>
  </section>
</main>`);
}

function publicState(state) {
  const listings = Object.values(state.marketplaceListings);
  return {
    runs: state.runs.slice(0, 10),
    operations: Object.values(state.operations),
    skills: Object.values(state.skills),
    marketplaceListings: listings,
    catalog: listings,
    tokenWallets: Object.values(state.tokenWallets).map(publicWallet),
    tokenLedger: state.tokenLedger.slice(0, 20),
    verificationRecords: Object.values(state.verificationRecords),
    repairJobs: Object.values(state.repairJobs),
    invocationLogs: state.invocationLogs.slice(0, 20),
    currentOperationId: state.currentOperationId,
    targetState: state.targetState
  };
}

function serveStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  let filePath = path.join(PUBLIC_DIR, requestedPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden");
    return true;
  }
  if ((!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) && !path.extname(requestedPath)) {
    const htmlPath = path.join(PUBLIC_DIR, `${requestedPath}.html`);
    if (!htmlPath.startsWith(PUBLIC_DIR)) {
      send(res, 403, "Forbidden");
      return true;
    }
    filePath = htmlPath;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const ext = path.extname(filePath);
  const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": `${type}; charset=utf-8` });
  return true;
}

function createApp() {
  const state = createState();
  const bus = new EventBus();
  const tokenStore = new Set();
  let baseUrl = "http://localhost:3000";
  bootstrapMarketplace(state)
    .then(() => bus.emit("marketplace.ready", { listings: Object.values(state.marketplaceListings).length }))
    .catch((error) => bus.emit("marketplace.bootstrap_failed", { error: { message: error.message } }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;
    try {
      if (req.method === "GET" && pathname === "/.well-known/cairn.json") {
        const origin = requestOrigin(req, baseUrl);
        const listings = Object.values(state.marketplaceListings);
        json(res, 200, {
          name: "Cairn",
          description: "Marketplace for workflow APIs that agents can call and pay for.",
          catalog: `${origin}/api/catalog`,
          pricing: `${origin}/pricing`,
          tools: `${origin}/api/tools`,
          mcp: `${origin}/mcp`,
          openapi: `${origin}/openapi.json`,
          payments: {
            provider: "stripe",
            sharedPaymentTokens: true,
            tokens: true,
            tokenWallet: `${origin}/api/tokens/wallet`,
            tokenCheckout: `${origin}/api/tokens/checkout`,
            mode: process.env.STRIPE_SECRET_KEY ? "live_configured" : "stub_until_keys_configured"
          },
          listings: listings.map((listing) => ({
            slug: listing.slug,
            title: listing.title,
            invoke: `${origin}${listing.invokePath}`,
            quote: `${origin}${listing.quotePath}`
          }))
        });
        return;
      }
      if (req.method === "GET" && pathname === "/openapi.json") {
        json(res, 200, openApiDocument(Object.values(state.marketplaceListings), state));
        return;
      }
      if (req.method === "GET" && pathname === "/api/events") {
        const unsubscribe = bus.subscribe(res);
        req.on("close", unsubscribe);
        return;
      }
      if (req.method === "GET" && pathname === "/api/state") {
        json(res, 200, publicState(state));
        return;
      }
      if (req.method === "GET" && pathname === "/api/catalog") {
        const listings = Object.values(state.marketplaceListings);
        json(res, 200, {
          listings,
          count: listings.length,
          categories: [...new Set(listings.map((listing) => listing.category))]
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/catalog/")) {
        const slug = pathAfter(pathname, "/api/catalog/");
        const listing = findListing(state, slug);
        if (!listing) {
          json(res, 404, { error: "listing_not_found", slug });
          return;
        }
        const operation = state.operations[listing.operationId];
        json(res, 200, {
          listing,
          operation,
          snippets: integrationSnippet(requestOrigin(req, baseUrl), listing)
        });
        return;
      }
      if (req.method === "GET" && pathname === "/api/tools") {
        const tools = Object.values(state.marketplaceListings).map((listing) => (
          publicTool(listing, state.operations[listing.operationId])
        ));
        json(res, 200, { tools, count: tools.length });
        return;
      }
      if (req.method === "GET" && pathname === "/api/payments/stripe-config") {
        json(res, 200, stripeConfig());
        return;
      }
      if (req.method === "GET" && pathname === "/api/tokens/config") {
        json(res, 200, tokenConfig());
        return;
      }
      if (req.method === "GET" && pathname === "/api/tokens/wallet") {
        const accountId = url.searchParams.get("accountId") || "demo-user";
        const wallet = ensureWallet(state, accountId);
        json(res, 200, {
          wallet: publicWallet(wallet),
          ledger: walletLedger(state, accountId)
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/tokens/quote") {
        const body = await parseBody(req);
        json(res, 200, {
          quote: createTokenQuote(body.packId || "starter", body.accountId || "demo-user")
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/tokens/checkout") {
        const body = await parseBody(req);
        const accountId = body.accountId || (body.buyer && body.buyer.accountId) || "demo-user";
        const quote = body.quote || createTokenQuote(body.packId || "starter", accountId);
        const checkout = await createTokenCheckout(state, quote, {
          ...(body.buyer || {}),
          accountId,
          returnBaseUrl: requestOrigin(req, baseUrl)
        });
        bus.emit("tokens.checkout_created", {
          accountId,
          checkoutId: checkout.id,
          mode: checkout.mode,
          tokens: checkout.tokens
        });
        json(res, 200, { checkout });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/") && pathname.endsWith("/openapi.json")) {
        const slug = pathAfter(pathname, "/api/tools/", "/openapi.json");
        const listing = findListing(state, slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", slug });
          return;
        }
        const operation = state.operations[listing.operationId];
        json(res, 200, operation.openapi);
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/") && pathname.endsWith("/readme.md")) {
        const slug = pathAfter(pathname, "/api/tools/", "/readme.md");
        const listing = findListing(state, slug);
        if (!listing) {
          send(res, 404, `# Tool not found\n\nNo Cairn API exists for ${slug}.\n`, {
            "Content-Type": "text/markdown; charset=utf-8"
          });
          return;
        }
        send(res, 200, listing.readme, {
          "Content-Type": "text/markdown; charset=utf-8"
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/")) {
        const slug = pathAfter(pathname, "/api/tools/");
        const listing = findListing(state, slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", slug });
          return;
        }
        json(res, 200, {
          tool: publicTool(listing, state.operations[listing.operationId]),
          listing,
          snippets: integrationSnippet(requestOrigin(req, baseUrl), listing)
        });
        return;
      }
      if (req.method === "POST" && pathname.startsWith("/api/tools/") && pathname.endsWith("/quote")) {
        const slug = pathAfter(pathname, "/api/tools/", "/quote");
        const listing = findListing(state, slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", slug });
          return;
        }
        const body = await parseBody(req);
        json(res, 200, { quote: createQuote(listing, body.input || {}) });
        return;
      }
      if (req.method === "POST" && pathname.startsWith("/api/tools/") && pathname.endsWith("/checkout")) {
        const slug = pathAfter(pathname, "/api/tools/", "/checkout");
        const listing = findListing(state, slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", slug });
          return;
        }
        const body = await parseBody(req);
        const quote = body.quote || createQuote(listing, body.input || {});
        const checkout = await createCheckout(listing, quote, body.buyer || {});
        bus.emit("payment.checkout_created", { toolId: listing.slug, checkoutId: checkout.id, mode: checkout.mode });
        json(res, 200, { checkout });
        return;
      }
      if (req.method === "POST" && pathname.startsWith("/api/tools/") && pathname.endsWith("/invoke")) {
        const slug = pathAfter(pathname, "/api/tools/", "/invoke");
        const listing = findListing(state, slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", slug });
          return;
        }
        const body = await parseBody(req);
        const tokenPayment = wantsTokenPayment(body);
        const tokenAccountId = tokenAccountFrom(body);
        const tokenPreview = tokenPayment ? previewTokenDebit(state, tokenAccountId, listing) : null;
        if (tokenPayment && !tokenPreview.ok) {
          json(res, 402, {
            error: "insufficient_tokens",
            message: `This API costs ${tokenPreview.tokenCost} tokens. Buy more tokens or use direct Stripe payment.`,
            tokenCost: tokenPreview.tokenCost,
            wallet: tokenPreview.wallet,
            shortfall: tokenPreview.shortfall,
            tokenPacks: tokenConfig().packs,
            checkout: `${requestOrigin(req, baseUrl)}/api/tokens/checkout`
          });
          return;
        }
        if (!tokenPayment && !hasPaymentAuthorization(listing, body)) {
          const quote = createQuote(listing, body.input || {});
          json(res, 402, {
            error: "payment_required",
            message: "Authorize payment with Stripe Checkout, a Shared Payment Token, or Cairn tokens before invoking this paid tool.",
            quote,
            tokenCost: listing.pricing.tokenCost,
            tokenWallet: `${requestOrigin(req, baseUrl)}/api/tokens/wallet`,
            checkout: `${requestOrigin(req, baseUrl)}/api/tools/${listing.slug}/checkout`
          });
          return;
        }
        const result = await invokeSkill({
          skillId: listing.skillId,
          input: body.input || {},
          caller: body.caller || { id: "marketplace-agent", scopes: listing.scopes },
          state,
          bus,
          baseUrl
        });
        const tokenDebit = tokenPayment && result.allowed === true && result.output
          ? spendTokens(state, tokenAccountId, listing, {
              toolId: listing.slug,
              invocationId: result.log && result.log.id
            })
          : null;
        const usage = !tokenPayment && result.allowed === true && result.output
          ? await recordUsage(listing, {
              stripeCustomerId: body.stripeCustomerId || (body.payment && body.payment.stripeCustomerId),
              identifier: result.log && result.log.id,
              value: 1
            })
          : null;
        json(res, result.allowed === false ? 403 : 200, {
          toolId: listing.slug,
          metered: listing.pricing.enabled,
          paymentMode: tokenPayment ? "tokens" : "direct",
          tokenDebit,
          usage,
          result
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/payments/quote") {
        const body = await parseBody(req);
        const listing = findListing(state, body.toolId || body.slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", toolId: body.toolId || body.slug });
          return;
        }
        json(res, 200, { quote: createQuote(listing, body.input || {}) });
        return;
      }
      if (req.method === "POST" && pathname === "/api/payments/checkout") {
        const body = await parseBody(req);
        const listing = findListing(state, body.toolId || body.slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", toolId: body.toolId || body.slug });
          return;
        }
        const quote = body.quote || createQuote(listing, body.input || {});
        json(res, 200, { checkout: await createCheckout(listing, quote, body.buyer || {}) });
        return;
      }
      if (req.method === "POST" && pathname === "/api/payments/usage") {
        const body = await parseBody(req);
        const listing = findListing(state, body.toolId || body.slug);
        if (!listing) {
          json(res, 404, { error: "tool_not_found", toolId: body.toolId || body.slug });
          return;
        }
        json(res, 200, {
          usage: await recordUsage(listing, {
            stripeCustomerId: body.stripeCustomerId,
            customerId: body.customerId,
            identifier: body.identifier,
            value: body.value || 1
          })
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/stripe/webhook") {
        const body = await parseBody(req);
        bus.emit("payment.webhook_received", {
          provider: "stripe",
          type: body.type || "unknown",
          livemode: Boolean(body.livemode)
        });
        json(res, 200, { received: true, mode: "stub_until_signature_verification_is_configured" });
        return;
      }
      if (req.method === "POST" && pathname === "/api/workflows/recordings") {
        const body = await parseBody(req);
        json(res, 202, {
          id: id("recording_upload"),
          status: "accepted",
          message: "Recording upload accepted. The recorder/compiler team can wire this to artifact storage and synthesis.",
          received: {
            title: body.title || null,
            targetUrl: body.targetUrl || null,
            artifactCount: Array.isArray(body.artifacts) ? body.artifacts.length : 0
          }
        });
        return;
      }
      if (req.method === "POST" && pathname === "/mcp") {
        const body = await parseBody(req);
        const method = body.method;
        const requestId = body.id || null;
        if (method === "initialize") {
          json(res, 200, {
            jsonrpc: "2.0",
            id: requestId,
            result: {
              protocolVersion: "2025-06-18",
              serverInfo: { name: "cairn", version: "0.2.0" },
              capabilities: { tools: {} }
            }
          });
          return;
        }
        if (method === "tools/list") {
          const tools = Object.values(state.marketplaceListings).map((listing) => {
            const operation = state.operations[listing.operationId];
            return {
              name: operation.name,
              title: listing.title,
              description: listing.tagline,
              inputSchema: operation.inputSchema,
              annotations: {
                toolId: listing.slug,
                paid: listing.pricing.enabled,
                priceCents: listing.pricing.priceCents,
                currency: listing.pricing.currency,
                tokenCost: listing.pricing.tokenCost
              }
            };
          });
          json(res, 200, { jsonrpc: "2.0", id: requestId, result: { tools } });
          return;
        }
        if (method === "tools/call") {
          const params = body.params || {};
          const listing = findListing(state, params.name || params.toolId);
          if (!listing) {
            json(res, 200, {
              jsonrpc: "2.0",
              id: requestId,
              error: { code: -32602, message: "Unknown Cairn tool." }
            });
            return;
          }
          const callBody = {
            input: params.arguments || params.input || {},
            payment: params.payment,
            paymentToken: params.paymentToken,
            sharedPaymentToken: params.sharedPaymentToken,
            paymentMethod: params.paymentMethod,
            tokenAccountId: params.tokenAccountId,
            useTokens: params.useTokens,
            demo: params.demo
          };
          const tokenPayment = wantsTokenPayment(callBody);
          const tokenAccountId = tokenAccountFrom(callBody);
          const tokenPreview = tokenPayment ? previewTokenDebit(state, tokenAccountId, listing) : null;
          if (tokenPayment && !tokenPreview.ok) {
            json(res, 200, {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                isError: true,
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    error: "insufficient_tokens",
                    tokenCost: tokenPreview.tokenCost,
                    wallet: tokenPreview.wallet,
                    tokenPacks: tokenConfig().packs
                  })
                }]
              }
            });
            return;
          }
          if (!tokenPayment && !hasPaymentAuthorization(listing, callBody)) {
            json(res, 200, {
              jsonrpc: "2.0",
              id: requestId,
              result: {
                isError: true,
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    error: "payment_required",
                    quote: createQuote(listing, callBody.input)
                  })
                }]
              }
            });
            return;
          }
          const result = await invokeSkill({
            skillId: listing.skillId,
            input: callBody.input,
            caller: { id: "mcp-agent", scopes: listing.scopes },
            state,
            bus,
            baseUrl
          });
          const tokenDebit = tokenPayment && result.allowed === true && result.output
            ? spendTokens(state, tokenAccountId, listing, {
                toolId: listing.slug,
                invocationId: result.log && result.log.id
              })
            : null;
          const usage = !tokenPayment && result.allowed === true && result.output
            ? await recordUsage(listing, {
                stripeCustomerId: params.stripeCustomerId || (params.payment && params.payment.stripeCustomerId),
                identifier: result.log && result.log.id,
                value: 1
              })
            : null;
          json(res, 200, {
            jsonrpc: "2.0",
            id: requestId,
            result: {
              isError: !result.allowed || Boolean(result.error),
              content: [{ type: "text", text: JSON.stringify({ output: result.output, error: result.error, tokenDebit, usage }) }]
            }
          });
          return;
        }
        json(res, 200, {
          jsonrpc: "2.0",
          id: requestId,
          error: { code: -32601, message: "Method not found." }
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo/record") {
        const body = await parseBody(req);
        const target = body.target === "civic" ? "civic" : "meridian";
        const input = body.input || {};
        recordSynthesizeVerify({ target, input, state, bus, baseUrl }).catch((error) => {
          bus.emit("run.failed", { target, error: { message: error.message } });
        });
        json(res, 202, { status: "started", target });
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo/reverify") {
        const body = await parseBody(req);
        const target = body.target === "civic" ? "civic" : "meridian";
        const result = await reverifyLatest({ target, state, bus, baseUrl });
        json(res, result.error ? 404 : 200, result);
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo/repair") {
        const body = await parseBody(req);
        const target = body.target === "civic" ? "civic" : "meridian";
        const result = await repairLatest({ target, state, bus, baseUrl });
        json(res, result.error ? 404 : 200, result);
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo/drift-civic") {
        state.targetState.civicDetailPath = "/civic/record";
        bus.emit("target.drift_induced", {
          target: "civic",
          change: "detail POST route moved from /civic/detail to /civic/record"
        });
        json(res, 200, { status: "drift_enabled", civicDetailPath: state.targetState.civicDetailPath });
        return;
      }
      if (req.method === "POST" && pathname === "/api/demo/reset-drift") {
        state.targetState.civicDetailPath = "/civic/detail";
        bus.emit("target.drift_reset", { target: "civic" });
        json(res, 200, { status: "reset", civicDetailPath: state.targetState.civicDetailPath });
        return;
      }
      if (req.method === "POST" && pathname === "/api/invoke") {
        const body = await parseBody(req);
        const result = await invokeSkill({
          skillId: body.skillId,
          input: body.input || {},
          caller: body.caller || { id: "demo-agent", scopes: ["crm:customer:read", "civic:record:read"] },
          state,
          bus,
          baseUrl
        });
        json(res, result.allowed === false ? 403 : 200, result);
        return;
      }

      if (req.method === "GET" && pathname === "/meridian") {
        html(res, meridianApp());
        return;
      }
      if (req.method === "POST" && pathname === "/meridian/api/auth/login") {
        setCookie(res, "meridian_session", id("sess"));
        json(res, 200, { ok: true, next: "otp" });
        return;
      }
      if (req.method === "POST" && pathname === "/meridian/api/auth/otp") {
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && pathname === "/meridian/api/customers") {
        const name = url.searchParams.get("name") || "";
        const status = url.searchParams.get("status") || "";
        json(res, 200, { customers: searchCustomers(name, status) });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/meridian/api/customers/")) {
        const customer = getCustomer(decodeURIComponent(pathname.split("/").pop()));
        if (!customer) {
          json(res, 404, { error: "not_found" });
          return;
        }
        json(res, 200, { customer });
        return;
      }

      if (req.method === "GET" && pathname === "/civic") {
        redirect(res, "/civic/login");
        return;
      }
      if (req.method === "GET" && pathname === "/civic/login") {
        html(res, civicLoginPage());
        return;
      }
      if (req.method === "POST" && pathname === "/civic/login") {
        setCookie(res, "civic_session", id("sess"));
        redirect(res, "/civic/otp");
        return;
      }
      if (req.method === "GET" && pathname === "/civic/otp") {
        html(res, civicOtpPage());
        return;
      }
      if (req.method === "POST" && pathname === "/civic/otp") {
        redirect(res, "/civic/search");
        return;
      }
      if (req.method === "GET" && pathname === "/civic/search") {
        html(res, civicSearchPage(tokenStore));
        return;
      }
      if (req.method === "POST" && pathname === "/civic/results") {
        const body = await parseBody(req);
        if (!consumeTokenPair(tokenStore, body.csrf, body.__VIEWSTATE)) {
          html(res, pageShell("Stale token", "<main class='target-app'><section class='target-panel'><h1>Stale token</h1><p>The submitted CSRF or ViewState value was not fresh.</p></section></main>"), 422);
          return;
        }
        html(res, civicResultsPage(tokenStore, body.name || "", state.targetState.civicDetailPath));
        return;
      }
      if (req.method === "POST" && (pathname === "/civic/detail" || pathname === "/civic/record")) {
        if (pathname !== state.targetState.civicDetailPath) {
          html(res, pageShell("Route changed", "<main class='target-app'><section class='target-panel'><h1>Route changed</h1><p>This endpoint has drifted.</p></section></main>"), pathname === "/civic/detail" ? 410 : 404);
          return;
        }
        const body = await parseBody(req);
        if (!consumeTokenPair(tokenStore, body.csrf, body.__VIEWSTATE)) {
          html(res, pageShell("Stale token", "<main class='target-app'><section class='target-panel'><h1>Stale token</h1><p>The submitted CSRF or ViewState value was not fresh.</p></section></main>"), 422);
          return;
        }
        const record = getCivicRecord(body.record_id);
        if (!record) {
          html(res, pageShell("Not found", "<main class='target-app'><section class='target-panel'><h1>Record not found</h1></section></main>"), 404);
          return;
        }
        html(res, civicDetailPage(record));
        return;
      }

      if (req.method === "GET" && serveStatic(req, res, pathname)) {
        return;
      }
      json(res, 404, { error: "not_found", pathname });
    } catch (error) {
      json(res, 500, { error: "server_error", message: error.message });
    }
  });

  server.setBaseUrl = (value) => {
    baseUrl = value;
  };
  server.state = state;
  server.bus = bus;
  return server;
}

let serverlessApp;

function getServerlessBaseUrl(req) {
  const configured = process.env.CAIRN_PUBLIC_URL;
  if (configured) return configured;
  return requestOrigin(req, "https://localhost");
}

function serverlessHandler(req, res) {
  if (!serverlessApp) {
    serverlessApp = createApp();
  }
  serverlessApp.setBaseUrl(getServerlessBaseUrl(req));
  return new Promise((resolve, reject) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    res.on("error", reject);
    serverlessApp.emit("request", req, res);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  const server = createApp();
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  server.setBaseUrl(`http://${displayHost}:${port}`);
  server.listen(port, host, () => {
    console.log(`Cairn demo running at http://${displayHost}:${port}`);
  });
}

module.exports = serverlessHandler;
module.exports.createApp = createApp;
