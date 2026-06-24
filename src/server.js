const { loadEnv } = require("./cairn/env");
loadEnv();

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");
const { EventBus } = require("./cairn/eventBus");
const { accountExistsPersistent, ensureAccountPersistent, normalizeAccountId } = require("./cairn/accounts");
const {
  accountMatchesAuth,
  authenticateAgentRequest,
  issueAgentKeyPersistent
} = require("./cairn/agentAuth");
const {
  accountUsageSummary,
  recordWorkflowSubmission
} = require("./cairn/database");
const {
  createState,
  invokeSkill,
  recordSynthesizeVerify,
  repairLatest,
  reverifyLatest,
  seedDemoApis
} = require("./cairn/pipeline");
const {
  bootstrapApis,
  findOwnedApi,
  listApisForAccount,
  openApiDocument,
  publicApi,
  singleApiOpenApi
} = require("./cairn/apis");
const {
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

function explicitAccountFrom(body) {
  const value = body.accountId || (body.caller && body.caller.id);
  return value ? normalizeAccountId(value) : null;
}

function accountIdFrom(body) {
  return normalizeAccountId(body.accountId || (body.caller && body.caller.id) || "demo-user");
}

function authHelp(origin) {
  return {
    createAccount: `${origin}/api/accounts`,
    header: "Authorization: Bearer <agentKey>",
    sdk: "new CairnClient({ accountId, agentKey })"
  };
}

function authError(res, status, error, origin, details = {}) {
  json(res, status, {
    error,
    message: error === "agent_account_mismatch"
      ? "This agent key is not allowed to access the requested account."
      : "Create an account and send its agent key before calling protected Cairn APIs.",
    auth: authHelp(origin),
    ...details
  });
}

async function requireAgentAuth(req, res, state, accountId, origin) {
  const auth = await authenticateAgentRequest(req, state);
  if (!auth.ok) {
    authError(res, auth.status || 401, auth.error, origin);
    return null;
  }
  if (accountId && !accountMatchesAuth(auth, accountId)) {
    authError(res, 403, "agent_account_mismatch", origin, {
      requestedAccountId: normalizeAccountId(accountId),
      authenticatedAccountId: auth.accountId
    });
    return null;
  }
  return auth;
}

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
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
  return {
    runs: state.runs.slice(0, 10),
    operations: Object.values(state.operations),
    skills: Object.values(state.skills),
    apis: Object.values(state.apis),
    apiStorage: state.apiStorage,
    accounts: Object.values(state.accounts || {}),
    workflowSubmissions: Object.values(state.workflowSubmissions || {}),
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
  const typeByExt = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".html": "text/html"
  };
  const type = typeByExt[ext] || "application/octet-stream";
  const contentType = type.startsWith("text/") || type === "application/json"
    ? `${type}; charset=utf-8`
    : type;
  send(res, 200, fs.readFileSync(filePath), { "Content-Type": contentType });
  return true;
}

function demoApisEnabled(options) {
  if (Object.prototype.hasOwnProperty.call(options, "seedDemoApis")) {
    return options.seedDemoApis === true;
  }
  if (Object.prototype.hasOwnProperty.call(options, "seedDemoListings")) {
    return options.seedDemoListings === true;
  }
  return process.env.CAIRN_ENABLE_DEMO_APIS === "true";
}

