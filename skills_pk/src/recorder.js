import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CdpClient, getPageTarget, launchChrome, sleep } from "./cdp.js";
import { flattenScalars } from "./json-path.js";
import { hasKuriExecutable, startKuriBroker } from "./kuri.js";
import { collectPlaywrightEvidence } from "./playwright-evidence.js";
import {
  analyzeRecordingWithLlm,
  applyLlmAnalysisToSkill,
  llmAnalysisStatus,
  orderCandidatesByAnalysis,
} from "./llm-analyzer.js";

const ANALYTICS_HOST_PATTERNS = [
  "google",
  "doubleclick",
  "googletagmanager",
  "adobedtm",
  "demdex",
  "smetrics",
  "nr-data",
  "newrelic",
  "outbrain",
  "facebook",
  "hotjar",
  "clarity",
  "sentry",
  "plausible",
  "posthog",
  "segment",
  "amplitude",
  "mixpanel",
  "fullstory",
  "logrocket",
  "elfsight",
  "ads.linkedin",
  "adroll",
  "analytics.google",
  "google-analytics",
  "analytics.twitter",
  "tiktok",
  "snap",
  "fontawesome",
];

const GOAL_WORDS = [
  "submit",
  "respond",
  "response",
  "apply",
  "application",
  "resume",
  "quote",
  "price",
  "premium",
  "compute",
  "calculate",
  "fare",
  "search",
  "route",
  "availability",
  "checkout",
  "eligibility",
  "validate",
];

const TELEMETRY_PATH_PATTERNS = [
  "/envelope",
  "/events",
  "/event",
  "/track",
  "/collect",
  "/analytics",
  "/client_report",
  "/rum",
  "/challenge-platform",
  "/p/boot/",
  "/wa/",
  "/i/v0/e",
  "/g/collect",
  "/listing_ads/",
  "/adsct",
  "/onp/",
  "/pex/",
  "/attribution_trigger",
  "/tr/",
];

const GOAL_PATH_PATTERNS = [
  "/respond",
  "/submit",
  "/apply",
  "/application",
  "/quote",
  "/compute",
  "/calculate",
  "/price",
  "/premium",
  "/search",
  "/checkout",
];

const TECHNICAL_FIELD_PATTERNS = [
  /^__.+$/i,
  /^_+(?:method|token|csrf|xsrf)$/i,
  /^viewstate(?:generator)?$/i,
  /^eventvalidation$/i,
  /^eventtarget$/i,
  /^eventargument$/i,
  /^lastfocus$/i,
  /csrf/i,
  /xsrf/i,
  /anti[-_]?forgery/i,
  /authenticity[_-]?token/i,
  /requestverificationtoken/i,
  /verificationtoken/i,
  /captcha/i,
  /recaptcha/i,
  /turnstile/i,
  /nonce/i,
  /(?:session|respondent|blockgroup|request|visitor|client|correlation|interaction).*(?:uuid|id|token|key)/i,
  /(?:uuid|id|token|key).*(?:session|respondent|blockgroup|request|visitor|client|correlation|interaction)/i,
  /respondentuuid/i,
  /blockgroupuuid/i,
  /fingerprint/i,
  /trace/i,
];

const NON_USER_CONTROL_PATTERNS = [
  /(?:^|[_-])submit(?:$|[_-])/i,
  /(?:^|[_-])button(?:$|[_-])/i,
  /(?:^|[_-])btn(?:$|[_-])/i,
  /(?:^|[_-])but(?:$|[_-])/i,
  /(?:^|[_-])action(?:$|[_-])/i,
  /(?:^|[_-])command(?:$|[_-])/i,
  /(?:^|[_-])event(?:$|[_-])/i,
  /^gen(?:erated)?[_-].*(?:num|count|index)$/i,
];

const REPEATABLE_GROUP_KEYS = [
  "module",
  "mod",
  "course",
  "subject",
  "item",
  "traveller",
  "traveler",
  "passenger",
  "person",
  "member",
  "dependent",
  "applicant",
  "child",
  "row",
];

export async function recordWorkflow({ url, name, goal, headless = false, waitForDone } = {}) {
  const engine = String(process.env.SKILL_BUILDER_BROWSER_ENGINE || process.env.SKILL_BUILDER_RECORDER_ENGINE || "auto").toLowerCase();
  if (engine !== "cdp" && (engine === "kuri" || (engine === "auto" && hasKuriExecutable()))) {
    try {
      return await recordWorkflowWithKuri({ url, name, goal, headless, waitForDone });
    } catch (error) {
      if (engine === "kuri") throw error;
      console.warn(`Kuri recorder unavailable; falling back to Chrome CDP recorder: ${error.message}`);
    }
  }
  return recordWorkflowWithCdp({ url, name, goal, headless, waitForDone });
}

