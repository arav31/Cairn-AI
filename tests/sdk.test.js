const test = require("node:test");
const assert = require("node:assert/strict");
const { CairnClient, DEFAULT_BASE_URL } = require("../src/sdk/client");

test("sdk defaults to the production marketplace URL", () => {
  const client = new CairnClient({
    fetchImpl: async () => new Response("{}")
  });

  assert.equal(client.baseUrl, DEFAULT_BASE_URL);
  assert.equal(client.accountId, "demo-user");
});

test("sdk invokes tools with token payment by default", async () => {
  let seen;
  const client = new CairnClient({
    baseUrl: "https://cairn.example",
    accountId: "acct_sdk",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const result = await client.invoke("insurance/compare-insurance-prices", {
    input: { zipCode: "78701" }
  });
  const body = JSON.parse(seen.init.body);

  assert.equal(result.ok, true);
  assert.equal(seen.url, "https://cairn.example/api/tools/insurance%2Fcompare-insurance-prices/invoke");
  assert.equal(body.paymentMethod, "tokens");
  assert.equal(body.tokenAccountId, "acct_sdk");
  assert.deepEqual(body.input, { zipCode: "78701" });
});

test("sdk can create accounts and buy token packs", async () => {
  const calls = [];
  const client = new CairnClient({
    baseUrl: "https://cairn.example",
    accountId: "acct_sdk",
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      const body = url.endsWith("/api/tokens/quote")
        ? { quote: { id: "quote_1", packId: "starter", tokens: 250, total: 99 } }
        : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await client.createAccount("acct_sdk");
  await client.buyTokens("starter", "acct_sdk");

  assert.equal(calls[0].url, "https://cairn.example/api/accounts");
  assert.equal(calls[1].url, "https://cairn.example/api/tokens/quote");
  assert.equal(calls[2].url, "https://cairn.example/api/tokens/checkout");
  assert.equal(JSON.parse(calls[2].init.body).accountId, "acct_sdk");
});
