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
  const req = request("GET", "/api/cairn?cairnPath=/api/catalog&search=insurance");

  _internal.restoreOriginalPath(req);

  assert.equal(req.url, "/api/catalog?search=insurance");
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

test("vercel adapter serves rewritten marketplace API routes", async () => {
  const req = request("GET", "/api/cairn?cairnPath=/api/catalog");
  const res = response();

  await handler(req, res);
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.count, 2);
  assert.equal(body.listings[0].slug, "insurance/compare-insurance-prices");
  assert.equal(body.listings[1].slug, "real-estate/search-properties");
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
