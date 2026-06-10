import fs from "node:fs/promises";
import path from "node:path";
import { CdpClient, getPageTarget, launchChrome, sleep } from "./cdp.js";
import { getPath } from "./json-path.js";
import { applyComputedInputs, renderTemplate } from "./templates.js";
import { executeUnbrowseSkill } from "./unbrowse-adapter.js";

export async function loadSkills(skillsDir = "skills") {
  const files = await fs.readdir(skillsDir).catch(() => []);
  const skills = [];
  for (const file of files.filter((name) => name.endsWith(".json") && !name.endsWith(".draft.json"))) {
    const fullPath = path.join(skillsDir, file);
    const skill = JSON.parse(await fs.readFile(fullPath, "utf8"));
    skill.__path = fullPath;
    skills.push(skill);
  }
  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export async function loadSkill(skillId, skillsDir = "skills") {
  const skills = await loadSkills(skillsDir);
  const skill = skills.find((candidate) => candidate.id === skillId);
  if (!skill) throw new Error(`Skill not found: ${skillId}`);
  return skill;
}

export async function runSkill(skill, rawInputs, options = {}) {
  const context = applyComputedInputs(skill, normalizeInputs(skill, rawInputs), options.now || new Date());
  if (skill.provider === "unbrowse" || skill.unbrowse) {
    return runUnbrowseBackedSkill(skill, context);
  }
  await prepareProviderInputs(skill, context);
  const cookieJar = new CookieJar();
  const responses = {};
  const saved = {};

  for (const step of skill.steps || []) {
    if (step.when && !context[step.when]) continue;

    if (step.browserWorkflow) {
      const workflow = renderTemplate(step.browserWorkflow, { ...context, ...saved });
      const responseRecord = await runBrowserWorkflowStep(skill, step, workflow);
      responses[step.id] = responseRecord;
      if (!responseRecord.ok && step.failOnError !== false) {
        const error = new Error(`Step ${step.id} failed: ${responseRecord.status} ${responseRecord.statusText || ""}`.trim());
        error.response = responseRecord;
        throw error;
      }
      continue;
    }

    const request = materializeRequest(renderTemplate(step.request, { ...context, ...saved }));
    request.headers = request.headers || {};
    if (step.useCookieJar) {
      const cookieHeader = cookieJar.headerFor(request.url);
      if (cookieHeader) request.headers.cookie = cookieHeader;
    }

    let responseRecord;
    if (step.browserMode === "navigate") {
      responseRecord = await fetchStepRequestInBrowser(skill, step, request);
    } else {
      responseRecord = await fetchStepRequest(step, request, cookieJar);
      if (!responseRecord.ok && shouldUseBrowserFallback(skill, step, responseRecord)) {
        responseRecord = await fetchStepRequestInBrowser(skill, step, request);
      }
    }

    responses[step.id] = responseRecord;

    if (!responseRecord.ok && step.failOnError !== false) {
      const statusText = responseRecord.statusText || "";
      const error = new Error(`Step ${step.id} failed: ${responseRecord.status} ${statusText}`.trim());
      error.response = responses[step.id];
      throw error;
    }

    if (step.save?.bodyText) {
      saved[step.save.bodyText] = responseRecord.text;
    }
    for (const [name, sourcePath] of Object.entries(step.save?.json || {})) {
      saved[name] = firstResolvedJsonPath(responseRecord.json, sourcePath);
    }
  }

  return {
    skillId: skill.id,
    inputs: context,
    responses,
    saved,
    summary: summarize(skill, responses),
  };
}

async function runUnbrowseBackedSkill(skill, context) {
  const params = {};
  for (const input of skill.inputs || []) {
    if (context[input.id] === undefined) continue;
    params[input.unbrowseParam || input.id] = context[input.id];
  }

  const executed = await executeUnbrowseSkill(skill, params);
  const responseRecord = makeResponseRecord({
    id: "goal",
    request: executed.request,
    status: statusCodeFromUnbrowse(executed.result),
    statusText: executed.result?.trace?.success === false ? "Unbrowse execution failed" : "OK",
    ok: unbrowseResultOk(executed.result),
    ms: executed.ms,
    headers: { "content-type": "application/json" },
    text: JSON.stringify(executed.result ?? null),
  });
  responseRecord.json = executed.result;

  if (!responseRecord.ok) {
    const error = new Error(`Step goal failed: ${responseRecord.status} ${responseRecord.statusText}`.trim());
    error.response = responseRecord;
    throw error;
  }

  const responses = { goal: responseRecord };
  return {
    skillId: skill.id,
    inputs: context,
    responses,
    saved: {},
    summary: summarize(skill, responses),
  };
}

function unbrowseResultOk(result) {
  if (!result) return false;
  if (result.success === true) return true;
  if (result.trace?.success === true) return true;
  if (result.status === "ok") return true;
  if (result.result?.error || result.error) return false;
  return result.trace?.success !== false;
}

function statusCodeFromUnbrowse(result) {
  return result?.status_code || result?.trace?.status_code || (unbrowseResultOk(result) ? 200 : 500);
}

function firstResolvedJsonPath(json, sourcePath) {
  if (!Array.isArray(sourcePath)) return getPath(json, sourcePath);
  for (const pathExpression of sourcePath) {
    const value = getPath(json, pathExpression);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

async function fetchStepRequest(step, request, cookieJar) {
  const method = request.method || "GET";
  const started = performance.now();
  const response = await fetch(request.url, {
    method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(method.toUpperCase()) || request.body === undefined
      ? undefined
      : typeof request.body === "string"
        ? request.body
        : JSON.stringify(request.body),
  });
  const text = await response.text();
  const ms = Math.round(performance.now() - started);

  cookieJar.addFromResponse(request.url, response);

  return makeResponseRecord({
    id: step.id,
    request,
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    ms,
    headers: Object.fromEntries(response.headers.entries()),
    text,
  });
}

function makeResponseRecord({ id, request, status, statusText = "", ok, ms, headers = {}, text = "" }) {
  let json = null;
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  if (contentType.includes("json")) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    id,
    request,
    status,
    statusText,
    ok,
    ms,
    headers,
    text,
    json,
  };
}

function shouldUseBrowserFallback(skill, step, responseRecord) {
  if ((responseRecord.request.method || "GET").toUpperCase() !== "GET") return false;
  if (step.browserFallback === false || skill.browserFallback === false) return false;
  if (step.browserFallback || skill.browserFallback) return true;
  return isBrowserChallenge(responseRecord);
}

function isBrowserChallenge(responseRecord) {
  const headers = normalizeHeaderKeys(responseRecord.headers || {});
  if (headers["cf-mitigated"] === "challenge") return true;
  if (responseRecord.status === 403 && /Just a moment|challenges\.cloudflare\.com|cf_chl/i.test(responseRecord.text || "")) {
    return true;
  }
  return false;
}

async function fetchStepRequestInBrowser(skill, step, request) {
  const fallback = typeof step.browserFallback === "object"
    ? step.browserFallback
    : typeof skill.browserFallback === "object"
      ? skill.browserFallback
      : {};
  const started = performance.now();
  const startUrl = fallback.startUrl || skill.sourceUrl || originFromUrl(request.url) || request.url;
  const { child, port } = launchChrome({
    url: "about:blank",
    headless: fallback.headless === true,
  });

  let client = null;
  try {
    const page = await getPageTarget(port);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Network.enable");
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    await navigateAndWait(client, startUrl, fallback.loadTimeoutMs || 30000);
    await waitForBrowserChallengeToSettle(client, fallback.challengeTimeoutMs || 30000);
    if (step.browserMode === "navigate" || fallback.mode === "navigate") {
      const rendered = await navigateRequestInBrowser(client, request, fallback.fetchTimeoutMs || 30000);
      return makeResponseRecord({
        id: step.id,
        request: { ...request, execution: "browser-navigate" },
        status: rendered.status,
        statusText: rendered.statusText,
        ok: rendered.ok,
        ms: Math.round(performance.now() - started),
        headers: rendered.headers,
        text: rendered.text,
      });
    }
    const browserResponse = await browserFetch(client, request, fallback.fetchTimeoutMs || 30000);

    return makeResponseRecord({
      id: step.id,
      request: { ...request, execution: "browser-fallback" },
      status: browserResponse.status,
      statusText: browserResponse.statusText,
      ok: browserResponse.ok,
      ms: Math.round(performance.now() - started),
      headers: browserResponse.headers,
      text: browserResponse.text,
    });
  } finally {
    client?.close();
    child.kill();
  }
}

async function navigateRequestInBrowser(client, request, timeoutMs) {
  await navigateAndWait(client, request.url, timeoutMs);
  await waitForStableBodyText(client, Math.min(timeoutMs, 5000));
  const rendered = await evaluateInBrowser(client, `(() => ({
    status: 200,
    statusText: "OK",
    ok: true,
    headers: {"content-type": "text/plain; charset=utf-8"},
    text: document.body ? document.body.innerText : document.documentElement.innerText,
    url: location.href,
    title: document.title
  }))()`);
  return rendered;
}

async function waitForStableBodyText(client, timeoutMs) {
  const started = Date.now();
  const deadline = Date.now() + timeoutMs;
  let previous = "";
  let stableCount = 0;
  while (Date.now() < deadline) {
    const current = await evaluateInBrowser(client, `(() => document.body ? document.body.innerText : document.documentElement.innerText)()`);
    if (current && current === previous) {
      stableCount += 1;
      if (stableCount >= 2 && Date.now() - started >= 1200) return;
    } else {
      stableCount = 0;
      previous = current || "";
    }
    await sleep(400);
  }
}

async function runBrowserWorkflowStep(skill, step, workflow) {
  const started = performance.now();
  const startUrl = workflow.startUrl || skill.sourceUrl;
  const { child, port } = launchChrome({
    url: "about:blank",
    headless: workflow.headless === true,
  });
  let client = null;
  try {
    const page = await getPageTarget(port);
    client = new CdpClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Network.enable");
    await client.send("Page.enable");
    await client.send("Runtime.enable");

    await navigateAndWait(client, startUrl, workflow.loadTimeoutMs || 30000);
    await sleep(workflow.initialWaitMs || 500);
    for (const action of workflow.actions || []) {
      await runBrowserWorkflowAction(client, action);
      await sleep(action.waitMs || workflow.actionWaitMs || 250);
    }
    await sleep(workflow.finalWaitMs || 750);
    const rendered = await evaluateInBrowser(client, `(() => ({
      text: document.body ? document.body.innerText : document.documentElement.innerText,
      url: location.href,
      title: document.title
    }))()`);
    return makeResponseRecord({
      id: step.id,
      request: {
        method: "BROWSER",
        url: rendered.url,
        execution: "browser-workflow",
      },
      status: 200,
      statusText: "OK",
      ok: true,
      ms: Math.round(performance.now() - started),
      headers: { "content-type": "text/plain; charset=utf-8" },
      text: rendered.text,
    });
  } finally {
    client?.close();
    child.kill();
  }
}

async function runBrowserWorkflowAction(client, action) {
  if (action.type === "fill") {
    await evaluateInBrowser(client, `(() => {
      const element = document.querySelector(${JSON.stringify(action.selector)});
      if (!element) throw new Error("Element not found: " + ${JSON.stringify(action.selector)});
      const value = ${JSON.stringify(action.value ?? "")};
      element.focus();
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    return;
  }

  if (action.type === "click") {
    await evaluateInBrowser(client, `(() => {
      const element = document.querySelector(${JSON.stringify(action.selector)});
      if (!element) throw new Error("Element not found: " + ${JSON.stringify(action.selector)});
      element.click();
      return true;
    })()`);
  }

  if (action.type === "clickChoice") {
    await evaluateInBrowser(client, `(() => {
      const value = ${JSON.stringify(action.value ?? "")};
      const choices = ${JSON.stringify(action.choices || [])};
      const match = choices.find((choice) =>
        String(choice.value ?? choice.label).toLowerCase() === String(value).toLowerCase() ||
        String(choice.label ?? choice.value).toLowerCase() === String(value).toLowerCase()
      );
      const selector = match?.selector || ${JSON.stringify(action.fallbackSelector || "")};
      const element = selector ? document.querySelector(selector) : null;
      if (!element) throw new Error("Choice element not found: " + value);
      element.click();
      return true;
    })()`);
  }
}

async function navigateAndWait(client, url, timeoutMs) {
  const loaded = waitForCdpEvent(client, "Page.loadEventFired", timeoutMs);
  await client.send("Page.navigate", { url });
  await loaded;
}

function waitForCdpEvent(client, method, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    client.on(method, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function waitForBrowserChallengeToSettle(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pageState = await evaluateInBrowser(client, `(() => ({
      title: document.title,
      text: document.body ? document.body.innerText.slice(0, 500) : "",
      hasChallengeScript: Boolean(document.querySelector('script[src*="challenge-platform"]'))
    }))()`);
    if (!/Just a moment/i.test(pageState.title || "") && !pageState.hasChallengeScript) return;
    await sleep(750);
  }
}

async function browserFetch(client, request, timeoutMs) {
  const expression = `fetch(${JSON.stringify(request.url)}, {
    method: ${JSON.stringify(request.method || "GET")},
    headers: ${JSON.stringify(browserSafeHeaders(request.headers || {}))},
    credentials: "include",
    referrer: ${JSON.stringify(request.headers?.Referer || request.headers?.referer || "")}
  }).then(async (response) => ({
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    headers: Object.fromEntries(response.headers.entries()),
    text: await response.text()
  })).catch((error) => ({ error: String(error && error.message ? error.message : error) }))`;
  const result = await Promise.race([
    evaluateInBrowser(client, expression),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Browser fallback fetch timed out.")), timeoutMs)),
  ]);
  if (result?.error) throw new Error(`Browser fallback fetch failed: ${result.error}`);
  return result;
}

async function evaluateInBrowser(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails) {
    throw new Error(result.result.exceptionDetails.text || "Browser evaluation failed.");
  }
  return result.result?.result?.value;
}

function browserSafeHeaders(headers) {
  const forbidden = new Set([
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "referer",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-user",
    "user-agent",
  ]);
  const safe = {};
  for (const [key, value] of Object.entries(headers)) {
    if (forbidden.has(key.toLowerCase())) continue;
    safe[key] = value;
  }
  return safe;
}

function normalizeHeaderKeys(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

function materializeRequest(request) {
  const url = new URL(request.url);
  const output = { ...request };

  if (request.query) {
    for (const [key, value] of Object.entries(request.query)) {
      appendQueryValue(url.searchParams, key, value);
    }
    delete output.query;
  }

  if (request.form) {
    output.body = formBody(request.form);
    delete output.form;
  }

  output.url = url.toString();
  return output;
}

function appendQueryValue(searchParams, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendQueryValue(searchParams, key, item);
    return;
  }
  searchParams.append(key, String(value));
}

function formBody(form) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form || {})) {
    appendFormValue(params, key, value);
  }
  return params.toString();
}

function appendFormValue(searchParams, key, value) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) appendFormValue(searchParams, key, item);
    return;
  }
  searchParams.append(key, String(value));
}

async function prepareProviderInputs(skill, context) {
  if (skill.provider === "tally") {
    await prepareTallyFileInputs(skill, context);
  }
}

async function prepareTallyFileInputs(skill, context) {
  const fileInputs = (skill.inputs || []).filter((input) => input.type === "file" && context[input.id]);
  if (!fileInputs.length) return;

  const formId = resolveTallyFormId(skill);
  if (!formId) throw new Error("Tally file upload needs providerConfig.formId or a forms/<id>/respond step URL.");

  for (const input of fileInputs) {
    context[input.id] = await uploadTallyAsset({
      skill,
      formId,
      input,
      value: context[input.id],
      respondentUuid: context.respondentUuid,
      submissionUuid: context.sessionUuid,
    });
  }
}

async function uploadTallyAsset({ skill, formId, input, value, respondentUuid, submissionUuid }) {
  const existingUpload = coerceExistingUpload(value);
  if (existingUpload) return existingUpload;

  if (typeof value !== "string") {
    throw new Error(`${input.question || input.id} must be a file path or a Tally upload object array.`);
  }

  const filePath = path.resolve(stripQuotes(value.trim()));
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error(`File not found for ${input.question || input.id}: ${filePath}`);

  const fileName = path.basename(filePath);
  const fileBytes = await fs.readFile(filePath);
  const mimeType = mimeTypeForPath(filePath);
  const uploadUrl = `https://api.tally.so/upload/${formId}/response-asset`;
  const blockGroupUuid = input.tally?.blockGroupUuid || input.blockGroupUuid;
  const metadata = { respondentUuid, submissionUuid, blockGroupUuid };

  const asset = fileBytes.length < 0x2000000
    ? await uploadSmallTallyAsset({ skill, uploadUrl, fileBytes, fileName, mimeType, metadata })
    : await uploadLargeTallyAsset({ skill, uploadUrl, fileBytes, fileName, mimeType, metadata });

  return Array.isArray(asset) ? asset : [asset];
}

async function uploadSmallTallyAsset({ skill, uploadUrl, fileBytes, fileName, mimeType, metadata }) {
  const form = new FormData();
  appendTallyUploadMetadata(form, metadata);
  form.append("asset", new Blob([fileBytes], { type: mimeType }), fileName);

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: tallyUploadHeaders(skill),
    body: form,
  });
  return parseTallyUploadResponse(response);
}

async function uploadLargeTallyAsset({ skill, uploadUrl, fileBytes, fileName, mimeType, metadata }) {
  const signedUrl = new URL(`${uploadUrl}/signed-url`);
  signedUrl.searchParams.set("fileType", mimeType);
  signedUrl.searchParams.set("fileName", fileName);
  signedUrl.searchParams.set("fileSize", String(fileBytes.length));
  if (metadata.blockGroupUuid) signedUrl.searchParams.set("blockGroupUuid", metadata.blockGroupUuid);

  const signedResponse = await fetch(signedUrl, {
    headers: tallyUploadHeaders(skill),
  });
  const signed = await parseTallyUploadResponse(signedResponse);

  const putResponse = await fetch(signed.signedUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: fileBytes,
  });
  if (!putResponse.ok) {
    throw new Error(`Tally signed upload failed: ${putResponse.status} ${putResponse.statusText} ${await putResponse.text()}`);
  }

  const completeResponse = await fetch(`${uploadUrl}/signed-url`, {
    method: "POST",
    headers: {
      ...tallyUploadHeaders(skill),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileId: signed.fileId,
      fileType: mimeType,
      fileName,
      fileSize: fileBytes.length,
      respondentUuid: metadata.respondentUuid,
      submissionUuid: metadata.submissionUuid,
      blockGroupUuid: metadata.blockGroupUuid,
    }),
  });
  return parseTallyUploadResponse(completeResponse);
}

