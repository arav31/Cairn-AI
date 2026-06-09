const fs = require("node:fs");
const path = require("node:path");

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const quote = trimmed[0];
  if ((quote !== "\"" && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed;
  }
  const inner = trimmed.slice(1, -1);
  if (quote === "'") return inner;
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

function stripInlineComment(value) {
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const prev = value[index - 1];
    if ((char === "\"" || char === "'") && prev !== "\\") {
      quote = quote === char ? null : quote || char;
    }
    if (char === "#" && !quote && /\s/.test(prev || "")) {
      return value.slice(0, index);
    }
  }
  return value;
}

function parseEnv(contents) {
  const parsed = {};
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = normalized.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = stripInlineComment(normalized.slice(equalsIndex + 1));
    parsed[key] = unquote(value);
  }
  return parsed;
}

function loadEnv(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, loaded: false, keys: [] };
  }
  const parsed = parseEnv(fs.readFileSync(filePath, "utf8"));
  const keys = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { path: filePath, loaded: true, keys };
}

module.exports = {
  loadEnv,
  parseEnv
};