async function recordWorkflowWithCdp({ url, name, goal, headless = false, waitForDone } = {}) {
  const { child, port, profileDir } = launchChrome({ url, headless });
  console.log(`Chrome launched on debug port ${port}.`);
  console.log(`Profile: ${profileDir}`);

  const page = await getPageTarget(port);
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();

  const requests = new Map();
  client.on("Network.requestWillBeSent", (params) => {
    const request = params.request;
    requests.set(params.requestId, {
      id: params.requestId,
      method: request.method,
      url: request.url,
      requestHeaders: request.headers,
      postData: request.postData,
      resourceType: params.type,
      startedAt: params.wallTime,
      cdpStartedAt: params.timestamp,
      initiator: params.initiator,
    });
  });
  client.on("Network.responseReceived", (params) => {
    const item = requests.get(params.requestId) || { id: params.requestId };
    item.status = params.response.status;
    item.statusText = params.response.statusText;
    item.mimeType = params.response.mimeType;
    item.responseHeaders = params.response.headers;
    item.cdpResponseAt = params.timestamp;
    requests.set(params.requestId, item);
  });
  client.on("Network.loadingFinished", (params) => {
    const item = requests.get(params.requestId);
    if (!item) return;
    item.cdpFinishedAt = params.timestamp;
    item.encodedDataLength = params.encodedDataLength;
  });
  client.on("Network.loadingFailed", (params) => {
    const item = requests.get(params.requestId) || { id: params.requestId };
    item.failed = true;
    item.errorText = params.errorText;
    requests.set(params.requestId, item);
  });

  await client.send("Network.enable");
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await installInteractionRecorder(client).catch(() => {});

  console.log("");
  console.log("Complete the target workflow in Chrome.");
  console.log("When the final result/quote is visible, come back here and press Enter.");
  if (waitForDone) {
    await waitForDone();
  } else {
    const rl = readline.createInterface({ input, output });
    await rl.question("Press Enter when done...");
    rl.close();
  }
  await sleep(500);
  const [pageFields, playwrightEvidence] = await Promise.all([
    collectPageFields(client).catch((error) => ({
      error: error.message,
      fields: [],
    })),
    collectPlaywrightEvidence({ port }).catch((error) => ({
      enabled: false,
      error: error.message,
    })),
  ]);

  const allRequests = [...requests.values()].map((request) => ({
    ...request,
    durationMs: request.cdpFinishedAt && request.cdpStartedAt
      ? Math.round((request.cdpFinishedAt - request.cdpStartedAt) * 1000)
      : undefined,
  }));
  let candidates = rankCandidates(allRequests, goal);
  await attachCandidateResponseBodies(client, allRequests, candidates).catch(() => {});
  candidates = rankCandidates(allRequests, goal);
  const recording = {
    url,
    name,
    goal,
    recordedAt: new Date().toISOString(),
    pageFields,
    playwright: playwrightEvidence,
    requests: allRequests,
    candidates,
  };

  await fs.mkdir("recordings", { recursive: true });
  const safeName = slugify(name || new URL(url).hostname);
  const file = path.join("recordings", `${safeName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.writeFile(file, JSON.stringify(recording, null, 2));

  client.close();
  child.kill();
  return { file, recording };
}

async function recordWorkflowWithKuri({ url, name, goal, headless = false, waitForDone } = {}) {
  const chrome = launchChrome({ url, headless });
  console.log(`Chrome launched on debug port ${chrome.port}.`);
  console.log(`Profile: ${chrome.profileDir}`);

  const page = await getPageTarget(chrome.port);
  const broker = await startKuriBroker({
    headless,
    cdpUrl: `http://127.0.0.1:${chrome.port}/json/version`,
  });
  console.log(`Kuri launched on broker port ${broker.port}.`);
  console.log(`Browser engine: Chrome + Kuri attached recorder.`);
  console.log(`State: ${broker.stateDir}`);

  let tabId = "";
  try {
    await broker.discover(chrome.port);
    tabId = await findKuriTabIdForUrl(broker, page.id, url);
    if (!tabId) throw new Error(`Kuri could not attach to the Chrome tab for ${url}.`);
    const confirmedUrl = await broker.currentUrl(tabId).catch(() => "");
    if (!confirmedUrl || confirmedUrl === "about:blank") {
      throw new Error(`Chrome opened a blank tab instead of ${url}.`);
    }
    await broker.networkEnable(tabId).catch(() => {});
    await broker.harStart(tabId).catch(() => {});
    await broker.addInitScript(tabId, INTERACTION_RECORDER_SCRIPT).catch(() => {});
    await broker.injectScript(tabId, INTERACTION_RECORDER_SCRIPT).catch(() => {});

    console.log("");
    console.log("Complete the target workflow in the Kuri-controlled Chrome window.");
    console.log("When the final result/quote is visible, come back here and press Enter.");
    if (waitForDone) {
      await waitForDone();
    } else {
      const rl = readline.createInterface({ input, output });
      await rl.question("Press Enter when done...");
      rl.close();
    }
    await sleep(700);

    const pageFields = await collectPageFields(kuriRuntimeClient(broker, tabId)).catch((error) => ({
      error: error.message,
      fields: [],
    }));
    const [har, text, markdown, snapshot, finalUrl] = await Promise.all([
      broker.harStop(tabId).catch((error) => ({ entries: [], error: error.message })),
      broker.text(tabId).catch(() => ""),
      broker.markdown(tabId).catch(() => ""),
      broker.snapshot(tabId).catch(() => ""),
      broker.currentUrl(tabId).catch(() => ""),
    ]);

    const allRequests = requestsFromKuriHar(har.entries || []);
    let candidates = rankCandidates(allRequests, goal);
    const recording = {
      url,
      name,
      goal,
      recordedAt: new Date().toISOString(),
      browserEngine: "kuri",
      pageFields: {
        ...pageFields,
        url: pageFields.url || finalUrl || url,
        text: pageFields.text || String(text || "").slice(0, 5000),
      },
      kuri: {
        brokerPort: broker.port,
        tabId,
        textPreview: String(text || "").slice(0, 5000),
        markdownPreview: String(markdown || "").slice(0, 8000),
        snapshotPreview: String(snapshot || "").slice(0, 8000),
        harEntryCount: har.entries?.length || 0,
        harError: har.error || "",
      },
      playwright: {
        enabled: false,
        skipped: true,
        reason: "Kuri is the browser recorder for this run; Playwright evidence is only used by the legacy CDP backend.",
      },
      requests: allRequests,
      candidates,
    };

    await fs.mkdir("recordings", { recursive: true });
    const safeName = slugify(name || new URL(url).hostname);
    const file = path.join("recordings", `${safeName}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.writeFile(file, JSON.stringify(recording, null, 2));

    return { file, recording };
  } finally {
    if (tabId) await broker.closeTab(tabId).catch(() => {});
    await broker.stop();
    chrome.child.kill();
  }
}

async function findKuriTabIdForUrl(broker, chromeTargetId, requestedUrl) {
  const requested = safeUrl(requestedUrl);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const tabs = await broker.tabs().catch(() => []);
    const exactId = tabs.find((tab) => tab?.id === chromeTargetId);
    if (exactId?.id) return exactId.id;
    const matchingUrl = tabs.find((tab) => {
      const tabUrl = safeUrl(tab?.url || "");
      return tabUrl.href === requested.href
        || (tabUrl.hostname === requested.hostname && tabUrl.pathname === requested.pathname)
        || (tabUrl.hostname === requested.hostname && !/^about:blank$/i.test(tab?.url || ""));
    });
    if (matchingUrl?.id) return matchingUrl.id;
    await broker.discover().catch(() => null);
    await sleep(250);
  }
  return "";
}

function kuriRuntimeClient(broker, tabId) {
  return {
    async send(method, params = {}) {
      if (method !== "Runtime.evaluate") {
        return { result: { result: { value: null } } };
      }
      const value = await broker.evaluate(tabId, params.expression || "");
      return { result: { result: { value } } };
    },
  };
}

function requestsFromKuriHar(entries) {
  return (entries || []).map((entry, index) => {
    const requestHeaders = headersArrayToObject(entry.request?.headers || []);
    const responseHeaders = headersArrayToObject(entry.response?.headers || []);
    const responseContent = entry.response?.content || {};
    const startedAt = parseHarStartedAt(entry.startedDateTime);
    return {
      id: `kuri.${index + 1}`,
      method: entry.request?.method || "GET",
      url: entry.request?.url || "",
      requestHeaders,
      postData: entry.request?.postData?.text || "",
      resourceType: inferHarResourceType(entry),
      startedAt,
      status: entry.response?.status,
      statusText: entry.response?.statusText || "",
      mimeType: responseContent.mimeType || responseHeaders["content-type"] || "",
      responseHeaders,
      durationMs: typeof entry.time === "number" ? Math.max(0, Math.round(entry.time)) : undefined,
      encodedDataLength: entry.response?.bodySize,
      responseBodyPreview: typeof responseContent.text === "string" ? responseContent.text.slice(0, 5000) : undefined,
    };
  });
}

function headersArrayToObject(headers) {
  if (!Array.isArray(headers)) return {};
  const output = {};
  for (const header of headers) {
    if (!header?.name) continue;
    output[header.name] = header.value ?? "";
  }
  return output;
}

function parseHarStartedAt(value) {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

function inferHarResourceType(entry) {
  const mime = String(entry.response?.content?.mimeType || "").toLowerCase();
  const url = safeUrl(entry.request?.url || "");
  if (mime.includes("json") || /\/api\/|graphql|quote|price|search|calculate/i.test(url.pathname)) return "Fetch";
  if (mime.includes("html")) return "Document";
  if (mime.includes("javascript")) return "Script";
  if (mime.includes("css")) return "Stylesheet";
  if (mime.startsWith("image/")) return "Image";
  if (mime.includes("font")) return "Font";
  return "Fetch";
}

export function rankCandidates(requests, goal = "") {
  const goalTerms = `${goal} ${GOAL_WORDS.join(" ")}`.toLowerCase().split(/\s+/).filter(Boolean);
  return requests
    .filter((request) => {
      if (!request?.method || !request.url) return false;
      const url = safeUrl(request.url);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      const haystack = `${url.hostname} ${url.pathname}`.toLowerCase();
      if (ANALYTICS_HOST_PATTERNS.some((pattern) => url.hostname.includes(pattern))) return false;
      if (TELEMETRY_PATH_PATTERNS.some((pattern) => haystack.includes(pattern))) return false;
      if (["Script", "Image", "Stylesheet", "Font", "Manifest", "Media"].includes(request.resourceType)) return false;
      if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|webmanifest)(\?|$)/i.test(url.pathname)) return false;
      return true;
    })
    .map((request) => {
      const url = safeUrl(request.url);
      let score = 0;
      if (["POST", "PUT", "PATCH"].includes(request.method)) score += 40;
      if (["XHR", "Fetch"].includes(request.resourceType)) score += 35;
      if (request.postData) score += 20;
      if (request.method === "GET" && url.search && ["XHR", "Fetch", "Document"].includes(request.resourceType)) score += 25;
      if ((request.mimeType || "").includes("json")) score += 20;
      if (request.status >= 200 && request.status < 300) score += 10;
      if (request.durationMs !== undefined && request.durationMs < 3000) score += 5;

      const haystack = `${url.pathname} ${url.search}`.toLowerCase();
      for (const term of goalTerms) {
        if (term.length > 2 && haystack.includes(term)) score += 10;
      }

      const postData = request.postData || "";
      if (ANALYTICS_HOST_PATTERNS.some((pattern) => url.hostname.includes(pattern))) score -= 100;
      if (TELEMETRY_PATH_PATTERNS.some((pattern) => haystack.includes(pattern))) score -= 120;
      if (GOAL_PATH_PATTERNS.some((pattern) => haystack.includes(pattern))) score += 35;
      if (/form|responses?|answers?|application|resume/i.test(postData)) score += 15;
      if (/sentry|client_report|FORM_VIEW|FORM_START|QUESTION_DROP_OFF|pageview/i.test(postData)) score -= 70;
      if (["Script", "Image", "Stylesheet", "Font"].includes(request.resourceType)) score -= 40;
      if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico)(\?|$)/i.test(url.pathname)) score -= 40;
      if (request.failed) score -= 20;

      return {
        id: request.id,
        score,
        method: request.method,
        url: request.url,
        status: request.status,
        resourceType: request.resourceType,
        durationMs: request.durationMs,
        mimeType: request.mimeType,
        hasPostData: Boolean(request.postData),
        postDataPreview: request.postData?.slice(0, 500),
        responseBodyPreview: request.responseBodyPreview?.slice(0, 1000),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 25);
}

async function attachCandidateResponseBodies(client, requests, candidates) {
  const byId = new Map(requests.map((request) => [request.id, request]));
  for (const candidate of candidates.slice(0, 12)) {
    const request = byId.get(candidate.id);
    if (!request || request.failed) continue;
    if (!["XHR", "Fetch", "Document"].includes(request.resourceType)) continue;
    const body = await client.send("Network.getResponseBody", { requestId: candidate.id }).catch(() => null);
    if (!body || body.base64Encoded) continue;
    request.responseBodyPreview = String(body.body || "").slice(0, 5000);
  }
}

export async function inspectRecording(file) {
  const recording = JSON.parse(await fs.readFile(file, "utf8"));
  return rankCandidates(recording.requests || [], recording.goal);
}

export async function analyzeRecordingFile(file) {
  const recording = JSON.parse(await fs.readFile(file, "utf8"));
  const candidates = rankCandidates(recording.requests || [], recording.goal);
  return analyzeRecordingWithLlm(recording, candidates);
}

export { llmAnalysisStatus };

export async function createDraftSkillFromRecording({ recordingFile, candidateIndex, name }) {
  const recording = JSON.parse(await fs.readFile(recordingFile, "utf8"));
  const candidates = rankCandidates(recording.requests || [], recording.goal);
  const analysis = await safeAnalyzeRecording(recording, candidates);
  const skippedDraftWarnings = [];

  const preferredFallback = await createPreferredFallbackSkill({ recording, recordingFile, name, analysis });
  if (preferredFallback) return writeDraftSkill(finalizeSkill(preferredFallback, { analysis, recordingFile, recording }));

  const requestedCandidate = Number.isInteger(candidateIndex) ? candidates[candidateIndex] : null;
  const orderedCandidates = orderCandidatesByAnalysis([
    requestedCandidate,
    ...candidates.filter((candidate) => candidate?.id !== requestedCandidate?.id),
  ].filter(Boolean), analysis);

  for (const candidate of orderedCandidates) {
    const request = recording.requests.find((item) => item.id === candidate.id);
    if (!request || !isDraftWorthyRequest(request)) continue;

    const skill = await createSkillForRequest({ recording, request, recordingFile, name, analysis });
    if (skill) {
      const finalized = finalizeSkill(skill, { analysis, recordingFile, recording });
      const quality = assessDraftQuality(finalized, recording);
      if (!quality.ok) {
        skippedDraftWarnings.push(quality.reason);
        continue;
      }
      return writeDraftSkill(finalized);
    }
  }

  const fallbackSkill =
    await maybeCreateFinalUrlQuerySkill({ recording, recordingFile, name }) ||
    await maybeCreateBrowserReplaySkill({ recording, recordingFile, name, analysis });

  if (fallbackSkill) {
    const finalizedFallback = finalizeSkill(fallbackSkill, { analysis, recordingFile, recording });
    if (skippedDraftWarnings.length) {
      finalizedFallback.learning = {
        ...(finalizedFallback.learning || {}),
        replayWarnings: [
          ...new Set([
            ...(finalizedFallback.learning?.replayWarnings || []),
            ...skippedDraftWarnings,
          ]),
        ],
      };
    }
    return writeDraftSkill(finalizedFallback);
  }

  throw new Error("No reusable API endpoint, result URL, or browser input workflow was detected. Record the workflow again after interacting with the actual form/result controls.");
}

function assessDraftQuality(skill, recording) {
  const visibleInputs = (skill.inputs || []).filter((inputSpec) => !isTechnicalInputSpec(inputSpec));
  if (isApiOnlySkill(skill) && hasRecordedPromptableInteractions(recording) && !visibleInputs.length) {
    return {
      ok: false,
      reason: "Skipped an API candidate because the recording contained visible form interactions, but the generated API skill had zero user-facing inputs. The learner will try another endpoint or browser replay instead of saving a misleading no-input skill.",
    };
  }
  return { ok: true };
}

function isApiOnlySkill(skill) {
  const steps = skill.steps || [];
  if (!steps.length) return false;
  if (steps.some((step) => step.browserWorkflow || step.browserMode)) return false;
  return steps.some((step) => step.request);
}

async function safeAnalyzeRecording(recording, candidates) {
  const status = llmAnalysisStatus();
  if (!status.enabled) return null;
  try {
    const analysis = await analyzeRecordingWithLlm(recording, candidates);
    validateAnalyzerResult(analysis, status);
    return analysis;
  } catch (error) {
    if (analysisRequired()) throw error;
    console.warn(`LLM contextual analysis skipped: ${error.message}`);
    return null;
  }
}

function validateAnalyzerResult(analysis, status) {
  if (!analysisRequired() || !analysis) return;
  const threshold = Number(process.env.SKILL_BUILDER_ANALYSIS_MIN_CONFIDENCE || (status.provider === "codex" ? 0.65 : 0));
  if (threshold > 0 && Number(analysis.confidence || 0) < threshold) {
    throw new Error(`Analyzer confidence ${analysis.confidence} is below required threshold ${threshold}. Re-record the workflow or inspect the draft manually.`);
  }
  if (analysis.strategy?.kind === "manual_review") {
    throw new Error("Analyzer requested manual_review, so the skill was not auto-drafted.");
  }
}

function analysisRequired() {
  return process.env.SKILL_BUILDER_LLM_REQUIRED === "1"
    || process.env.SKILL_BUILDER_CODEX_REQUIRED === "1"
    || process.env.SKILL_BUILDER_ANALYZER_REQUIRED === "1";
}

async function createPreferredFallbackSkill({ recording, recordingFile, name, analysis }) {
  const kind = analysis?.strategy?.kind;
  if (kind === "browser_result_url") {
    return maybeCreateFinalUrlQuerySkill({ recording, recordingFile, name });
  }
  if (kind === "browser_replay") {
    return maybeCreateBrowserReplaySkill({ recording, recordingFile, name, analysis });
  }
  return null;
}

async function writeDraftSkill(skill) {
  await fs.mkdir("skills", { recursive: true });
  const file = path.join("skills", `${skill.id}.draft.json`);
  await fs.writeFile(file, JSON.stringify(skill, null, 2));
  return file;
}

function finalizeSkill(skill, { analysis, recordingFile, recording }) {
  const withMetadata = {
    ...skill,
    learning: {
      strategy: {
        kind: inferSkillStrategy(skill),
        rationale: "Selected by deterministic recorder evidence.",
      },
      recordingFile,
      llm: analysis ? "used" : "not-used",
      ...(skill.learning || {}),
    },
  };
  return ensureConversationMetadata(applyLlmAnalysisToSkill(withMetadata, analysis), recording, analysis);
}

function ensureConversationMetadata(skill, recording, analysis) {
  const inputs = (skill.inputs || []).filter((inputSpec) => !isTechnicalInputSpec(inputSpec));
  const inputIds = new Set(inputs.map((inputSpec) => inputSpec.id));
  const analysisConversation = analysis?.conversation || {};
  const existingConversation = skill.conversation || {};
  const inferredGoal = cleanText(analysis?.goal || "");
  const workflowName = cleanText(recording?.pageFields?.title || skill.name || "this workflow");
  const fallbackIntro = inferredGoal
    ? `I'll help you ${lowercaseFirst(inferredGoal)}. I'll ask for the details the website needs, then run the saved workflow.`
    : `I'll help you run ${workflowName}. I'll ask for the details the website needs, then run the saved workflow.`;

  const requestedGroups = Array.isArray(analysisConversation.inputGroups)
    ? analysisConversation.inputGroups
    : Array.isArray(existingConversation.inputGroups)
      ? existingConversation.inputGroups
      : [];
  const groups = sanitizeConversationGroups(requestedGroups, inputs, inputIds);
  const groupedIds = new Set(groups.flatMap((group) => group.inputIds));
  const remaining = inputs.filter((inputSpec) => !groupedIds.has(inputSpec.id));
  if (remaining.length) groups.push(...inferConversationGroups(remaining));

  return applyRepeatableGroupCounters({
    ...skill,
    inputs,
    conversation: {
      intro: cleanText(analysisConversation.intro || existingConversation.intro || fallbackIntro),
      inputGroups: groups,
    },
  });
}

function sanitizeConversationGroups(groups, inputs, inputIds) {
  const inputById = new Map(inputs.map((inputSpec) => [inputSpec.id, inputSpec]));
  return groups
    .map((group) => {
      const ids = (group.inputIds || [])
        .map(String)
        .map((id) => inputById.has(id) ? id : findInputIdByLooseMatch(inputById, id))
        .filter((id, index, all) => id && inputIds.has(id) && all.indexOf(id) === index);
      if (!ids.length) return null;
      const key = commonGroupKey(ids.map((id) => inputById.get(id))) || ids[0];
      return {
        title: cleanText(group.title || group.label || groupTitleFromKey(key)),
        description: cleanText(group.description || ""),
        inputIds: ids,
        repeatable: Boolean(group.repeatable) || isRepeatableGroupKey(key),
        addAnotherQuestion: cleanText(group.addAnotherQuestion || defaultAddAnotherQuestion(key)),
      };
    })
    .filter(Boolean);
}

function inferConversationGroups(inputs) {
  const byKey = new Map();
  for (const inputSpec of inputs) {
    const key = groupKeyForInput(inputSpec);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(inputSpec);
  }

  const groups = [];
  for (const [key, groupInputs] of byKey) {
    groups.push({
      title: groupTitleFromKey(key),
      description: "",
      inputIds: groupInputs.map((inputSpec) => inputSpec.id),
      repeatable: isRepeatableGroupKey(key) && groupInputs.length > 1,
      addAnotherQuestion: defaultAddAnotherQuestion(key),
    });
  }
  return groups;
}

function findInputIdByLooseMatch(inputById, candidate) {
  const normalized = normalizeFieldName(candidate);
  for (const [id, inputSpec] of inputById) {
    const keys = [id, inputSpec.question].filter(Boolean).map(normalizeFieldName);
    if (keys.some((key) => key === normalized || key.includes(normalized) || normalized.includes(key))) return id;
  }
  return "";
}

function commonGroupKey(inputs) {
  const keys = inputs.map(groupKeyForInput).filter(Boolean);
  if (!keys.length) return "";
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function groupKeyForInput(inputSpec) {
  const inputId = inputSpec.id || "";
  const key = baseParamName(inputId)
    .replace(/\[\d+\]/g, "")
    .split(/[_-]+/)
    .find((part) => part && part.length > 1);
  if (key && REPEATABLE_GROUP_KEYS.includes(key.toLowerCase())) return key.toLowerCase();
  if (key && inputId.split(/[_-]+/).length > 1) return key.toLowerCase();
  return "details";
}

function groupTitleFromKey(key) {
  const normalized = String(key || "details").toLowerCase();
  if (["mod", "module", "course", "subject"].includes(normalized)) return "Module details";
  if (["traveller", "traveler", "passenger", "person"].includes(normalized)) return "Traveller details";
  if (["dependent", "child", "member", "applicant"].includes(normalized)) return `${humanizeName(normalized)} details`;
  if (normalized === "details") return "Details";
  return `${humanizeName(normalized)} details`;
}

function isRepeatableGroupKey(key) {
  return REPEATABLE_GROUP_KEYS.includes(String(key || "").toLowerCase());
}

function defaultAddAnotherQuestion(key) {
  const normalized = String(key || "").toLowerCase();
  if (["mod", "module", "course", "subject"].includes(normalized)) return "Do you want to add another module?";
  if (["traveller", "traveler", "passenger", "person"].includes(normalized)) return "Do you want to add another traveller?";
  if (normalized === "child") return "Do you want to add another child?";
  if (normalized === "dependent") return "Do you want to add another dependent?";
  if (["item", "row"].includes(normalized)) return "Do you want to add another item?";
  return "Do you want to add another entry?";
}

function applyRepeatableGroupCounters(skill) {
  const repeatableGroups = (skill.conversation?.inputGroups || []).filter((group) => group.repeatable && group.inputIds?.length);
  if (!repeatableGroups.length) return skill;

  const updated = structuredClone(skill);
  updated.computed = { ...(updated.computed || {}) };
  for (const group of repeatableGroups) {
    const firstInputId = group.inputIds[0];
    const groupKey = groupKeyForInput({ id: firstInputId });
    const countId = uniqueInputId(`${groupKey}-count`, new Set(Object.keys(updated.computed)));
    updated.computed[countId] = { fn: "count", input: firstInputId };
    for (const step of updated.steps || []) {
      if (step.request) {
        step.request = replaceGeneratedCounterValues(step.request, groupKey, repeatableGroups.length === 1, `{{${countId}}}`);
      }
    }
  }
  return updated;
}

function replaceGeneratedCounterValues(value, groupKey, onlyRepeatableGroup, replacement) {
  if (Array.isArray(value)) {
    return value.map((item) => replaceGeneratedCounterValues(item, groupKey, onlyRepeatableGroup, replacement));
  }
  if (!value || typeof value !== "object") return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (isGeneratedCounterName(key)
      && (onlyRepeatableGroup || normalizeFieldName(key).includes(normalizeFieldName(groupKey)))
      && isPrimitiveCounterValue(child)) {
      output[key] = replacement;
      continue;
    }
    output[key] = replaceGeneratedCounterValues(child, groupKey, onlyRepeatableGroup, replacement);
  }
  return output;
}

function isGeneratedCounterName(name) {
  const normalized = normalizeFieldName(name);
  return /^gen(?:erated)?.*(?:num|count|index)$/.test(normalized)
    || /(?:row|item|entry).*(?:num|count|index)$/.test(normalized);
}

function isPrimitiveCounterValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) return false;
  return value === "" || /^\d+$/.test(String(value));
}

function inferSkillStrategy(skill) {
  const step = skill.steps?.[0] || {};
  if (step.browserWorkflow) return "browser_replay";
  if (step.browserMode === "navigate") return "browser_result_url";
  const method = step.request?.method || "GET";
  if (method === "GET" && step.request?.query) return "query_api";
  return "direct_api";
}

async function createSkillForRequest({ recording, request, recordingFile, name, analysis }) {
  return (
    await maybeCreateTallySkill({ recording, request, recordingFile, name }) ||
    await maybeCreateQuerySkill({ recording, request, recordingFile, name, analysis }) ||
    await maybeCreateGatewayPreflightSkill({ recording, request, recordingFile, name, analysis }) ||
    await createGenericRequestSkill({ recording, request, recordingFile, name, analysis })
  );
}

async function createGenericRequestSkill({ recording, request, recordingFile, name, analysis }) {
  let body = null;
  let form = null;
  let inputs = [];
  let computed = {};
  if (request.postData) {
    try {
      body = JSON.parse(request.postData);
      const fields = await getPageFieldCatalog(recording);
      const engineered = buildEngineeredBodyTemplate(body, fields, analysis);
      if (engineered) {
        body = engineered.body;
        inputs = engineered.inputs;
        computed = engineered.computed;
      } else {
        const conservative = buildConservativeBodyTemplate(body, fields);
        const visibleChoices = buildVisibleChoiceBodyTemplate(body, fields, conservative);
        body = visibleChoices.body;
        inputs = visibleChoices.inputs;
      }
    } catch {
      const fields = await getPageFieldCatalog(recording);
      const formBody = buildFormBodyTemplate(request.postData, fields, analysis, request);
      if (formBody) {
        body = undefined;
        form = formBody.form;
        inputs = formBody.inputs;
        computed = formBody.computed;
      } else {
        body = request.postData;
      }
    }
  }

  const requestSpec = {
    method: request.method,
    url: request.url,
    headers: keepReplayHeaders(request.requestHeaders || {}),
    ...(form ? { form } : { body }),
  };
  const replayWarnings = [];
  if (!inputs.length && hasRecordedPromptableInteractions(recording)) {
    replayWarnings.push("Recorded visible interactions were found, but none were safely mapped to this API payload. This draft replays recorded constants unless LLM analysis maps the fields.");
  }

  const skill = {
    id: slugify(name || recording.name || "draft-skill"),
    name: name || recording.name || "Draft skill",
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. Review before using.`,
    ...(replayWarnings.length ? { learning: { replayWarnings } } : {}),
    ...(Object.keys(computed).length ? { computed } : {}),
    inputs,
    steps: [
      {
        id: "goal",
        request: requestSpec,
      },
    ],
    outputs: [
      {
        label: "Result",
        from: "goal",
        path: "$",
        extractor: "important",
      },
    ],
  };
  return skill;
}

