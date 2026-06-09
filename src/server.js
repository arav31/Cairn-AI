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
  return {
    runs: state.runs.slice(0, 10),
    operations: Object.values(state.operations),
    skills: Object.values(state.skills),
    marketplaceListings: Object.values(state.marketplaceListings),
    verificationRecords: Object.values(state.verificationRecords),
    repairJobs: Object.values(state.repairJobs),
    invocationLogs: state.invocationLogs.slice(0, 20),
    currentOperationId: state.currentOperationId,
    targetState: state.targetState
  };
}

function serveStatic(req, res, pathname) {
  const filePath = path.join(PUBLIC_DIR, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Forbidden");
    return true;
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

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl);
    const pathname = url.pathname;
    try {
      if (req.method === "GET" && pathname === "/api/events") {
        const unsubscribe = bus.subscribe(res);
        req.on("close", unsubscribe);
        return;
      }
      if (req.method === "GET" && pathname === "/api/state") {
        json(res, 200, publicState(state));
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

module.exports = { createApp };
