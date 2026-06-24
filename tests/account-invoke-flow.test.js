const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createApp } = require("../src/server");

function request(method, url, body, headers = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {
    host: "cairn.example",
    "x-forwarded-proto": "https",
    ...headers
  };
  if (body !== undefined) {
    req.headers["content-type"] = "application/json";
  }
  req.sendBody = () => {
    if (body !== undefined) {
      req.emit("data", JSON.stringify(body));
    }
    req.emit("end");
  };
  return req;
}

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.writeHead = (status, headers = {}) => {
    res.statusCode = status;
    Object.assign(res.headers, headers);
  };
  res.setHeader = (key, value) => {
    res.headers[key] = value;
  };
  res.end = (body = "") => {
    res.body = body.toString();
    res.emit("finish");
  };
  return res;
}

async function send(app, method, url, body, headers = {}) {
  await app.ready;
  const req = request(method, url, body, headers);
  const res = response();
  const done = new Promise((resolve, reject) => {
    res.on("finish", resolve);
    res.on("error", reject);
  });
  app.emit("request", req, res);
  setImmediate(() => req.sendBody());
  await done;
  return {
    status: res.statusCode,
    body: JSON.parse(res.body)
  };
}

// A brand-new (non-demo) account: POST returns its agent key once.
async function accountKey(app, accountId) {
  const account = await send(app, "POST", "/api/accounts", { accountId });
  return account.body.agentAuth.agentKey;
}

// In demo mode the seeded "demo-user" account already exists; its key is exposed
// via the discovery doc so clients (and the dashboard) can use the seeded APIs.
async function demoKey(app) {
  const wk = await send(app, "GET", "/.well-known/cairn.json");
  return wk.body.demo.agentKey;
}

test("account creation issues an agent key and exposes no wallet or payments", async () => {
  const app = createApp({ seedDemoApis: true });
  app.setBaseUrl("https://cairn.example");

  const account = await send(app, "POST", "/api/accounts", { accountId: "acct_new" });
  assert.equal(account.status, 201);
  assert.match(account.body.agentAuth.agentKey, /^cairn_agent_/);
  assert.equal("wallet" in account.body, false);
  assert.equal("ledger" in account.body, false);
  assert.ok(account.body.next.listApis.endsWith("/api/apis"));
});

test("the demo account lists only its own APIs and invokes them without payment", async () => {
  const app = createApp({ seedDemoApis: true });
  app.setBaseUrl("https://cairn.example");
  const key = await demoKey(app);
  const auth = { authorization: `Bearer ${key}` };

  const noAuth = await send(app, "GET", "/api/apis");
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.body.error, "agent_auth_required");

  const apis = await send(app, "GET", "/api/apis", undefined, auth);
  assert.equal(apis.status, 200);
  assert.equal(apis.body.count, 3);
  const slug = apis.body.apis.find((api) => api.name === "compareInsurancePrices").slug;
  assert.equal(slug, "demo-user/compareInsurancePrices");

  const invoke = await send(app, "POST", `/api/tools/${encodeURIComponent(slug)}/invoke`, {
    input: { coverageType: "auto", zipCode: "78701", driverAge: 35, vehicleYear: 2021 }
  }, auth);

  assert.equal(invoke.status, 200);
  assert.equal(invoke.body.apiId, slug);
  assert.equal(invoke.body.result.allowed, true);
  assert.equal(invoke.body.result.output.zipCode, "78701");
  assert.equal("tokenDebit" in invoke.body, false);
  assert.equal("paymentMode" in invoke.body, false);
});

test("invocation requires an agent key", async () => {
  const app = createApp({ seedDemoApis: true });
  app.setBaseUrl("https://cairn.example");

  const blocked = await send(app, "POST", "/api/tools/demo-user%2FcompareInsurancePrices/invoke", {
    input: { zipCode: "78701" }
  });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.error, "agent_auth_required");
});

test("APIs are private: another account cannot see or call them", async () => {
  const app = createApp({ seedDemoApis: true });
  app.setBaseUrl("https://cairn.example");
  const intruderKey = await accountKey(app, "intruder");
  const intruder = { authorization: `Bearer ${intruderKey}` };

  const list = await send(app, "GET", "/api/apis", undefined, intruder);
  assert.equal(list.body.count, 0);

  const leak = await send(app, "POST", "/api/tools/demo-user%2FcompareInsurancePrices/invoke", {
    input: { zipCode: "78701" }
  }, intruder);
  assert.equal(leak.status, 404);
  assert.equal(leak.body.error, "api_not_found");
});

test("payment and marketplace routes are gone", async () => {
  const app = createApp({ seedDemoApis: true });
  app.setBaseUrl("https://cairn.example");
  const key = await demoKey(app);
  const auth = { authorization: `Bearer ${key}` };

  assert.equal((await send(app, "GET", "/api/tokens/wallet?accountId=demo-user", undefined, auth)).status, 404);
  assert.equal((await send(app, "GET", "/api/payments/stripe-config")).status, 404);
  assert.equal((await send(app, "GET", "/api/catalog")).status, 404);

  const discovery = await send(app, "GET", "/.well-known/cairn.json");
  assert.equal(discovery.body.model, "private");
  assert.equal("payments" in discovery.body, false);
});

test("usage summary returns invocation logs with no wallet", async () => {
  const app = createApp({ seedDemoApis: true });
  app.setBaseUrl("https://cairn.example");
  const key = await demoKey(app);
  const auth = { authorization: `Bearer ${key}` };

  await send(app, "POST", "/api/tools/demo-user%2FcompareInsurancePrices/invoke", {
    input: { coverageType: "auto", zipCode: "78701", driverAge: 35, vehicleYear: 2021 }
  }, auth);

  const usage = await send(app, "GET", "/api/accounts/demo-user/usage", undefined, auth);
  assert.equal(usage.status, 200);
  assert.equal(usage.body.accountId, "demo-user");
  assert.equal("wallet" in usage.body, false);
  assert.ok(usage.body.usage.invocationLogs.length >= 1);
  assert.equal(usage.body.usage.invocationLogs[0].callerId, "demo-user");
});

test("workflow submissions are stored against the submitting account", async () => {
  const app = createApp();
  app.setBaseUrl("https://cairn.example");
  const key = await accountKey(app, "acct_submitter");
  const auth = { authorization: `Bearer ${key}` };

  const submission = await send(app, "POST", "/api/workflows/recordings", {
    title: "Check vendor renewal",
    targetUrl: "https://vendor.example/account",
    goal: "Return renewal price and cancellation date.",
    artifacts: []
  }, auth);

  assert.equal(submission.status, 202);
  assert.equal(submission.body.received.accountId, "acct_submitter");

  const usage = await send(app, "GET", "/api/accounts/acct_submitter/usage", undefined, auth);
  assert.equal(usage.status, 200);
  assert.equal(usage.body.usage.workflowSubmissions[0].title, "Check vendor renewal");
});
