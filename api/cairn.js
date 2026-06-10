const { createApp } = require("../src/server");

let app;

function requestBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

function restoreOriginalPath(req) {
  const baseUrl = requestBaseUrl(req);
  const url = new URL(req.url, baseUrl);
  const originalPath = url.searchParams.get("cairnPath");
  if (!originalPath || !originalPath.startsWith("/")) return;
  url.searchParams.delete("cairnPath");
  const query = url.searchParams.toString();
  req.url = query ? `${originalPath}?${query}` : originalPath;
}

function getApp(baseUrl) {
  if (!app) {
    app = createApp();
  }
  app.setBaseUrl(baseUrl);
  return app;
}

module.exports = function handler(req, res) {
  const baseUrl = process.env.CAIRN_PUBLIC_URL || requestBaseUrl(req);
  restoreOriginalPath(req);
  const server = getApp(baseUrl);
  return new Promise((resolve, reject) => {
    res.on("finish", resolve);
    res.on("close", resolve);
    res.on("error", reject);
    server.emit("request", req, res);
  });
};

module.exports._internal = {
  requestBaseUrl,
  restoreOriginalPath
};