async function parseTallyUploadResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`Tally file upload failed: ${response.status} ${response.statusText} ${text}`);
  }
  return json;
}

function appendTallyUploadMetadata(form, metadata) {
  if (metadata.respondentUuid) form.append("respondentUuid", metadata.respondentUuid);
  if (metadata.submissionUuid) form.append("submissionUuid", metadata.submissionUuid);
  if (metadata.blockGroupUuid) form.append("blockGroupUuid", metadata.blockGroupUuid);
}

function tallyUploadHeaders(skill) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "tally-version": "2025-01-15",
  };
  const origin = skill.providerConfig?.origin || originFromUrl(skill.sourceUrl);
  if (origin) {
    headers.origin = origin;
    headers.referer = skill.providerConfig?.referer || `${origin}/`;
  }
  return headers;
}

function resolveTallyFormId(skill) {
  if (skill.providerConfig?.formId) return skill.providerConfig.formId;
  for (const step of skill.steps || []) {
    const match = step.request?.url?.match(/\/forms\/([^/]+)\/respond/);
    if (match) return match[1];
  }
  return null;
}

function coerceExistingUpload(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!/^[{\[]/.test(trimmed)) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function mimeTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || "application/octet-stream";
}

export function normalizeInputs(skill, rawInputs) {
  const normalized = {};
  for (const input of skill.inputs || []) {
    const value = rawInputs[input.id] ?? input.default;
    if ((value === undefined || value === "") && input.optional) continue;
    if (input.type === "number" && value !== undefined && value !== "") {
      normalized[input.id] = Array.isArray(value) ? value.map((item) => Number(item)) : Number(value);
    } else if (input.type === "boolean") {
      normalized[input.id] = Array.isArray(value)
        ? value.map((item) => booleanValue(item))
        : booleanValue(value);
    } else {
      normalized[input.id] = value;
    }
  }
  for (const [key, value] of Object.entries(rawInputs)) {
    if (!(key in normalized)) normalized[key] = value;
  }
  return normalized;
}

function booleanValue(value) {
  return value === true || value === "true" || value === "yes" || value === "y";
}

function summarize(skill, responses) {
  if (skill.postProcess === "fwdTravelQuote") return summarizeFwdTravel(responses);
  if (skill.postProcess === "singlifeSimpleTerm") return summarizeSinglifeSimpleTerm(responses);

  const outputs = [];
  for (const output of skill.outputs || []) {
    const response = responses[output.from];
    const source = response?.json ?? response?.text;
    if (!response) continue;
    if (output.each) {
      const rows = getPath(source, output.each) || [];
      outputs.push({
        label: output.label,
        rows: rows.map((row) => {
          const mapped = {};
          for (const [field, fieldPath] of Object.entries(output.fields || {})) {
            mapped[field] = getPath(row, fieldPath);
          }
          return mapped;
        }),
      });
    } else {
      const value = getPath(source, output.path);
      outputs.push({
        label: output.label,
        value: formatOutputValue(value, response, output, skill),
      });
    }
  }
  return outputs;
}

function formatOutputValue(value, response, output, skill) {
  if (output.extractor === "important" || shouldCondenseOutput(value, response)) {
    return extractImportantOutput(value, response, output, skill);
  }
  return value;
}

function shouldCondenseOutput(value, response) {
  if (typeof value === "string") {
    return value.length > 1200 || /<html|<!doctype|<body|<table|<main|<section/i.test(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value).length > 2500;
  }
  const contentType = response?.headers?.["content-type"] || response?.headers?.["Content-Type"] || "";
  return /html|text\/plain/i.test(contentType) && typeof response?.text === "string" && response.text.length > 1200;
}

function extractImportantOutput(value, response, output, skill) {
  if (value && typeof value === "object") {
    return compactJsonResult(value);
  }

  const text = htmlToReadableText(String(value ?? response?.text ?? ""));
  if (!text) return "";

  const explicit = extractByOutputHints(text, output);
  if (explicit) return explicit;

  const domain = `${skill.name || ""} ${skill.description || ""} ${skill.sourceUrl || ""}`.toLowerCase();
  if (/bmi|body mass index/.test(domain) || /Calculated BMI Results/i.test(text)) {
    return extractBmiResult(text);
  }

  return extractResultSection(text);
}

function compactJsonResult(value) {
  const quoteSummary = compactQuotePlans(value);
  if (quoteSummary) return quoteSummary;

  const importantKeys = /success|message|error|errors|price|premium|quote|total|amount|cost|fare|result|score|status|category|plan|name|id|rate|discount|duration|distance|bmi|risk|range|benefit|coverage|limit|suminsured/i;
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(compactJsonResult);
  }
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (importantKeys.test(key)) {
      output[key] = compactJsonResult(child);
    }
  }
  if (Object.keys(output).length) return output;

  const entries = Object.entries(value).slice(0, 12);
  for (const [key, child] of entries) {
    if (child === null || ["string", "number", "boolean"].includes(typeof child)) output[key] = child;
  }
  return Object.keys(output).length ? output : value;
}

