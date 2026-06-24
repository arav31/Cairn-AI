/* Settings: account + agent key management. */

const settings = {
  freshKey: null
};

const $ = (id) => document.getElementById(id);

function setStatus(id, message, tone = "ok") {
  const node = $(id);
  node.textContent = message || "";
  node.dataset.tone = tone;
}

function renderAgentKey() {
  const session = getSession();
  const display = $("agent-key-display");

  if (settings.freshKey) {
    display.innerHTML = `
      <p class="key-warning">Shown once — copy it now and store it somewhere safe.</p>
      <div class="agent-key">
        <code>${escapeHtml(settings.freshKey)}</code>
        <button class="ghost-button copy-button" type="button" data-copy="${escapeHtml(settings.freshKey)}">Copy</button>
      </div>
    `;
    bindCopyButtons(display);
    return;
  }

  if (session.agentKey) {
    display.innerHTML = `
      <p class="muted-copy">This browser is linked to <strong>${escapeHtml(session.accountId || "an account")}</strong>. The key is stored locally and sent as a bearer credential on every request.</p>
      <div class="agent-key">
        <code>${escapeHtml(maskKey(session.agentKey))}</code>
        <button class="ghost-button copy-button" type="button" data-copy="${escapeHtml(session.agentKey)}">Copy</button>
      </div>
    `;
    bindCopyButtons(display);
    return;
  }

  display.innerHTML = `<p class="muted-copy">No agent key on this browser yet. Create or load an account, or attach an existing key.</p>`;
}

function maskKey(key) {
  if (key.length <= 12) return key;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

async function createOrLoadAccount() {
  const accountId = ($("account-id-input").value || "demo-user").trim() || "demo-user";
  const session = getSession();
  // Reuse the saved bearer only when re-loading the same account.
  const sameAccount = session.agentKey && session.accountId === accountId;

  const result = await cairnFetch("/api/accounts", {
    method: "POST",
    body: { accountId },
    auth: sameAccount
  });

  if (result.ok) {
    const agentKey = result.payload.agentAuth && result.payload.agentAuth.agentKey;
    applyAgentAuth(result.payload);
    if (agentKey) {
      settings.freshKey = agentKey;
      setStatus("account-status", `Account "${accountId}" created. Copy your agent key below — it's shown once.`, "ok");
    } else {
      settings.freshKey = null;
      setStatus("account-status", `Account "${accountId}" loaded with your saved key.`, "ok");
    }
    renderAgentKey();
  } else if (result.status === 409) {
    settings.freshKey = null;
    setStatus("account-status", "That account already exists. Paste its saved agent key on the right to attach this browser.", "warn");
  } else if (result.status === 403) {
    settings.freshKey = null;
    setStatus("account-status", "Your saved key belongs to a different account. Use that account id, or attach the right key.", "warn");
  } else {
    setStatus("account-status", "Could not create or load that account.", "warn");
  }
}

function attachKey() {
  const accountId = ($("attach-account-id").value || "").trim();
  const agentKey = ($("attach-agent-key").value || "").trim();
  if (!accountId || !agentKey) {
    setStatus("attach-status", "Enter both an account id and an agent key.", "warn");
    return;
  }
  saveSession({ accountId, agentKey });
  settings.freshKey = null;
  $("attach-agent-key").value = "";
  $("account-id-input").value = accountId;
  setStatus("attach-status", `This browser is now linked to "${accountId}".`, "ok");
  renderAgentKey();
}

function init() {
  const session = getSession();
  if (session.accountId) $("account-id-input").value = session.accountId;
  $("account-button").addEventListener("click", createOrLoadAccount);
  $("attach-button").addEventListener("click", attachKey);
  renderAgentKey();
}

init();
