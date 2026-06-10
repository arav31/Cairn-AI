import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { loadEnvFile } from "./env.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RECORDINGS_DIR = path.join(PROJECT_ROOT, "recordings");
const SKILLS_DIR = path.join(PROJECT_ROOT, "skills");
const RECORDED_SKILLS_PATH = path.join(SKILLS_DIR, "marketplace-recorded-skills.json");

const activeSessions = new Map();

export function listRegisteredMarketplaceSkills() {
  return readRecordedSkills().map((skill) => ({
    ...skill,
    real: false,
    recorded: true,
    status: skill.status || "recorded",
    category: skill.category || "Custom",
    provider: skill.provider || "User registered",
    price: skill.price || "Private",
  }));
}

export function getRegisteredMarketplaceSkill(skillId) {
  return listRegisteredMarketplaceSkills().find((skill) => skill.id === skillId) || null;
}

export async function startSkillRecording({ websiteLink, description }) {
  loadEnvFile();
  const url = normalizeUrl(websiteLink);
  const goal = String(description || "").trim();
  if (!goal) throw new Error("Description is required.");

  const chromePath = findChromeExecutable();
  const sessionId = crypto.randomUUID();
  const userDataDir = path.join(os.tmpdir(), `cairn-skill-recorder-${sessionId}`);
  const startedAt = new Date().toISOString();
  const events = [];
  const network = [];
  const startedMs = performance.now();

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: chromePath,
    headless: false,
    viewport: null,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  await context.addInitScript(() => {
    const cleanText = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const fieldLabel = (element) => {
      const id = element.getAttribute("id");
      const label =
        (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText) ||
        element.closest("label")?.innerText ||
        element.getAttribute("aria-label") ||
        element.getAttribute("placeholder") ||
        element.getAttribute("name") ||
        element.getAttribute("id") ||
        "";
      return cleanText(label);
    };
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    window.__cairnSkillEvents = [];
    window.__cairnPushEvent = (event) => {
      window.__cairnSkillEvents.push({ ...event, at: new Date().toISOString(), url: location.href });
      if (window.__cairnSkillEvents.length > 600) window.__cairnSkillEvents.shift();
    };
    document.addEventListener(
      "input",
      (event) => {
        const element = event.target;
        if (!element || !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || !visible(element)) return;
        window.__cairnPushEvent({
          type: "input",
          tag: element.tagName.toLowerCase(),
          inputType: element.getAttribute("type") || element.tagName.toLowerCase(),
          label: fieldLabel(element),
          name: element.getAttribute("name") || "",
          value: cleanText(element.value),
        });
      },
      true,
    );
    document.addEventListener(
      "change",
      (event) => {
        const element = event.target;
        if (!element || !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || !visible(element)) return;
        window.__cairnPushEvent({
          type: "change",
          tag: element.tagName.toLowerCase(),
          inputType: element.getAttribute("type") || element.tagName.toLowerCase(),
          label: fieldLabel(element),
          name: element.getAttribute("name") || "",
          value: cleanText(element.value),
        });
      },
      true,
    );
    document.addEventListener(
      "click",
      (event) => {
        const element = event.target?.closest?.("button,a,input,[role='button'],[role='option'],[role='radio'],[role='checkbox']");
        if (!element || !visible(element)) return;
        window.__cairnPushEvent({
          type: "click",
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          text: cleanText(element.innerText || element.value || element.getAttribute("aria-label")),
          name: element.getAttribute("name") || "",
          id: element.getAttribute("id") || "",
        });
      },
      true,
    );
    document.addEventListener(
      "submit",
      (event) => {
        window.__cairnPushEvent({
          type: "submit",
          tag: "form",
          text: cleanText(event.target?.innerText),
        });
      },
      true,
    );
  });

  const page = await context.newPage();
  page.on("request", (request) => {
    const record = {
      id: crypto.randomUUID(),
      type: "request",
      at: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      postData: truncate(request.postData() || "", 20000),
      headers: redactHeaders(request.headers()),
    };
    network.push(record);
    if (network.length > 1200) network.shift();
  });
  page.on("response", async (response) => {
    const request = response.request();
    const contentType = response.headers()["content-type"] || "";
    const shouldCaptureBody =
      /json|text|xml|graphql|x-www-form-urlencoded/i.test(contentType) &&
      ["xhr", "fetch", "document"].includes(request.resourceType());
    let body = "";
    if (shouldCaptureBody) {
      try {
        body = truncate(await response.text(), 50000);
      } catch {
        body = "";
      }
    }
    network.push({
      id: crypto.randomUUID(),
      type: "response",
      at: new Date().toISOString(),
      method: request.method(),
      url: response.url(),
      resourceType: request.resourceType(),
      status: response.status(),
      contentType,
      body,
      headers: redactHeaders(response.headers()),
    });
    if (network.length > 1200) network.shift();
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      events.push({ type: "navigation", at: new Date().toISOString(), url: frame.url() });
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  activeSessions.set(sessionId, {
    sessionId,
    websiteLink: url,
    description: goal,
    startedAt,
    startedMs,
    context,
    page,
    userDataDir,
    events,
    network,
  });

  return {
    sessionId,
    websiteLink: url,
    description: goal,
    message:
      "I am recording the skill. Complete the workflow in the Chrome window, then return here and click Finish recording.",
  };
}

export async function finishSkillRecording(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error("Recording session not found or already closed.");

  const finishedAt = new Date().toISOString();
  const browserEvents = await readBrowserEvents(session.page);
  const pageSnapshot = await readPageSnapshot(session.page);
  const finalUrl = session.page.url();
  const durationMs = Math.round(performance.now() - session.startedMs);

  await closeSession(session);
  activeSessions.delete(sessionId);

  const evidence = {
    sessionId,
    websiteLink: session.websiteLink,
    description: session.description,
    startedAt: session.startedAt,
    finishedAt,
    durationMs,
    finalUrl,
    browserEvents,
    pageSnapshot,
    networkCandidates: rankNetworkCandidates(session.network).slice(0, 20),
    networkSummary: summarizeNetwork(session.network),
  };

  ensureDir(RECORDINGS_DIR);
  const recordingPath = path.join(RECORDINGS_DIR, `marketplace-${slugifyHost(session.websiteLink)}-${Date.now()}.json`);
  fs.writeFileSync(recordingPath, JSON.stringify(evidence, null, 2));

  const analysis = await analyzeRecordingWithNemotron(evidence);
  const skill = saveRecordedSkill(evidence, analysis, recordingPath);
  return {
    sessionId,
    recordingPath,
    skill,
    analysis,
    message:
      "Recording analyzed. I converted the captured workflow into user-facing questions and ranked endpoint candidates.",
  };
}

export async function cancelSkillRecording(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return { cancelled: false };
  await closeSession(session);
  activeSessions.delete(sessionId);
  return { cancelled: true };
}

function saveRecordedSkill(evidence, analysis, recordingPath) {
  const skills = readRecordedSkills();
  const name = analysis.skillName || titleFromUrl(evidence.websiteLink);
  const id = uniqueSkillId(slugify(name), skills);
  const skill = {
    id,
    name,
    provider: "User registered",
    price: "Private",
    status: "recorded",
    category: "Custom",
    description: analysis.description || evidence.description,
    source: evidence.websiteLink,
    recordedAt: evidence.finishedAt,
    recordingPath,
    real: false,
    recorded: true,
    endpointBacked: (analysis.importantEndpoints || []).length > 0,
    goal: analysis.goal || evidence.description,
    questions: analysis.userQuestions || [],
    importantEndpoints: analysis.importantEndpoints || [],
    outputSummary: analysis.outputSummary || {},
    replayPlan: analysis.replayPlan || {},
    confidence: analysis.confidence ?? 0,
    notes: analysis.notes || [],
  };
  skills.push(skill);
  ensureDir(SKILLS_DIR);
  fs.writeFileSync(RECORDED_SKILLS_PATH, JSON.stringify(skills, null, 2));
  return skill;
}

async function analyzeRecordingWithNemotron(evidence) {
  const deterministic = deterministicAnalysis(evidence);
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return {
      ...deterministic,
      llmProvider: "deterministic-fallback",
      notes: [
        ...(deterministic.notes || []),
        "NVIDIA_API_KEY is not set, so this was analyzed without Nemotron.",
      ],
    };
  }

  const baseUrl = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1";
  const model = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b";
  const promptEvidence = compactEvidenceForLlm(evidence);
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are an endpoint reverse-engineering assistant for a skill marketplace. Analyze browser recording evidence and return JSON only. Do not hallucinate fields. Use visible labels, user actions, request payloads, and response snippets as evidence. Never ask users for technical hidden fields such as VIEWSTATE, CSRF, cookies, UUIDs, session ids, or raw payload paths; classify those as constants/auth/session fields instead.",
      },
      {
        role: "user",
        content:
          "Create a reusable skill summary from this recording. Return JSON with this schema: {\"skillName\":\"short name\",\"description\":\"what the skill does\",\"goal\":\"user goal\",\"userQuestions\":[{\"id\":\"stable_id\",\"question\":\"human question\",\"label\":\"short label\",\"inputType\":\"text|number|date|select|multi_select|boolean\",\"required\":true,\"options\":[\"option\"],\"sourceEvidence\":\"why this question exists\"}],\"importantEndpoints\":[{\"method\":\"GET|POST\",\"url\":\"endpoint url\",\"purpose\":\"why this endpoint matters\",\"whyRelevant\":\"evidence it reaches the goal\",\"requestShape\":\"short human description of payload/query\",\"requiredUserInputs\":[\"question ids\"],\"responseOutputs\":[\"important output fields\"],\"confidence\":0.0}],\"outputSummary\":{\"importantFields\":[\"what to show the user\"],\"presentation\":\"short result format\"},\"replayPlan\":{\"strategy\":\"direct_api|browser_replay|manual_review\",\"steps\":[\"step\"],\"limitations\":[\"limitation\"]},\"confidence\":0.0,\"notes\":[\"note\"]}.\n\nEvidence:\n" +
          JSON.stringify(promptEvidence),
      },
    ],
    temperature: Number(process.env.NVIDIA_TEMPERATURE || 0.2),
    top_p: Number(process.env.NVIDIA_TOP_P || 0.9),
    max_tokens: Number(process.env.NVIDIA_MAX_TOKENS || 4096),
    chat_template_kwargs: { enable_thinking: true },
    reasoning_budget: Number(process.env.NVIDIA_REASONING_BUDGET || 4096),
  };

  try {
    const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }, Number(process.env.SKILL_REGISTRATION_LLM_TIMEOUT_MS || 60000));
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 400)}`);
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(content);
    if (!parsed?.skillName) throw new Error("Nemotron did not return the expected JSON shape.");
    return normalizeAnalysis(parsed, deterministic, model);
  } catch (error) {
    return {
      ...deterministic,
      llmProvider: "deterministic-fallback",
      notes: [
        ...(deterministic.notes || []),
        `Nemotron analysis failed: ${error.message}`,
      ],
    };
  }
}

function deterministicAnalysis(evidence) {
  const fields = evidence.pageSnapshot.fields
    .filter((field) => field.label || field.name || field.placeholder)
    .slice(0, 16);
  const questions = fields
    .filter((field) => !isTechnicalField(field))
    .map((field, index) => ({
      id: slugify(field.name || field.label || `field_${index + 1}`),
      question: buildQuestionText(field),
      label: field.label || field.name || `Field ${index + 1}`,
      inputType: normalizeInputType(field),
      required: Boolean(field.required),
      options: field.options || [],
      sourceEvidence: "Visible form control captured from the recorded page.",
    }));

  const endpoints = evidence.networkCandidates.slice(0, 6).map((candidate) => ({
    method: candidate.method,
    url: candidate.url,
    purpose: candidate.reason || "Likely workflow endpoint from network recording.",
    whyRelevant: `Ranked ${candidate.score} from method/resource type/body/response evidence.`,
    requestShape: candidate.postData ? truncate(candidate.postData, 500) : "No request body captured.",
    requiredUserInputs: questions.slice(0, 6).map((question) => question.id),
    responseOutputs: candidate.responsePreview ? ["See response preview in recording"] : [],
    confidence: Math.min(0.85, Math.max(0.25, candidate.score / 140)),
  }));

  return {
    skillName: titleFromUrl(evidence.websiteLink),
    description: evidence.description,
    goal: evidence.description,
    userQuestions: questions,
    importantEndpoints: endpoints,
    outputSummary: {
      importantFields: ["Primary result shown on the final page", "Prices, quotes, scores, statuses, or recommendations returned by the selected endpoint"],
      presentation: "Show only the business result and the endpoint speed, not the full raw payload.",
    },
    replayPlan: {
      strategy: endpoints.length ? "manual_review" : "browser_replay",
      steps: [
        "Review the ranked endpoint candidate.",
        "Map clean user questions to payload fields.",
        "Call the endpoint directly when constants/auth/session values are stable.",
      ],
      limitations: ["This deterministic fallback is less accurate than Nemotron analysis."],
    },
    confidence: endpoints.length ? 0.45 : 0.25,
    notes: ["Fallback analysis used visible fields and ranked network candidates."],
  };
}

function normalizeAnalysis(parsed, fallback, model) {
  return {
    skillName: String(parsed.skillName || fallback.skillName).slice(0, 80),
    description: String(parsed.description || fallback.description).slice(0, 500),
    goal: String(parsed.goal || fallback.goal).slice(0, 500),
    userQuestions: Array.isArray(parsed.userQuestions)
      ? parsed.userQuestions.map(normalizeQuestion).filter(Boolean).slice(0, 30)
      : fallback.userQuestions,
    importantEndpoints: Array.isArray(parsed.importantEndpoints)
      ? parsed.importantEndpoints.map(normalizeEndpoint).filter(Boolean).slice(0, 12)
      : fallback.importantEndpoints,
    outputSummary: parsed.outputSummary || fallback.outputSummary,
    replayPlan: parsed.replayPlan || fallback.replayPlan,
    confidence: clampConfidence(parsed.confidence),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map(String).slice(0, 8) : [],
    llmProvider: "nvidia",
    llmModel: model,
  };
}

function normalizeQuestion(question, index) {
  const label = String(question.label || question.question || `Question ${index + 1}`).trim();
  const text = String(question.question || label).trim();
  if (!text) return null;
  return {
    id: slugify(question.id || label),
    question: text,
    label,
    inputType: ["text", "number", "date", "select", "multi_select", "boolean"].includes(question.inputType)
      ? question.inputType
      : "text",
    required: question.required !== false,
    options: Array.isArray(question.options) ? question.options.map(String).slice(0, 80) : [],
    sourceEvidence: String(question.sourceEvidence || "").slice(0, 300),
  };
}

function normalizeEndpoint(endpoint) {
  const url = String(endpoint.url || "").trim();
  if (!url) return null;
  return {
    method: String(endpoint.method || "GET").toUpperCase(),
    url,
    purpose: String(endpoint.purpose || "").slice(0, 500),
    whyRelevant: String(endpoint.whyRelevant || "").slice(0, 500),
    requestShape: String(endpoint.requestShape || "").slice(0, 900),
    requiredUserInputs: Array.isArray(endpoint.requiredUserInputs) ? endpoint.requiredUserInputs.map(String).slice(0, 30) : [],
    responseOutputs: Array.isArray(endpoint.responseOutputs) ? endpoint.responseOutputs.map(String).slice(0, 30) : [],
    confidence: clampConfidence(endpoint.confidence),
  };
}

function rankNetworkCandidates(network) {
  const responsesByKey = new Map();
  for (const item of network) {
    if (item.type === "response") responsesByKey.set(`${item.method} ${item.url}`, item);
  }

  return network
    .filter((item) => item.type === "request")
    .filter((item) => !isNoiseUrl(item.url))
    .map((request) => {
      const response = responsesByKey.get(`${request.method} ${request.url}`);
      const score = scoreRequest(request, response);
      return {
        method: request.method,
        url: request.url,
        resourceType: request.resourceType,
        status: response?.status,
        contentType: response?.contentType,
        score,
        reason: candidateReason(request, response),
        postData: request.postData,
        responsePreview: response?.body ? truncate(response.body, 1600) : "",
        headerKeys: Object.keys(request.headers || {}),
      };
    })
    .filter((item) => item.score >= 20)
    .sort((a, b) => b.score - a.score);
}

function scoreRequest(request, response) {
  let score = 0;
  if (request.method !== "GET") score += 35;
  if (["xhr", "fetch"].includes(request.resourceType)) score += 30;
  if (request.postData) score += 25;
  if (response?.status && response.status >= 200 && response.status < 300) score += 15;
  if (/json/i.test(response?.contentType || "")) score += 20;
  if (/quote|premium|price|calculate|calc|search|result|recommend|plan|submit|application|api|graphql/i.test(request.url)) score += 25;
  if (/analytics|telemetry|collect|rum|pixel|tag|gtm|google|facebook|doubleclick/i.test(request.url)) score -= 70;
  return score;
}

function candidateReason(request, response) {
  const reasons = [];
  if (request.method !== "GET") reasons.push(`${request.method} request`);
  if (["xhr", "fetch"].includes(request.resourceType)) reasons.push(`${request.resourceType} resource`);
  if (request.postData) reasons.push("has user/request payload");
  if (/json/i.test(response?.contentType || "")) reasons.push("JSON response");
  if (/quote|premium|price|calculate|result|recommend|api/i.test(request.url)) reasons.push("goal-like endpoint name");
  return reasons.join(", ") || "candidate request from recording";
}

function summarizeNetwork(network) {
  const requests = network.filter((item) => item.type === "request");
  const responses = network.filter((item) => item.type === "response");
  return {
    requestCount: requests.length,
    responseCount: responses.length,
    methods: countBy(requests, "method"),
    resourceTypes: countBy(requests, "resourceType"),
    hosts: countHosts(requests),
  };
}

async function readBrowserEvents(page) {
  try {
    return await page.evaluate(() => window.__cairnSkillEvents || []);
  } catch {
    return [];
  }
}

async function readPageSnapshot(page) {
  try {
    return await page.evaluate(() => {
      const cleanText = (value, max = 600) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const labelFor = (element) => {
        const id = element.getAttribute("id");
        return cleanText(
          (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)?.innerText) ||
            element.closest("label")?.innerText ||
            element.getAttribute("aria-label") ||
            element.getAttribute("placeholder") ||
            element.getAttribute("name") ||
            element.getAttribute("id") ||
            "",
        );
      };
      const fields = Array.from(document.querySelectorAll("input, select, textarea"))
        .filter(visible)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          type: element.getAttribute("type") || element.tagName.toLowerCase(),
          label: labelFor(element),
          name: element.getAttribute("name") || "",
          id: element.getAttribute("id") || "",
          placeholder: element.getAttribute("placeholder") || "",
          required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
          value: cleanText(element.value, 120),
          options:
            element.tagName === "SELECT"
              ? Array.from(element.options).map((option) => cleanText(option.text || option.value, 120)).filter(Boolean)
              : [],
        }));
      const buttons = Array.from(document.querySelectorAll("button, a, input[type='button'], input[type='submit'], [role='button']"))
        .filter(visible)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role") || "",
          text: cleanText(element.innerText || element.value || element.getAttribute("aria-label"), 160),
        }))
        .filter((item) => item.text);
      return {
        title: document.title,
        url: location.href,
        headings: Array.from(document.querySelectorAll("h1,h2,h3")).filter(visible).map((element) => cleanText(element.innerText, 180)).slice(0, 30),
        fields: fields.slice(0, 120),
        buttons: buttons.slice(0, 80),
        visibleText: cleanText(document.body.innerText, 5000),
      };
    });
  } catch {
    return { title: "", url: "", headings: [], fields: [], buttons: [], visibleText: "" };
  }
}

function compactEvidenceForLlm(evidence) {
  return {
    websiteLink: evidence.websiteLink,
    finalUrl: evidence.finalUrl,
    description: evidence.description,
    durationMs: evidence.durationMs,
    browserEvents: evidence.browserEvents.slice(-160),
    pageSnapshot: {
      title: evidence.pageSnapshot.title,
      url: evidence.pageSnapshot.url,
      headings: evidence.pageSnapshot.headings,
      fields: evidence.pageSnapshot.fields.slice(0, 80),
      buttons: evidence.pageSnapshot.buttons.slice(0, 60),
      visibleText: truncate(evidence.pageSnapshot.visibleText, 3500),
    },
    networkCandidates: evidence.networkCandidates.slice(0, 12).map((candidate) => ({
      method: candidate.method,
      url: candidate.url,
      resourceType: candidate.resourceType,
      status: candidate.status,
      contentType: candidate.contentType,
      score: candidate.score,
      reason: candidate.reason,
      postData: truncate(candidate.postData, 1800),
      responsePreview: truncate(candidate.responsePreview, 1800),
    })),
    networkSummary: evidence.networkSummary,
  };
}

async function closeSession(session) {
  try {
    await session.context.close();
  } catch {
    // already closed
  }
}

function readRecordedSkills() {
  try {
    if (!fs.existsSync(RECORDED_SKILLS_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(RECORDED_SKILLS_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome executable not found. Set CHROME_PATH in .env.");
  return found;
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Website link is required.");
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.toString();
  } catch {
    throw new Error("Enter a valid website link.");
  }
}

function isTechnicalField(field) {
  return /viewstate|eventvalidation|csrf|token|uuid|session|captcha|g-recaptcha|password|hidden/i.test(
    `${field.name} ${field.id} ${field.label} ${field.type}`,
  );
}

function buildQuestionText(field) {
  const base = field.label || field.placeholder || field.name || "Value";
  if (field.options?.length) return `${base}`;
  if (field.type === "date") return `${base}`;
  return `${base}`;
}

function normalizeInputType(field) {
  if (field.tag === "select") return field.options?.length > 1 ? "select" : "text";
  if (/checkbox|radio/.test(field.type)) return "boolean";
  if (/number|range/.test(field.type)) return "number";
  if (/date/.test(field.type)) return "date";
  return "text";
}

function isNoiseUrl(url) {
  return (
    /\.(?:js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map)(?:\?|$)/i.test(url) ||
    /google-analytics|googletagmanager|doubleclick|facebook|hotjar|clarity|newrelic|datadog|optimizely|segment|sentry|akamai|cloudflareinsights/i.test(url)
  );
}

function redactHeaders(headers) {
  const keep = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/cookie|authorization|token|secret|key/i.test(key)) {
      keep[key] = "[redacted]";
    } else if (/content-type|accept|origin|referer|user-agent|x-requested-with/i.test(key)) {
      keep[key] = String(value).slice(0, 500);
    }
  }
  return keep;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function countHosts(items) {
  const counts = {};
  for (const item of items) {
    try {
      const host = new URL(item.url).host;
      counts[host] = (counts[host] || 0) + 1;
    } catch {
      // skip
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20));
}

function parseJsonObject(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function uniqueSkillId(base, skills) {
  let id = base || "recorded-skill";
  let index = 2;
  const existing = new Set(skills.map((skill) => skill.id));
  while (existing.has(id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function titleFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return `${host} Skill`;
  } catch {
    return "Recorded Skill";
  }
}

function slugifyHost(url) {
  try {
    return slugify(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return "site";
  }
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, number));
}
