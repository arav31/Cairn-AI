import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CdpClient, getPageTarget, launchChrome, sleep } from "./cdp.js";
import { flattenScalars } from "./json-path.js";
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
  const pageFields = await collectPageFields(client).catch((error) => ({
    error: error.message,
    fields: [],
  }));

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
      return writeDraftSkill(finalizeSkill(skill, { analysis, recordingFile, recording }));
    }
  }

  const fallbackSkill =
    await maybeCreateFinalUrlQuerySkill({ recording, recordingFile, name }) ||
    await maybeCreateBrowserReplaySkill({ recording, recordingFile, name });

  if (fallbackSkill) {
    return writeDraftSkill(finalizeSkill(fallbackSkill, { analysis, recordingFile, recording }));
  }

  throw new Error("No reusable API endpoint, result URL, or browser input workflow was detected. Record the workflow again after interacting with the actual form/result controls.");
}

async function safeAnalyzeRecording(recording, candidates) {
  const status = llmAnalysisStatus();
  if (!status.enabled) return null;
  try {
    return await analyzeRecordingWithLlm(recording, candidates);
  } catch (error) {
    if (process.env.SKILL_BUILDER_LLM_REQUIRED === "1") throw error;
    console.warn(`LLM contextual analysis skipped: ${error.message}`);
    return null;
  }
}

