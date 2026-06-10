const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const handler = require("../api/cairn");
const { _internal } = handler;

test("vercel adapter restores original rewritten route", () => {
  const req = new EventEmitter();
  req.headers = {
    host: "cairn.example",
    "x-forwarded-proto": "https"
  };
  req.url = "/api/cairn?cairnPath=/api/catalog&search=insurance";

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
  const req = new EventEmitter();
  req.method = "GET";
  req.url = "/api/cairn?cairnPath=/api/catalog";
  req.headers = {
    host: "cairn.example",
    "x-forwarded-proto": "https"
  };

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

  await handler(req, res);
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.count, 2);
  assert.equal(body.listings[0].slug, "insurance/compare-insurance-prices");
  assert.equal(body.listings[1].slug, "real-estate/search-properties");
});