function compactQuotePlans(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const planRows = collectPlanRows(value);
  if (!planRows.length) return null;
  return {
    ...(Object.hasOwn(value, "success") ? { success: value.success } : {}),
    ...(value.message ? { message: value.message } : {}),
    plans: planRows.slice(0, 12).map(compactPlanRow),
  };
}

function collectPlanRows(value, rows = []) {
  if (!value || typeof value !== "object") return rows;
  if (Array.isArray(value)) {
    for (const item of value) collectPlanRows(item, rows);
    return rows;
  }

  if (Array.isArray(value.premiumDetails)) {
    rows.push(...value.premiumDetails);
  }
  if (Array.isArray(value.plans)) {
    rows.push(...value.plans);
  }
  if (Array.isArray(value.planDetails)) {
    rows.push(...value.planDetails);
  }

  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) && /premium|plan/i.test(key) && child.some(looksLikePlanRow)) {
      rows.push(...child);
    }
    if (child && typeof child === "object") collectPlanRows(child, rows);
  }
  return dedupePlanRows(rows);
}

function looksLikePlanRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).join(" ");
  return /productName|planName|productCode|planCode/i.test(keys) && /premium|amount|price|total|discount/i.test(keys);
}

function dedupePlanRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = [
      row?.productCode,
      row?.planCode,
      row?.productName,
      row?.planName,
    ].filter(Boolean).join("|");
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || planRowRichness(row) > planRowRichness(existing)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function planRowRichness(row) {
  if (!row || typeof row !== "object") return 0;
  let score = 0;
  for (const key of Object.keys(row)) {
    if (/premium|amount|discount|gst|benefit|coverage|limit|suminsured/i.test(key) && row[key] !== null && row[key] !== undefined) {
      score += Array.isArray(row[key]) ? row[key].length + 1 : 1;
    }
  }
  return score + Object.keys(row).length / 100;
}

