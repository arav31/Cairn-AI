const crypto = require("node:crypto");

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

function now() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function redact(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/cookie|token|csrf|viewstate|password|secret|authorization/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redact(nested);
      }
    }
    return out;
  }
  return value;
}

function toQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseHidden(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, "i");
  const match = html.match(pattern);
  return match ? match[1] : undefined;
}

function parseRows(html) {
  const rows = [];
  const rowPattern = /<tr[^>]*data-record-id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(html))) {
    const cells = [];
    const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[2]))) {
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }
    rows.push({ id: rowMatch[1], cells });
  }
  return rows;
}

function parseDefinitionList(html) {
  const result = {};
  const pattern = /<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    const key = match[1].replace(/<[^>]+>/g, "").trim().toLowerCase().replace(/\s+/g, "_");
    const value = match[2].replace(/<[^>]+>/g, "").trim();
    result[key] = value;
  }
  return result;
}

module.exports = {
  id,
  now,
  sleep,
  stableHash,
  redact,
  toQuery,
  htmlEscape,
  parseHidden,
  parseRows,
  parseDefinitionList
};
