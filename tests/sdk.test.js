const test = require("node:test");
const assert = require("node:assert/strict");
const { CairnClient, DEFAULT_BASE_URL } = require("../src/sdk/client");

test("sdk defaults to the production base url", () => {
  const client = new CairnClient({
    fetchImpl: async () => new Response("{}")
  });

  assert.equal(client.baseUrl, DEFAULT_BASE_URL);
  assert.equal(client.accountId, "demo-user");
});

test("sdk invokes an API with a payment-free body", async () => {
  let seen;
  const client = new CairnClient({
    baseUrl: "https://cairn.example",
    accountId: "acct_sdk",
    agentKey: "cairn_agent_sdk",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ apiId: "acct_sdk/getThing", result: { allowed: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.invoke("acct_sdk/getThing", { input: { q: "hi" } });
  const body = JSON.parse(seen.init.body);

  assert.equal(result.result.allowed, true);
  assert.equal(seen.url, "https://cairn.example/api/tools/acct_sdk%2FgetThing/invoke");
  assert.equal(seen.init.headers.Authorization, "Bearer cairn_agent_sdk");
  assert.deepEqual(body.input, { q: "hi" });
  assert.deepEqual(body.caller, { id: "acct_sdk" });
  assert.equal("paymentMethod" in body, false);
  assert.equal("tokenAccountId" in body, false);
});

test("sdk lists APIs, records workflows, and captures the agent key", async () => {
  const calls = [];
  const client = new CairnClient({
    baseUrl: "https://cairn.example",
    accountId: "acct_sdk",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      const body = url.endsWith("/api/accounts")
        ? { account: {}, agentAuth: { agentKey: "cairn_agent_created" } }
        : url.endsWith("/api/apis")
          ? { apis: [], count: 0 }
          : { id: "rec_1", status: "accepted" };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.createAccount("acct_sdk");
  assert.equal(client.agentKey, "cairn_agent_created");

  await client.listApis();
  await client.recordWorkflow({ title: "Check renewal", targetUrl: "https://x.example", goal: "Return status." });

  assert.equal(calls[0].url, "https://cairn.example/api/accounts");
  assert.equal(calls[1].url, "https://cairn.example/api/apis");
  assert.equal(calls[1].init.headers.Authorization, "Bearer cairn_agent_created");
  assert.equal(calls[2].url, "https://cairn.example/api/workflows/recordings");
  assert.equal(JSON.parse(calls[2].init.body).title, "Check renewal");
});