async function maybeCreateGatewayPreflightSkill({ recording, request, recordingFile, name, analysis }) {
  const requests = recording.requests || [];
  const gatewayRequest = findGatewayBootstrapRequest(requests);
  const parameterRequest = findGatewayParameterRequest(requests, request);
  if (!gatewayRequest || !parameterRequest) return null;
  if (!looksLikeGatewayProtectedRequest(request)) return null;

  const finalSkill = await createGenericRequestSkill({ recording, request, recordingFile, name, analysis });
  const finalStep = structuredClone(finalSkill.steps?.[0] || {});
  if (!finalStep.request) return null;

  finalStep.id = "goal";
  finalStep.request = {
    ...finalStep.request,
    url: gatewayEndpointTemplate(request.url),
    headers: gatewayProtectedHeaders(request.requestHeaders || {}, { includeToken: true }),
  };

  const parameterPayload = recordedPayloadSpec(parameterRequest);
  const gatewayStep = {
    id: "gateway_config",
    request: {
      method: gatewayRequest.method || "GET",
      url: gatewayRequest.url,
      headers: keepReplayHeaders(gatewayRequest.requestHeaders || {}),
    },
    save: {
      json: {
        gatewayBaseUrl: ["$.url", "$.baseUrl", "$.apiUrl", "$.gatewayUrl"],
        clientId: ["$.clientId", "$.client_id"],
        clientSecret: ["$.clientSecret", "$.client_secret"],
        giToken: ["$.token", "$.giToken", "$.gi_tkn", "$.headers.gi-tkn"],
      },
    },
  };

  const parameterStep = {
    id: "gateway_session",
    request: {
      method: parameterRequest.method || "POST",
      url: gatewayEndpointTemplate(parameterRequest.url),
      headers: gatewayProtectedHeaders(parameterRequest.requestHeaders || {}, { includeToken: false }),
      ...parameterPayload,
    },
    save: {
      json: {
        apiToken: ["$.token", "$.params.token", "$.data.token", "$.accessToken", "$.sessionToken"],
      },
    },
  };

  finalSkill.description = `Draft generated from ${recordingFile}. This workflow learned the API preflight/session calls required before the final endpoint. Review before using.`;
  finalSkill.steps = [gatewayStep, parameterStep, finalStep];
  finalSkill.learning = {
    ...(finalSkill.learning || {}),
    strategy: {
      kind: "direct_api_with_preflight",
      rationale: "The final endpoint depends on gateway configuration and a session token captured from earlier network calls.",
    },
  };
  return finalSkill;
}

function findGatewayBootstrapRequest(requests) {
  return requests.find((request) => {
    if ((request.method || "GET").toUpperCase() !== "GET") return false;
    const url = safeUrl(request.url || "");
    const haystack = `${url.hostname} ${url.pathname}`.toLowerCase();
    if (/getapigatewayparams|gateway.*params|api.*gateway.*config|gateway.*config/.test(haystack)) return true;
    return /"clientId"|"client_id"|"clientSecret"|"client_secret"|"gi-tkn"/i.test(request.responseBodyPreview || "");
  }) || null;
}

function findGatewayParameterRequest(requests, finalRequest) {
  const finalIndex = requests.findIndex((request) => request.id === finalRequest.id);
  const priorRequests = finalIndex >= 0 ? requests.slice(0, finalIndex) : requests;
  const finalUrl = safeUrl(finalRequest.url || "");
  return [...priorRequests].reverse().find((request) => {
    if (!["POST", "PUT", "PATCH"].includes((request.method || "").toUpperCase())) return false;
    if (!request.postData) return false;
    const url = safeUrl(request.url || "");
    const haystack = `${url.hostname} ${url.pathname}`.toLowerCase();
    if (url.hostname !== finalUrl.hostname && !/gateway|token|session|parameter/.test(haystack)) return false;
    return /\/parameter$|\/parameters$|\/session$|\/token$|\/init(?:ialize)?$|\/bootstrap$/.test(url.pathname.toLowerCase());
  }) || null;
}

function looksLikeGatewayProtectedRequest(request) {
  const headers = normalizeHeaderObject(request.requestHeaders || {});
  if (headers.client_id || headers["client-id"] || headers.client_secret || headers["client-secret"] || headers["gi-tkn"]) {
    return true;
  }
  if (headers.token && !/^bearer\s/i.test(String(headers.token))) return true;
  const url = safeUrl(request.url || "");
  return /gateway|\/gw\.|\/ext\/.*\/fe\//i.test(`${url.hostname}${url.pathname}`);
}

function normalizeHeaderObject(headers) {
  const normalized = {};
  for (const [key, value] of Object.entries(headers || {})) normalized[key.toLowerCase()] = value;
  return normalized;
}

function gatewayProtectedHeaders(recordedHeaders, { includeToken }) {
  const headers = stripVolatileHeaders(keepReplayHeaders(recordedHeaders || {}));
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (["client_id", "client-id", "client_secret", "client-secret", "gi-tkn", "token"].includes(lower)) {
      delete headers[key];
    }
  }
  headers.client_id = "{{clientId}}";
  headers.client_secret = "{{clientSecret}}";
  headers["gi-tkn"] = "{{giToken}}";
  if (includeToken) headers.Token = "{{apiToken}}";
  return headers;
}

function gatewayEndpointTemplate(urlValue) {
  const url = safeUrl(urlValue || "");
  const path = url.pathname;
  const commonGatewayIndex = path.toLowerCase().lastIndexOf("/fe/");
  const suffix = commonGatewayIndex >= 0
    ? path.slice(commonGatewayIndex + 4)
    : path.split("/").filter(Boolean).slice(-1)[0] || "";
  return `{{gatewayBaseUrl}}${suffix}${url.search || ""}`;
}

function recordedPayloadSpec(request) {
  if (!request.postData) return {};
  try {
    return { body: JSON.parse(request.postData) };
  } catch {
    if (looksLikeFormBody(request.postData, request)) {
      const form = {};
      for (const [key, value] of new URLSearchParams(request.postData).entries()) appendFormTemplateValue(form, key, value);
      return { form };
    }
    return { body: request.postData };
  }
}

function hasRecordedPromptableInteractions(recording) {
  const hasEvents = (recording.pageFields?.events || []).some((event) => {
    if (["input", "change"].includes(event.type) && event.value !== undefined && event.value !== "") return true;
    if (isChoiceClickEvent(event) && cleanChoices(event.options || []).length > 1) return true;
    return false;
  });
  if (hasEvents) return true;

  return fieldsFromPlaywrightEvidence(recording.playwright).some((field) => {
    if (!isUserFacingField(field)) return false;
    const type = String(field.type || "").toLowerCase();
    const role = String(field.role || "").toLowerCase();
    if (["button", "submit", "reset", "image"].includes(type) || role === "button") return false;
    return Boolean(field.promptText || field.label || field.placeholder || field.options?.length);
  });
}

function isDraftWorthyRequest(request) {
  if (!request?.method || !request.url) return false;
  const url = safeUrl(request.url);
  if (!["http:", "https:"].includes(url.protocol)) return false;

  const haystack = `${url.hostname} ${url.pathname}`.toLowerCase();
  if (ANALYTICS_HOST_PATTERNS.some((pattern) => url.hostname.includes(pattern))) return false;
  if (TELEMETRY_PATH_PATTERNS.some((pattern) => haystack.includes(pattern))) return false;
  if (["Script", "Image", "Stylesheet", "Font", "Manifest", "Media"].includes(request.resourceType)) return false;
  if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ico|webmanifest|json)(\?|$)/i.test(url.pathname)) return false;

  if (["POST", "PUT", "PATCH"].includes(request.method)) return Boolean(request.postData);
  if (request.method === "GET") return Boolean(url.search);
  return false;
}

async function maybeCreateFinalUrlQuerySkill({ recording, recordingFile, name }) {
  const finalUrl = safeUrl(recording.pageFields?.url || recording.url);
  const originalUrl = safeUrl(recording.url);
  if (!["http:", "https:"].includes(finalUrl.protocol)) return null;
  if (![...finalUrl.searchParams.keys()].length) return null;
  if (finalUrl.origin !== originalUrl.origin) return null;

  const fields = await getPageFieldCatalog(recording);
  const groupedParams = groupSearchParams(finalUrl.searchParams);
  const usedInputIds = new Set();
  const inputs = [];
  const query = {};
  const availableFields = [...fields];

  for (const [paramName, values] of groupedParams) {
    if (shouldSkipQueryParam(paramName, values, null)) continue;
    const field = findBestFieldForFinalParam(availableFields, paramName, values);
    if (field) {
      const index = availableFields.indexOf(field);
      if (index >= 0) availableFields.splice(index, 1);
    }
    const inputId = uniqueInputId(slugify(field?.label || field?.placeholder || baseParamName(paramName)), usedInputIds);
    inputs.push(toFinalUrlInputSpec(inputId, paramName, values, field));
    query[paramName] = { $value: `{{${inputId}}}` };
  }

  if (!inputs.length) return null;

  return {
    id: slugify(name || recording.name || "client-side-skill"),
    name: name || recording.name || "Client-side skill",
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. This site appears to calculate in the browser, so the skill opens the result URL in Chrome and captures the rendered page.`,
    inputs,
    steps: [
      {
        id: "goal",
        browserMode: "navigate",
        request: {
          method: "GET",
          url: `${finalUrl.origin}${finalUrl.pathname}`,
          headers: {
            Referer: recording.url,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          query,
        },
      },
    ],
    outputs: [
      {
        label: "Rendered result",
        from: "goal",
        path: "$",
        extractor: "important",
      },
    ],
  };
}

function toFinalUrlInputSpec(inputId, paramName, values, field) {
  const choices = cleanChoices(field?.options || []).map((choice) => ({
    label: choice.label,
    value: normalizeBrowserValue(choice.value),
  }));
  const uniqueChoices = cleanChoices(choices);
  const isMulti = paramName.endsWith("[]") || values.length > 1 || Boolean(field?.multiple);
  const spec = {
    id: inputId,
    question: questionForField(paramName, field),
    type: uniqueChoices.length ? (isMulti ? "multi-choice" : "choice") : inferInputTypeFromValues(values),
    optional: false,
  };
  if (uniqueChoices.length) spec.choices = uniqueChoices;
  return spec;
}

function inferInputTypeFromValues(values) {
  return values.every((value) => /^-?\d+(\.\d+)?$/.test(value)) ? "number" : "string";
}

function findBestFieldForFinalParam(fields, paramName, values) {
  const byName = findFieldForParam(fields, paramName);
  if (byName) return byName;

  const normalizedValues = new Set(values.map(normalizeBrowserValue));
  return fields.find((field) => {
    if (!field.visible) return false;
    if (!field.value) return false;
    if (normalizedValues.has(normalizeBrowserValue(field.value))) return true;
    return (field.options || []).some((option) => option.selected && normalizedValues.has(normalizeBrowserValue(option.value)));
  });
}

function normalizeBrowserValue(value) {
  return String(value ?? "").replace(/^(number|string|boolean):/, "");
}

async function maybeCreateBrowserReplaySkill({ recording, recordingFile, name, analysis }) {
  const analyzedSkill = await maybeCreateAnalyzedBrowserReplaySkill({ recording, recordingFile, name, analysis });
  if (analyzedSkill) return analyzedSkill;

  const events = recording.pageFields?.events || [];
  const inputEvents = latestInputEvents(events);
  const clickEvents = events.filter((event) => event.type === "click" && event.selector);
  if (!inputEvents.length && !clickEvents.length) return null;

  const usedInputIds = new Set();
  const inputs = [];
  for (const event of inputEvents) {
    const question = questionForRecordedEvent(event);
    const inputId = uniqueInputId(slugify(question || event.name || event.id || "input"), usedInputIds);
    event.inputId = inputId;
    inputs.push({
      id: inputId,
      question,
      type: inferInputTypeFromValues([event.value]),
      optional: false,
    });
  }

  const choiceClickEvents = latestChoiceClickEvents(clickEvents);
  for (const event of choiceClickEvents) {
    const question = questionForChoiceClickEvent(event, events);
    const inputId = uniqueInputId(slugify(question || event.text || "choice"), usedInputIds);
    event.inputId = inputId;
    const rawChoices = cleanChoices(event.options || []);
    const choices = rawChoices.some((choice) => choice.selector)
      ? rawChoices
      : [{ label: cleanText(event.text || "Selected option"), value: cleanText(event.value || event.text || "") }];
    inputs.push({
      id: inputId,
      question,
      type: "choice",
      optional: false,
      choices,
    });
  }

  const lastClick = [...events].reverse().find((event) => event.type === "click" && event.selector);
  const actions = inputEvents.map((event) => ({
    type: "fill",
    selector: event.selector,
    value: `{{${event.inputId}}}`,
  }));
  for (const event of choiceClickEvents) {
    actions.push({
      type: "clickChoice",
      value: `{{${event.inputId}}}`,
      choices: (event.options || []).filter((option) => option.selector).map((option) => ({
        label: cleanText(option.label || option.text || option.value),
        value: option.value ?? option.label,
        selector: option.selector || "",
      })),
      fallbackSelector: event.selector,
    });
  }
  if (inputEvents.length && lastClick) {
    actions.push({ type: "click", selector: lastClick.selector });
  } else if (!inputEvents.length) {
    const choiceSelectors = new Set(choiceClickEvents.map((event) => event.selector));
    actions.push(...clickEvents
      .filter((event) => !choiceSelectors.has(event.selector))
      .map((event) => ({ type: "click", selector: event.selector })));
  }

  return {
    id: slugify(name || recording.name || "browser-replay-skill"),
    name: name || recording.name || "Browser replay skill",
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. No reusable API endpoint was detected, so this skill replays the browser workflow.`,
    inputs,
    steps: [
      {
        id: "goal",
        browserWorkflow: {
          startUrl: recording.url,
          actions,
        },
      },
    ],
    outputs: [
      {
        label: "Rendered result",
        from: "goal",
        path: "$",
        extractor: "important",
      },
    ],
  };
}

