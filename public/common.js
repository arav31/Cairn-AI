/* Shared Cairn helpers. Every page includes this before its own script. */

const CAIRN_ACCOUNT_KEY = "cairnAccountId";
const CAIRN_AGENT_KEY = "cairnAgentKey";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function generatedAccountId() {
  const suffix = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : String(Date.now()).slice(-8);
  return `acct_${suffix}`;
}

/* localStorage-backed session, mirroring the keys the old app.js used. */
function getSession() {
  return {
    accountId: localStorage.getItem(CAIRN_ACCOUNT_KEY) || null,
    agentKey: localStorage.getItem(CAIRN_AGENT_KEY) || null
  };
}

function saveSession({ accountId, agentKey }) {
  if (accountId) localStorage.setItem(CAIRN_ACCOUNT_KEY, accountId);
  if (agentKey) localStorage.setItem(CAIRN_AGENT_KEY, agentKey);
  return getSession();
}

function clearSession() {
  localStorage.removeItem(CAIRN_ACCOUNT_KEY);
  localStorage.removeItem(CAIRN_AGENT_KEY);
}

/* Pull the agent key + account id out of a POST /api/accounts response and persist. */
function applyAgentAuth(payload) {
  if (!payload || !payload.account) return getSession();
  const accountId = payload.account.accountId || payload.account.id;
  const agentKey = payload.agentAuth && payload.agentAuth.agentKey;
  return saveSession({ accountId, agentKey });
}

/*
 * In demo mode the server publishes a shared demo account via the discovery
 * doc, so a fresh — or stale — browser can recover its session automatically.
 * Returns { accountId, agentKey } or null (e.g. outside demo mode).
 */
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

async function rawFetch(path, options = {}) {
  const { method = "GET", body, auth = true, headers = {} } = options;
  const session = getSession();
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (auth && session.agentKey) finalHeaders.Authorization = `Bearer ${session.agentKey}`;

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let payload = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    payload = await response.json();
  } else {
    payload = await response.text();
  }
  return { ok: response.ok, status: response.status, payload };
}

/*
 * cairnFetch injects the bearer key from localStorage and parses JSON.
 * Returns { ok, status, payload }. Pass { auth: false } to skip the bearer.
 * Self-heals a stale/expired key: on a 401 it re-acquires the shared demo
 * session (demo mode) and retries once, so a restarted server never strands
 * the browser on an old key.
 */
async function cairnFetch(path, options = {}) {
  let result = await rawFetch(path, options);
  if (result.status === 401 && options.auth !== false && !options._healed) {
    const demo = await fetchDemoAccount();
    if (demo) {
      saveSession(demo);
      result = await rawFetch(path, { ...options, _healed: true });
    }
  }
  return result;
}

/* Relative-time formatter for "last verified" / "created" lines. */
function relativeTime(value) {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString();
}

/* Copy-to-clipboard wired to any [data-copy] button. The value to copy is read
 * from the button's data-copy attribute. Briefly swaps the label to "Copied". */
function bindCopyButtons(root = document) {
  for (const button of root.querySelectorAll("[data-copy]")) {
    if (button.dataset.copyBound) continue;
    button.dataset.copyBound = "true";
    button.addEventListener("click", async () => {
      const text = button.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch (error) {
        const helper = document.createElement("textarea");
        helper.value = text;
        document.body.appendChild(helper);
        helper.select();
        document.execCommand("copy");
        helper.remove();
      }
      const original = button.textContent;
      button.textContent = "Copied";
      button.classList.add("is-copied");
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove("is-copied");
      }, 1400);
    });
  }
}
