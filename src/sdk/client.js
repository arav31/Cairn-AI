const DEFAULT_BASE_URL = "https://cairn-ai-gamma.vercel.app";

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function assertFetch(fetchImpl) {
  if (!fetchImpl) {
    throw new Error("CairnClient requires fetch. Use Node 18+ or pass fetchImpl.");
  }
}

async function parseResponse(response) {
  const text = await response.text();
  const type = response.headers && response.headers.get
    ? response.headers.get("content-type") || ""
    : "";
  const body = type.includes("application/json") && text ? JSON.parse(text) : text;
  if (!response.ok) {
    const error = new Error(`Cairn request failed with ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

// CairnClient calls your own private, reusable APIs. Create an account once to
// get an agent key, then list, inspect, record, and call the APIs that belong
// to that account. There are no credits or payments.
class CairnClient {
  constructor(options = {}) {
    this.baseUrl = trimSlash(options.baseUrl || process.env.CAIRN_BASE_URL || DEFAULT_BASE_URL);
    this.accountId = options.accountId || process.env.CAIRN_ACCOUNT_ID || "demo-user";
    this.agentKey = options.agentKey || process.env.CAIRN_AGENT_KEY || null;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    assertFetch(this.fetchImpl);
  }

  async request(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {})
    };
    if (this.agentKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.agentKey}`;
    }
    const init = {
      method: options.method || "GET",
      headers
    };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    return parseResponse(response);
  }

  discovery() {
    return this.request("/.well-known/cairn.json");
  }

  // Create (or attach to) an account and capture its agent key.
  async createAccount(accountId = this.accountId) {
    this.accountId = accountId || this.accountId;
    const result = await this.request("/api/accounts", {
      method: "POST",
      body: { accountId: this.accountId }
    });
    if (result.agentAuth && result.agentAuth.agentKey) {
      this.agentKey = result.agentAuth.agentKey;
    }
    return result;
  }

  // List the APIs that belong to your account.
  listApis() {
    return this.request("/api/apis");
  }

  // Inspect one of your APIs (contract, verification, endpoints).
  getApi(slug) {
    return this.request(`/api/apis/${encodeURIComponent(slug)}`);
  }

  apiReadme(slug) {
    return this.request(`/api/tools/${encodeURIComponent(slug)}/readme.md`, {
      headers: { Accept: "text/markdown" }
    });
  }

  apiOpenApi(slug) {
    return this.request(`/api/tools/${encodeURIComponent(slug)}/openapi.json`);
  }

  // Submit a workflow recording so Cairn can compile it into a private API.
  recordWorkflow({ title, targetUrl, goal, artifacts = [] } = {}) {
    return this.request("/api/workflows/recordings", {
      method: "POST",
      body: { title, targetUrl, goal, artifacts }
    });
  }

  // Call one of your APIs. Auth-gated, never payment-gated.
  invoke(slug, options = {}) {
    const accountId = options.accountId || this.accountId;
    return this.request(`/api/tools/${encodeURIComponent(slug)}/invoke`, {
      method: "POST",
      body: {
        input: options.input || {},
        caller: options.caller || { id: accountId }
      }
    });
  }

  mcpToolList() {
    return this.request("/mcp", {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: "tools",
        method: "tools/list"
      }
    });
  }

  mcpCall(name, args = {}, options = {}) {
    const accountId = options.accountId || this.accountId;
    return this.request("/mcp", {
      method: "POST",
      body: {
        jsonrpc: "2.0",
        id: options.id || "call-1",
        method: "tools/call",
        params: {
          name,
          arguments: args,
          caller: options.caller || { id: accountId }
        }
      }
    });
  }
}

module.exports = {
  CairnClient,
  DEFAULT_BASE_URL
};