function compactPlanRow(row) {
  const output = pickExisting(row, [
    "productName",
    "planName",
    "productCode",
    "planCode",
    "premiumAfterDiscountNoAddOn",
    "premiumBeforeDiscountNoAddOn",
    "premiumAfterDiscount",
    "premiumAfterDiscountGST",
    "premiumValueBeforeDiscountWithGst",
    "totalFinalPremium",
    "totalPremium",
    "grossPremium",
    "promoCodeDisAmount",
    "totalGst",
    "discount",
  ]);
  const benefits = collectBenefitRows(row).slice(0, 8).map((benefit) => pickExisting(benefit, [
    "benefitName",
    "name",
    "description",
    "sumInsured",
    "limit",
    "amount",
    "coverage",
  ]));
  if (benefits.length) output.benefits = benefits;
  return Object.keys(output).length ? output : compactJsonResult(row);
}

function collectBenefitRows(value, rows = []) {
  if (!value || typeof value !== "object") return rows;
  if (Array.isArray(value)) {
    for (const item of value) collectBenefitRows(item, rows);
    return rows;
  }
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child) && /benefit|coverage/i.test(key)) rows.push(...child.filter((item) => item && typeof item === "object"));
    else if (child && typeof child === "object") collectBenefitRows(child, rows);
  }
  return rows;
}

