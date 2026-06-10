import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareTermPlans, getInsuranceMarketplaceSkills } from "./insurance-quote-engine.js";
import { loadEnvFile } from "./env.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const PORT = Number(process.env.PORT || 8787);

loadEnvFile();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        app: "insurance-marketplace",
        time: new Date().toISOString(),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/marketplace/skills") {
      return sendJson(response, 200, { skills: getInsuranceMarketplaceSkills() });
    }

    if (request.method === "POST" && url.pathname === "/api/marketplace/install") {
      const body = await readJsonBody(request);
      const skill = getInsuranceMarketplaceSkills().find((item) => item.id === body.skillId);
      if (!skill) return sendJson(response, 404, { error: "Skill not found" });
      return sendJson(response, 200, {
        installed: true,
        skill,
        message: skill.real
          ? "Skill installed. The chatbot can now call the learned direct endpoints."
          : "Mock skill installed for marketplace demonstration.",
      });
    }

    if (request.method === "POST" && url.pathname === "/api/insurance/compare") {
      const body = await readJsonBody(request);
      const result = await compareTermPlans(body, { useCache: body.useCache !== false });
      return sendJson(response, 200, result);
    }

    if (request.method === "GET") {
      return serveStatic(response, url.pathname);
    }

    return sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    return sendJson(response, 500, {
      error: error?.message || String(error),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Insurance marketplace running at http://127.0.0.1:${PORT}`);
});

function serveStatic(response, pathname) {
  const cleanPath = pathname === "/" ? "/insurance-marketplace.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(response, 403, "Forbidden", "text/plain");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendText(response, 404, "Not found", "text/plain");
  }
  return sendText(response, 200, fs.readFileSync(filePath), contentType(filePath));
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  }[ext] || "application/octet-stream";
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, statusCode, body) {
  sendText(response, statusCode, JSON.stringify(body), "application/json; charset=utf-8");
}

function sendText(response, statusCode, body, type) {
  response.writeHead(statusCode, {
    "content-type": type,
    "cache-control": "no-store",
  });
  response.end(body);
}
