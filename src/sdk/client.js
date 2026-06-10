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

class CairnClient {
  constructor(options = {}) {
    this.baseUrl = trimSlash(options.baseUrl || process.env.CAIRN_BASE_URL || DEFAULT_BASE_URL);
    this.accountId = options.accountId || process.env.CAIRN_ACCOUNT_ID || "demo-user";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    assertFetch(this.fetchImpl);
  }

  async request(path, options = {}) {
    const headers = {
      Accept: "application/json",
      ...(options.headers || {})
    };
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

  catalog() {
    return this.request("/api/catalog");
  }

  tool(slugOrName) {
    return this.request(`/api/tools/${encodeURIComponent(slugOrName)}`);
  }

  toolReadme(slugOrName) {
    return this.request(`/api/tools/${encodeURIComponent(slugOrName)}/readme.md`, {
      headers: { Accept: "text/markdown" }
    });
  }

  integrationGuide(slugOrName) {
    const suffix = slugOrName ? `/${encodeURIComponent(slugOrName)}` : "";
    return this.request(`/api/integrations${suffix}`);
  }

  createAccount(accountId = this.accountId) {
    this.accountId = accountId || this.accountId;
    return this.request("/api/accounts", {
      method: "POST",
      body: { accountId: this.accountId }
    });
  }

  wallet(accountId = this.accountId) {
    return this.request(`/api/tokens/wallet?accountId=${encodeURIComponent(accountId)}`);
  }

  tokenQuote(packId = "starter", accountId = this.accountId) {
    return this.request("/api/tokens/quote", {
      method: "POST",
      body: { packId, accountId }
    });
  }

  async buyTokens(packId = "starter", accountId = this.accountId) {
    const quote = await this.tokenQuote(packId, accountId);
    return this.request("/api/tokens/checkout", {
      method: "POST",
      body: {
        packId,
        accountId,
        quote: quote.quote,
        buyer: { accountId }
      }
    });
  }

  toolQuote(slugOrName, input = {}) {
    return this.request(`/api/tools/${encodeURIComponent(slugOrName)}/quote`, {
      method: "POST",
      body: { input }
    });
  }

  toolCheckout(slugOrName, input = {}, buyer = {}) {
    return this.request(`/api/tools/${encodeURIComponent(slugOrName)}/checkout`, {
      method: "POST",
      body: { input, buyer }
    });
  }

  invoke(slugOrName, options = {}) {
    const accountId = options.accountId || this.accountId;
    const body = {
      input: options.input || {},
      caller: options.caller
    };
    if (options.demo) {
      body.demo = true;
    } else if (options.paymentMethod === "tokens" || options.useTokens !== false) {
      body.paymentMethod = "tokens";
      body.tokenAccountId = accountId;
      body.caller = body.caller || { id: accountId };
    } else {
      body.payment = options.payment;
      body.sharedPaymentToken = options.sharedPaymentToken;
      body.stripeCustomerId = options.stripeCustomerId;
    }
    return this.request(`/api/tools/${encodeURIComponent(slugOrName)}/invoke`, {
      method: "POST",
      body
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
          paymentMethod: options.paymentMethod || "tokens",
          tokenAccountId: accountId,
          demo: options.demo,
          payment: options.payment,
          sharedPaymentToken: options.sharedPaymentToken
        }
      }
    });
  }
}

module.exports = {
  CairnClient,
  DEFAULT_BASE_URL
};