function pickExisting(source, keys) {
  const output = {};
  for (const key of keys) {
    if (source?.[key] !== undefined && source[key] !== null && source[key] !== "") output[key] = source[key];
  }
  return output;
}

function extractByOutputHints(text, output) {
  const focus = cleanText(output.focus || output.path || "");
  if (!focus || focus === "$") return null;
  if (focus.startsWith("regex:")) {
    return extractRegexFields(text, focus.slice("regex:".length));
  }
  const index = text.toLowerCase().indexOf(focus.toLowerCase());
  if (index === -1) return null;
  return text.slice(index, index + 900).replace(/\s+/g, " ").trim();
}

function extractRegexFields(text, pattern) {
  try {
    const regex = new RegExp(pattern, "is");
    const match = text.match(regex);
    if (!match) return null;
    if (match.groups) return { ...match.groups };
    if (match.length > 2) {
      return match.slice(1).reduce((acc, value, index) => {
        acc[`value${index + 1}`] = cleanText(value);
        return acc;
      }, {});
    }
    return cleanText(match[1] || match[0]);
  } catch {
    return null;
  }
}

function extractBmiResult(text) {
  const section = sliceAround(text, /Your Calculated BMI Results/i, /BMI Range Singapore|Calculate again|Please note/i, 1400);
  const resultText = section || text;
  const fields = {};

  assignMatch(fields, "height", resultText, /Height\s+([\d.]+\s*cm)/i);
  assignMatch(fields, "weight", resultText, /Weight\s+([\d.]+\s*kg)/i);
  assignMatch(fields, "bmi", resultText, /BMI\s+([\d.]+)/i);
  assignMatch(fields, "category", resultText, /Category\s+([A-Za-z ]+?)(?=\s+Risk|\s+Your Healthy|\s*$)/i);
  assignMatch(fields, "risk", resultText, /Risk of Heart Attack and Diabetes\s+([A-Za-z ]+?)(?=\s+Your Healthy|\s+Please note|\s*$)/i);
  assignMatch(fields, "healthyWeightRange", resultText, /Your Healthy Weight Range.*?(Between\s+[\d.]+\s*kg\s+and\s+[\d.]+\s*kg)/i);

  return Object.keys(fields).length ? fields : extractResultSection(text);
}