async function maybeCreateAnalyzedBrowserReplaySkill({ recording, recordingFile, name, analysis }) {
  const mappings = (analysis?.endpointEngineering?.userInputMappings || [])
    .filter((mapping) => mapping?.inputId && mapping?.question && mapping?.mapsTo?.length);
  if (!mappings.length) return null;
  if (!["browser_replay", "manual_review"].includes(analysis?.strategy?.kind) && analysis?.endpointEngineering?.payloadType !== "browser") {
    return null;
  }

  const fields = await getPageFieldCatalog(recording);
  const events = recording.pageFields?.events || [];
  const usedInputIds = new Set();
  const inputs = [];
  const actions = [];

  for (const mapping of mappings) {
    const group = findBrowserReplayGroup(fields, mapping);
    if (!group) continue;
    const choices = browserReplayChoicesForGroup(group);
    if (!choices.length) continue;
    const inputId = uniqueInputId(slugify(mapping.inputId || mapping.question), usedInputIds);
    inputs.push({
      id: inputId,
      question: cleanText(mapping.question),
      type: mapping.type === "multi-choice" ? "multi-choice" : "choice",
      optional: mapping.required === false,
      choices,
      ...(mapping.helpText ? { description: cleanText(mapping.helpText) } : {}),
    });
    actions.push({
      type: "clickChoice",
      value: `{{${inputId}}}`,
      choices,
      fallbackSelector: group.selected?.selector || choices[0]?.selector || "",
    });
  }

  if (!inputs.length || inputs.length < Math.min(2, mappings.length)) return null;

  const submit = findSubmitAction(events, fields);
  if (submit?.selector) {
    actions.push({ type: "click", selector: submit.selector });
  }

  return {
    id: slugify(name || recording.name || "browser-replay-skill"),
    name: name || recording.name || "Browser replay skill",
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. Codex/analyzer mapped the visible browser questions; no reusable API endpoint was detected, so this skill replays the browser workflow.`,
    inputs,
    steps: [
      {
        id: "goal",
        browserWorkflow: {
          startUrl: recording.url,
          actions,
        },
      },
    ],
    outputs: [
      {
        label: "Rendered result",
        from: "goal",
        path: "$",
        extractor: "important",
      },
    ],
  };
}

function findBrowserReplayGroup(fields, mapping) {
  const choiceGroups = groupBrowserChoiceFields(fields);
  const targets = mapping.mapsTo || [];
  for (const target of targets) {
    const parsed = parseBrowserTarget(target);
    if (!parsed.name) continue;
    const group = choiceGroups.find((candidate) => normalizeFieldName(candidate.name) === parsed.normalizedName);
    if (group?.fields?.length >= 2) {
      return {
        target,
        fields: group.fields,
        selected: group.fields.find((field) => field.checked || String(field.value) === String(field.default)),
      };
    }
  }

  const targetQuestions = targets.map((target) => parseBrowserTarget(target).question).filter(Boolean);
  const scoredGroups = [];
  for (const question of [...targetQuestions, mapping.question]) {
    for (const group of choiceGroups) {
      const score = scoreBrowserFieldGroupForMapping(group, mapping, question);
      if (score >= 0.45) {
        scoredGroups.push({ group, score, question });
      }
    }
  }

  scoredGroups.sort((a, b) => b.score - a.score);
  const best = scoredGroups[0];
  if (best?.group?.fields?.length >= 2) {
    return {
      target: best.question || mapping.question,
      fields: best.group.fields,
      selected: best.group.fields.find((field) => field.checked || String(field.value) === String(field.default)),
    };
  }
  return null;
}

function parseBrowserTarget(target) {
  const raw = String(target || "");
  const radioName = raw.match(/radio\[name=["']?([^"'\]]+)["']?\]/i)?.[1];
  const cssName = raw.match(/\[name=["']?([^"'\]]+)["']?\]/i)?.[1];
  const fieldsetQuestion = raw.match(/fieldset\[question=["']?([^"'\]]+)["']?\]/i)?.[1];
  const genericQuestion = raw.match(/\bquestion=["']?([^"'\]]+)["']?/i)?.[1];
  const name = cleanText(radioName || cssName || "");
  return {
    raw,
    name,
    question: cleanText(fieldsetQuestion || genericQuestion || ""),
    normalizedName: normalizeFieldName(name),
  };
}

function groupBrowserChoiceFields(fields) {
  const groups = new Map();
  for (const field of fields) {
    if (!field.selector || !isChoiceField(field)) continue;
    const name = cleanText(field.name || field.groupName || field.sectionText || field.groupLabel || field.promptText || field.selector);
    const key = normalizeFieldName(name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { name, fields: [] });
    groups.get(key).fields.push(field);
  }
  return [...groups.values()].filter((group) => group.fields.length >= 2);
}

function scoreBrowserFieldGroupForMapping(group, mapping, question) {
  const prompt = cleanText(question || mapping.question || "");
  const evidence = cleanText([
    mapping.question,
    mapping.helpText,
    mapping.transform,
    mapping.evidence,
    ...(mapping.mapsTo || []),
  ].filter(Boolean).join(" ")).toLowerCase();
  const optionLabels = [...new Set(group.fields.map(choiceLabelForBrowserField).filter(Boolean))];
  const optionHits = optionLabels.filter((label) => evidence.includes(label.toLowerCase())).length;
  const optionScore = optionLabels.length ? optionHits / optionLabels.length : 0;
  const nameScore = textOverlapScore(prompt, group.name);
  const sectionScore = Math.max(...group.fields.map((field) => textOverlapScore(prompt, field.sectionText || "")), 0);
  return (optionScore * 0.58) + (nameScore * 0.32) + (sectionScore * 0.10);
}

function isChoiceField(field) {
  const type = String(field.type || "").toLowerCase();
  const role = String(field.role || "").toLowerCase();
  return ["radio", "checkbox"].includes(type) || ["radio", "checkbox", "option", "button"].includes(role);
}

function browserReplayChoicesForGroup(group) {
  return cleanChoices(group.fields
    .filter((field) => field.selector)
    .map((field) => ({
      label: choiceLabelForBrowserField(field),
      value: field.value || field.label || field.text || field.promptText,
      selector: field.selector,
    })));
}

function choiceLabelForBrowserField(field) {
  const label = cleanText(field.label || field.text || field.promptText || field.value);
  const value = cleanText(field.value || "");
  if (/^2147483647$/.test(value) && /more than/i.test(label)) return label;
  if (/^(?:true|false)$/i.test(value) && /^(?:yes|no)$/i.test(label)) return label;
  return label || value;
}

function findSubmitAction(events, fields) {
  const event = [...events].reverse().find((item) => {
    const type = String(item.inputType || item.type || "").toLowerCase();
    const text = cleanText(item.text || item.label || item.promptText || "");
    return item.selector && item.type === "click" && (
      type === "submit" ||
      /\b(get|show|calculate|submit|recommend|quote|search|apply|continue|next)\b/i.test(text)
    );
  });
  if (event) return event;

  return [...fields].reverse().find((field) => {
    const type = String(field.type || "").toLowerCase();
    const text = cleanText(field.text || field.label || field.promptText || "");
    return field.selector && (
      type === "submit" ||
      /\b(get|show|calculate|submit|recommend|quote|search|apply|continue|next)\b/i.test(text)
    );
  }) || null;
}

function textOverlapScore(a, b) {
  const left = new Set(tokenizeForOverlap(a));
  const right = new Set(tokenizeForOverlap(b));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const word of left) {
    if (right.has(word) || [...right].some((candidate) => overlapTokenMatch(word, candidate))) hits += 1;
  }
  return hits / left.size;
}

function tokenizeForOverlap(value) {
  return cleanText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
    .map(stemOverlapToken);
}

function stemOverlapToken(word) {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function overlapTokenMatch(a, b) {
  const min = Math.min(a.length, b.length);
  if (min < 4) return false;
  return a.slice(0, min) === b.slice(0, min);
}

function questionForRecordedEvent(event) {
  const candidate = cleanText(event.promptText || event.label || event.placeholder || event.groupLabel || event.nearbyText || event.name || event.id || "Input");
  return readableQuestionLabel(candidate, { name: event.name, id: event.id }, event.name || event.id || "");
}

function latestChoiceClickEvents(clickEvents) {
  const byGroup = new Map();
  for (const event of clickEvents) {
    const choices = cleanChoices(event.options || []);
    if (choices.length < 2) continue;
    const key = normalizeFieldName(questionForChoiceClickEvent(event));
    if (!key) continue;
    byGroup.set(key, event);
  }
  return [...byGroup.values()];
}

function questionForChoiceClickEvent(event, allEvents = []) {
  const choices = cleanChoices(event.options || []);
  const direct = directChoicePrompt(event, choices);
  if (direct) return direct;

  const contexts = [
    `${event.label || ""} ${event.groupLabel || ""} ${event.nearbyText || ""} ${event.sectionText || ""}`,
    ...choiceContextFromOtherEvents(allEvents, choices),
  ];
  const inferred = contexts
    .map((context) => inferChoiceGroupQuestion(context, choices))
    .filter(Boolean)
    .sort((a, b) => choiceQuestionScore(b) - choiceQuestionScore(a) || a.length - b.length)[0];
  return inferred || questionForRecordedEvent(event);
}

function directChoicePrompt(event, choices) {
  const optionLabels = choices.map((choice) => cleanText(choice.label || choice.value)).filter(Boolean);
  for (const candidate of [event.promptText, event.groupLabel]) {
    const prompt = cleanText(candidate);
    if (!prompt || prompt.length > 120) continue;
    const normalized = normalizeComparableText(prompt);
    if (!normalized) continue;
    if (optionLabels.some((label) => normalizeComparableText(label) === normalized)) continue;
    const embeddedOptionCount = optionLabels
      .filter((label) => prompt.toLowerCase().includes(label.toLowerCase()))
      .length;
    if (embeddedOptionCount >= Math.min(2, optionLabels.length)) continue;
    return prompt;
  }
  return "";
}

function choiceContextFromOtherEvents(events, choices) {
  if (!events?.length || choices.length < 2) return [];
  const labels = choices.map((choice) => cleanText(choice.label || choice.value)).filter(Boolean);
  return events
    .map((event) => `${event.label || ""} ${event.groupLabel || ""} ${event.nearbyText || ""} ${event.sectionText || ""}`)
    .filter((context) => labels.filter((label) => context.toLowerCase().includes(label.toLowerCase())).length >= Math.min(2, labels.length));
}

function inferChoiceGroupQuestion(contextText, choices) {
  const text = cleanText(contextText);
  if (!text || !choices.length) return "";
  const labels = choices.map((choice) => cleanText(choice.label || choice.value)).filter(Boolean);
  const indices = [];
  const lowerText = text.toLowerCase();
  for (const label of labels) {
    const lowerLabel = label.toLowerCase();
    let index = lowerText.indexOf(lowerLabel);
    while (index >= 0) {
      indices.push({ label, index });
      index = lowerText.indexOf(lowerLabel, index + lowerLabel.length);
    }
  }
  indices.sort((a, b) => a.index - b.index);
  if (!indices.length) return "";
  const tails = [];
  const naturalMatches = [];
  for (const item of indices) {
    const prefix = cleanText(text.slice(0, item.index));
    if (!prefix) continue;
    const tail = prefix.split(/\s+/).slice(-12).join(" ");
    const natural = tail.match(/\b(i am a(?:n)?|i need(?: a| an)?|looking to cover|select(?: your)?|choose(?: your)?|coverage for|travelling to|leaving .* on|arriving .* on)\b.*$/i);
    if (natural?.[0]) {
      const value = stripTrailingChoiceLabels(cleanText(natural[0]), labels);
      naturalMatches.push({ value, score: choiceQuestionScore(value) });
    }
    tails.push(tail);
  }
  naturalMatches.sort((a, b) => b.score - a.score || a.value.length - b.value.length);
  if (naturalMatches[0]?.value) return naturalMatches[0].value;
  return stripTrailingChoiceLabels(cleanText(tails[0] || ""), labels);
}

function choiceQuestionScore(value) {
  if (/^i am a(?:n)?\b/i.test(value)) return 100;
  if (/^i need\b/i.test(value)) return 90;
  if (/^looking to cover\b/i.test(value)) return 85;
  if (/^select\b|^choose\b/i.test(value)) return 80;
  if (/^travelling to\b|^leaving .* on\b|^arriving .* on\b/i.test(value)) return 75;
  if (/^coverage for\b/i.test(value)) return 40;
  return 50;
}

function stripTrailingChoiceLabels(value, labels) {
  let output = cleanText(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const label of labels) {
      const regex = new RegExp(`(?:^|\\s)${escapeRegExp(label)}$`, "i");
      if (regex.test(output)) {
        output = cleanText(output.replace(regex, ""));
        changed = true;
      }
    }
  }
  return output;
}

function latestInputEvents(events) {
  const bySelector = new Map();
  for (const event of events) {
    if (!["input", "change"].includes(event.type)) continue;
    const inputType = String(event.inputType || event.type || "").toLowerCase();
    if (["radio", "checkbox", "button", "submit", "reset"].includes(inputType)) continue;
    if (!event.selector || event.value === undefined || event.value === "") continue;
    bySelector.set(event.selector, event);
  }
  return [...bySelector.values()];
}

function buildEngineeredBodyTemplate(body, fields, analysis) {
  const plan = analysis?.endpointEngineering;
  if (!plan || plan.payloadType !== "json") return null;
  const mappings = [...(plan.userInputMappings || []), ...(analysis.inputs || [])].filter((mapping) => mapping.mapsTo?.length);
  if (!mappings.length && !plan.volatileFields?.length) return null;

  const rows = flattenScalars(body).filter((row) => row.value !== "" && row.value !== null && row.value !== undefined);
  const template = structuredClone(body);
  const inputs = [];
  const computed = {};
  const usedInputIds = new Set();
  const usedComputedIds = new Set();
  const inputIdByMapping = new Map();

  for (const row of rows) {
    const field = findFieldForParam(fields, inputIdFromPath(row.path));
    const technicalOrGenerated = isTechnicalPayloadPath(row.path) || isTechnicalOrGeneratedControl(lastPathName(row.path), field);
    const volatile = findPathPlan(row.path, plan.volatileFields || []);
    if (volatile) {
      if (volatile.handling === "omit") {
        deletePathValue(template, row.path);
        continue;
      }
      if (volatile.handling === "regenerate_uuid") {
        const computedId = uniqueInputId(slugify(baseParamName(row.path).replace(/^\$/, "") || "uuid"), usedComputedIds);
        computed[computedId] = { fn: "uuid" };
        setPathValue(template, row.path, `{{${computedId}}}`);
        continue;
      }
      if (volatile.handling === "ask_user") {
        if (technicalOrGenerated || !isUserFacingField(field)) continue;
        const input = inputFromMappingOrRow(null, row, fields, usedInputIds);
        inputs.push(input);
        setPathValue(template, row.path, `{{${input.id}}}`);
        continue;
      }
    }

    const mapping = findPathPlan(row.path, mappings);
    if (mapping) {
      const mappingField = findFieldForMapping(fields, mapping, row);
      if (technicalOrGenerated || !isUserFacingField(mappingField)) continue;
      const mappingKey = mapping.inputId || mapping.id || mapping.question || row.path;
      let inputId = inputIdByMapping.get(mappingKey);
      if (!inputId) {
        const input = inputFromMappingOrRow(mapping, row, fields, usedInputIds);
        inputs.push(input);
        inputId = input.id;
        inputIdByMapping.set(mappingKey, inputId);
      }
      setPathValue(template, row.path, `{{${inputId}}}`);
    }
  }

  return { body: template, inputs, computed };
}

function buildConservativeBodyTemplate(body, fields) {
  const template = structuredClone(body);
  const inputs = [];
  const usedInputIds = new Set();
  const usedPaths = new Set();
  for (const row of flattenScalars(body)) {
    if (row.value === "" || row.value === null || row.value === undefined) continue;
    const field = findFieldForParam(fields, inputIdFromPath(row.path));
    if (!shouldAskPayloadPath(row.path, [row.value], field)) continue;
    const input = toBodyInputSpec(row, fields, usedInputIds);
    inputs.push(input);
    usedPaths.add(row.path);
    setPathValue(template, row.path, `{{${input.id}}}`);
  }
  return { body: template, inputs, usedPaths };
}

function buildVisibleChoiceBodyTemplate(body, fields, base = {}) {
  const template = structuredClone(base.body || body);
  const rows = flattenScalars(body).filter((row) => row.value !== "" && row.value !== null && row.value !== undefined);
  const choiceFields = fields.filter((field) => {
    const choices = cleanChoices(field.options || []);
    return field.visible !== false && choices.length > 1 && isUserFacingField(field);
  });
  const inputs = [...(base.inputs || [])];
  const usedInputIds = new Set(inputs.map((input) => input.id));
  const usedPaths = new Set(base.usedPaths || []);

  for (const field of choiceFields) {
    const match = findPayloadRowForVisibleChoice(rows, field, usedPaths);
    if (!match) continue;
    usedPaths.add(match.row.path);
    const inputId = uniqueInputId(slugify(field.label || field.groupLabel || lastPathName(match.row.path)), usedInputIds);
    inputs.push({
      id: inputId,
      question: questionForField(inputId, field),
      type: "choice",
      optional: false,
      default: match.row.value,
      choices: payloadChoicesForVisibleField(field, match.row.value),
    });
    setPathValue(template, match.row.path, `{{${inputId}}}`);
  }

  return { body: template, inputs, usedPaths };
}

function findPayloadRowForVisibleChoice(rows, field, usedPaths) {
  const selectedLabel = cleanText(field.value || field.options?.find((option) => option.selected)?.label || "");
  if (!selectedLabel) return null;
  const candidates = rows
    .filter((row) => !usedPaths.has(row.path))
    .filter((row) => typeof row.value === "string" || typeof row.value === "number" || typeof row.value === "boolean")
    .filter((row) => !isTechnicalPayloadPath(row.path) && !isNonUserControlName(lastPathName(row.path)))
    .map((row) => ({ row, score: visibleChoicePayloadScore(selectedLabel, row) }))
    .filter((item) => item.score >= 0.78)
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function visibleChoicePayloadScore(label, row) {
  const labelNorm = normalizeComparableText(label);
  const valueNorm = normalizeComparableText(row.value);
  if (!labelNorm || !valueNorm) return 0;
  let score = stringSimilarity(labelNorm, valueNorm);
  const pathNorm = normalizeComparableText(lastPathName(row.path));
  if (/type|code|option|plan|class|role|occup/i.test(lastPathName(row.path))) score += 0.04;
  if (pathNorm && stringSimilarity(labelNorm, pathNorm) > 0.55) score += 0.04;
  return Math.min(score, 1);
}

function payloadChoicesForVisibleField(field, selectedPayloadValue) {
  const selectedLabel = cleanText(field.value || "");
  const selectedNorm = normalizeComparableText(selectedLabel);
  const selectedValue = String(selectedPayloadValue);
  const selectedValueNorm = normalizeComparableText(selectedValue);
  const codeLike = /^[A-Z0-9_ -]+$/.test(selectedValue) && !/\s/.test(selectedValue.trim());
  return cleanChoices(field.options || []).map((choice) => {
    const label = cleanText(choice.label || choice.value);
    const labelNorm = normalizeComparableText(label);
    let value = choice.value ?? label;
    if (labelNorm === selectedNorm) {
      value = selectedPayloadValue;
    } else if (codeLike && stringSimilarity(selectedNorm, selectedValueNorm) >= 0.72) {
      value = label.replace(/[^a-z0-9]+/gi, "").toUpperCase();
    }
    return { label, value };
  });
}

function normalizeComparableText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const distance = levenshteinDistance(a, b);
  return 1 - distance / Math.max(a.length, b.length);
}

function levenshteinDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    let last = i;
    previous[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const old = previous[j + 1];
      previous[j + 1] = a[i] === b[j]
        ? last
        : Math.min(last + 1, previous[j] + 1, previous[j + 1] + 1);
      last = old;
    }
  }
  return previous[b.length];
}

function inputFromMappingOrRow(mapping, row, fields, usedInputIds) {
  const field = findFieldForMapping(fields, mapping, row);
  const choices = cleanChoices(field?.options || []);
  const preferredId = [mapping?.inputId, mapping?.id, inputIdFromPath(row.path), mapping?.question]
    .find((candidate) => candidate && !isTechnicalFieldName(candidate)) || "input";
  const inputId = uniqueInputId(slugify(preferredId), usedInputIds);
  const spec = {
    id: inputId,
    question: questionForEngineeredInput(mapping, row, field),
    type: mapping?.type && mapping.type !== "boolean"
      ? mapping.type
      : typeof row.value === "number"
        ? "number"
        : choices.length
          ? "choice"
          : "string",
    optional: mapping?.required === false,
  };
  if (choices.length && ["choice", "multi-choice", "string"].includes(spec.type)) {
    spec.type = spec.type === "multi-choice" ? "multi-choice" : "choice";
    spec.choices = choices;
  }
  if (mapping?.transform) spec.description = `Transform: ${mapping.transform}`;
  return spec;
}

function findFieldForMapping(fields, mapping, row) {
  const names = [
    mapping?.inputId,
    mapping?.id,
    ...(mapping?.mapsTo || []),
    inputIdFromPath(row.path),
    lastPathName(row.path),
  ].filter(Boolean);
  for (const name of names) {
    const field = findFieldForParam(fields, name);
    if (field) return field;
  }
  return null;
}

function questionForEngineeredInput(mapping, row, field) {
  const question = cleanText(mapping?.question || "");
  if (question && !/^\$\.|uuid|value for/i.test(question) && !isTechnicalFieldName(question)) return question;
  return questionForField(inputIdFromPath(row.path), field);
}

function findPathPlan(pathExpression, items) {
  const normalized = normalizePlanPath(pathExpression);
  return items.find((item) => {
    const paths = item.mapsTo || [item.path];
    return paths.some((path) => {
      const candidate = normalizePlanPath(path);
      return candidate && (candidate === normalized || normalized.endsWith(candidate) || candidate.endsWith(normalized));
    });
  });
}

function normalizePlanPath(pathExpression) {
  return String(pathExpression || "")
    .replace(/^body\./i, "$.")
    .replace(/^json\./i, "$.")
    .replace(/^payload\./i, "$.")
    .replace(/^requestBody\./i, "$.")
    .replace(/^query\./i, "$.")
    .replace(/^form\./i, "$.")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function setPathValue(target, pathExpression, value) {
  const segments = pathSegments(pathExpression);
  if (!segments.length) return;
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (current?.[segment] === undefined) return;
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function deletePathValue(target, pathExpression) {
  const segments = pathSegments(pathExpression);
  if (!segments.length) return;
  let current = target;
  for (const segment of segments.slice(0, -1)) {
    if (current?.[segment] === undefined) return;
    current = current[segment];
  }
  if (Array.isArray(current)) {
    current.splice(Number(segments.at(-1)), 1);
  } else {
    delete current[segments.at(-1)];
  }
}

function pathSegments(pathExpression) {
  return String(pathExpression)
    .replace(/^\$\./, "")
    .replace(/^\$/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function lastPathName(pathExpression) {
  const segments = pathSegments(pathExpression);
  const last = segments.at(-1);
  return last === undefined ? "" : String(last);
}

function buildFormBodyTemplate(postData, fields, analysis, request) {
  if (!looksLikeFormBody(postData, request)) return null;

  const plan = analysis?.endpointEngineering;
  const usePlan = plan?.payloadType === "form";
  const mappings = usePlan
    ? [...(plan.userInputMappings || []), ...(analysis.inputs || [])].filter((mapping) => mapping.mapsTo?.length)
    : [];
  const params = new URLSearchParams(postData);
  const inputs = [];
  const form = {};
  const computed = {};
  const usedInputIds = new Set();
  const inputIdByMapping = new Map();

  for (const [paramName, value] of params.entries()) {
    const row = { path: `form.${paramName}`, value };
    const field = findFieldForParam(fields, paramName);
    const technicalOrGenerated = isTechnicalOrGeneratedControl(paramName, field);
    const volatile = usePlan ? findPathPlan(row.path, plan.volatileFields || []) : null;

    if (volatile?.handling === "omit") continue;
    if (volatile?.handling === "ask_user") {
      if (technicalOrGenerated || !isUserFacingField(field)) {
        appendFormTemplateValue(form, paramName, value);
        continue;
      }
      const input = inputFromMappingOrRow(null, row, fields, usedInputIds);
      inputs.push(input);
      appendFormTemplateValue(form, paramName, `{{${input.id}}}`);
      continue;
    }

    const mapping = usePlan ? findPathPlan(row.path, mappings) : null;
    if (mapping) {
      const mappingField = findFieldForMapping(fields, mapping, row);
      if (technicalOrGenerated || !isUserFacingField(mappingField)) {
        appendFormTemplateValue(form, paramName, value);
        continue;
      }
      const mappingKey = mapping.inputId || mapping.id || mapping.question || row.path;
      let inputId = inputIdByMapping.get(mappingKey);
      if (!inputId) {
        const input = inputFromMappingOrRow(mapping, row, fields, usedInputIds);
        inputs.push(input);
        inputId = input.id;
        inputIdByMapping.set(mappingKey, inputId);
      }
      appendFormTemplateValue(form, paramName, `{{${inputId}}}`);
      continue;
    }

    if (!usePlan && shouldAskQueryParam(paramName, [value], field)) {
      const inputId = uniqueInputId(slugify(field?.label || field?.placeholder || baseParamName(paramName)), usedInputIds);
      inputs.push(toFormInputSpec(inputId, paramName, [value], field));
      appendFormTemplateValue(form, paramName, `{{${inputId}}}`);
      continue;
    }

    appendFormTemplateValue(form, paramName, value);
  }

  if (!inputs.length) return null;
  return {
    form,
    inputs,
    computed,
  };
}

function looksLikeFormBody(postData, request) {
  if (!postData || typeof postData !== "string") return false;
  const contentType = Object.entries(request.requestHeaders || {})
    .find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
  if (/application\/x-www-form-urlencoded/i.test(contentType)) return true;
  if (/^[^=&\s]+=[\s\S]*(&[^=&\s]+=[\s\S]*)*$/.test(postData)) return true;
  return false;
}

function toFormInputSpec(inputId, paramName, values, field) {
  const choices = cleanChoices(field?.options || []);
  const spec = {
    id: inputId,
    question: questionForField(paramName, field),
    type: choices.length ? "choice" : inferInputTypeFromValues(values),
    optional: false,
  };
  if (choices.length) spec.choices = choices;
  return spec;
}

function appendFormTemplateValue(form, key, value) {
  if (form[key] === undefined) {
    form[key] = value;
    return;
  }
  if (Array.isArray(form[key])) {
    form[key].push(value);
    return;
  }
  form[key] = [form[key], value];
}

function toBodyInputSpec(row, fields, usedInputIds = new Set()) {
  const inputName = inputIdFromPath(row.path);
  const field = findFieldForParam(fields, inputName);
  const choices = cleanChoices(field?.options || []);
  const inputId = uniqueInputId(slugify(field?.label || field?.placeholder || inputName), usedInputIds);
  const spec = {
    id: inputId,
    question: questionForField(inputName, field),
    type: typeof row.value === "number" ? "number" : choices.length ? "choice" : "string",
  };
  if (choices.length) spec.choices = choices;
  return spec;
}

async function maybeCreateQuerySkill({ recording, request, recordingFile, name, analysis }) {
  if (!["GET", "HEAD"].includes(request.method) || !request.url) return null;

  const url = safeUrl(request.url);
  if (![...url.searchParams.keys()].length) return null;

  const fields = await getPageFieldCatalog(recording);
  const engineered = buildEngineeredQueryTemplate(url, fields, analysis);
  if (engineered) {
    return {
      id: slugify(name || recording.name || "query-skill"),
      name: name || recording.name || "Query skill",
      sourceUrl: recording.url,
      description: `Draft generated from ${recordingFile}. Query parameters were mapped using the LLM endpoint engineering plan and visible website fields where possible.`,
      inputs: engineered.inputs,
      steps: [
        {
          id: "goal",
          request: {
            method: request.method,
            url: `${url.origin}${url.pathname}`,
            headers: stripVolatileHeaders(keepReplayHeaders(request.requestHeaders || {}), recording.url),
            query: engineered.query,
          },
        },
      ],
      outputs: [
        {
          label: "Result",
          from: "goal",
          path: "$",
          extractor: "important",
        },
      ],
    };
  }

  const groupedParams = groupSearchParams(url.searchParams);
  const usedInputIds = new Set();
  const inputs = [];
  const query = {};

  for (const [paramName, values] of groupedParams) {
    const field = findFieldForParam(fields, paramName);
    if (shouldSkipQueryParam(paramName, values, field)) continue;

    if (!shouldAskQueryParam(paramName, values, field)) {
      query[paramName] = values.length > 1 ? values : values[0];
      continue;
    }

    const inputId = uniqueInputId(slugify(field?.label || field?.placeholder || baseParamName(paramName)), usedInputIds);
    inputs.push(toQueryInputSpec(inputId, paramName, values, field));
    query[paramName] = { $value: `{{${inputId}}}` };
  }

  if (!inputs.length) return null;

  return {
    id: slugify(name || recording.name || "query-skill"),
    name: name || recording.name || "Query skill",
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. Questions are based on visible form labels/options where available.`,
    inputs,
    steps: [
      {
        id: "goal",
        request: {
          method: request.method,
          url: `${url.origin}${url.pathname}`,
          headers: stripVolatileHeaders(keepReplayHeaders(request.requestHeaders || {}), recording.url),
          query,
        },
      },
    ],
    outputs: [
      {
        label: "Result",
        from: "goal",
        path: "$",
        extractor: "important",
      },
    ],
  };
}

