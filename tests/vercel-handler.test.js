const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const handler = require("../api/cairn");
const rootHandler = require("../src/server");
const { _internal } = handler;

function request(method, url) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {
    host: "cairn.example",
    "x-forwarded-proto": "https"
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

test("vercel adapter restores original rewritten route", () => {
  const req = request("GET", "/api/cairn?cairnPath=/api/apis&search=insurance");

  _internal.restoreOriginalPath(req);

  assert.equal(req.url, "/api/apis?search=insurance");
});

test("vercel adapter derives request base url", () => {
  const req = {
    headers: {
      host: "cairn.example",
      "x-forwarded-proto": "https"
    }
  };

  assert.equal(_internal.requestBaseUrl(req), "https://cairn.example");
});

test("vercel adapter serves rewritten private API routes (auth required)", async () => {
  const req = request("GET", "/api/cairn?cairnPath=/api/apis");
  const res = response();

  await handler(req, res);
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 401);
  assert.equal(body.error, "agent_auth_required");
});

test("root server export works as Vercel entrypoint", async () => {
  const req = request("GET", "/");
  const res = response();

  await rootHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Cairn/);
});

test("root server export handles deployment HEAD checks", async () => {
  const req = request("HEAD", "/");
  const res = response();

  await rootHandler(req, res);

  assert.equal(res.statusCode, 200);
});
