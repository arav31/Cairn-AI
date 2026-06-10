import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const DEFAULT_BASE_URL = "http://localhost:6969";
const DEFAULT_TIMEOUT_MS = 90000;

export async function getUnbrowseStatus() {
  const mode = normalizeMode(process.env.SKILL_BUILDER_UNBROWSE || "auto");
  const baseUrl = normalizedBaseUrl();
  const cliPath = findUnbrowseCli();
  const bun = findBun();
  const localHealth = await fetchLocalHealth(baseUrl);
  const remoteEnabled = process.env.SKILL_BUILDER_UNBROWSE_REMOTE === "1" && Boolean(process.env.UNBROWSE_API_KEY);

  if (mode === "off") {
    return {
      enabled: false,
      mode,
      transport: "disabled",
      baseUrl,
      cliPath,
      bunPath: bun.path,
      reason: "SKILL_BUILDER_UNBROWSE is off.",
    };
  }

  if (localHealth.ok) {
    return {
      enabled: true,
      mode,
      transport: "local-http",
      baseUrl,
      cliPath,
      bunPath: bun.path,
      health: localHealth.data,
      reason: `Local Unbrowse runtime is running at ${baseUrl}.`,
    };
  }

  if (cliPath && bun.ok) {
    return {
      enabled: true,
      mode,
      transport: "cli-managed-local",
      baseUrl,
      cliPath,
      bunPath: bun.path,
      reason: "Unbrowse CLI and Bun are available; the CLI can start the local runtime.",
    };
  }

  if (remoteEnabled) {
    return {
      enabled: true,
      mode,
      transport: "remote-sdk",
      baseUrl: process.env.UNBROWSE_BACKEND_URL || process.env.UNBROWSE_API_URL || "https://beta-api.unbrowse.ai",
      cliPath,
      bunPath: bun.path,
      reason: "UNBROWSE_API_KEY is set and SKILL_BUILDER_UNBROWSE_REMOTE=1.",
    };
  }

  return {
    enabled: false,
    mode,
    transport: "unavailable",
    baseUrl,
    cliPath,
    bunPath: bun.path,
    reason: cliPath
      ? "Unbrowse CLI is installed, but Bun is not available and no local Unbrowse server is running."
      : "Unbrowse CLI is not installed and no local Unbrowse server is running.",
  };
}

export async function ensureUnbrowseRuntime() {
  const initial = await getUnbrowseStatus();
  if (!initial.enabled) return initial;
  if (initial.transport === "local-http" || initial.transport === "remote-sdk") return initial;
  if (initial.transport !== "cli-managed-local") return initial;

  const started = await startUnbrowseServe(initial);
  if (!started.ok) {
    return {
      ...initial,
      enabled: false,
      transport: "unavailable",
      reason: started.error || "Failed to start the local Unbrowse runtime.",
    };
  }

  const health = await waitForLocalHealth(initial.baseUrl, Number(process.env.UNBROWSE_START_TIMEOUT_MS || 20000));
  if (!health.ok) {
    return {
      ...initial,
      enabled: false,
      transport: "unavailable",
      reason: `Unbrowse CLI ran, but ${initial.baseUrl}/health is still unavailable.`,
    };
  }

  return {
    ...initial,
    transport: "local-http",
    health: health.data,
    reason: `Local Unbrowse runtime started at ${initial.baseUrl}.`,
  };
}

async function startUnbrowseServe(status) {
  const runtime = resolveUnbrowseRuntimeEntrypoint();
  if (!runtime) {
    return { ok: false, error: "Could not find node_modules/unbrowse/runtime/cli.js. Run npm install in this folder." };
  }
  if (!status.bunPath) {
    return { ok: false, error: "Bun is required to start the Unbrowse local runtime." };
  }

  const url = new URL(status.baseUrl);
  const child = spawn(status.bunPath, [runtime, "serve"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      UNBROWSE_URL: status.baseUrl,
      UNBROWSE_BUN_BIN: status.bunPath,
      UNBROWSE_TOS_ACCEPTED: process.env.UNBROWSE_TOS_ACCEPTED || "1",
      UNBROWSE_NON_INTERACTIVE: process.env.UNBROWSE_NON_INTERACTIVE || "1",
      // Manual route learning needs an actual browser window. Unbrowse/Kuri
      // defaults to headless unless these flags are explicitly false.
      HEADLESS: process.env.HEADLESS || "false",
      KURI_HEADLESS: process.env.KURI_HEADLESS || process.env.HEADLESS || "false",
      // The npm Unbrowse runtime defaults Kuri to proxykingdom.cn2.ai. That
      // breaks normal local capture when the proxy tunnel is unavailable.
      UNBROWSE_DIRECT_EGRESS: process.env.UNBROWSE_DIRECT_EGRESS || "1",
      UNBROWSE_KURI_PROXY: process.env.UNBROWSE_KURI_PROXY || "0",
      KURI_PROXY: process.env.KURI_PROXY || "",
      HOST: !url.hostname || url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
      PORT: url.port || (url.protocol === "https:" ? "443" : "80"),
    },
  });
  child.unref();
  return { ok: true, pid: child.pid };
}