function buildEngineeredQueryTemplate(url, fields, analysis) {
  const plan = analysis?.endpointEngineering;
  if (!plan || plan.payloadType !== "query") return null;
  const mappings = [...(plan.userInputMappings || []), ...(analysis.inputs || [])].filter((mapping) => mapping.mapsTo?.length);
  if (!mappings.length && !plan.volatileFields?.length) return null;

  const groupedParams = groupSearchParams(url.searchParams);
  const inputs = [];
  const query = {};
  const usedInputIds = new Set();
  const inputIdByMapping = new Map();

  for (const [paramName, values] of groupedParams) {
    const row = {
      path: `query.${paramName}`,
      value: values.length > 1 ? values : values[0],
    };
    const field = findFieldForParam(fields, paramName);
    const technicalOrGenerated = isTechnicalOrGeneratedControl(paramName, field);

    const volatile = findPathPlan(row.path, plan.volatileFields || []);
    if (volatile?.handling === "omit") continue;
    if (volatile?.handling === "ask_user") {
      if (technicalOrGenerated || !isUserFacingField(field)) {
        query[paramName] = values.length > 1 ? values : values[0];
        continue;
      }
      const input = inputFromMappingOrRow(null, row, fields, usedInputIds);
      inputs.push(input);
      query[paramName] = { $value: `{{${input.id}}}` };
      continue;
    }

    const mapping = findPathPlan(row.path, mappings);
    if (mapping) {
      const mappingField = findFieldForMapping(fields, mapping, row);
      if (technicalOrGenerated || !isUserFacingField(mappingField)) {
        query[paramName] = values.length > 1 ? values : values[0];
        continue;
      }
      const mappingKey = mapping.inputId || mapping.id || mapping.question || row.path;
      let inputId = inputIdByMapping.get(mappingKey);
      if (!inputId) {
        const input = inputFromMappingOrRow(mapping, row, fields, usedInputIds);
        inputs.push(input);
        inputId = input.id;
        inputIdByMapping.set(mappingKey, inputId);
      }
      query[paramName] = { $value: `{{${inputId}}}` };
      continue;
    }

    query[paramName] = values.length > 1 ? values : values[0];
  }

  return inputs.length ? { inputs, query } : null;
}