function assignMatch(target, key, text, regex) {
  const match = text.match(regex);
  if (match?.[1]) target[key] = cleanText(match[1]);
}

function extractResultSection(text) {
  const section = sliceAround(
    text,
    /(result|results|quote|price|premium|total|summary|score|category|status|eligibility|calculated|estimate)/i,
    /(please note|terms|privacy|faq|related|copyright|contact us|book appointment)/i,
    1200,
  );
  if (section) return section;

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(cleanText)
    .filter((sentence) => /(result|quote|price|premium|total|score|category|status|risk|range|eligible|approved|declined|estimated)/i.test(sentence))
    .slice(0, 6);
  if (sentences.length) return sentences.join(" ");

  return text.slice(0, 900).replace(/\s+/g, " ").trim();
}

function sliceAround(text, startPattern, endPattern, maxLength) {
  const startMatch = text.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return "";
  const start = startMatch.index;
  const rest = text.slice(start);
  const endMatch = rest.slice(60).match(endPattern);
  const end = endMatch?.index !== undefined ? 60 + endMatch.index : maxLength;
  return rest.slice(0, Math.min(end, maxLength)).replace(/\s+/g, " ").trim();
}

function htmlToReadableText(value) {
  return decodeHtml(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(tr|p|div|section|article|li|h[1-6]|table)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
  };
  return String(value || "").replace(/&(#x?[0-9a-f]+|\w+);/gi, (_, entity) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const codePoint = Number.parseInt(radix === 16 ? entity.slice(2) : entity.slice(1), radix);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    }
    return named[entity.toLowerCase()] ?? "";
  });
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function summarizeFwdTravel(responses) {
  const quote = responses.quickCompute?.json;
  const promo = responses.verifyPromoCode?.json;
  const plans = getPath(quote, "$.data.policyPlans") || [];
  const discountRows =
    getPath(promo, "$.data.layeredPromoCode.t2[0].additionalVoucherDiscount") ||
    getPath(promo, "$.data.additionalVoucherDiscount") ||
    [];

  return plans.map((plan) => {
    const discount = findDiscount(discountRows, plan.id);
    const discountRate = Number(discount?.finalPromoValue ?? discount?.promoPercentValue ?? 0);
    const discountedPremium = discountRate ? roundMoney(plan.grossPremium * (1 - discountRate)) : plan.grossPremium;
    return {
      plan: plan.name,
      code: plan.id,
      basePremium: plan.grossPremium,
      discountRate,
      discountedPremium,
    };
  });
}

function findDiscount(rows, planId) {
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => {
    const values = Object.values(row).map(String);
    return values.includes(planId);
  });
}

function summarizeSinglifeSimpleTerm(responses) {
  const data = responses.computePremium?.json?.data;
  const coverages = data?.coverages || [];
  return {
    totalPremium: data?.totalOriginalPremium,
    totalAfterDiscountPremium: data?.totalAfterDiscountPremium,
    totalAnnualizedPremium: data?.totalAnnualizedPremium,
    paymentModes: coverages.map((coverage) => ({
      id: coverage.id,
      name: coverage.name,
      annualPremium: coverage.attributes?.annualPremium,
      halfYearlyPremium: coverage.attributes?.halfYearlyPremium,
      quarterlyPremium: coverage.attributes?.quarterlyPremium,
      monthlyPremium: coverage.attributes?.monthlyPremium,
      modalPremium: coverage.attributes?.modalPremium,
    })),
  };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

const MIME_TYPES = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  addFromResponse(_url, response) {
    const setCookies = response.headers.getSetCookie?.() || splitSetCookie(response.headers.get("set-cookie"));
    for (const setCookie of setCookies) {
      const [pair] = setCookie.split(";");
      const separator = pair.indexOf("=");
      if (separator === -1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  headerFor() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g);
}