async function waitForLocalHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const health = await fetchLocalHealth(baseUrl, 1500);
    if (health.ok) return health;
    last = health;
    await delay(500);
  }
  return last || { ok: false, error: "Timed out waiting for Unbrowse /health." };
}

export async function resolveUnbrowseIntent({ url, intent, params = {}, forceCapture = false, dryRun = true, timeoutMs } = {}) {
  const runtime = await ensureUnbrowseRuntime();
  if (!runtime.enabled) return { ok: false, status: runtime, error: runtime.reason };

  const budgetMs = Number(process.env.UNBROWSE_RESOLVE_BUDGET_MS || timeoutMs || DEFAULT_TIMEOUT_MS);
  const body = {
    intent,
    params: { url, ...params },
    context: { url },
    projection: { raw: true },
    budget_ms: budgetMs,
    ...(forceCapture ? { force_capture: true } : {}),
    ...(dryRun ? { dry_run: true } : {}),
  };

  if (runtime.transport === "remote-sdk") {
    const client = await makeRemoteClient();
    const started = performance.now();
    const result = await client.resolve({ intent, contextUrl: url, limit: 8 }, { timeout: budgetMs });
    return { ok: true, transport: runtime.transport, status: runtime, result, ms: Math.round(performance.now() - started) };
  }

  const started = performance.now();
  const result = await localJson(runtime.baseUrl, "POST", "/v1/intent/resolve", body, budgetMs + 15000);
  return { ok: true, transport: runtime.transport, status: runtime, result, ms: Math.round(performance.now() - started) };
}

export async function startUnbrowseCapture({ url } = {}) {
  const runtime = await ensureUnbrowseRuntime();
  if (!runtime.enabled || runtime.transport === "remote-sdk") {
    return {
      ok: false,
      status: runtime,
      error: runtime.transport === "remote-sdk"
        ? "Remote Unbrowse SDK cannot open a local browser capture session."
        : runtime.reason,
    };
  }
  const started = performance.now();
  const result = await localJson(runtime.baseUrl, "POST", "/v1/browse/go", { url }, DEFAULT_TIMEOUT_MS);
  return { ok: true, transport: runtime.transport, status: runtime, result, ms: Math.round(performance.now() - started) };
}

export async function syncUnbrowseCapture({ sessionId } = {}) {
  const runtime = await ensureUnbrowseRuntime();
  if (!runtime.enabled || runtime.transport === "remote-sdk") {
    return { ok: false, status: runtime, error: runtime.reason };
  }
  const result = await localJson(runtime.baseUrl, "POST", "/v1/browse/sync", sessionBody(sessionId), DEFAULT_TIMEOUT_MS);
  return { ok: true, transport: runtime.transport, status: runtime, result };
}

export async function closeUnbrowseCapture({ sessionId } = {}) {
  const runtime = await ensureUnbrowseRuntime();
  if (!runtime.enabled || runtime.transport === "remote-sdk") {
    return { ok: false, status: runtime, error: runtime.reason };
  }
  const result = await localJson(runtime.baseUrl, "POST", "/v1/browse/close", sessionBody(sessionId), DEFAULT_TIMEOUT_MS);
  return { ok: true, transport: runtime.transport, status: runtime, result };
}

