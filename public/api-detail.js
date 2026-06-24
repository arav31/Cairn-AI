/* Per-API detail page. Reads ?slug= from the URL (slugs contain a slash). */

const detail = {
  slug: null,
  api: null,
  operation: null,
  verification: null
};

const $ = (id) => document.getElementById(id);

function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("slug");
}

function statusBadge(status) {
  if (status === "needs_repair") {
    return '<span class="status-badge is-needs-repair">Needs repair</span>';
  }
  return '<span class="status-badge is-active">Active</span>';
}

function copyButton(value) {
  return `<button class="ghost-button copy-button" type="button" data-copy="${escapeHtml(value)}">Copy</button>`;
}

function renderMessage(title, body, action = "") {
  $("detail-root").innerHTML = `
    <section class="empty-panel">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(body)}</p>
      ${action}
    </section>
  `;
}

function describe(api, operation) {
  return api.description || (operation && operation.description) || "Recorded workflow API.";
}

function render() {
  const { api, operation, verification } = detail;
  const origin = window.location.origin;
  const invokePath = api.endpoints.invoke;
  const invokeUrl = `${origin}${invokePath}`;
  const openapiUrl = `${origin}${api.endpoints.openapi}`;
  const readmeUrl = `${origin}${api.endpoints.readme}`;
  const sampleInput = api.sampleInput || {};
  const sampleInline = JSON.stringify(sampleInput);

  const curl = `curl -X POST ${invokeUrl} \\
  -H "Authorization: Bearer $CAIRN_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ input: sampleInput })}'`;

  const session = getSession();
  const accountId = session.accountId || "demo-user";
  const sdk = `const { CairnClient } = require("cairn");
const cairn = new CairnClient({
  baseUrl: "${origin}",
  accountId: "${accountId}",
  agentKey: process.env.CAIRN_AGENT_KEY
});

const result = await cairn.invoke("${api.slug}", {
  input: ${JSON.stringify(sampleInput)}
});`;

  const cli = `npx cairn call --api "${api.slug}" --input '${sampleInline}'`;

  const latest = verification && verification.latest ? verification.latest : null;

  $("detail-root").innerHTML = `
    <header class="detail-pane detail-head">
      <div class="detail-header">
        <span class="api-icon large green" aria-hidden="true">API</span>
        <div>
          <p class="eyebrow">${escapeHtml(api.target ? api.target + " workflow" : "Recorded workflow")}</p>
          <h1>${escapeHtml(api.title || api.name)}</h1>
          <div class="head-badges">${statusBadge(api.status)}</div>
        </div>
      </div>
    </header>

    <section class="detail-pane">
      <div class="detail-section">
        <h3>What it does</h3>
        <p class="muted-copy">${escapeHtml(describe(api, operation))}</p>
      </div>

      <div class="detail-section">
        <h3>Your durable endpoints</h3>
        <p class="muted-copy">Call this from any agent with your agent key. The contract stays stable even when the underlying site changes.</p>
        <div class="endpoint-list compact endpoint-rows">
          <span>Invoke</span>
          <div class="endpoint-value"><code>POST ${escapeHtml(invokeUrl)}</code>${copyButton(invokeUrl)}</div>
          <span>OpenAPI</span>
          <div class="endpoint-value"><code><a href="${escapeHtml(api.endpoints.openapi)}">${escapeHtml(openapiUrl)}</a></code>${copyButton(openapiUrl)}</div>
          <span>README</span>
          <div class="endpoint-value"><code><a href="${escapeHtml(api.endpoints.readme)}">${escapeHtml(readmeUrl)}</a></code>${copyButton(readmeUrl)}</div>
          <span>MCP tool</span>
          <div class="endpoint-value"><code>${escapeHtml(api.mcpToolName)}</code>${copyButton(api.mcpToolName)}</div>
        </div>
      </div>

      <div class="detail-section">
        <h3>Call it from code</h3>
        <div class="code-block">
          <div class="code-block-head"><span>curl</span>${copyButton(curl)}</div>
          <pre>${escapeHtml(curl)}</pre>
        </div>
        <div class="code-block">
          <div class="code-block-head"><span>SDK</span>${copyButton(sdk)}</div>
          <pre>${escapeHtml(sdk)}</pre>
        </div>
        <div class="code-block">
          <div class="code-block-head"><span>CLI</span>${copyButton(cli)}</div>
          <pre>${escapeHtml(cli)}</pre>
        </div>
      </div>

      <details class="detail-section">
        <summary>Input schema</summary>
        <pre>${escapeHtml(pretty(api.inputSchema || (operation && operation.inputSchema) || {}))}</pre>
      </details>
    </section>

    <section class="detail-pane test-panel">
      <div class="detail-section">
        <h3>Test it</h3>
        <p class="muted-copy">Run the API against your account with sample input and see the live response.</p>
        <textarea id="test-input" spellcheck="false" aria-label="Test input JSON">${escapeHtml(pretty(sampleInput))}</textarea>
        <button id="test-button" type="button">Test it</button>
        <pre id="test-result">Run the API to see the response here.</pre>
      </div>
    </section>

    <section class="detail-pane">
      <div class="detail-section">
        <h3>Health &amp; repairs</h3>
        <div class="metric-grid">
          <article><strong>${api.status === "needs_repair" ? "Needs repair" : "Active"}</strong><span>Status</span></article>
          <article><strong>${escapeHtml(relativeTime(api.lastVerifiedAt))}</strong><span>Last verified</span></article>
          <article><strong>${Number(api.callCount || 0).toLocaleString()}</strong><span>Total calls</span></article>
          <article><strong>${escapeHtml(relativeTime(api.createdAt))}</strong><span>Created</span></article>
        </div>
        <ol class="repair-history" id="repair-history">
          ${latest ? `
            <li>
              <strong>${latest.passed ? "Passed" : "Failed"}</strong>
              <span>${escapeHtml(latest.status || (latest.passed ? "verified" : "verification failed"))}${latest.error ? " — " + escapeHtml(latest.error) : ""}</span>
              <small>${escapeHtml(verification.updatedAt ? relativeTime(verification.updatedAt) : "")}${latest.durationMs ? " · " + latest.durationMs + "ms" : ""}</small>
            </li>
          ` : `<li><span>No verification runs recorded yet.</span></li>`}
        </ol>
        <button id="reverify-button" class="ghost-button" type="button">Re-verify</button>
        <p id="reverify-status" class="form-status" role="status"></p>
      </div>
    </section>
  `;

  bindCopyButtons($("detail-root"));
  $("test-button").addEventListener("click", runTest);
  $("reverify-button").addEventListener("click", reverify);
}