function createApp(options = {}) {
  const state = createState();
  const bus = new EventBus();
  const tokenStore = new Set();
  let baseUrl = "http://localhost:3000";
  // Demo-only auto-login: { accountId, agentKey } exposed via discovery so the
  // dashboard can show the seeded demo APIs out of the box. Null outside demo mode.
  let demoAccount = null;
  const ready = bootstrapApis(state)
    .then(async (storage) => {
      if (storage.loadedCount === 0 && demoApisEnabled(options)) {
        const demoSeededCount = await seedDemoApis(state, "demo-user");
        state.apiStorage.demoSeeded = demoSeededCount > 0;
        state.apiStorage.demoSeededCount = demoSeededCount;
        state.apiStorage.apiCount = Object.values(state.apis).length;
        const issued = await issueAgentKeyPersistent(state, "demo-user", { label: "Demo agent key" });
        demoAccount = { accountId: "demo-user", agentKey: issued.agentKey };
      }
      bus.emit("apis.ready", {
        apis: Object.values(state.apis).length,
        storage: state.apiStorage
      });
    })
    .catch((error) => bus.emit("apis.bootstrap_failed", { error: { message: error.message } }));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;
    const origin = requestOrigin(req, baseUrl);
    try {
      await ready;
      if (req.method === "GET" && pathname === "/.well-known/cairn.json") {
        json(res, 200, {
          name: "Cairn",
          description: "Record a browser workflow once and reuse it forever as a durable, private API. Every API is scoped to its owning account and called with an agent key.",
          model: "private",
          apis: `${origin}/api/apis`,
          mcp: `${origin}/mcp`,
          openapi: `${origin}/openapi.json`,
          record: `${origin}/api/workflows/recordings`,
          package: {
            install: "npm install github:arav31/Cairn-AI"
          },
          auth: {
            type: "bearer",
            createAccount: `${origin}/api/accounts`,
            header: "Authorization: Bearer <agentKey>",
            note: "Every API is private to its owning account. List, inspect, and call them with that account's agent key.",
            protectedEndpoints: ["list APIs", "inspect API", "invoke API", "MCP tools/list", "MCP tools/call", "usage", "record workflow"]
          },
          ...(demoAccount ? { demo: demoAccount } : {}),
          storage: state.apiStorage
        });
        return;
      }
      if (req.method === "GET" && pathname === "/openapi.json") {
        const auth = await authenticateAgentRequest(req, state);
        const apis = auth.ok ? listApisForAccount(state, auth.accountId) : [];
        json(res, 200, openApiDocument(apis, state));
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
      if (req.method === "GET" && pathname === "/api/apis") {
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const apis = listApisForAccount(state, auth.accountId).map((api) => {
          const pub = publicApi(api, state.operations[api.operationId]);
          const vr = state.verificationRecords[api.operationId];
          pub.status = vr && vr.latest && vr.latest.passed === false ? "needs_repair" : "active";
          pub.lastVerifiedAt = (vr && vr.updatedAt) || api.createdAt;
          return pub;
        });
        json(res, 200, { apis, count: apis.length, storage: state.apiStorage });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/apis/")) {
        const slug = pathAfter(pathname, "/api/apis/");
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const api = findOwnedApi(state, slug, auth.accountId);
        if (!api) {
          json(res, 404, { error: "api_not_found", slug });
          return;
        }
        const operation = state.operations[api.operationId];
        json(res, 200, {
          api: publicApi(api, operation),
          operation,
          verification: state.verificationRecords[operation.id] || null
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/accounts") {
        const body = await parseBody(req);
        const accountId = accountIdFrom(body);
        const auth = await authenticateAgentRequest(req, state);
        if (!auth.ok && auth.error !== "agent_auth_required") {
          authError(res, auth.status || 401, auth.error, origin);
          return;
        }
        if (auth.ok && !accountMatchesAuth(auth, accountId)) {
          authError(res, 403, "agent_account_mismatch", origin, {
            requestedAccountId: accountId,
            authenticatedAccountId: auth.accountId
          });
          return;
        }
        const exists = await accountExistsPersistent(state, accountId);
        if (!auth.ok && exists) {
          authError(res, 409, "account_auth_required", origin, { accountId });
          return;
        }
        const account = await ensureAccountPersistent(state, accountId, {
          displayName: body.displayName || body.name,
          source: "api_accounts"
        });
        const issued = auth.ok
          ? { key: auth.key, agentKey: null }
          : await issueAgentKeyPersistent(state, accountId, {
              displayName: body.displayName || body.name,
              label: body.agentLabel || "Default agent key"
            });
        json(res, 201, {
          account,
          agentAuth: {
            type: "bearer",
            header: "Authorization",
            scheme: "Bearer",
            agentKey: issued.agentKey,
            key: issued.key,
            note: issued.agentKey
              ? "Store this key now. Cairn only returns the raw agent key once."
              : "Authenticated with an existing agent key."
          },
          next: {
            listApis: `${requestOrigin(req, baseUrl)}/api/apis`,
            recordWorkflow: `${requestOrigin(req, baseUrl)}/api/workflows/recordings`
          }
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/accounts/") && pathname.endsWith("/usage")) {
        const accountId = pathAfter(pathname, "/api/accounts/", "/usage");
        const normalizedAccountId = normalizeAccountId(accountId);
        const auth = await requireAgentAuth(req, res, state, normalizedAccountId, origin);
        if (!auth) return;
        const databaseUsage = await accountUsageSummary(normalizedAccountId);
        if (databaseUsage) {
          json(res, 200, { accountId: normalizedAccountId, usage: databaseUsage });
          return;
        }
        json(res, 200, {
          accountId: normalizedAccountId,
          usage: {
            apis: listApisForAccount(state, normalizedAccountId).map((api) => (
              publicApi(api, state.operations[api.operationId])
            )),
            invocationLogs: state.invocationLogs
              .filter((log) => log.callerId === normalizedAccountId)
              .slice(0, 50),
            workflowSubmissions: Object.values(state.workflowSubmissions || {})
              .filter((submission) => submission.accountId === normalizedAccountId)
              .slice(0, 50)
          }
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/") && pathname.endsWith("/openapi.json")) {
        const slug = pathAfter(pathname, "/api/tools/", "/openapi.json");
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const api = findOwnedApi(state, slug, auth.accountId);
        if (!api) {
          json(res, 404, { error: "api_not_found", slug });
          return;
        }
        json(res, 200, singleApiOpenApi(api, state.operations[api.operationId]));
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/") && pathname.endsWith("/readme.md")) {
        const slug = pathAfter(pathname, "/api/tools/", "/readme.md");
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const api = findOwnedApi(state, slug, auth.accountId);
        if (!api) {
          send(res, 404, `# API not found\n\nNo Cairn API named ${slug} belongs to your account.\n`, {
            "Content-Type": "text/markdown; charset=utf-8"
          });
          return;
        }
        send(res, 200, api.readme, {
          "Content-Type": "text/markdown; charset=utf-8"
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/") && pathname.endsWith("/verification")) {
        const slug = pathAfter(pathname, "/api/tools/", "/verification");
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const api = findOwnedApi(state, slug, auth.accountId);
        if (!api) {
          json(res, 404, { error: "api_not_found", slug });
          return;
        }
        const operation = state.operations[api.operationId];
        json(res, 200, {
          api: api.slug,
          operationId: operation.id,
          operationVersion: operation.version,
          verification: state.verificationRecords[operation.id] || null
        });
        return;
      }
      if (req.method === "POST" && pathname.startsWith("/api/tools/") && pathname.endsWith("/invoke")) {
        const slug = pathAfter(pathname, "/api/tools/", "/invoke");
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const api = findOwnedApi(state, slug, auth.accountId);
        if (!api) {
          json(res, 404, { error: "api_not_found", slug });
          return;
        }
        const body = await parseBody(req);
        const result = await invokeSkill({
          skillId: api.skillId,
          input: body.input || {},
          caller: { ...(body.caller || {}), id: auth.accountId, scopes: api.scopes },
          state,
          bus,
          baseUrl,
          apiSlug: api.slug
        });
        json(res, result.allowed === false ? 403 : 200, {
          apiId: api.slug,
          result
        });
        return;
      }
      if (req.method === "GET" && pathname.startsWith("/api/tools/")) {
        const slug = pathAfter(pathname, "/api/tools/");
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const api = findOwnedApi(state, slug, auth.accountId);
        if (!api) {
          json(res, 404, { error: "api_not_found", slug });
          return;
        }
        const operation = state.operations[api.operationId];
        json(res, 200, {
          api: publicApi(api, operation),
          verification: state.verificationRecords[operation.id] || null
        });
        return;
      }
      if (req.method === "POST" && pathname === "/api/workflows/recordings") {
        const body = await parseBody(req);
        const submissionId = id("recording_upload");
        const auth = await requireAgentAuth(req, res, state, explicitAccountFrom(body), origin);
        if (!auth) return;
        const accountId = auth.accountId;
        const submission = {
          id: submissionId,
          accountId,
          title: body.title || "Untitled workflow",
          targetUrl: body.targetUrl || null,
          goal: body.goal || "",
          artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
          status: "submitted"
        };
        state.workflowSubmissions[submissionId] = {
          ...submission,
          createdAt: new Date().toISOString()
        };
        await recordWorkflowSubmission(submission);
        json(res, 202, {
          id: submissionId,
          status: "accepted",
          message: "Recording upload accepted. The recorder/compiler team can wire this to artifact storage and synthesis.",
          received: {
            accountId,
            title: submission.title,
            targetUrl: submission.targetUrl,
            artifactCount: submission.artifacts.length
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
          const auth = await requireAgentAuth(req, res, state, null, origin);
          if (!auth) return;
          const tools = listApisForAccount(state, auth.accountId).map((api) => {
            const operation = state.operations[api.operationId];
            return {
              name: operation.name,
              title: api.title,
              description: api.tagline,
              inputSchema: operation.inputSchema,
              annotations: { apiId: api.slug }
            };
          });
          json(res, 200, { jsonrpc: "2.0", id: requestId, result: { tools } });
          return;
        }
        if (method === "tools/call") {
          const params = body.params || {};
          const auth = await requireAgentAuth(req, res, state, null, origin);
          if (!auth) return;
          const api = findOwnedApi(state, params.name || params.toolId, auth.accountId);
          if (!api) {
            json(res, 200, {
              jsonrpc: "2.0",
              id: requestId,
              error: { code: -32602, message: "Unknown Cairn API for this account." }
            });
            return;
          }
          const result = await invokeSkill({
            skillId: api.skillId,
            input: params.arguments || params.input || {},
            caller: { ...(params.caller || {}), id: auth.accountId, scopes: api.scopes },
            state,
            bus,
            baseUrl,
            apiSlug: api.slug
          });
          json(res, 200, {
            jsonrpc: "2.0",
            id: requestId,
            result: {
              isError: !result.allowed || Boolean(result.error),
              content: [{ type: "text", text: JSON.stringify({ output: result.output, error: result.error }) }]
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
        const auth = await authenticateAgentRequest(req, state);
        const owner = auth.ok ? auth.accountId : "demo-user";
        recordSynthesizeVerify({ target, input, state, bus, baseUrl, owner }).catch((error) => {
          bus.emit("run.failed", { target, error: { message: error.message } });
        });
        json(res, 202, { status: "started", target, owner });
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
        const auth = await authenticateAgentRequest(req, state);
        const owner = auth.ok ? auth.accountId : undefined;
        const result = await repairLatest({ target, state, bus, baseUrl, owner });
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
        const auth = await requireAgentAuth(req, res, state, null, origin);
        if (!auth) return;
        const skill = state.skills[body.skillId];
        if (!skill || skill.owner !== auth.accountId) {
          json(res, 404, { error: "skill_not_found", skillId: body.skillId });
          return;
        }
        const ownedApi = state.apis[skill.id];
        const result = await invokeSkill({
          skillId: body.skillId,
          input: body.input || {},
          caller: { ...(body.caller || {}), id: auth.accountId, scopes: skill.scopes },
          state,
          bus,
          baseUrl,
          apiSlug: ownedApi && ownedApi.slug
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

      if ((req.method === "GET" || req.method === "HEAD") && serveStatic(req, res, pathname)) {
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
  server.ready = ready;
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
