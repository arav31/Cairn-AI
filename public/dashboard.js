/* Dashboard: "My APIs" home. Lists the logged-in account's private APIs. */

const dash = {
  apis: [],
  demoPending: false
};

const $ = (id) => document.getElementById(id);

function setStatus(message, tone = "muted") {
  const node = $("dashboard-status");
  node.textContent = message || "";
  node.dataset.tone = tone;
}

function targetLabel(api) {
  return api.target ? `${api.target} workflow` : "Recorded workflow";
}

function statusBadge(status) {
  if (status === "needs_repair") {
    return '<span class="status-badge is-needs-repair">Needs repair</span>';
  }
  return '<span class="status-badge is-active">Active</span>';
}

function apiCard(api) {
  const slug = encodeURIComponent(api.slug);
  const calls = Number(api.callCount || 0);
  return `
    <a class="listing-card" href="/api-detail.html?slug=${slug}">
      <div class="card-top">
        <span class="api-icon green" aria-hidden="true">API</span>
        ${statusBadge(api.status)}
      </div>
      <div class="listing-body">
        <h2>${escapeHtml(api.title || api.name)}</h2>
        <p>${escapeHtml(api.description || "Recorded workflow API.")}</p>
        <div class="tag-row">
          <span>${escapeHtml(targetLabel(api))}</span>
        </div>
      </div>
      <dl class="card-meta">
        <div><dt>Last verified</dt><dd>${escapeHtml(relativeTime(api.lastVerifiedAt))}</dd></div>
        <div><dt>Calls</dt><dd>${calls.toLocaleString()}</dd></div>
      </dl>
    </a>
  `;
}

function pendingCard() {
  return `
    <article class="listing-card is-pending" aria-live="polite">
      <div class="card-top">
        <span class="api-icon green" aria-hidden="true">…</span>
        <span class="status-badge is-needs-repair">Verifying…</span>
      </div>
      <div class="listing-body">
        <h2>Recording your workflow</h2>
        <p>Cairn is running record → synthesize → verify. Your new API will appear here once it passes.</p>
      </div>
      <dl class="card-meta">
        <div><dt>Status</dt><dd>In progress</dd></div>
        <div><dt>Calls</dt><dd>—</dd></div>
      </dl>
    </article>
  `;
}

function emptyState() {
  return `
    <section class="empty-panel">
      <h2>No APIs yet</h2>
      <p>Record a workflow once and Cairn turns it into a durable, private API you and your agents can call forever.</p>
      <div class="empty-actions">
        <a href="/record">Record your first workflow</a>
        <button id="demo-record-button" class="ghost-button" type="button">Try a sandbox demo</button>
      </div>
    </section>
  `;
}

function render() {
  const grid = $("api-grid");
  const cards = dash.apis.map(apiCard).join("");

  if (!dash.apis.length && !dash.demoPending) {
    grid.classList.remove("listing-grid");
    grid.innerHTML = emptyState();
    const demoButton = $("demo-record-button");
    if (demoButton) demoButton.addEventListener("click", startSandboxDemo);
    return;
  }

  grid.classList.add("listing-grid");
  grid.innerHTML = (dash.demoPending ? pendingCard() : "") + cards;
}

async function loadApis() {
  const result = await cairnFetch("/api/apis");
  if (result.status === 401) {
    setStatus("This browser isn't linked to an account yet. Open Settings to enter your agent key.", "warn");
    return false;
  }
  if (!result.ok) {
    setStatus("Could not load your APIs. Please try again.", "warn");
    return false;
  }
  dash.apis = (result.payload.apis || []).slice().sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
  );
  return true;
}

// In demo mode the server exposes a shared demo account via the discovery doc so
// the seeded APIs show out of the box. Returns { accountId, agentKey } or null.
async function fetchDemoAccount() {
  try {
    const response = await fetch("/.well-known/cairn.json");
    if (!response.ok) return null;
    const body = await response.json();
    return body && body.demo && body.demo.agentKey ? body.demo : null;
  } catch (error) {
    return null;
  }
}

async function ensureSession() {
  const session = getSession();
  if (session.agentKey) return true;

  // Demo mode: auto-log-in to the shared demo account so seeded APIs appear.
  const demo = await fetchDemoAccount();
  if (demo) {
    saveSession(demo);
    return true;
  }

  // Otherwise create / load the default account.
  const accountId = session.accountId || "demo-user";
  const result = await cairnFetch("/api/accounts", {
    method: "POST",
    body: { accountId },
    auth: false
  });
  if (result.ok) {
    applyAgentAuth(result.payload);
    return true;
  }
  if (result.status === 409) {
    setStatus("That account already exists. Open Settings to enter your saved agent key.", "warn");
    return false;
  }
  setStatus("Could not start a session. Open Settings to manage your account.", "warn");
  return false;
}

function renderAccountChip() {
  const session = getSession();
  $("account-chip-id").textContent = session.accountId || "not linked";
}

async function startSandboxDemo() {
  dash.demoPending = true;
  setStatus("Recording a sandbox demo (Meridian CRM). This takes a second or two…", "muted");
  render();

  const result = await cairnFetch("/api/demo/record", {
    method: "POST",
    body: { target: "meridian" }
  });
  if (!result.ok) {
    dash.demoPending = false;
    setStatus("Could not start the sandbox demo. Make sure demo APIs are enabled.", "warn");
    render();
    return;
  }

  const before = dash.apis.length;
  let tries = 0;
  const poll = async () => {
    tries += 1;
    await loadApis();
    if (dash.apis.length > before) {
      dash.demoPending = false;
      setStatus("Sandbox demo recorded. Your new API is active.", "ok");
      render();
      renderAccountChip();
      return;
    }
    if (tries >= 15) {
      dash.demoPending = false;
      setStatus("Still verifying — refresh in a moment to see your sandbox API.", "muted");
      render();
      return;
    }
    setTimeout(poll, 1200);
  };
  setTimeout(poll, 1200);
}

async function init() {
  renderAccountChip();
  let ready = await ensureSession();
  renderAccountChip();
  if (!ready) {
    render();
    return;
  }
  let ok = await loadApis();
  // Stale/invalid saved key — drop it and start a fresh session once.
  if (!ok && getSession().agentKey) {
    clearSession();
    ready = await ensureSession();
    renderAccountChip();
    if (ready) ok = await loadApis();
  }
  if (ok) setStatus("");
  render();
}

init();