async function createPreferredFallbackSkill({ recording, recordingFile, name, analysis }) {
  const kind = analysis?.strategy?.kind;
  if (kind === "browser_result_url") {
    return maybeCreateFinalUrlQuerySkill({ recording, recordingFile, name });
  }
  if (kind === "browser_replay") {
    return maybeCreateBrowserReplaySkill({ recording, recordingFile, name });
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
        body = conservative.body;
        inputs = conservative.inputs;
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

  const skill = {
    id: slugify(name || recording.name || "draft-skill"),
    name: name || recording.name || "Draft skill",
    sourceUrl: recording.url,
    description: `Draft generated from ${recordingFile}. Review before using.`,
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

async function maybeCreateBrowserReplaySkill({ recording, recordingFile, name }) {
  const events = recording.pageFields?.events || [];
  const inputEvents = latestInputEvents(events);
  const clickEvents = events.filter((event) => event.type === "click" && event.selector);
  if (!inputEvents.length && !clickEvents.length) return null;

  const usedInputIds = new Set();
  const inputs = inputEvents.map((event) => {
    const question = questionForRecordedEvent(event);
    const inputId = uniqueInputId(slugify(question || event.name || event.id || "input"), usedInputIds);
    event.inputId = inputId;
    return {
      id: inputId,
      question,
      type: inferInputTypeFromValues([event.value]),
      optional: false,
    };
  });
  const lastClick = [...events].reverse().find((event) => event.type === "click" && event.selector);
  const actions = inputEvents.map((event) => ({
    type: "fill",
    selector: event.selector,
    value: `{{${event.inputId}}}`,
  }));
  if (inputEvents.length && lastClick) {
    actions.push({ type: "click", selector: lastClick.selector });
  } else if (!inputEvents.length) {
    actions.push(...clickEvents.map((event) => ({ type: "click", selector: event.selector })));
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

function questionForRecordedEvent(event) {
  const candidate = cleanText(event.label || event.placeholder || event.groupLabel || event.nearbyText || event.name || event.id || "Input");
  return readableQuestionLabel(candidate, { name: event.name, id: event.id }, event.name || event.id || candidate);
}

function latestInputEvents(events) {
  const bySelector = new Map();
  for (const event of events) {
    if (!["input", "change"].includes(event.type)) continue;
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
  for (const row of flattenScalars(body)) {
    if (row.value === "" || row.value === null || row.value === undefined) continue;
    const field = findFieldForParam(fields, inputIdFromPath(row.path));
    if (!shouldAskPayloadPath(row.path, [row.value], field)) continue;
    const input = toBodyInputSpec(row, fields, usedInputIds);
    inputs.push(input);
    setPathValue(template, row.path, `{{${input.id}}}`);
  }
  return { body: template, inputs };
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
  const candidate = cleanText(field?.label || field?.placeholder || field?.groupLabel || field?.nearbyText || "");
  if (candidate) return readableQuestionLabel(candidate, field, paramName);
  return humanizeName(baseParamName(paramName));
}

function readableQuestionLabel(candidate, field, paramName) {
  const normalizedCandidate = normalizeFieldName(candidate);
  const rawFieldNames = [field?.name, field?.id, paramName].filter(Boolean).map(normalizeFieldName);
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
    clean.push({ label, value });
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
      field.label,
      field.groupLabel,
    ].filter(Boolean).map(normalizeFieldName);
    return names.includes(normalized);
  });
}

async function getPageFieldCatalog(recording) {
  const recordedFields = recording.pageFields?.fields || [];
  const eventFields = fieldsFromRecordedEvents(recording.pageFields?.events || []);
  if (recordedFields.length) return mergeFieldCatalogs(recordedFields.map(normalizeFieldRecord), eventFields);

  const htmlFields = await fetchPageFieldCatalog(recording.url).catch(() => []);
  return mergeFieldCatalogs(htmlFields.map(normalizeFieldRecord), eventFields);
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
    const label = cleanText(event.label || event.groupLabel || event.nearbyText || event.name || event.id || "");

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

    if (event.type === "click" && ["button", "a", "input"].includes(tag)) {
      const groupLabel = cleanText(event.groupLabel || event.nearbyText || "");
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
      const parent = element.closest("[role='radiogroup'], [role='group']") || element.parentElement;
      if (!parent) return [];
      const controls = Array.from(parent.querySelectorAll("button, [role='button'], input[type='button'], input[type='radio'], input[type='checkbox'], option"));
      return controls.slice(0, 40).map((item) => ({
        label: compact(item.innerText || item.textContent || item.getAttribute("aria-label") || item.value || "", 120),
        value: item.value || compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 120),
        selected: Boolean(item.checked || item.selected || item.getAttribute("aria-pressed") === "true" || item.getAttribute("aria-checked") === "true"),
      })).filter((option) => option.label || option.value);
    };
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const fields = Array.from(document.querySelectorAll("input, select, textarea")).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: element.getAttribute("type") || element.tagName.toLowerCase(),
      name: element.getAttribute("name") || "",
      id: element.id || "",
      selector: selectorFor(element),
      label: labelTextFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      value: element.value || "",
      checked: Boolean(element.checked),
      multiple: Boolean(element.multiple),
      visible: isVisible(element),
      dataInput: element.getAttribute("data-input") || "",
      dataSelect: element.getAttribute("data-select") || "",
      nearbyText: nearbyTextFor(element),
      groupLabel: groupLabelFor(element),
      sectionText: sectionTextFor(element),
      options: element.tagName.toLowerCase() === "select"
        ? Array.from(element.options).map((option) => ({
            label: option.textContent || "",
            value: option.value || "",
            selected: option.selected,
          }))
        : optionGroupFor(element),
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
    const parent = element.closest && (element.closest("[role='radiogroup'], [role='group']") || element.parentElement);
    if (!parent) return [];
    const controls = Array.from(parent.querySelectorAll("button, [role='button'], input[type='button'], input[type='radio'], input[type='checkbox'], option"));
    return controls.slice(0, 40).map((item) => ({
      label: compact(item.innerText || item.textContent || item.getAttribute("aria-label") || item.value || "", 120),
      value: item.value || compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 120),
      selected: Boolean(item.checked || item.selected || item.getAttribute("aria-pressed") === "true" || item.getAttribute("aria-checked") === "true"),
    })).filter((option) => option.label || option.value);
  };
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
  const record = (type, element) => {
    if (!element || !element.tagName) return;
    const tag = element.tagName.toLowerCase();
    if (!["input", "select", "textarea", "button", "a"].includes(tag)) return;
    window.__apiSkillBuilderEvents.push({
      type,
      ts: Date.now(),
      selector: selectorFor(element),
      tag,
      inputType: element.getAttribute("type") || tag,
      id: element.id || "",
      name: element.getAttribute("name") || "",
      label: labelFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      text: compact(element.innerText || element.textContent || "", 200),
      value: element.value || "",
      checked: Boolean(element.checked),
      nearbyText: nearbyTextFor(element),
      groupLabel: groupLabelFor(element),
      sectionText: sectionTextFor(element),
      options: optionGroupFor(element),
      url: location.href
    });
    if (window.__apiSkillBuilderEvents.length > 500) window.__apiSkillBuilderEvents.shift();
  };
  document.addEventListener("input", (event) => record("input", event.target), true);
  document.addEventListener("change", (event) => record("change", event.target), true);
  document.addEventListener("click", (event) => {
    const target = event.target?.closest
      ? event.target.closest("button,a,input,select,textarea") || event.target
      : event.target?.parentElement;
    record("click", target);
  }, true);
})()`;

function normalizeFieldRecord(field) {
  return {
    ...field,
    label: cleanText(field.label || ""),
    placeholder: cleanText(field.placeholder || ""),
    selector: field.selector || "",
    name: field.name || "",
    id: field.id || "",
    type: field.type || field.tag || "text",
    nearbyText: cleanText(field.nearbyText || ""),
    groupLabel: cleanText(field.groupLabel || ""),
    sectionText: cleanText(field.sectionText || ""),
    source: field.source || "",
    options: cleanChoices(field.options || []),
  };
}

function isUserFacingField(field) {
  if (!field || isTechnicalField(field) || isLikelyHiddenField(field)) return false;
  const type = String(field.type || "").toLowerCase();
  if (["submit", "button", "image", "reset", "file"].includes(type)) return type === "file";
  return field.visible === true || Boolean(field.label || field.placeholder || field.options?.length || field.name || field.id);
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
  return [field.name, field.id, field.dataInput, field.dataSelect, field.label, field.placeholder]
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
      lower.startsWith("x-")
    ) {
      keep[key] = value;
    }
  }
  return keep;
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