export async function executeUnbrowseSkill(skill, inputs = {}) {
  const config = skill.unbrowse || {};
  const started = performance.now();

  if (config.transport === "remote-sdk") {
    const client = await makeRemoteClient();
    const result = await client.execute({
      endpoint_id: config.endpointId,
      params: { ...inputs },
      raw: true,
    }, { timeout: Number(process.env.UNBROWSE_EXECUTE_TIMEOUT_MS || 60000) });
    return {
      result,
      ms: Math.round(performance.now() - started),
      request: {
        method: "UNBROWSE",
        url: config.endpointUrl || config.contextUrl || skill.sourceUrl,
        execution: "unbrowse-remote-sdk",
      },
    };
  }

  const runtime = await ensureUnbrowseRuntime();
  if (!runtime.enabled) throw new Error(`Unbrowse runtime unavailable: ${runtime.reason}`);
  const skillId = config.skillId;
  if (!skillId) throw new Error("Unbrowse skill is missing unbrowse.skillId.");
  const endpointId = config.endpointId;
  const body = {
    params: {
      ...(endpointId ? { endpoint_id: endpointId } : {}),
      ...inputs,
    },
    projection: { raw: true },
    intent: config.intent || skill.learning?.inferredGoal || skill.name,
    context_url: config.contextUrl || skill.sourceUrl,
    ...(config.confirmUnsafe || process.env.UNBROWSE_CONFIRM_UNSAFE === "1" ? { confirm_unsafe: true } : {}),
    ...(config.confirmThirdPartyTerms || process.env.UNBROWSE_CONFIRM_THIRD_PARTY_TERMS === "1" ? { confirm_third_party_terms: true } : {}),
  };
  const result = await localJson(runtime.baseUrl, "POST", `/v1/skills/${encodeURIComponent(skillId)}/execute`, body, Number(process.env.UNBROWSE_EXECUTE_TIMEOUT_MS || 60000));
  return {
    result,
    ms: Math.round(performance.now() - started),
    request: {
      method: "UNBROWSE",
      url: config.endpointUrl || config.contextUrl || skill.sourceUrl,
      execution: "unbrowse-local-runtime",
    },
  };
}

export async function createUnbrowseDraftSkill({ url, name, goal, resolveResult, syncResult, closeResult } = {}) {
  const endpoint = selectBestEndpoint(resolveResult, goal) || selectBestEndpoint(syncResult, goal) || selectBestEndpoint(closeResult, goal);
  if (!endpoint) {
    return {
      ok: false,
      reason: "Unbrowse did not expose a reusable endpoint for this workflow yet.",
      endpoints: collectEndpoints(resolveResult, syncResult, closeResult),
    };
  }

  const skillId = resolveSkillId(resolveResult) || resolveSkillId(syncResult) || endpoint.skill_id;
  if (!skillId && !endpoint.skill_id) {
    return {
      ok: false,
      reason: "Unbrowse returned an endpoint but no skill_id, so it cannot be replayed safely.",
      endpoints: collectEndpoints(resolveResult, syncResult, closeResult),
    };
  }

  const inputs = inputSpecsFromEndpoint(endpoint);
  const validation = validateUnbrowseEndpointForSkill(endpoint, inputs, { url, goal });
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      endpoints: collectEndpoints(resolveResult, syncResult, closeResult),
      endpoint,
    };
  }

  const id = slugify(name || hostnameFromUrl(url) || "unbrowse-skill");
  const skill = {
    id,
    name: name || humanizeName(id),
    sourceUrl: url,
    provider: "unbrowse",
    description: `Unbrowse-backed skill for ${goal || "the captured workflow"}. It reuses the learned route through Unbrowse execute instead of rerunning browser automation.`,
    inputs,
    conversation: {
      intro: `I'll help you ${goal ? lowercaseFirst(goal) : "run this Unbrowse skill"}. I'll ask for the endpoint parameters Unbrowse marked as user-supplied, then execute the learned route.`,
      inputGroups: inputs.length ? [{
        title: "Details",
        description: "",
        inputIds: inputs.map((input) => input.id),
        repeatable: false,
      }] : [],
    },
    unbrowse: {
      transport: resolveResult?.transport || syncResult?.transport || closeResult?.transport || "local-http",
      skillId: skillId || endpoint.skill_id,
      endpointId: endpoint.endpoint_id,
      endpointUrl: endpoint.url_template || endpoint.url,
      method: endpoint.method || "GET",
      intent: goal || "",
      contextUrl: url,
      endpointDescription: endpoint.description_out || endpoint.description || "",
      replayContract: endpoint.replay_contract || endpoint.contract || null,
    },
    learning: {
      strategy: {
        kind: "unbrowse_execute",
        rationale: "Resolved through Unbrowse route cache/capture and saved as a direct Unbrowse execute pointer.",
      },
      inferredGoal: goal || "",
      summary: endpoint.description_out || endpoint.description || "Unbrowse learned endpoint route.",
      confidence: normalizeScore(endpoint.score),
      endpointEngineering: {
        selectedRequestId: endpoint.endpoint_id || "",
        selectedEndpointUrl: endpoint.url_template || endpoint.url || "",
        method: endpoint.method || "",
        endpointPurpose: endpoint.description_out || endpoint.description || "",
        payloadType: "unbrowse",
        userInputMappings: inputs.map((input) => ({
          inputId: input.id,
          question: input.question,
          mapsTo: [input.unbrowseParam || input.id],
          required: input.optional !== true,
          type: input.type,
        })),
      },
      replayWarnings: inputs.length
        ? []
        : ["Unbrowse did not expose user-facing parameter specs. This skill can still execute if the route needs no runtime inputs; review if the original website had visible fields."],
    },
    outputs: [
      {
        label: "Result",
        from: "goal",
        path: "$",
        extractor: "important",
      },
    ],
  };

  await fsp.mkdir("skills", { recursive: true });
  const file = path.join("skills", `${id}.draft.json`);
  await fsp.writeFile(file, JSON.stringify(skill, null, 2));
  return { ok: true, file, skill, endpoint };
}