async function runTest() {
  const button = $("test-button");
  const resultBox = $("test-result");
  let input;
  try {
    input = JSON.parse($("test-input").value || "{}");
  } catch (error) {
    resultBox.textContent = `Invalid JSON: ${error.message}`;
    return;
  }
  button.disabled = true;
  resultBox.textContent = "Running…";
  const result = await cairnFetch(`/api/tools/${encodeURIComponent(detail.slug)}/invoke`, {
    method: "POST",
    body: { input }
  });
  button.disabled = false;

  if (result.status === 401) {
    resultBox.textContent = "Unauthorized. Open Settings to enter your agent key.";
    return;
  }
  const payload = result.payload || {};
  const runResult = payload.result || {};
  if (runResult.allowed === false) {
    resultBox.textContent = pretty({ allowed: false, decision: runResult.decision, error: runResult.error });
    return;
  }
  if (runResult.error) {
    resultBox.textContent = pretty({ error: runResult.error });
    return;
  }
  resultBox.textContent = pretty(runResult.output ?? runResult);
}

async function reverify() {
  const button = $("reverify-button");
  const status = $("reverify-status");
  if (!detail.api.target) {
    status.textContent = "This API has no sandbox target to re-verify.";
    status.dataset.tone = "warn";
    return;
  }
  button.disabled = true;
  status.textContent = "Re-verifying…";
  status.dataset.tone = "muted";
  const result = await cairnFetch("/api/demo/reverify", {
    method: "POST",
    body: { target: detail.api.target }
  });
  button.disabled = false;
  if (!result.ok) {
    status.textContent = "Could not re-verify this API.";
    status.dataset.tone = "warn";
    return;
  }
  status.textContent = "Re-verification complete. Refreshing…";
  status.dataset.tone = "ok";
  await load();
}

async function load() {
  const result = await cairnFetch(`/api/apis/${encodeURIComponent(detail.slug)}`);
  if (result.status === 401) {
    renderMessage(
      "Not linked to an account",
      "This browser isn't linked to an account yet. Open Settings to enter your agent key.",
      '<div class="empty-actions"><a href="/settings">Open Settings</a></div>'
    );
    return;
  }
  if (result.status === 404) {
    renderMessage(
      "API not found",
      "No API with this slug belongs to your account.",
      '<div class="empty-actions"><a href="/dashboard">Back to My APIs</a></div>'
    );
    return;
  }
  if (!result.ok) {
    renderMessage("Could not load this API", "Please try again in a moment.");
    return;
  }
  detail.api = result.payload.api;
  detail.operation = result.payload.operation;
  detail.verification = result.payload.verification;
  render();
}

function init() {
  detail.slug = getSlugFromUrl();
  if (!detail.slug) {
    renderMessage(
      "No API selected",
      "Open an API from My APIs to see its endpoints and health.",
      '<div class="empty-actions"><a href="/dashboard">Back to My APIs</a></div>'
    );
    return;
  }
  load();
}

init();
