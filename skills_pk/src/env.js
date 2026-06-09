import fs from "node:fs";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

export function loadEnvFile({ envPath = DEFAULT_ENV_PATH, override = false } = {}) {
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath, keys: [] };
  }

  const keys = [];
  const source = fs.readFileSync(envPath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (!override && process.env[parsed.key] !== undefined) continue;
    process.env[parsed.key] = parsed.value;
    keys.push(parsed.key);
  }
  return { loaded: true, path: envPath, keys };
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;

  const key = trimmed.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(separator + 1).trim();
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}