function stripVolatileHeaders(headers, sourceUrl) {
  const clean = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (["x-csrf-token", "x-xsrf-token"].includes(lower)) continue;
    if (lower === "referer" && sourceUrl) {
      clean[key] = sourceUrl;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function groupSearchParams(searchParams) {
  const grouped = new Map();
  for (const [name, value] of searchParams.entries()) {
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(value);
  }
  return grouped;
}

function shouldSkipQueryParam(name, values, field) {
  const normalized = baseParamName(name);
  if (["commit", "utf8", "authenticity_token", "csrf_token", "search_uuid"].includes(normalized)) return true;
  if (/_chosen$/.test(normalized) || /^chosen-/.test(normalized)) return true;
  if (!field && values.every((value) => value === "") && ["sort", "page"].includes(normalized)) return true;
  return false;
}

function shouldAskQueryParam(name, values, field) {
  return shouldAskPayloadPath(name, values, field, { allowUnmatchedSearchParam: true });
}

function shouldAskPayloadPath(name, values, field, options = {}) {
  if (isTechnicalPayloadPath(name) || isTechnicalField(field)) return false;
  if (field) return isUserFacingField(field);
  if (!options.allowUnmatchedSearchParam) return false;
  if (isNonUserControlName(name)) return false;
  return ["term", "q", "query", "search", "keyword", "keywords"].includes(baseParamName(lastPathName(name)).toLowerCase());
}

function toQueryInputSpec(inputId, paramName, values, field) {
  const choices = cleanChoices(field?.options || []);
  const isMulti = paramName.endsWith("[]") || values.length > 1 || Boolean(field?.multiple);
  const spec = {
    id: inputId,
    question: questionForField(paramName, field),
    type: isMulti ? "multi-choice" : choices.length ? "choice" : "string",
    optional: true,
  };

  if (choices.length) spec.choices = choices;
  if (choices.length > 25) {
    spec.description = `Type one or more ${spec.question.toLowerCase()} names or values, separated by commas. Examples: ${choices.slice(0, 5).map((choice) => choice.label).join(", ")}.`;
  }
  return spec;
}

function questionForField(paramName, field) {
  const candidate = cleanText(field?.promptText || field?.label || field?.placeholder || field?.groupLabel || field?.nearbyText || "");
  if (candidate) return readableQuestionLabel(candidate, field, paramName);
  return humanizeName(baseParamName(paramName));
}

function readableQuestionLabel(candidate, field, paramName) {
  const normalizedCandidate = normalizeFieldName(candidate);
  const rawFieldNames = [field?.name, field?.id, paramName].filter(Boolean).map(normalizeFieldName);
  if (/\s/.test(candidate) && !/[_-]|[a-z][A-Z]/.test(candidate)) {
    return candidate;
  }
  if (rawFieldNames.includes(normalizedCandidate) || /[_-]|[a-z][A-Z]/.test(candidate)) {
    return humanizeName(candidate);
  }
  return candidate;
}

function cleanChoices(choices) {
  const seen = new Set();
  const clean = [];
  for (const choice of choices) {
    const label = cleanText(choice.label || choice.text || choice.value);
    const value = choice.value ?? label;
    if (!label || value === undefined || value === "") continue;
    const key = `${label}\u0000${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ label, value, ...(choice.selector ? { selector: choice.selector } : {}) });
  }
  return clean;
}

function findFieldForParam(fields, paramName) {
  const normalized = normalizeFieldName(paramName);
  return fields.find((field) => {
    const names = [
      field.name,
      field.id,
      field.dataInput,
      field.dataSelect,
      field.promptText,
      field.label,
      field.groupLabel,
    ].filter(Boolean).map(normalizeFieldName);
    return names.includes(normalized);
  });
}

async function getPageFieldCatalog(recording) {
  const recordedFields = recording.pageFields?.fields || [];
  const eventFields = fieldsFromRecordedEvents(recording.pageFields?.events || []);
  const playwrightFields = fieldsFromPlaywrightEvidence(recording.playwright);
  if (recordedFields.length) return mergeFieldCatalogs(recordedFields.map(normalizeFieldRecord), eventFields, playwrightFields);

  const htmlFields = await fetchPageFieldCatalog(recording.url).catch(() => []);
  return mergeFieldCatalogs(htmlFields.map(normalizeFieldRecord), eventFields, playwrightFields);
}

function fieldsFromPlaywrightEvidence(playwright) {
  return (playwright?.controls || [])
    .filter((control) => control && control.visible !== false)
    .map((control) => normalizeFieldRecord({
      ...control,
      source: "playwright",
      tag: control.tag || "control",
      type: control.type || control.role || control.tag || "control",
      label: control.label || control.promptText || control.text || "",
      promptText: control.promptText || control.label || "",
      value: control.value || control.text || "",
      options: cleanChoices(control.options || []),
    }));
}

function mergeFieldCatalogs(...catalogs) {
  const merged = [];
  const seen = new Set();
  for (const field of catalogs.flat()) {
    const normalized = normalizeFieldRecord(field);
    const key = [
      normalizeFieldName(normalized.name),
      normalizeFieldName(normalized.id),
      normalizeFieldName(normalized.dataInput),
      normalizeFieldName(normalized.dataSelect),
      normalized.selector,
      normalizeFieldName(normalized.label),
    ].filter(Boolean).join("|");
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(normalized);
  }
  return merged;
}

function fieldsFromRecordedEvents(events) {
  const byKey = new Map();
  for (const event of events || []) {
    if (!event || !["input", "change", "click"].includes(event.type)) continue;
    const tag = event.tag || "";
    const inputType = event.inputType || tag;
    const label = cleanText(event.promptText || event.label || event.groupLabel || event.nearbyText || event.name || event.id || "");

    if (["input", "change"].includes(event.type) && ["input", "select", "textarea"].includes(tag)) {
      const key = event.selector || event.name || event.id || label;
      if (!key) continue;
      byKey.set(key, {
        tag,
        type: inputType,
        name: event.name || "",
        id: event.id || "",
        selector: event.selector || "",
        label,
        promptText: event.promptText || "",
        placeholder: event.placeholder || "",
        value: event.value || "",
        checked: Boolean(event.checked),
        visible: true,
        source: "recorded-event",
        nearbyText: event.nearbyText || "",
        groupLabel: event.groupLabel || "",
        sectionText: event.sectionText || "",
        options: cleanChoices(event.options || []),
      });
      continue;
    }

    if (isChoiceClickEvent(event)) {
      const groupLabel = cleanText(questionForChoiceClickEvent(event, events));
      const options = cleanChoices(event.options || []);
      if (!groupLabel || options.length < 2) continue;
      const key = `choice:${normalizeFieldName(groupLabel)}`;
      byKey.set(key, {
        tag: "select",
        type: "choice",
        name: slugify(groupLabel),
        id: "",
        selector: event.selector || "",
        label: groupLabel,
        promptText: groupLabel,
        placeholder: "",
        value: cleanText(event.value || event.text || ""),
        checked: false,
        visible: true,
        source: "recorded-click-group",
        nearbyText: event.nearbyText || "",
        groupLabel,
        sectionText: event.sectionText || "",
        options,
      });
    }
  }
  return [...byKey.values()].map(normalizeFieldRecord);
}

function isChoiceClickEvent(event) {
  if (!event || event.type !== "click") return false;
  const tag = String(event.tag || "").toLowerCase();
  const role = String(event.role || "").toLowerCase();
  return ["button", "a", "input"].includes(tag) || ["button", "radio", "checkbox", "option", "tab"].includes(role);
}

async function fetchPageFieldCatalog(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Could not fetch page for form labels: ${response.status}`);
  return extractHtmlFormFields(await response.text());
}

function extractHtmlFormFields(html) {
  const fields = [];
  const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  for (const match of html.matchAll(selectRegex)) {
    const attrs = parseAttributes(match[1]);
    fields.push({
      tag: "select",
      type: "select",
      name: attrs.name,
      id: attrs.id,
      label: labelForHtmlField(html, attrs),
      placeholder: attrs.placeholder,
      multiple: Object.hasOwn(attrs, "multiple"),
      dataInput: attrs["data-input"],
      dataSelect: attrs["data-select"],
      options: extractOptions(match[2]),
    });
  }

  const inputRegex = /<input\b([^>]*)>/gi;
  for (const match of html.matchAll(inputRegex)) {
    const attrs = parseAttributes(match[1]);
    fields.push({
      tag: "input",
      type: attrs.type || "text",
      name: attrs.name,
      id: attrs.id,
      label: labelForHtmlField(html, attrs),
      placeholder: attrs.placeholder,
      value: attrs.value,
      dataInput: attrs["data-input"],
      dataSelect: attrs["data-select"],
      options: [],
    });
  }

  const textareaRegex = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
  for (const match of html.matchAll(textareaRegex)) {
    const attrs = parseAttributes(match[1]);
    fields.push({
      tag: "textarea",
      type: "textarea",
      name: attrs.name,
      id: attrs.id,
      label: labelForHtmlField(html, attrs),
      placeholder: attrs.placeholder,
      value: cleanText(match[2]),
      dataInput: attrs["data-input"],
      dataSelect: attrs["data-select"],
      options: [],
    });
  }

  return fields;
}

function extractOptions(html) {
  const options = [];
  const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
  for (const match of html.matchAll(optionRegex)) {
    const attrs = parseAttributes(match[1]);
    options.push({
      value: decodeHtml(attrs.value ?? cleanText(match[2])),
      label: cleanText(match[2]),
    });
  }
  return options;
}

function labelForHtmlField(html, attrs) {
  if (!attrs.id) return "";
  const escapedId = escapeRegExp(attrs.id);
  const labelMatch = html.match(new RegExp(`<label\\b[^>]*for=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/label>`, "i"));
  return labelMatch ? cleanText(labelMatch[1]) : "";
}

function parseAttributes(source) {
  const attrs = {};
  const attrRegex = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const match of source.matchAll(attrRegex)) {
    attrs[match[1]] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

async function installInteractionRecorder(client) {
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: INTERACTION_RECORDER_SCRIPT,
  });
  await client.send("Runtime.evaluate", {
    expression: INTERACTION_RECORDER_SCRIPT,
  });
}

async function collectPageFields(client) {
  const expression = String.raw`(() => {
    const compact = (value, limit = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
    const CONTROL_SELECTOR = "input, select, textarea, button, a, [role='button'], [role='radio'], [role='checkbox'], [role='combobox'], [role='option']";
    const cssEscape = (value) => {
      if (window.CSS && CSS.escape) return CSS.escape(value);
      return String(value).replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, "\\$&");
    };
    const selectorFor = (element) => {
      if (!element || !element.tagName) return "";
      if (element.id) return "#" + cssEscape(element.id);
      if (element.name) return element.tagName.toLowerCase() + "[name=\"" + String(element.name).replace(/"/g, "\\\"") + "\"]";
      const parts = [];
      let current = element;
      while (current && current.nodeType === 1 && parts.length < 5) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
        parts.unshift(part);
        current = parent;
      }
      return parts.join(" > ");
    };
    const labelTextFor = (element) => {
      if (element.labels && element.labels.length) {
        return compact(Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" "));
      }
      if (element.id) {
        const explicit = Array.from(document.querySelectorAll("label")).find((label) => label.htmlFor === element.id);
        if (explicit) return compact(explicit.innerText || explicit.textContent || "");
      }
      const wrapping = element.closest("label");
      if (wrapping) return compact(wrapping.innerText || wrapping.textContent || "");
      return compact(element.getAttribute("aria-label") || element.getAttribute("placeholder") || "");
    };
    const resolvedLabelledByText = (element) => {
      const ids = compact(element.getAttribute?.("aria-labelledby") || "", 500).split(/\s+/).filter(Boolean);
      return compact(ids.map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "").filter(Boolean).join(" "), 160);
    };
    const nonControlText = (element, currentElement) => {
      if (!element) return "";
      const clone = element.cloneNode(true);
      clone.querySelectorAll(CONTROL_SELECTOR).forEach((control) => control.remove());
      if (currentElement?.id) clone.querySelector("#" + cssEscape(currentElement.id))?.remove();
      return compact(clone.innerText || clone.textContent || "", 180);
    };
    const precedingTextFor = (element) => {
      const candidates = [];
      let current = element;
      for (let depth = 0; current && current.parentElement && depth < 4; depth += 1) {
        const siblings = Array.from(current.parentElement.children);
        const index = siblings.indexOf(current);
        for (let i = index - 1; i >= 0 && i >= index - 4; i -= 1) {
          const text = nonControlText(siblings[i], element);
          if (text) candidates.push(text);
        }
        current = current.parentElement;
      }
      return bestQuestionCandidate(candidates);
    };
    const groupContainerFor = (element) => element.closest?.("fieldset, [role='radiogroup'], [role='group'], .form-group, .field, .question, .control-group, form, section") || element.parentElement;
    const groupQuestionFor = (element) => {
      const fieldset = element.closest?.("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend) return compact(legend.innerText || legend.textContent || "", 160);
      const group = groupContainerFor(element);
      const ariaLabel = compact(group?.getAttribute?.("aria-label") || "", 160);
      if (ariaLabel) return ariaLabel;
      const labelled = group ? resolvedLabelledByText(group) : "";
      if (labelled) return labelled;
      const ownLabelled = resolvedLabelledByText(element);
      if (ownLabelled) return ownLabelled;
      const heading = group ? Array.from(group.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,label,[aria-label]"))
        .map((item) => compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 160))
        .filter(Boolean)[0] : "";
      if (heading) return heading;
      const withoutControls = nonControlText(group, element);
      const bestFromGroup = bestQuestionCandidate(withoutControls.split(/(?<=[?:])\s+|[|]/).map((text) => compact(text, 160)).filter(Boolean));
      return bestFromGroup || precedingTextFor(element);
    };
    const questionScore = (text) => {
      const value = compact(text, 160);
      if (!value || value.length < 2 || value.length > 140) return -100;
      let score = 0;
      if (/[?:]$/.test(value)) score += 25;
      if (/^(what|which|who|where|when|how|do you|are you|is this|i am a(?:n)?|i need|looking to|select|choose)\b/i.test(value)) score += 50;
      if (/\b(name|email|phone|postal|postcode|destination|date|height|weight|salary|country|category|plan|coverage|property|travelling|leaving|arriving)\b/i.test(value)) score += 15;
      if (/\b(insurance|discount|promo|notice|terms|privacy|help|login|copyright|enable javascript)\b/i.test(value)) score -= 25;
      if (/%|\$\d|within minutes|instant savings/i.test(value)) score -= 20;
      score -= Math.max(0, value.split(/\s+/).length - 12);
      return score;
    };
    const bestQuestionCandidate = (items) => items
      .map((text) => compact(text, 160))
      .filter(Boolean)
      .sort((a, b) => questionScore(b) - questionScore(a) || a.length - b.length)[0] || "";
    const promptTextFor = (element) => {
      const direct = bestQuestionCandidate([labelTextFor(element), resolvedLabelledByText(element)]);
      if (direct) return direct;
      const candidates = [
        groupQuestionFor(element),
        precedingTextFor(element),
      ].filter(Boolean);
      return bestQuestionCandidate(candidates);
    };
    const nearbyTextFor = (element) => {
      const pieces = [];
      let current = element;
      while (current && current.parentElement && pieces.join(" ").length < 400) {
        const siblings = Array.from(current.parentElement.children);
        const index = siblings.indexOf(current);
        for (const sibling of siblings.slice(Math.max(0, index - 4), index).reverse()) {
          const text = compact(sibling.innerText || sibling.textContent || "", 160);
          if (text) pieces.unshift(text);
        }
        current = current.parentElement;
      }
      return compact(pieces.join(" "), 400);
    };
    const groupLabelFor = (element) => {
      const prompt = promptTextFor(element);
      if (prompt) return prompt;
      const legend = element.closest("fieldset")?.querySelector("legend");
      if (legend) return compact(legend.innerText || legend.textContent || "");
      const group = element.closest("[role='radiogroup'], [role='group'], .form-group, .field, .question, .control-group");
      const aria = group?.getAttribute("aria-label") || group?.getAttribute("aria-labelledby");
      if (aria && !aria.includes(" ")) {
        const labelled = document.getElementById(aria);
        if (labelled) return compact(labelled.innerText || labelled.textContent || "");
      }
      if (aria) return compact(aria);
      const nearby = nearbyTextFor(element);
      return nearby ? compact(nearby.split(/[.?!]\s+/)[0], 120) : "";
    };
    const sectionTextFor = (element) => {
      const section = element.closest("fieldset, form, section, article, [role='group'], [role='radiogroup']") || element.parentElement;
      return compact(section?.innerText || section?.textContent || "", 600);
    };
    const optionGroupFor = (element) => {
      const tag = element.tagName.toLowerCase();
      const type = (element.getAttribute("type") || "").toLowerCase();
      if (tag === "select") {
        return Array.from(element.options).map((option) => ({
          label: option.textContent || "",
          value: option.value || "",
          selected: option.selected,
        })).filter((option) => option.label || option.value);
      }
      if (tag === "textarea" || (tag === "input" && !["radio", "checkbox", "button"].includes(type))) return [];
      const parent = element.closest("[role='radiogroup'], [role='group']") || element.parentElement;
      if (!parent) return [];
      const controls = Array.from(parent.querySelectorAll(CONTROL_SELECTOR));
      return controls.slice(0, 40).map((item) => ({
        label: compact(item.innerText || item.textContent || item.getAttribute("aria-label") || item.value || "", 120),
        value: item.value || compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 120),
        selector: selectorFor(item),
        selected: Boolean(item.checked || item.selected || item.getAttribute("aria-pressed") === "true" || item.getAttribute("aria-checked") === "true"),
      })).filter((option) => option.label || option.value);
    };
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const valueFor = (element) => element.value || element.getAttribute("aria-valuetext") || element.getAttribute("aria-value") || element.getAttribute("data-value") || element.getAttribute("value") || "";
    const fields = Array.from(document.querySelectorAll("input, select, textarea, [role='combobox'], [role='radio'], [role='checkbox']"))
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute("type") || element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      selector: selectorFor(element),
      label: labelTextFor(element),
      promptText: promptTextFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      value: valueFor(element),
      checked: Boolean(element.checked),
      multiple: Boolean(element.multiple),
      visible: isVisible(element),
      dataInput: element.getAttribute("data-input") || "",
      dataSelect: element.getAttribute("data-select") || "",
      nearbyText: nearbyTextFor(element),
      groupLabel: groupLabelFor(element),
      sectionText: sectionTextFor(element),
      options: optionGroupFor(element),
    }));
    return {
      url: location.href,
      title: document.title,
      text: document.body ? document.body.innerText.slice(0, 5000) : "",
      fields,
      events: window.__apiSkillBuilderEvents || []
    };
  })()`;
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return result.result?.result?.value || { fields: [] };
}

const INTERACTION_RECORDER_SCRIPT = String.raw`(() => {
  if (window.__apiSkillBuilderRecorderInstalled) return;
  window.__apiSkillBuilderRecorderInstalled = true;
  window.__apiSkillBuilderEvents = window.__apiSkillBuilderEvents || [];

  const compact = (value, limit = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const CONTROL_SELECTOR = "input, select, textarea, button, a, [role='button'], [role='radio'], [role='checkbox'], [role='combobox'], [role='option']";
  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, "\\$&");
  };
  const selectorFor = (element) => {
    if (!element || !element.tagName) return "";
    if (element.id) return "#" + cssEscape(element.id);
    if (element.name) return element.tagName.toLowerCase() + "[name=\"" + String(element.name).replace(/"/g, "\\\"") + "\"]";
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };
  const nearbyTextFor = (element) => {
    const pieces = [];
    let current = element;
    while (current && current.parentElement && pieces.join(" ").length < 400) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      for (const sibling of siblings.slice(Math.max(0, index - 4), index).reverse()) {
        const text = compact(sibling.innerText || sibling.textContent || "", 160);
        if (text) pieces.unshift(text);
      }
      current = current.parentElement;
    }
    return compact(pieces.join(" "), 400);
  };
  const groupLabelFor = (element) => {
    const prompt = promptTextFor(element);
    if (prompt) return prompt;
    const legend = element.closest && element.closest("fieldset")?.querySelector("legend");
    if (legend) return compact(legend.innerText || legend.textContent || "");
    const group = element.closest && element.closest("[role='radiogroup'], [role='group'], .form-group, .field, .question, .control-group");
    const aria = group?.getAttribute("aria-label") || group?.getAttribute("aria-labelledby");
    if (aria && !aria.includes(" ")) {
      const labelled = document.getElementById(aria);
      if (labelled) return compact(labelled.innerText || labelled.textContent || "");
    }
    if (aria) return compact(aria);
    const nearby = nearbyTextFor(element);
    return nearby ? compact(nearby.split(/[.?!]\s+/)[0], 120) : "";
  };
  const sectionTextFor = (element) => {
    const section = element.closest && (element.closest("fieldset, form, section, article, [role='group'], [role='radiogroup']") || element.parentElement);
    return compact(section?.innerText || section?.textContent || "", 600);
  };
  const optionGroupFor = (element) => {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (tag === "select") {
      return Array.from(element.options).map((option) => ({
        label: option.textContent || "",
        value: option.value || "",
        selected: option.selected,
      })).filter((option) => option.label || option.value);
    }
    if (tag === "textarea" || (tag === "input" && !["radio", "checkbox", "button"].includes(type))) return [];
    const parent = element.closest && (element.closest("[role='radiogroup'], [role='group']") || element.parentElement);
    if (!parent) return [];
    const controls = Array.from(parent.querySelectorAll(CONTROL_SELECTOR));
    return controls.slice(0, 40).map((item) => ({
      label: compact(item.innerText || item.textContent || item.getAttribute("aria-label") || item.value || "", 120),
      value: item.value || compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 120),
      selector: selectorFor(item),
      selected: Boolean(item.checked || item.selected || item.getAttribute("aria-pressed") === "true" || item.getAttribute("aria-checked") === "true"),
    })).filter((option) => option.label || option.value);
  };
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const valueFor = (element) => element.value || element.getAttribute("aria-valuetext") || element.getAttribute("aria-value") || element.getAttribute("data-value") || element.getAttribute("value") || "";
  const labelFor = (element) => {
    if (element.labels && element.labels.length) {
      return compact(Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" "));
    }
    if (element.id) {
      const explicit = Array.from(document.querySelectorAll("label")).find((label) => label.htmlFor === element.id);
      if (explicit) return compact(explicit.innerText || explicit.textContent || "");
    }
    const label = element.closest && element.closest("label");
    if (label) return compact(label.innerText || label.textContent || "");
    return element.getAttribute && compact(element.getAttribute("aria-label") || element.getAttribute("placeholder") || "");
  };
  const resolvedLabelledByText = (element) => {
    const ids = compact(element.getAttribute?.("aria-labelledby") || "", 500).split(/\s+/).filter(Boolean);
    return compact(ids.map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "").filter(Boolean).join(" "), 160);
  };
  const nonControlText = (element, currentElement) => {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll(CONTROL_SELECTOR).forEach((control) => control.remove());
    if (currentElement?.id) clone.querySelector("#" + cssEscape(currentElement.id))?.remove();
    return compact(clone.innerText || clone.textContent || "", 180);
  };
  const precedingTextFor = (element) => {
    const candidates = [];
    let current = element;
    for (let depth = 0; current && current.parentElement && depth < 4; depth += 1) {
      const siblings = Array.from(current.parentElement.children);
      const index = siblings.indexOf(current);
      for (let i = index - 1; i >= 0 && i >= index - 4; i -= 1) {
        const text = nonControlText(siblings[i], element);
        if (text) candidates.push(text);
      }
      current = current.parentElement;
    }
    return bestQuestionCandidate(candidates);
  };
  const groupContainerFor = (element) => element.closest?.("fieldset, [role='radiogroup'], [role='group'], .form-group, .field, .question, .control-group, form, section") || element.parentElement;
  const groupQuestionFor = (element) => {
    const fieldset = element.closest?.("fieldset");
    const legend = fieldset?.querySelector("legend");
    if (legend) return compact(legend.innerText || legend.textContent || "", 160);
    const group = groupContainerFor(element);
    const ariaLabel = compact(group?.getAttribute?.("aria-label") || "", 160);
    if (ariaLabel) return ariaLabel;
    const labelled = group ? resolvedLabelledByText(group) : "";
    if (labelled) return labelled;
    const ownLabelled = resolvedLabelledByText(element);
    if (ownLabelled) return ownLabelled;
    const heading = group ? Array.from(group.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,label,[aria-label]"))
      .map((item) => compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 160))
      .filter(Boolean)[0] : "";
    if (heading) return heading;
    const withoutControls = nonControlText(group, element);
    const bestFromGroup = bestQuestionCandidate(withoutControls.split(/(?<=[?:])\s+|[|]/).map((text) => compact(text, 160)).filter(Boolean));
    return bestFromGroup || precedingTextFor(element);
  };
  const questionScore = (text) => {
    const value = compact(text, 160);
    if (!value || value.length < 2 || value.length > 140) return -100;
    let score = 0;
    if (/[?:]$/.test(value)) score += 25;
    if (/^(what|which|who|where|when|how|do you|are you|is this|i am a(?:n)?|i need|looking to|select|choose)\b/i.test(value)) score += 50;
    if (/\b(name|email|phone|postal|postcode|destination|date|height|weight|salary|country|category|plan|coverage|property|travelling|leaving|arriving)\b/i.test(value)) score += 15;
    if (/\b(insurance|discount|promo|notice|terms|privacy|help|login|copyright|enable javascript)\b/i.test(value)) score -= 25;
    if (/%|\$\d|within minutes|instant savings/i.test(value)) score -= 20;
    score -= Math.max(0, value.split(/\s+/).length - 12);
    return score;
  };
  const bestQuestionCandidate = (items) => items
    .map((text) => compact(text, 160))
    .filter(Boolean)
    .sort((a, b) => questionScore(b) - questionScore(a) || a.length - b.length)[0] || "";
  const promptTextFor = (element) => {
    const direct = bestQuestionCandidate([labelFor(element), resolvedLabelledByText(element)]);
    if (direct) return direct;
    const candidates = [
      groupQuestionFor(element),
      precedingTextFor(element),
    ].filter(Boolean);
    return bestQuestionCandidate(candidates);
  };
  const localControlsFor = (element) => {
    const root = groupContainerFor(element) || element.parentElement || document.body;
    return Array.from(root.querySelectorAll(CONTROL_SELECTOR))
      .filter((control, index, all) => all.indexOf(control) === index && isVisible(control))
      .slice(0, 30)
      .map((control) => ({
        tag: control.tagName.toLowerCase(),
        role: control.getAttribute("role") || "",
        type: control.getAttribute("type") || "",
        selector: selectorFor(control),
        promptText: promptTextFor(control),
        label: labelFor(control),
        text: compact(control.innerText || control.textContent || "", 100),
        value: valueFor(control),
        checked: Boolean(control.checked || control.getAttribute("aria-checked") === "true" || control.getAttribute("aria-pressed") === "true"),
      }))
      .filter((control) => control.promptText || control.label || control.text || control.value);
  };
  const record = (type, element) => {
    if (!element || !element.tagName) return;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") || "";
    if (!["input", "select", "textarea", "button", "a"].includes(tag) && !element.matches(CONTROL_SELECTOR)) return;
    window.__apiSkillBuilderEvents.push({
      type,
      ts: Date.now(),
      selector: selectorFor(element),
      tag,
      role,
      inputType: element.getAttribute("type") || tag,
      id: element.id || "",
      name: element.getAttribute("name") || "",
      label: labelFor(element),
      promptText: promptTextFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      text: compact(element.innerText || element.textContent || "", 200),
      value: valueFor(element),
      checked: Boolean(element.checked),
      nearbyText: nearbyTextFor(element),
      groupLabel: groupLabelFor(element),
      sectionText: sectionTextFor(element),
      options: optionGroupFor(element),
      localControls: localControlsFor(element),
      url: location.href
    });
    if (window.__apiSkillBuilderEvents.length > 500) window.__apiSkillBuilderEvents.shift();
  };
  document.addEventListener("input", (event) => record("input", event.target), true);
  document.addEventListener("change", (event) => record("change", event.target), true);
  document.addEventListener("click", (event) => {
    const target = event.target?.closest
      ? event.target.closest(CONTROL_SELECTOR) || event.target
      : event.target?.parentElement;
    record("click", target);
  }, true);
})()`;

function normalizeFieldRecord(field) {
  return {
    ...field,
    promptText: cleanText(field.promptText || ""),
    label: cleanText(field.label || ""),
    placeholder: cleanText(field.placeholder || ""),
    selector: field.selector || "",
    name: field.name || "",
    id: field.id || "",
    type: field.type || field.tag || "text",
    role: field.role || "",
    nearbyText: cleanText(field.nearbyText || ""),
    groupLabel: cleanText(field.groupLabel || ""),
    sectionText: cleanText(field.sectionText || ""),
    source: field.source || "",
    options: cleanChoices(field.options || []),
    localControls: Array.isArray(field.localControls) ? field.localControls : [],
  };
}

function isUserFacingField(field) {
  if (!field || isTechnicalField(field) || isLikelyHiddenField(field)) return false;
  const type = String(field.type || "").toLowerCase();
  if (["submit", "button", "image", "reset", "file"].includes(type)) return type === "file";
  const role = String(field.role || "").toLowerCase();
  if (["button", "link", "tab"].includes(role)) return false;

  const readableEvidence = [
    field.promptText,
    field.label,
    field.placeholder,
    field.groupLabel,
    field.nearbyText,
  ].some((value) => cleanText(value).length > 0);
  if (readableEvidence) return true;
  if (cleanChoices(field.options || []).length > 1) return true;

  const evidenceSource = String(field.source || "");
  const capturedFromVisibleBrowser = ["recorded-event", "recorded-click-group", "playwright"].includes(evidenceSource);
  if (capturedFromVisibleBrowser && field.visible === true) {
    return Boolean(field.selector || field.value || field.text);
  }

  return false;
}

function isLikelyHiddenField(field) {
  if (!field) return false;
  const type = String(field.type || "").toLowerCase();
  if (["hidden", "submit", "button", "image", "reset"].includes(type)) return true;
  if (field.visible === true) return false;
  if (field.tag === "select" && field.options?.length) return false;
  return field.visible === false;
}

function isTechnicalField(field) {
  if (!field) return false;
  return [field.name, field.id, field.dataInput, field.dataSelect, field.promptText, field.label, field.placeholder]
    .filter(Boolean)
    .some(isTechnicalFieldName);
}

function isTechnicalOrGeneratedControl(name, field) {
  if (isTechnicalFieldName(name) || isTechnicalField(field)) return true;
  if (field && isUserFacingField(field)) return false;
  return isNonUserControlName(name);
}

function isTechnicalPayloadPath(pathExpression) {
  const raw = String(pathExpression || "");
  return raw.split(/[.[\]]+/).filter(Boolean).some(isTechnicalFieldName);
}

function isTechnicalFieldName(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  const base = baseParamName(lastPathName(raw));
  const normalized = normalizeFieldName(base);
  return TECHNICAL_FIELD_PATTERNS.some((pattern) => pattern.test(raw) || pattern.test(base) || pattern.test(normalized));
}

function isNonUserControlName(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  const base = baseParamName(lastPathName(raw));
  const normalized = normalizeFieldName(base);
  return NON_USER_CONTROL_PATTERNS.some((pattern) => pattern.test(raw) || pattern.test(base) || pattern.test(normalized));
}

function isTechnicalInputSpec(inputSpec) {
  const haystack = [inputSpec?.id, inputSpec?.question, inputSpec?.description]
    .filter(Boolean)
    .join(" ");
  return isTechnicalFieldName(inputSpec?.id)
    || isTechnicalFieldName(inputSpec?.question)
    || /^\s*(?:value for|\$\.)/i.test(String(inputSpec?.question || ""))
    || /\b(?:viewstate|eventvalidation|csrf|xsrf|captcha|recaptcha|turnstile|nonce|authenticity token|request verification token)\b/i.test(haystack);
}

function baseParamName(name) {
  return String(name).replace(/\[\]$/, "");
}

function normalizeFieldName(name) {
  return baseParamName(name)
    .toLowerCase()
    .replace(/[_-]+chosen$/, "")
    .replace(/^chosen[_-]+/, "")
    .replace(/[_-]+/g, "");
}

function humanizeName(name) {
  const words = String(name)
    .replace(/\[\]$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      const replacements = {
        cap: "CAP",
        cgpa: "CGPA",
        gpa: "GPA",
        dob: "Date of birth",
        mc: "MCs",
        mcs: "MCs",
        mod: "Module",
        num: "Number",
        qty: "Quantity",
        url: "URL",
        id: "ID",
      };
      return replacements[lower] || lower.replace(/\b\w/g, (letter) => letter.toUpperCase());
    });
  return cleanText(words.join(" "));
}