export function collectEndpoints(...sources) {
  const endpoints = [];
  const seen = new Set();
  for (const source of sources) {
    for (const endpoint of collectEndpointsFromSource(source)) {
      const key = endpoint.endpoint_id || `${endpoint.method || ""}|${endpoint.url_template || endpoint.url || ""}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      endpoints.push(endpoint);
    }
  }
  return endpoints;
}

function collectEndpointsFromSource(source) {
  if (!source) return [];
  const result = source.result || source;
  const collections = [
    result.available_endpoints,
    result.available_operations,
    result.endpoints,
    result.skill?.endpoints,
    result.result?.available_endpoints,
    result.result?.available_operations,
    result.result?.endpoints,
    result.result?.skill?.endpoints,
    result.resolve_result?.available_endpoints,
    result.resolve_result?.available_operations,
    result.resolve_result?.result?.available_endpoints,
  ];
  return collections.flatMap((items) => Array.isArray(items) ? items : []).filter(Boolean);
}

function selectBestEndpoint(...sources) {
  const maybeGoal = sources.find((source) => typeof source === "string") || "";
  const endpoints = collectEndpoints(...sources.filter((source) => typeof source !== "string"))
    .filter(isUsableEndpoint);
  if (!endpoints.length) return null;
  return endpoints
    .map((endpoint) => ({ endpoint, score: scoreEndpoint(endpoint, maybeGoal) }))
    .sort((a, b) => b.score - a.score)[0].endpoint;
}

function isUsableEndpoint(endpoint) {
  if (!endpoint) return false;
  if (!endpoint.endpoint_id && !endpoint.url_template && !endpoint.url) return false;
  const url = String(endpoint.url_template || endpoint.url || "");
  const method = String(endpoint.method || "GET").toUpperCase();
  const haystack = `${url} ${endpoint.description || ""} ${endpoint.description_out || ""}`.toLowerCase();
  if (!["GET", "POST", "PUT", "PATCH", "HEAD"].includes(method)) return false;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|webmanifest)(\?|$)/i.test(url)) return false;
  if (/analytics|telemetry|segment|gtm|google-analytics|doubleclick|hotjar|sentry|log|beacon|pixel/i.test(haystack)) return false;
  if (/login|logout|auth|oauth|token|session|captcha|challenge/i.test(haystack) && !/quote|price|result|search|calculate|recommend/i.test(haystack)) return false;
  return true;
}

function scoreEndpoint(endpoint, goal) {
  const text = `${endpoint.method || ""} ${endpoint.url_template || endpoint.url || ""} ${endpoint.description_out || ""} ${endpoint.description || ""}`.toLowerCase();
  const goalTokens = new Set(String(goal || "").toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  let score = Number(endpoint.score || endpoint.rank_score || 0);
  if (String(endpoint.method || "").toUpperCase() === "POST") score += 8;
  if (/quote|price|premium|calculate|result|recommend|search|submit|plan|compare|eligib|score|rate/.test(text)) score += 20;
  if (/api|graphql|json|ajax|compute|estimate/.test(text)) score += 10;
  if (/page|html|asset|config|bootstrap|manifest|telemetry/.test(text)) score -= 15;
  for (const token of goalTokens) {
    if (text.includes(token)) score += 4;
  }
  return score;
}

function validateUnbrowseEndpointForSkill(endpoint, inputs, { url, goal } = {}) {
  const badInputs = inputs.filter(isGarbageUnbrowseInput);
  if (inputs.length && badInputs.length === inputs.length) {
    return {
      ok: false,
      reason: "Unbrowse exposed page-text option labels as endpoint parameters, not real user inputs. Falling back to browser/Codex recording.",
    };
  }

  if (inputs.length && badInputs.length / inputs.length >= 0.5 && looksLikeDomOptionEndpoint(endpoint)) {
    return {
      ok: false,
      reason: "Unbrowse returned a DOM option-list route with low-quality parameter names. Falling back to browser/Codex recording.",
    };
  }

  if (looksLikeDomOptionEndpoint(endpoint) && likelyInteractiveGoal(goal) && isSamePageGet(endpoint, url)) {
    return {
      ok: false,
      reason: "Unbrowse only produced a static DOM/page route for an interactive workflow. Falling back to browser/Codex recording.",
    };
  }

  return { ok: true };
}

function isGarbageUnbrowseInput(input) {
  const question = cleanText(input?.question || "");
  const param = cleanText(input?.unbrowseParam || input?.id || "");
  const numberCount = (question.match(/\b\d+\b/g) || []).length;
  if (!question || !param) return true;
  if (question.length > 180 || param.length > 180) return true;
  if (/^\[\]/.test(question) || /^\[\]/.test(param)) return true;
  if (numberCount > 12 && question.length > 80) return true;
  if (/course\s*code.*unit.*grade.*simulated\s*gpa/i.test(question)) return true;
  if (/please\s+add\s+courses\s+to\s+the\s+list/i.test(question)) return true;
  return false;
}

function looksLikeDomOptionEndpoint(endpoint) {
  const method = String(endpoint?.method || "GET").toUpperCase();
  const url = String(endpoint?.url_template || endpoint?.url || "");
  const text = cleanText(`${endpoint?.description || ""} ${endpoint?.description_out || ""}`).toLowerCase();
  if (method !== "GET") return false;
  if (/\/api\/|graphql|ajax|json|compute|calculate|quote|premium|price/i.test(url)) return false;
  return /returns?\s+(?:options|fields)|option-list|dom|page\s+text|course codeunitgrade|simulated gpa/.test(text);
}

function likelyInteractiveGoal(goal) {
  return /input|fill|submit|calculate|calculator|quote|price|premium|search|gpa|bmi|grade|form/i.test(String(goal || ""));
}

function isSamePageGet(endpoint, targetUrl) {
  if (String(endpoint?.method || "GET").toUpperCase() !== "GET") return false;
  try {
    const endpointUrl = new URL(endpoint.url_template || endpoint.url || "");
    const target = new URL(targetUrl || "");
    return endpointUrl.origin === target.origin && endpointUrl.pathname === target.pathname;
  } catch {
    return false;
  }
}

function inputSpecsFromEndpoint(endpoint) {
  const params = [];
  const seen = new Set();
  const add = (rawName, source = {}, fallbackValue) => {
    const name = paramName(rawName);
    if (!name || seen.has(name) || isTechnicalParamName(name)) return;
    seen.add(name);
    params.push({ name, source, fallbackValue });
  };

  for (const spec of endpoint.replay_contract?.parameter_specs || endpoint.contract?.parameter_specs || []) {
    if (spec && spec.userSupplied !== false) add(spec.name, spec, spec.defaultValue ?? spec.values?.[0]);
  }
  for (const spec of endpoint.semantic?.requires || endpoint.requires || []) {
    if (typeof spec === "string") add(spec, { required: true });
    else add(spec.key || spec.name, spec);
  }
  for (const spec of normalizeParamCollection(endpoint.needs_params || endpoint.input_params || endpoint.parameters || endpoint.params_schema)) {
    add(spec.name, spec, spec.default);
  }
  for (const name of templateNames(endpoint.url_template || endpoint.url || "")) {
    add(name, { required: true, source: "url_template" });
  }
  if (!params.length && endpoint.sample_values && typeof endpoint.sample_values === "object") {
    for (const [key, value] of Object.entries(endpoint.sample_values)) add(key, { required: false, source: "sample_values" }, value);
  }

  return params.map(({ name, source, fallbackValue }) => {
    const choices = choicesFromParamSpec(source);
    const type = choices.length ? "choice" : inferInputType(source, fallbackValue);
    return {
      id: slugify(name),
      unbrowseParam: name,
      question: questionFromParam(name, source),
      type,
      optional: source.required === false,
      ...(choices.length ? { choices } : {}),
      ...(fallbackValue !== undefined && fallbackValue !== null && fallbackValue !== "" && !isSensitiveParamName(name)
        ? { default: fallbackValue }
        : {}),
    };
  });
}

function normalizeParamCollection(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? { name: item } : item).filter(Boolean);
  }
  if (typeof value === "object") {
    if (value.properties && typeof value.properties === "object") {
      return Object.entries(value.properties).map(([name, spec]) => ({
        name,
        ...(spec && typeof spec === "object" ? spec : {}),
        required: Array.isArray(value.required) ? value.required.includes(name) : undefined,
      }));
    }
    return Object.entries(value).map(([name, spec]) => ({
      name,
      ...(spec && typeof spec === "object" && !Array.isArray(spec) ? spec : { default: spec }),
    }));
  }
  return [];
}

function choicesFromParamSpec(spec = {}) {
  const enumValues = spec.enum || spec.choices || spec.options || spec.constraints?.find?.((item) => item.kind === "enum")?.value;
  const values = Array.isArray(enumValues) ? enumValues : [];
  return values
    .map((item) => {
      if (item && typeof item === "object") {
        return {
          label: String(item.label ?? item.name ?? item.value),
          value: item.value ?? item.name ?? item.label,
        };
      }
      return { label: String(item), value: item };
    })
    .filter((choice, index, all) => choice.label && all.findIndex((item) => String(item.value) === String(choice.value)) === index)
    .slice(0, 50);
}

function inferInputType(spec = {}, fallbackValue) {
  const type = String(spec.type || spec.semantic_type || "").toLowerCase();
  if (/bool/.test(type) || typeof fallbackValue === "boolean") return "boolean";
  if (/number|integer|float|decimal/.test(type) || typeof fallbackValue === "number") return "number";
  if (/date/.test(type)) return "string";
  return "string";
}

function questionFromParam(name, spec = {}) {
  const explicit = spec.question || spec.prompt || spec.label || spec.description;
  if (explicit && String(explicit).length <= 120 && !isTechnicalParamName(explicit)) return cleanText(explicit);
  const semantic = String(spec.semantic_type || "").replace(/_/g, " ");
  const human = humanizeName(name);
  if (semantic && !/^(input|identifier|string|number|flag|resource|value)$/i.test(semantic)) {
    return `${human} (${semantic})`;
  }
  return human;
}

function resolveSkillId(...sources) {
  for (const source of sources) {
    const result = source?.result || source;
    const id = result?.skill_id || result?.skill?.skill_id || result?.result?.skill_id || result?.result?.skill?.skill_id;
    if (typeof id === "string" && id) return id;
  }
  return "";
}

function sessionBody(sessionId) {
  return sessionId ? { session_id: sessionId } : {};
}

async function localJson(baseUrl, method, pathName, body, timeoutMs) {
  const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, "")}${pathName}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, timeoutMs);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const message = json?.error || json?.message || text || `${response.status} ${response.statusText}`;
    throw new Error(`Unbrowse ${method} ${pathName} failed: ${message}`);
  }
  return json;
}

async function fetchLocalHealth(baseUrl, timeoutMs = 1000) {
  try {
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/+$/, "")}/health`, {}, timeoutMs);
    if (!response.ok) return { ok: false, error: `${response.status} ${response.statusText}` };
    const data = await response.json();
    if (data?.status !== "ok") return { ok: false, error: "Health response was not an Unbrowse runtime." };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function makeRemoteClient() {
  const { Unbrowse } = await import("unbrowse/sdk");
  return new Unbrowse({
    apiKey: process.env.UNBROWSE_API_KEY,
    baseURL: process.env.UNBROWSE_API_URL || process.env.UNBROWSE_BACKEND_URL,
    timeout: Number(process.env.UNBROWSE_API_TIMEOUT_MS || 60000),
  });
}

async function runUnbrowseCli(args, { timeoutMs = 30000, env = {} } = {}) {
  const cli = findUnbrowseCli();
  if (!cli) return { ok: false, code: 127, stdout: "", stderr: "Unbrowse CLI not found." };

  const run = spawnSync(cli, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    windowsHide: true,
    encoding: "utf8",
    timeout: timeoutMs,
  });
  const stdout = run.stdout || "";
  const stderr = run.stderr || "";
  let json = null;
  try {
    json = stdout.trim() ? JSON.parse(stdout.trim()) : null;
  } catch {
    json = null;
  }
  return {
    ok: run.status === 0 && !run.error,
    code: run.status,
    stdout,
    stderr: run.error?.code === "ETIMEDOUT"
      ? `${stderr}\nTimed out after ${timeoutMs}ms.`.trim()
      : stderr || run.error?.message || "",
    json,
  };
}

function cleanCliFailure(run) {
  return cleanText(run.stderr || run.stdout || run.json?.error || "");
}

function resolveUnbrowseRuntimeEntrypoint() {
  const local = path.join(process.cwd(), "node_modules", "unbrowse", "runtime", "cli.js");
  if (fs.existsSync(local)) return local;
  const packageRoot = path.dirname(path.dirname(findUnbrowseCli() || ""));
  const sibling = path.join(packageRoot, "unbrowse", "runtime", "cli.js");
  if (fs.existsSync(sibling)) return sibling;
  return "";
}

function normalizedBaseUrl() {
  return (process.env.UNBROWSE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function normalizeMode(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (["0", "false", "off", "disabled", "none"].includes(normalized)) return "off";
  if (["1", "true", "on", "enabled", "auto"].includes(normalized)) return normalized === "auto" ? "auto" : "on";
  return normalized;
}

function findUnbrowseCli() {
  const configured = process.env.UNBROWSE_CLI;
  if (configured && fs.existsSync(configured)) return configured;
  const extension = process.platform === "win32" ? ".cmd" : "";
  const local = path.join(process.cwd(), "node_modules", ".bin", `unbrowse${extension}`);
  if (fs.existsSync(local)) return local;
  const global = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["unbrowse"], { encoding: "utf8" });
  if (global.status === 0) return global.stdout.split(/\r?\n/).find(Boolean);
  return "";
}

function findBun() {
  const candidates = [
    process.env.UNBROWSE_BUN_BIN,
    "bun",
    path.join(process.env.USERPROFILE || process.env.HOME || "", ".bun", "bin", process.platform === "win32" ? "bun.exe" : "bun"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return { ok: true, path: candidate, version: cleanText(probe.stdout) };
  }
  return { ok: false, path: "", version: "" };
}

function paramName(value) {
  if (!value) return "";
  return String(value).replace(/^\{+|\}+$/g, "").trim();
}

function templateNames(value) {
  return [...String(value || "").matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

function isTechnicalParamName(value) {
  const raw = String(value || "");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalized) return true;
  if (["endpointid", "contexturl", "requestid", "traceid", "sessionid", "url", "method"].includes(normalized)) return true;
  return /viewstate|viewstategenerator|eventvalidation|eventtarget|eventargument|csrf|xsrf|token|cookie|nonce|captcha|turnstile|authorization|clientsecret|clientid|apikey|auth|signature|timestamp|correlation|visitor|fingerprint/.test(normalized);
}

function isSensitiveParamName(value) {
  return /password|secret|token|cookie|auth|key|signature|csrf|xsrf/i.test(String(value || ""));
}

function slugify(value) {
  return String(value || "skill")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "skill";
}

function humanizeName(value) {
  return cleanText(String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()));
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function lowercaseFirst(value) {
  const text = cleanText(value);
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : "";
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  if (numeric > 1) return Math.min(1, numeric / 100);
  return Math.max(0, Math.min(1, numeric));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
