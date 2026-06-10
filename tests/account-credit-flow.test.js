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

test("account can buy credits and spend them only after workflow completion", async () => {
  const app = createApp({ seedDemoListings: true });
  app.setBaseUrl("https://cairn.example");
  const accountId = "acct_flow_test";

  const account = await send(app, "POST", "/api/accounts", { accountId });
  assert.equal(account.status, 201);
  assert.equal(account.body.wallet.balance, 0);
  assert.match(account.body.agentAuth.agentKey, /^cairn_agent_/);
  const authHeaders = { authorization: `Bearer ${account.body.agentAuth.agentKey}` };

  const blocked = await send(app, "POST", "/api/tools/insurance/compare-insurance-prices/invoke", {
    paymentMethod: "tokens",
    tokenAccountId: accountId,
    input: {
      coverageType: "auto",
      zipCode: "78701",
      driverAge: 35,
      vehicleYear: 2021
    }
  });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.body.error, "agent_auth_required");

  const checkout = await send(app, "POST", "/api/tokens/checkout", {
    packId: "starter",
    accountId
  }, authHeaders);
  assert.equal(checkout.status, 200);
  assert.equal(checkout.body.checkout.wallet.balance, 250);

  const invoke = await send(app, "POST", "/api/tools/insurance/compare-insurance-prices/invoke", {
    paymentMethod: "tokens",
    tokenAccountId: accountId,
    input: {
      coverageType: "auto",
      zipCode: "78701",
      driverAge: 35,
      vehicleYear: 2021
    }
  }, authHeaders);

  assert.equal(invoke.status, 200);
  assert.equal(invoke.body.result.allowed, true);
  assert.equal(invoke.body.tokenDebit.ok, true);
  assert.equal(invoke.body.tokenDebit.wallet.balance, 249);
  assert.equal(invoke.body.result.output.zipCode, "78701");

  const usage = await send(app, "GET", `/api/accounts/${accountId}/usage`, undefined, authHeaders);
  assert.equal(usage.status, 200);
  assert.equal(usage.body.accountId, accountId);
  assert.equal(usage.body.wallet.balance, 249);
  assert.equal(usage.body.usage.ledger[0].reason, "tool_invocation");
  assert.equal(usage.body.usage.invocationLogs[0].callerId, accountId);
});

test("integration guide exposes package, credit, REST, and MCP setup", async () => {
  const app = createApp({ seedDemoListings: true });
  app.setBaseUrl("https://cairn.example");

  const guide = await send(app, "GET", "/api/integrations/insurance%2Fcompare-insurance-prices");

  assert.equal(guide.status, 200);
  assert.equal(guide.body.package.currentInstall, "npm install github:arav31/Cairn-AI");
  assert.equal(guide.body.accountAndCredits.createAccount.url, "https://cairn.example/api/accounts");
  assert.equal(guide.body.invokeWithCredits.body.paymentMethod, "tokens");
  assert.equal(guide.body.mcp.tool, "compareInsurancePrices");
  assert.match(guide.body.cli.invoke, /npx cairn invoke/);
});

test("workflow submissions are stored against the submitting account", async () => {
  const app = createApp();
  app.setBaseUrl("https://cairn.example");
  const accountId = "acct_submitter";
  const account = await send(app, "POST", "/api/accounts", { accountId });
  const authHeaders = { authorization: `Bearer ${account.body.agentAuth.agentKey}` };

  const submission = await send(app, "POST", "/api/workflows/recordings", {
    accountId,
    title: "Check vendor renewal",
    targetUrl: "https://vendor.example/account",
    goal: "Return renewal price and cancellation date.",
    artifacts: []
  }, authHeaders);

  assert.equal(submission.status, 202);
  assert.equal(submission.body.received.accountId, accountId);

  const usage = await send(app, "GET", `/api/accounts/${accountId}/usage`, undefined, authHeaders);
  assert.equal(usage.status, 200);
  assert.equal(usage.body.usage.workflowSubmissions[0].title, "Check vendor renewal");
});