function lowercaseFirst(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function cleanText(value) {
  return decodeHtml(String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\x20-\x7E]+/g, " ")
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function maybeCreateTallySkill({ recording, request, recordingFile, name }) {
  const match = request.url?.match(/^https:\/\/api\.tally\.so\/forms\/([^/]+)\/respond/);
  if (!match || request.method !== "POST" || !request.postData) return null;

  let body;
  try {
    body = JSON.parse(request.postData);
  } catch {
    return null;
  }
  if (!body.responses || typeof body.responses !== "object") return null;

  const formId = match[1];
  const formSchema = await fetchTallySchema(recording.url).catch(() => null);
  const fields = formSchema ? buildTallyFieldMap(formSchema.blocks || []) : new Map();
  const usedInputIds = new Set();
  const inputs = [];
  const templatedResponses = {};

  for (const [responseId, recordedValue] of Object.entries(body.responses)) {
    const field = fields.get(responseId) || inferTallyField(responseId, recordedValue);
    const inputId = uniqueInputId(slugify(field.label || responseId), usedInputIds);
    inputs.push(toTallyInputSpec(inputId, field, recordedValue));
    templatedResponses[responseId] = toTallyResponseTemplate(inputId, field, recordedValue);
  }

  return {
    id: slugify(name || recording.name || `tally-${formId}`),
    name: name || recording.name || `Tally form ${formId}`,
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. Questions are extracted from the form where possible; review file-upload fields before production use.`,
    provider: "tally",
    providerConfig: {
      formId,
      origin: safeUrl(recording.url).origin,
    },
    computed: {
      sessionUuid: { fn: "uuid" },
      respondentUuid: { fn: "uuid" },
    },
    inputs,
    steps: [
      {
        id: "submit",
        request: {
          method: "POST",
          url: request.url,
          headers: keepReplayHeaders(request.requestHeaders || {}),
          body: {
            sessionUuid: "{{sessionUuid}}",
            respondentUuid: "{{respondentUuid}}",
            responses: templatedResponses,
            captchas: {},
            isCompleted: true,
            password: null,
          },
        },
      },
    ],
    outputs: [
      {
        label: "Submit response",
        from: "submit",
        path: "$",
      },
    ],
  };
}

async function fetchTallySchema(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) throw new Error(`Could not fetch Tally page: ${response.status}`);
  const html = await response.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s);
  if (!match) throw new Error("Could not find Tally __NEXT_DATA__");
  const data = JSON.parse(match[1]);
  return data.props?.pageProps || null;
}

function buildTallyFieldMap(blocks) {
  const fields = new Map();
  let currentTitle = "";

  for (const block of blocks) {
    const titleText = blockText(block);
    if (block.type === "TITLE" && titleText) {
      currentTitle = titleText;
      continue;
    }

    const groupUuid = block.groupUuid;
    if (!groupUuid) continue;

    if (isTallyOptionBlock(block)) {
      const field = ensureTallyField(fields, groupUuid, {
        blockGroupUuid: groupUuid,
        label: currentTitle || groupUuid,
        tallyType: block.groupType,
        required: Boolean(block.payload?.isRequired),
        options: [],
      });
      field.options.push({
        label: block.payload?.text || titleText || block.uuid,
        value: block.uuid,
      });
      field.required ||= Boolean(block.payload?.isRequired);
      continue;
    }

    if (isTallyInputBlock(block)) {
      const label = block.payload?.name || currentTitle || block.payload?.placeholder || groupUuid;
      const field = ensureTallyField(fields, groupUuid, {
        blockGroupUuid: groupUuid,
        label,
        tallyType: block.groupType || block.type,
        required: Boolean(block.payload?.isRequired),
        options: [],
      });
      field.label = label;
      field.tallyType = block.groupType || block.type;
      field.required = Boolean(block.payload?.isRequired);
      if (block.payload?.stars) {
        field.choices = Array.from({ length: Number(block.payload.stars) }, (_, index) => String(index + 1));
      }
    }
  }

  return fields;
}

function ensureTallyField(fields, groupUuid, defaults) {
  if (!fields.has(groupUuid)) fields.set(groupUuid, { ...defaults });
  return fields.get(groupUuid);
}

function isTallyOptionBlock(block) {
  return [
    "DROPDOWN_OPTION",
    "CHECKBOX",
    "MULTIPLE_CHOICE_OPTION",
  ].includes(block.type);
}

function isTallyInputBlock(block) {
  return [
    "INPUT_TEXT",
    "INPUT_EMAIL",
    "INPUT_LINK",
    "TEXTAREA",
    "FILE_UPLOAD",
    "RATING",
    "LINEAR_SCALE",
    "DROPDOWN",
    "CHECKBOXES",
    "MULTIPLE_CHOICE",
  ].includes(block.groupType || block.type);
}

function blockText(block) {
  const safeHTMLSchema = block.payload?.safeHTMLSchema;
  if (Array.isArray(safeHTMLSchema)) {
    const text = safeHTMLSchema.flat(Infinity).filter((value) => typeof value === "string").join(" ");
    if (text.trim()) return text.replace(/\s+/g, " ").trim();
  }
  return block.payload?.text || block.payload?.name || "";
}

function inferTallyField(responseId, value) {
  return {
    blockGroupUuid: responseId,
    label: responseId,
    tallyType: Array.isArray(value) ? "CHECKBOXES" : typeof value === "number" ? "NUMBER" : "INPUT_TEXT",
    required: true,
    options: [],
  };
}

function toTallyInputSpec(inputId, field, recordedValue) {
  const spec = {
    id: inputId,
    question: field.label,
    type: "string",
    optional: !field.required,
  };

  if (field.tallyType === "INPUT_EMAIL") spec.type = "email";
  if (field.tallyType === "INPUT_LINK") spec.type = "url";
  if (field.tallyType === "TEXTAREA") spec.type = "string";
  if (field.tallyType === "RATING" || field.tallyType === "LINEAR_SCALE" || typeof recordedValue === "number") {
    spec.type = "number";
    if (field.choices?.length) spec.choices = field.choices;
  }
  if (field.tallyType === "DROPDOWN" || field.tallyType === "MULTIPLE_CHOICE") {
    spec.type = "choice";
    spec.choices = field.options || [];
  }
  if (field.tallyType === "CHECKBOXES") {
    spec.type = "multi-choice";
    spec.choices = field.options || [];
  }
  if (field.tallyType === "FILE_UPLOAD") {
    spec.type = "file";
    spec.question = field.label;
    spec.description = "Paste a local file path, for example C:\\Users\\User\\Downloads\\Resume.pdf.";
    spec.tally = {
      blockGroupUuid: field.blockGroupUuid,
    };
  } else if (Array.isArray(recordedValue) && recordedValue[0] && typeof recordedValue[0] === "object") {
    spec.type = "json";
    spec.question = field.label;
    spec.description = "File upload replay is not fully automated yet. Paste the Tally upload object array captured from a browser upload.";
  }
  return spec;
}

function toTallyResponseTemplate(inputId, field, recordedValue) {
  if (field.tallyType === "FILE_UPLOAD") {
    return { $value: `{{${inputId}}}` };
  }
  if (field.tallyType === "DROPDOWN" || field.tallyType === "MULTIPLE_CHOICE") {
    return [`{{${inputId}}}`];
  }
  if (field.tallyType === "CHECKBOXES" || Array.isArray(recordedValue)) {
    return { $value: `{{${inputId}}}` };
  }
  return `{{${inputId}}}`;
}

function uniqueInputId(base, used) {
  let candidate = base || "input";
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function templateScalars(value, prefix = "$") {
  if (value === null || typeof value !== "object") {
    return `{{${inputIdFromPath(prefix)}}}`;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => templateScalars(item, `${prefix}[${index}]`));
  }
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = templateScalars(child, `${prefix}.${key}`);
  }
  return output;
}

function keepReplayHeaders(headers) {
  const keep = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (
      ["accept", "content-type", "origin", "referer"].includes(lower) ||
      isBrowserPublicReplayHeader(lower, value) ||
      lower.startsWith("x-")
    ) {
      keep[key] = value;
    }
  }
  return keep;
}

function isBrowserPublicReplayHeader(lower, value) {
  if (["client_id", "client-id", "client_secret", "client-secret", "gi-tkn"].includes(lower)) return true;
  if (lower === "token" && value && !/^bearer\s/i.test(String(value))) return true;
  return false;
}

function inputIdFromPath(pathExpression) {
  return pathExpression
    .replace(/^\$\./, "")
    .replace(/^\$/, "value")
    .replace(/\[(\d+)\]/g, "_$1")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_");
}

function safeUrl(url) {
  try {
    return new URL(url);
  } catch {
    return new URL("https://invalid.local/");
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "skill";
}
