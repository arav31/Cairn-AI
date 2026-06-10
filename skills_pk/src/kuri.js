import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sleep } from "./cdp.js";

export function currentKuriTarget() {
  if (process.platform === "win32" && process.arch === "x64") return "win-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "darwin-x64";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  return "";
}

export function kuriBinaryName() {
  return process.platform === "win32" ? "kuri.exe" : "kuri";
}

export function findKuriExecutable() {
  const explicit = process.env.KURI_BIN || process.env.SKILL_BUILDER_KURI_BIN;
  const target = currentKuriTarget();
  const candidates = [
    explicit,
    target ? path.join(process.cwd(), "node_modules", "unbrowse", "vendor", "kuri", target, kuriBinaryName()) : "",
    target ? path.join(process.cwd(), "vendor", "kuri", target, kuriBinaryName()) : "",
    "kuri",
  ].filter(Boolean);

  const found = candidates.find((candidate) => {
    if (candidate === "kuri") return Boolean(resolveOnPath(candidate));
    return fs.existsSync(candidate);
  });
  if (!found) throw new Error("Could not find Kuri. Install `unbrowse` or set KURI_BIN to kuri.exe.");
  return found === "kuri" ? resolveOnPath(found) : found;
}

export function hasKuriExecutable() {
  try {
    findKuriExecutable();
    return true;
  } catch {
    return false;
  }
}

export function randomKuriPort() {
  return 18080 + Math.floor(Math.random() * 1000);
}

export async function startKuriBroker({ port = randomKuriPort(), headless = false } = {}) {
  const binary = findKuriExecutable();
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-skill-builder-kuri-"));
  const child = spawn(binary, [], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      HEADLESS: headless ? "true" : "false",
      STATE_DIR: stateDir,
    },
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  try {
    await waitForKuriHealth(port);
  } catch (error) {
    child.kill();
    throw error;
  }

  return new KuriBroker({ port, child, stateDir, binary });
}

class KuriBroker {
  constructor({ port, child, stateDir, binary }) {
    this.port = port;
    this.child = child;
    this.stateDir = stateDir;
    this.binary = binary;
  }

  async get(route, params = {}, timeoutMs) {
    const response = await fetch(kuriUrl(this.port, route, params), {
      signal: AbortSignal.timeout(timeoutMs || Number(process.env.SKILL_BUILDER_KURI_TIMEOUT_MS || 30000)),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`);
    return parseMaybeJson(text);
  }

  async post(route, params = {}, body = {}, timeoutMs) {
    const response = await fetch(kuriUrl(this.port, route, params), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs || Number(process.env.SKILL_BUILDER_KURI_TIMEOUT_MS || 30000)),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `${response.status} ${response.statusText}`);
    return parseMaybeJson(text);
  }

  async health() {
    return this.get("/health", {}, 5000);
  }

  async newTab(url = "about:blank") {
    const result = await this.get("/tab/new", { url });
    return result.tab_id || result.id || result.targetId || "";
  }

  async navigate(tabId, url) {
    return this.get("/navigate", { tab_id: tabId, url }, Number(process.env.SKILL_BUILDER_KURI_NAV_TIMEOUT_MS || 45000));
  }

  async addInitScript(tabId, script) {
    return this.post("/add-init-script", {}, { tab_id: tabId, script });
  }

  async injectScript(tabId, source) {
    return this.post("/script/inject", { tab_id: tabId }, { source });
  }

  async evaluate(tabId, expression) {
    const result = await this.get("/evaluate", { tab_id: tabId, expression });
    return unwrapRuntimeValue(result);
  }

  async harStart(tabId) {
    return this.get("/har/start", { tab_id: tabId });
  }

  async harStop(tabId) {
    const result = await this.get("/har/stop", { tab_id: tabId });
    return {
      entries: result?.har?.log?.entries || [],
      raw: result,
    };
  }

  async networkEnable(tabId) {
    return this.get("/network", { tab_id: tabId, mode: "enable" }).catch(() => null);
  }

  async text(tabId) {
    return unwrapRuntimeValue(await this.get("/text", { tab_id: tabId }));
  }

  async markdown(tabId) {
    return unwrapRuntimeValue(await this.get("/markdown", { tab_id: tabId }));
  }

  async snapshot(tabId) {
    const result = await this.get("/snapshot", { tab_id: tabId, format: "text" });
    return typeof result === "string" ? result : result?.snapshot || unwrapRuntimeValue(result) || "";
  }

  async currentUrl(tabId) {
    const value = await this.evaluate(tabId, "window.location.href").catch(() => "");
    return typeof value === "string" ? value : "";
  }

  async closeTab(tabId) {
    if (!tabId) return;
    await this.get("/close", { tab_id: tabId }).catch(() => null);
  }

  async stop() {
    if (!this.child || this.child.exitCode !== null) return;
    this.child.kill("SIGTERM");
    if (await waitForProcessExit(this.child, 2500)) return;
    if (process.platform === "win32" && this.child.pid) {
      const killer = spawn("taskkill", ["/PID", String(this.child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      await waitForProcessExit(killer, 5000);
      return;
    }
    this.child.kill("SIGKILL");
    await waitForProcessExit(this.child, 2500);
  }
}

function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off?.("exit", onExit);
      resolve(false);
    }, timeoutMs);
    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }
    child.once("exit", onExit);
  });
}

function resolveOnPath(name) {
  const paths = String(process.env.PATH || "").split(path.delimiter);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of paths) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${name}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

async function waitForKuriHealth(port) {
  const deadline = Date.now() + Number(process.env.SKILL_BUILDER_KURI_START_TIMEOUT_MS || 20000);
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
      lastError = await response.text();
    } catch (error) {
      lastError = error.message;
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Kuri on port ${port}: ${lastError || "no response"}`);
}

function kuriUrl(port, route, params = {}) {
  const url = new URL(`http://127.0.0.1:${port}${route}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url;
}

function parseMaybeJson(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapRuntimeValue(result) {
  if (typeof result === "string") return result;
  if (result?.result?.result && "value" in result.result.result) return result.result.result.value;
  if (result?.result && "value" in result.result) return result.result.value;
  if ("text" in (result || {})) return result.text;
  if ("markdown" in (result || {})) return result.markdown;
  return result;
}
