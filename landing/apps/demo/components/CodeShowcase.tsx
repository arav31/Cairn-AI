'use client';
import { useState } from 'react';

type Surface = {
  id: string;
  label: string;
  hint: string;
  code: string;
};

// One recorded workflow — `supplier-status` — called every way an agent
// might reach it. The input is identical across surfaces on purpose: one
// recording, one contract, many callers.
const SURFACES: Surface[] = [
  {
    id: 'http',
    label: 'HTTP',
    hint: 'any language · bearer auth',
    code: `curl -X POST $CAIRN_HOST/api/tools/supplier-status/invoke \\
  -H "Authorization: Bearer $CAIRN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {"supplierId": "AC-2231"}}'`,
  },
  {
    id: 'openapi',
    label: 'OpenAPI',
    hint: 'generated spec · drop into any client',
    code: `{
  "paths": {
    "/api/tools/supplier-status/invoke": {
      "post": {
        "operationId": "supplierStatus",
        "security": [{ "bearerAuth": [] }],
        "requestBody": { "input": { "supplierId": "string" } },
        "responses": { "200": { "status": "string", "checkedAt": "string" } }
      }
    }
  }
}`,
  },
  {
    id: 'mcp',
    label: 'MCP',
    hint: 'your agents see only your tools',
    code: `// list — returns only the APIs your account owns
POST /mcp  { "method": "tools/list" }
=> [{ "name": "supplier-status", "description": "Check a supplier's status" }]

// call
POST /mcp  { "method": "tools/call",
  "params": { "name": "supplier-status",
              "arguments": { "supplierId": "AC-2231" } } }`,
  },
  {
    id: 'sdk',
    label: 'SDK',
    hint: 'typed client · node & browser',
    code: `import { CairnClient } from "cairn";

const cairn = new CairnClient({ apiKey: process.env.CAIRN_KEY });

const { result } = await cairn.invoke("supplier-status", {
  input: { supplierId: "AC-2231" },
});`,
  },
  {
    id: 'cli',
    label: 'CLI',
    hint: 'scripts & one-off runs',
    code: `npx cairn call --api supplier-status \\
  --input '{"supplierId": "AC-2231"}'`,
  },
];

// Single-pass highlighter: escape first, then tokenize in ONE regex so we
// never re-scan the markup we just inserted (the classic double-wrap bug).
// Comments are anchored to line starts so URLs like https:// are left alone.
function highlight(code: string): string {
  const esc = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.replace(
    /(^[ \t]*\/\/[^\n]*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(\d+(?:\.\d+)?)\b|\b(import|from|const|await|new|POST|GET)\b/gm,
    (match, comment, str, num, kw) => {
      if (comment) return `<span class="token-punct">${comment}</span>`;
      if (str) return `<span class="token-str">${str}</span>`;
      if (num) return `<span class="token-num">${num}</span>`;
      if (kw) return `<span class="token-key">${kw}</span>`;
      return match;
    }
  );
}

export default function CodeShowcase() {
  const [active, setActive] = useState(SURFACES[0]!.id);
  const [copied, setCopied] = useState(false);

  const surface = SURFACES.find((s) => s.id === active) ?? SURFACES[0]!;

  const copy = () => {
    navigator.clipboard?.writeText(surface.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="showcase">
      <div className="pm-tabs" role="tablist" aria-label="Ways to call your API">
        {SURFACES.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === active}
            className={s.id === active ? 'active' : ''}
            onClick={() => {
              setActive(s.id);
              setCopied(false);
            }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="code-block">
        <button className="copy" onClick={copy} aria-label="Copy snippet">
          {copied ? 'copied' : 'copy'}
        </button>
        <code dangerouslySetInnerHTML={{ __html: highlight(surface.code) }} />
      </div>
      <div className="showcase-hint">
        <span className="hl">{surface.label.toLowerCase()}</span> — {surface.hint}
      </div>
    </div>
  );
}
