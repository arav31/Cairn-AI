import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_CODEX_MODEL = "gpt-5.4";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "goal", "confidence", "strategy", "endpointEngineering", "inputs", "actions", "outputs", "conversation", "risks"],
  properties: {
    summary: { type: "string" },
    goal: { type: "string" },
    confidence: { type: "number" },
    strategy: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "candidateId", "rationale", "finalUrlUseful"],
      properties: {
        kind: {
          type: "string",
          enum: ["direct_api", "query_api", "browser_result_url", "browser_replay", "manual_review"],
        },
        candidateId: { type: "string" },
        rationale: { type: "string" },
        finalUrlUseful: { type: "boolean" },
      },
    },
    endpointEngineering: {
      type: "object",
      additionalProperties: false,
      required: [
        "selectedRequestId",
        "selectedEndpointUrl",
        "method",
        "endpointPurpose",
        "payloadType",
        "userInputMappings",
        "constantsToKeep",
        "volatileFields",
        "requiredPreflightSteps",
        "outputExtraction",
        "implementationNotes",
        "replayWarnings",
        "confidence",
      ],
      properties: {
        selectedRequestId: { type: "string" },
        selectedEndpointUrl: { type: "string" },
        method: { type: "string" },
        endpointPurpose: { type: "string" },
        payloadType: {
          type: "string",
          enum: ["json", "query", "form", "multipart", "browser", "none", "unknown"],
        },
        userInputMappings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["inputId", "question", "type", "mapsTo", "transform", "required", "evidence"],
            properties: {
              inputId: { type: "string" },
              question: { type: "string" },
              type: {
                type: "string",
                enum: ["string", "number", "email", "url", "choice", "multi-choice", "file", "json", "boolean"],
              },
              mapsTo: {
                type: "array",
                items: { type: "string" },
              },
              transform: { type: "string" },
              required: { type: "boolean" },
              evidence: { type: "string" },
            },
          },
        },
        constantsToKeep: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "reason", "evidence"],
            properties: {
              path: { type: "string" },
              reason: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        volatileFields: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["path", "handling", "reason", "evidence"],
            properties: {
              path: { type: "string" },
              handling: {
                type: "string",
                enum: ["omit", "regenerate_uuid", "fetch_from_preflight", "keep_recorded", "ask_user", "unknown"],
              },
              reason: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        requiredPreflightSteps: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["purpose", "candidateId", "url", "reason"],
            properties: {
              purpose: { type: "string" },
              candidateId: { type: "string" },
              url: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
        outputExtraction: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "source", "path", "evidence"],
            properties: {
              label: { type: "string" },
              source: { type: "string", enum: ["json", "text", "html", "browser", "unknown"] },
              path: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        implementationNotes: {
          type: "array",
          items: { type: "string" },
        },
        replayWarnings: {
          type: "array",
          items: { type: "string" },
        },
        confidence: { type: "number" },
      },
    },
    inputs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question", "type", "required", "mapsTo", "helpText", "evidence"],
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          type: {
            type: "string",
            enum: ["string", "number", "email", "url", "choice", "multi-choice", "file", "json", "boolean"],
          },
          required: { type: "boolean" },
          mapsTo: {
            type: "array",
            items: { type: "string" },
          },
          helpText: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "selector", "role", "evidence"],
        properties: {
          label: { type: "string" },
          selector: { type: "string" },
          role: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    outputs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "description", "evidence"],
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          evidence: { type: "string" },
        },
      },
    },
    conversation: {
      type: "object",
      additionalProperties: false,
      required: ["intro", "inputGroups"],
      properties: {
        intro: { type: "string" },
        inputGroups: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "description", "inputIds", "repeatable", "addAnotherQuestion"],
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              inputIds: {
                type: "array",
                items: { type: "string" },
              },
              repeatable: { type: "boolean" },
              addAnotherQuestion: { type: "string" },
            },
          },
        },
      },
    },
    risks: {
      type: "array",
      items: { type: "string" },
    },
  },
};

export function llmAnalysisStatus(env = process.env) {
  const provider = resolveLlmProvider(env);
  const model = modelForProvider(provider, env);
  if (env.SKILL_BUILDER_LLM === "off" || env.SKILL_BUILDER_LLM === "0") {
    return {
      enabled: false,
      reason: "disabled by SKILL_BUILDER_LLM",
      provider,
      model,
    };
  }
  if (provider === "codex") {
    if (["off", "0", "false"].includes(String(env.SKILL_BUILDER_CODEX || "").toLowerCase())) {
      return {
        enabled: false,
        reason: "disabled by SKILL_BUILDER_CODEX",
        provider,
        model,
      };
    }
    return {
      enabled: true,
      reason: "uses local Codex CLI auth",
      provider,
      model,
    };
  }
  const apiKeyName = apiKeyNameForProvider(provider);
  if (!env[apiKeyName]) {
    return {
      enabled: false,
      reason: `${apiKeyName} is not set`,
      provider,
      model,
    };
  }
  return {
    enabled: true,
    reason: `${apiKeyName} is set`,
    provider,
    model,
  };
}

export async function analyzeRecordingWithLlm(recording, candidates = [], options = {}) {
  const env = options.env || process.env;
  const status = llmAnalysisStatus(env);
  if (!status.enabled) return null;

  const provider = status.provider;
  const evidence = buildRecordingEvidence(recording, candidates, { compact: ["nvidia", "codex"].includes(provider) });
  const timeoutMs = Number(env.SKILL_BUILDER_LLM_TIMEOUT_MS || options.timeoutMs || defaultLlmTimeoutMs(provider));
  const response = provider === "nvidia"
    ? await callNvidiaChatJson({
      apiKey: env.NVIDIA_API_KEY,
      baseUrl: env.NVIDIA_BASE_URL || env.NVIDIA_API_BASE_URL || DEFAULT_NVIDIA_BASE_URL,
      model: options.model || env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
      evidence,
      env,
      timeoutMs,
    })
    : provider === "codex"
      ? await callCodexExecJson({
        model: options.model || env.SKILL_BUILDER_CODEX_MODEL || DEFAULT_CODEX_MODEL,
        evidence,
        env,
        timeoutMs,
      })
    : provider === "openai_responses"
      ? await callOpenAiStructured({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
        model: options.model || env.OPENAI_MODEL || DEFAULT_MODEL,
        evidence,
        timeoutMs,
      })
      : await callOpenAiChatJson({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
        model: options.model || env.OPENAI_MODEL || DEFAULT_MODEL,
        evidence,
        env,
        timeoutMs,
      });

  return {
    ...normalizeAnalysis(response, evidence),
    analyzer: provider === "nvidia"
      ? "nvidia-chat-completions-json-mode"
      : provider === "codex"
        ? "codex-exec-structured-output"
        : provider === "openai_responses"
          ? "openai-responses-structured-output"
          : "openai-chat-completions-structured-output",
    provider,
  };
}

function defaultLlmTimeoutMs(provider) {
  if (provider === "codex") return 240000;
  return provider === "nvidia" ? 30000 : 45000;
}

export function buildRecordingEvidence(recording, candidates = [], options = {}) {
  const compact = Boolean(options.compact);
  const page = recording.pageFields || {};
  return {
    sourceUrl: recording.url || "",
    finalUrl: page.url || recording.url || "",
    title: cleanText(page.title || ""),
    userGoal: cleanText(recording.goal || ""),
    pageText: redactSensitiveText(cleanText(page.text || "").slice(0, compact ? 800 : 4000)),
    fields: summarizeFields(page.fields || [], { compact }),
    events: summarizeEvents(page.events || [], { compact }),
    playwright: summarizePlaywrightEvidence(recording.playwright || {}, { compact }),
    candidateRequests: summarizeCandidates(candidates, { compact }),
    requestShapes: summarizeRequestShapes(recording.requests || [], candidates, { compact }),
  };
}

function summarizePlaywrightEvidence(playwright, options = {}) {
  if (!playwright?.enabled) {
    return {
      enabled: false,
      error: cleanText(playwright?.error || ""),
    };
  }
  const compact = Boolean(options.compact);
  return {
    enabled: true,
    url: playwright.url || "",
    title: cleanText(playwright.title || ""),
    roleCounts: playwright.roleCounts || {},
    forms: (playwright.forms || []).slice(0, compact ? 10 : 30).map((form) => ({
      tag: form.tag || "",
      role: form.role || "",
      promptText: cleanText(form.promptText || ""),
      text: cleanText(form.text || "").slice(0, compact ? 140 : 400),
      controlCount: form.controlCount || 0,
    })),
    controls: (playwright.controls || []).slice(0, compact ? 40 : 120).map((control) => ({
      tag: control.tag || "",
      role: control.role || "",
      type: control.type || "",
      name: control.name || "",
      id: control.id || "",
      promptText: cleanText(control.promptText || ""),
      label: cleanText(control.label || ""),
      placeholder: cleanText(control.placeholder || ""),
      text: cleanText(control.text || ""),
      value: valuePreview(control.value),
      checked: Boolean(control.checked),
      options: (control.options || []).slice(0, compact ? 8 : 20).map((option) => ({
        label: cleanText(option.label || option.text || ""),
        value: valuePreview(option.value),
        selected: Boolean(option.selected),
      })),
    })),
    accessibility: playwright.accessibility ? trimAccessibility(playwright.accessibility, compact ? 3 : 4) : null,
  };
}

function trimAccessibility(node, maxDepth, depth = 0) {
  if (!node || depth > maxDepth) return null;
  const output = {
    role: node.role || "",
    name: cleanText(node.name || ""),
  };
  if (node.value !== undefined) output.value = valuePreview(node.value);
  if (node.checked !== undefined) output.checked = node.checked;
  if (node.selected !== undefined) output.selected = node.selected;
  const children = (node.children || []).map((child) => trimAccessibility(child, maxDepth, depth + 1)).filter(Boolean);
  if (children.length) output.children = children.slice(0, 20);
  return output;
}

export function applyLlmAnalysisToSkill(skill, analysis) {
  if (!analysis) return skill;

  const improved = structuredClone(skill);
  improved.description = enhancedDescription(improved.description, analysis);
  improved.learning = {
    ...(improved.learning || {}),
    analyzer: analysis.analyzer || "openai-chat-completions-structured-output",
    provider: analysis.provider || "openai",
    summary: cleanText(analysis.summary),
    inferredGoal: cleanText(analysis.goal),
    confidence: clampConfidence(analysis.confidence),
    strategy: improved.learning?.strategy?.kind === "direct_api_with_preflight"
      ? improved.learning.strategy
      : analysis.strategy,
    endpointEngineering: analysis.endpointEngineering,
    outputs: analysis.outputs,
    risks: analysis.risks,
  };

  if (Array.isArray(improved.inputs)) {
    improved.inputs = improved.inputs
      .map((input) => improveInput(input, analysis.inputs || []))
      .filter((input) => !isTechnicalInput(input));
  }

  if (Array.isArray(improved.outputs)) {
    improved.outputs = improveOutputs(improved, analysis);
  }

  improved.conversation = improveConversation(improved, analysis);

  return improved;
}

export function orderCandidatesByAnalysis(candidates, analysis) {
  const candidateId = analysis?.strategy?.candidateId || analysis?.endpointEngineering?.selectedRequestId;
  if (!candidateId) return candidates;
  return [
    ...candidates.filter((candidate) => candidate.id === candidateId),
    ...candidates.filter((candidate) => candidate.id !== candidateId),
  ];
}

function summarizeFields(fields, options = {}) {
  const compact = Boolean(options.compact);
  return fields
    .filter((field) => field && field.visible !== false)
    .slice(0, compact ? 30 : 80)
    .map((field) => ({
      tag: field.tag || "",
      type: field.type || "",
      name: field.name || "",
      id: field.id || "",
      promptText: cleanText(field.promptText || ""),
      label: cleanText(field.label || ""),
      placeholder: cleanText(field.placeholder || ""),
      nearbyText: cleanText(field.nearbyText || ""),
      groupLabel: cleanText(field.groupLabel || ""),
      sectionText: cleanText(field.sectionText || "").slice(0, compact ? 80 : 300),
      source: field.source || "",
      value: valuePreview(field.value),
      checked: Boolean(field.checked),
      multiple: Boolean(field.multiple),
      options: (field.options || []).slice(0, compact ? 12 : 60).map((option) => ({
        label: cleanText(option.label || option.text || ""),
        value: valuePreview(option.value),
        selected: Boolean(option.selected),
      })),
    }));
}

function summarizeEvents(events, options = {}) {
  const compact = Boolean(options.compact);
  return events
    .filter((event) => event && ["input", "change", "click"].includes(event.type))
    .slice(compact ? -30 : -120)
    .map((event) => ({
      type: event.type,
      selector: event.selector || "",
      tag: event.tag || "",
      role: event.role || "",
      inputType: event.inputType || "",
      id: event.id || "",
      name: event.name || "",
      promptText: cleanText(event.promptText || ""),
      label: cleanText(event.label || ""),
      nearbyText: cleanText(event.nearbyText || ""),
      groupLabel: cleanText(event.groupLabel || ""),
      sectionText: cleanText(event.sectionText || "").slice(0, compact ? 100 : 300),
      text: cleanText(event.text || ""),
      value: valuePreview(event.value),
      checked: Boolean(event.checked),
      options: (event.options || []).slice(0, compact ? 8 : 20).map((option) => ({
        label: cleanText(option.label || option.text || ""),
        value: valuePreview(option.value),
        selected: Boolean(option.selected),
      })),
      localControls: (event.localControls || []).slice(0, compact ? 10 : 20).map((control) => ({
        tag: control.tag || "",
        role: control.role || "",
        type: control.type || "",
        promptText: cleanText(control.promptText || ""),
        label: cleanText(control.label || ""),
        text: cleanText(control.text || ""),
        value: valuePreview(control.value),
        checked: Boolean(control.checked),
      })),
      url: event.url || "",
    }));
}

function summarizeCandidates(candidates, options = {}) {
  const compact = Boolean(options.compact);
  return candidates.slice(0, compact ? 8 : 25).map((candidate, index) => ({
    index,
    id: candidate.id || "",
    score: candidate.score || 0,
    method: candidate.method || "",
    url: candidate.url || "",
    status: candidate.status || 0,
    resourceType: candidate.resourceType || "",
    durationMs: candidate.durationMs || 0,
    mimeType: candidate.mimeType || "",
    hasPostData: Boolean(candidate.hasPostData),
    postDataPreview: redactSensitiveText(candidate.postDataPreview || "").slice(0, compact ? 100 : 300),
    responseBodyPreview: redactSensitiveText(candidate.responseBodyPreview || "").slice(0, compact ? 140 : 500),
  }));
}

function summarizeRequestShapes(requests, candidates, options = {}) {
  const compact = Boolean(options.compact);
  const candidateIds = new Set(candidates.slice(0, compact ? 8 : 25).map((candidate) => candidate.id));
  return requests
    .filter((request) => candidateIds.has(request.id))
    .slice(0, compact ? 8 : 25)
    .map((request) => ({
      id: request.id || "",
      method: request.method || "",
      url: request.url || "",
      query: queryShape(request.url),
      postDataShape: postDataShape(request.postData, { compact }),
      postDataPreview: redactSensitiveText(request.postData || "").slice(0, compact ? 220 : 1200),
      responseBodyShape: postDataShape(request.responseBodyPreview, { compact }),
      responseBodyPreview: redactSensitiveText(request.responseBodyPreview || "").slice(0, compact ? 220 : 1200),
      requestHeaderNames: Object.keys(request.requestHeaders || {}).filter(isSafeHeaderName).slice(0, compact ? 10 : 30),
      responseHeaderNames: Object.keys(request.responseHeaders || {}).filter(isSafeHeaderName).slice(0, compact ? 10 : 30),
    }));
}

function queryShape(url) {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.entries()].slice(0, 80).map(([key, value]) => ({
      key,
      value: valuePreview(value),
    }));
  } catch {
    return [];
  }
}

function postDataShape(postData, options = {}) {
  const compact = Boolean(options.compact);
  if (!postData) return "";
  try {
    return JSON.stringify(shapeOf(JSON.parse(postData), 0, compact)).slice(0, compact ? 450 : 2000);
  } catch {
    return redactSensitiveText(String(postData)).slice(0, compact ? 220 : 1000);
  }
}

function shapeOf(value, depth = 0, compact = false) {
  if (depth > (compact ? 3 : 4)) return typeof value;
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1, compact)] : [];
  if (!value || typeof value !== "object") return typeof value;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, compact ? 18 : 60)) {
    output[key] = shapeOf(child, depth + 1, compact);
  }
  return output;
}

async function callOpenAiChatJson({ apiKey, baseUrl, model, evidence, env, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      store: false,
      messages: [
        {
          role: "system",
          content: analyzerInstructions(),
        },
        {
          role: "user",
          content: `Analyze this recording evidence and return strict JSON.\n\n${JSON.stringify(evidence)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "skill_recording_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
      max_completion_tokens: numberFromEnv(env.OPENAI_MAX_TOKENS, 4096),
    };

    if (env.OPENAI_TEMPERATURE !== undefined) body.temperature = numberFromEnv(env.OPENAI_TEMPERATURE, 0.2);
    if (env.OPENAI_REASONING_EFFORT) body.reasoning_effort = env.OPENAI_REASONING_EFFORT;

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI Chat Completions analysis failed: ${response.status} ${response.statusText} ${text.slice(0, 500)}`);
    }
    return parseChatCompletionJson(JSON.parse(text));
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiStructured({ apiKey, baseUrl, model, evidence, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      store: false,
      max_output_tokens: 3200,
      instructions: analyzerInstructions(),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Analyze this recording evidence and return strict JSON.\n\n${JSON.stringify(evidence)}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "skill_recording_analysis",
          strict: true,
          schema: ANALYSIS_SCHEMA,
        },
      },
    };

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI analysis failed: ${response.status} ${response.statusText} ${text.slice(0, 500)}`);
    }
    return parseOutputText(JSON.parse(text));
  } finally {
    clearTimeout(timer);
  }
}

async function callNvidiaChatJson({ apiKey, baseUrl, model, evidence, env, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      messages: [
        {
          role: "system",
          content: analyzerInstructions(),
        },
        {
          role: "user",
          content: [
            nvidiaAnalyzerPrompt(),
            "Recording evidence:",
            JSON.stringify(evidence),
          ].join("\n"),
        },
      ],
      response_format: { type: "json_object" },
      temperature: numberFromEnv(env.NVIDIA_TEMPERATURE, 0.2),
      top_p: numberFromEnv(env.NVIDIA_TOP_P, 0.9),
      max_tokens: numberFromEnv(env.NVIDIA_MAX_TOKENS, 3072),
    };

    if (["1", "true", "on", "yes"].includes(String(env.NVIDIA_ENABLE_THINKING || "").toLowerCase())) {
      body.chat_template_kwargs = { enable_thinking: true };
      body.reasoning_budget = numberFromEnv(env.NVIDIA_REASONING_BUDGET, 4096);
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`NVIDIA analysis failed: ${response.status} ${response.statusText} ${text.slice(0, 500)}`);
    }
    return parseChatCompletionJson(JSON.parse(text));
  } finally {
    clearTimeout(timer);
  }
}

async function callCodexExecJson({ model, evidence, env, timeoutMs }) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "api-skill-builder-codex-"));
  try {
    const schemaFile = path.join(tempDir, "skill-analysis.schema.json");
    const outputFile = path.join(tempDir, "skill-analysis.output.json");
    await fs.writeFile(schemaFile, JSON.stringify(ANALYSIS_SCHEMA, null, 2));

    const command = env.SKILL_BUILDER_CODEX_COMMAND || defaultCodexCommand();
    const args = [
      "exec",
      "--sandbox",
      env.SKILL_BUILDER_CODEX_SANDBOX || "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--output-schema",
      schemaFile,
      "-o",
      outputFile,
    ];
    const cwd = env.SKILL_BUILDER_CODEX_CWD || process.cwd();
    if (cwd) args.push("--cd", cwd);
    if (model && model !== "default") args.push("--model", model);
    args.push("-");

    const prompt = [
      codexAnalyzerPrompt(),
      "",
      "Recording evidence JSON:",
      JSON.stringify(evidence),
    ].join("\n");

    const result = await runProcess(command, args, {
      stdin: prompt,
      timeoutMs,
      env: {
        ...process.env,
        ...env,
        NO_COLOR: "1",
      },
    });

    if (result.code !== 0) {
      throw new Error(`Codex analysis failed: exit ${result.code}. ${cleanText(result.stderr || result.stdout).slice(0, 900)}`);
    }

    const outputText = await fs.readFile(outputFile, "utf8").catch(() => "");
    const text = outputText || result.stdout || "";
    if (!text.trim()) {
      throw new Error("Codex analysis did not produce structured output.");
    }
    return JSON.parse(extractJsonObjectText(text));
  } finally {
    if (env.SKILL_BUILDER_KEEP_CODEX_TEMP !== "1") {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function codexAnalyzerPrompt() {
  return [
    "You are Codex acting as a senior endpoint reverse engineer for one recorded website workflow.",
    "Use only the recording evidence below. Do not browse, do not run shell commands, and do not inspect local files.",
    "Your job is to decide whether the skill can be replayed with direct API calls, a query/result URL, or browser replay.",
    "Return only the final JSON object that matches the provided output schema.",
    "",
    analyzerInstructions(),
    "",
    "Extra review rules:",
    "- Treat Chrome DevTools Protocol network requests as the source of truth for endpoints.",
    "- Treat Playwright controls, accessibility names, recorded input/change/click events, labels, placeholders, and option text as the source of truth for user questions.",
    "- Reject internal request fields unless visible website evidence proves the user knowingly entered or selected them.",
    "- Prefer high confidence over overfitting. If the endpoint is unclear, choose browser_replay or manual_review.",
    "- Make the chatbot flow feel like the website: grouped, ordered, and concise.",
    "- Select important outputs only, such as quote plans/prices, BMI score/category, eligibility, distance/time, or result summary.",
  ].join("\n");
}

function defaultCodexCommand() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function runProcess(command, args, { stdin = "", timeoutMs, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      reject(new Error(`Codex analysis timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start Codex command "${command}": ${error.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.stdin.end(stdin);
  });
}

function nvidiaAnalyzerPrompt() {
  return [
    "Analyze this recording evidence and return one JSON object only.",
    "Use this exact top-level shape; omit no top-level keys:",
    "{",
    '  "summary": "short description",',
    '  "goal": "what the skill does",',
    '  "confidence": 0.0,',
    '  "strategy": {"kind":"direct_api|query_api|browser_result_url|browser_replay|manual_review","candidateId":"","rationale":"","finalUrlUseful":false},',
    '  "endpointEngineering": {"selectedRequestId":"","selectedEndpointUrl":"","method":"","endpointPurpose":"","payloadType":"json|query|form|multipart|browser|none|unknown","userInputMappings":[],"constantsToKeep":[],"volatileFields":[],"requiredPreflightSteps":[],"outputExtraction":[],"implementationNotes":[],"replayWarnings":[],"confidence":0.0},',
    '  "inputs": [],',
    '  "actions": [],',
    '  "outputs": [],',
    '  "conversation": {"intro":"","inputGroups":[]},',
    '  "risks": []',
    "}",
    "Each input must be an object with id, question, type, required, mapsTo, helpText, evidence.",
    "Each userInputMappings item must have inputId, question, type, mapsTo, transform, required, evidence.",
    "Only create inputs from visible labels/options/clicks/typed fields in the evidence.",
    "Never create inputs from hidden transport fields, headers, tokens, viewstate, UUIDs, counters, policy IDs, or raw JSON paths.",
    "Questions must sound like the website's own form questions.",
    "For outputs, keep only important result fields such as quote plans, premiums, prices, BMI score/category, duration/distance, or eligibility.",
    "",
  ].join("\n");
}

function analyzerInstructions() {
  return [
    "You are an endpoint reverse-engineering assistant for one recorded website workflow and return JSON only.",
    "Use only the evidence supplied. Do not invent endpoints, selectors, fields, buttons, prices, or outputs.",
    "Infer the website's purpose from page text, visible fields, clicks, final URL, candidate requests, request payload shapes, and response previews.",
    "Identify which captured request actually completes the user goal, which request fields are user-controlled, which are constants, and which are volatile session/generated fields.",
    "For payload paths, use JSONPath-like strings such as $.tripType, $.travellers[0].age, query.region, or form.height.",
    "Never turn hidden, framework, generated, or transport fields into user questions. Examples include __VIEWSTATE, __VIEWSTATEGENERATOR, __EVENTVALIDATION, __EVENTTARGET, CSRF/XSRF/authenticity/request verification tokens, nonces, UUID/session/correlation IDs, captcha/turnstile/recaptcha fields, submit buttons, counters, and generated row numbers.",
    "Classify technical fields as constantsToKeep, volatileFields, requiredPreflightSteps, or replay details. Only fields a real website user would knowingly enter/select/upload belong in inputs or userInputMappings.",
    "Every input and userInputMapping must cite visible evidence from fields or events, such as a label, placeholder, nearby text, clicked button, selected option, or typed value. Do not create questions merely because an API payload key sounds user-related.",
    "Prefer direct_api or query_api only when a candidate request clearly represents the final user goal.",
    "Use browser_result_url when the final URL query appears to carry the result state.",
    "Use browser_replay when the workflow depends on visible UI interactions and no reusable endpoint is clear.",
    "Write input questions as a user would see them on the website. If the website labels are unclear, rewrite them into concise natural questions based on page context and nearby options. Avoid raw JSON paths, UUIDs, request field names, or generic prompts such as 'Value for ...'.",
    "Return a conversation intro explaining in one short sentence what the learned skill will do, then group questions into a natural chatbot flow using inputGroups.",
    "For repeated visible rows or entities, such as modules, travellers, passengers, dependents, products, or jobs, create one repeatable input group and write a natural addAnotherQuestion.",
    "For outputs, identify only the important user-facing result fields, such as price, quote, BMI score, category, risk, eligibility, duration, distance, or plan summary.",
    "Do not make outputs point to the entire page or entire response when a smaller result section or JSON path is evident.",
    "Never recommend bypassing CAPTCHA, login, payment, access control, bot protection, or website security.",
    "Do not include private user-entered values in your answer.",
  ].join(" ");
}

function parseOutputText(response) {
  const direct = response.output_text;
  if (typeof direct === "string" && direct.trim()) return JSON.parse(direct);

  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        return JSON.parse(content.text);
      }
    }
  }
  throw new Error("OpenAI analysis response did not contain output_text JSON.");
}

function parseChatCompletionJson(response) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Chat completion analysis response did not contain message content JSON.");
  }
  return JSON.parse(extractJsonObjectText(content));
}

function extractJsonObjectText(content) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function normalizeAnalysis(analysis, evidence) {
  return {
    summary: cleanText(analysis.summary || ""),
    goal: cleanText(analysis.goal || evidence.userGoal || ""),
    confidence: clampConfidence(analysis.confidence),
    strategy: {
      kind: analysis.strategy?.kind || "manual_review",
      candidateId: analysis.strategy?.candidateId || analysis.endpointEngineering?.selectedRequestId || "",
      rationale: cleanText(analysis.strategy?.rationale || ""),
      finalUrlUseful: Boolean(analysis.strategy?.finalUrlUseful),
    },
    endpointEngineering: normalizeEndpointEngineering(analysis.endpointEngineering || {}),
    inputs: Array.isArray(analysis.inputs) ? analysis.inputs.map(normalizeInputAnalysis) : [],
    actions: Array.isArray(analysis.actions) ? analysis.actions.map(normalizeActionAnalysis) : [],
    outputs: Array.isArray(analysis.outputs) ? analysis.outputs.map(normalizeOutputAnalysis) : [],
    conversation: normalizeConversation(analysis.conversation || {}),
    risks: Array.isArray(analysis.risks) ? analysis.risks.map(cleanText).filter(Boolean) : [],
  };
}

function normalizeInputAnalysis(input) {
  return {
    id: slugLike(input.id || input.question || "input"),
    question: cleanText(input.question || input.id || "Input"),
    type: normalizeInputType(input.type),
    required: Boolean(input.required),
    mapsTo: Array.isArray(input.mapsTo) ? input.mapsTo.map(String).filter(Boolean) : [],
    helpText: cleanText(input.helpText || ""),
    evidence: cleanText(input.evidence || ""),
  };
}

function normalizeEndpointEngineering(plan) {
  return {
    selectedRequestId: String(plan.selectedRequestId || ""),
    selectedEndpointUrl: String(plan.selectedEndpointUrl || ""),
    method: String(plan.method || ""),
    endpointPurpose: cleanText(plan.endpointPurpose || ""),
    payloadType: normalizePayloadType(plan.payloadType),
    userInputMappings: Array.isArray(plan.userInputMappings) ? plan.userInputMappings.map(normalizeInputMapping) : [],
    constantsToKeep: Array.isArray(plan.constantsToKeep) ? plan.constantsToKeep.map(normalizeConstant) : [],
    volatileFields: Array.isArray(plan.volatileFields) ? plan.volatileFields.map(normalizeVolatileField) : [],
    requiredPreflightSteps: Array.isArray(plan.requiredPreflightSteps) ? plan.requiredPreflightSteps.map(normalizePreflightStep) : [],
    outputExtraction: Array.isArray(plan.outputExtraction) ? plan.outputExtraction.map(normalizeOutputExtraction) : [],
    implementationNotes: Array.isArray(plan.implementationNotes) ? plan.implementationNotes.map(cleanText).filter(Boolean) : [],
    replayWarnings: Array.isArray(plan.replayWarnings) ? plan.replayWarnings.map(cleanText).filter(Boolean) : [],
    confidence: clampConfidence(plan.confidence),
  };
}

function normalizeInputMapping(mapping) {
  return {
    inputId: slugLike(mapping.inputId || mapping.question || "input"),
    question: cleanText(mapping.question || mapping.inputId || "Input"),
    type: normalizeInputType(mapping.type),
    mapsTo: Array.isArray(mapping.mapsTo) ? mapping.mapsTo.map(String).filter(Boolean) : [],
    transform: cleanText(mapping.transform || ""),
    required: Boolean(mapping.required),
    evidence: cleanText(mapping.evidence || ""),
  };
}

function normalizeConstant(constant) {
  return {
    path: String(constant.path || ""),
    reason: cleanText(constant.reason || ""),
    evidence: cleanText(constant.evidence || ""),
  };
}

function normalizeVolatileField(field) {
  return {
    path: String(field.path || ""),
    handling: normalizeVolatileHandling(field.handling),
    reason: cleanText(field.reason || ""),
    evidence: cleanText(field.evidence || ""),
  };
}

function normalizePreflightStep(step) {
  return {
    purpose: cleanText(step.purpose || ""),
    candidateId: String(step.candidateId || ""),
    url: String(step.url || ""),
    reason: cleanText(step.reason || ""),
  };
}

function normalizeOutputExtraction(output) {
  return {
    label: cleanText(output.label || "Result"),
    source: normalizeOutputSource(output.source),
    path: String(output.path || ""),
    evidence: cleanText(output.evidence || ""),
  };
}

function normalizeActionAnalysis(action) {
  return {
    label: cleanText(action.label || ""),
    selector: String(action.selector || ""),
    role: cleanText(action.role || ""),
    evidence: cleanText(action.evidence || ""),
  };
}

function normalizeOutputAnalysis(output) {
  return {
    label: cleanText(output.label || "Result"),
    description: cleanText(output.description || ""),
    evidence: cleanText(output.evidence || ""),
  };
}

function normalizeConversation(conversation) {
  return {
    intro: cleanText(conversation.intro || ""),
    inputGroups: Array.isArray(conversation.inputGroups)
      ? conversation.inputGroups.map(normalizeInputGroup).filter((group) => group.inputIds.length)
      : [],
  };
}

function normalizeInputGroup(group) {
  return {
    title: cleanText(group.title || "Details"),
    description: cleanText(group.description || ""),
    inputIds: Array.isArray(group.inputIds) ? group.inputIds.map(slugLike).filter(Boolean) : [],
    repeatable: Boolean(group.repeatable),
    addAnotherQuestion: cleanText(group.addAnotherQuestion || ""),
  };
}

function improveInput(input, analyzedInputs) {
  const match = bestInputMatch(input, analyzedInputs);
  if (!match) return input;

  const improved = { ...input };
  if (looksLikeGoodQuestion(match.question)) improved.question = match.question;
  if (match.helpText) improved.description = match.helpText;
  if (match.type && match.type !== "boolean" && canSafelyUseType(input, match.type)) {
    improved.type = match.type;
  }
  if (typeof match.required === "boolean") improved.optional = !match.required;
  return improved;
}

function improveOutputs(skill, analysis) {
  const existing = skill.outputs || [];
  const engineered = analysis.endpointEngineering?.outputExtraction || [];
  const usableExtractions = engineered.filter((output) => output.path && output.path !== "unknown");
  if (usableExtractions.length) {
    const defaultFrom = existing[0]?.from || skill.steps?.at(-1)?.id || "goal";
    return usableExtractions.map((output, index) => {
      const base = {
        label: output.label || analysis.outputs?.[index]?.label || existing[index]?.label || "Result",
        from: existing[index]?.from || defaultFrom,
        path: output.path || existing[index]?.path || "$",
      };
      if (["html", "text", "browser"].includes(output.source) || output.path === "$") {
        return {
          ...base,
          path: "$",
          extractor: "important",
          focus: output.path === "$" ? output.evidence || output.label : output.path,
        };
      }
      return base;
    });
  }

  if (analysis.outputs?.length) {
    return existing.map((output, index) => ({
      ...output,
      label: analysis.outputs[index]?.label || analysis.outputs[0]?.label || output.label,
    }));
  }
  return existing;
}

function improveConversation(skill, analysis) {
  const inputs = skill.inputs || [];
  const inputById = new Map(inputs.map((input) => [input.id, input]));
  const intro = cleanText(analysis.conversation?.intro || analysis.summary || "");
  const groups = Array.isArray(analysis.conversation?.inputGroups)
    ? analysis.conversation.inputGroups
    : [];
  const sanitizedGroups = groups
    .map((group) => {
      const inputIds = (group.inputIds || [])
        .map((id) => inputById.has(id) ? id : findInputIdByLooseMatch(inputById, id))
        .filter((id, index, all) => id && all.indexOf(id) === index);
      if (!inputIds.length) return null;
      return {
        title: cleanText(group.title || "Details"),
        description: cleanText(group.description || ""),
        inputIds,
        repeatable: Boolean(group.repeatable),
        addAnotherQuestion: cleanText(group.addAnotherQuestion || ""),
      };
    })
    .filter(Boolean);

  return {
    intro,
    inputGroups: sanitizedGroups,
  };
}

function findInputIdByLooseMatch(inputById, candidate) {
  const normalized = normalizeKey(candidate);
  if (!normalized) return "";
  for (const [id, input] of inputById) {
    const keys = [id, input.question].filter(Boolean).map(normalizeKey);
    if (keys.some((key) => key === normalized || key.includes(normalized) || normalized.includes(key))) return id;
  }
  return "";
}

function bestInputMatch(input, analyzedInputs) {
  const inputKeys = new Set([
    input.id,
    input.question,
    ...(input.question ? [slugLike(input.question)] : []),
  ].filter(Boolean).map(normalizeKey));

  let best = null;
  let bestScore = 0;
  for (const analyzed of analyzedInputs) {
    const analyzedKeys = [
      analyzed.id,
      analyzed.question,
      ...analyzed.mapsTo,
    ].filter(Boolean).map(normalizeKey);
    let score = 0;
    for (const key of analyzedKeys) {
      if (inputKeys.has(key)) score += 3;
      for (const inputKey of inputKeys) {
        if (key && inputKey && (key.includes(inputKey) || inputKey.includes(key))) score += 1;
      }
    }
    if (score > bestScore) {
      best = analyzed;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
}

function enhancedDescription(existing, analysis) {
  const parts = [cleanText(existing || "")].filter(Boolean);
  if (analysis.summary) parts.push(`LLM context: ${analysis.summary}`);
  if (analysis.strategy?.rationale) parts.push(`Strategy rationale: ${analysis.strategy.rationale}`);
  if (analysis.endpointEngineering?.endpointPurpose) {
    parts.push(`Endpoint purpose: ${analysis.endpointEngineering.endpointPurpose}`);
  }
  return parts.join(" ");
}

function looksLikeGoodQuestion(question) {
  if (!question || question.length < 2 || question.length > 120) return false;
  if (/^\$\.|uuid|blockGroupUuid|value for/i.test(question)) return false;
  if (isTechnicalName(question)) return false;
  return true;
}

function isTechnicalInput(input) {
  const haystack = [input?.id, input?.question, input?.description]
    .filter(Boolean)
    .join(" ");
  return isTechnicalName(input?.id)
    || /^\s*(?:value for|\$\.)/i.test(String(input?.question || ""))
    || /\b(?:viewstate|eventvalidation|csrf|xsrf|captcha|recaptcha|turnstile|nonce|authenticity token|request verification token)\b/i.test(haystack);
}

function isTechnicalName(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const normalized = normalizeKey(raw);
  return [
    /^__.+$/i,
    /^_+(?:method|token|csrf|xsrf)$/i,
    /^viewstate(?:generator)?$/i,
    /^eventvalidation$/i,
    /^eventtarget$/i,
    /^eventargument$/i,
    /^lastfocus$/i,
    /csrf/i,
    /xsrf/i,
    /antiforgery/i,
    /authenticitytoken/i,
    /requestverificationtoken/i,
    /verificationtoken/i,
    /captcha/i,
    /recaptcha/i,
    /turnstile/i,
    /nonce/i,
    /(?:session|respondent|blockgroup|request|visitor|client|correlation|interaction).*(?:uuid|id|token|key)/i,
    /(?:uuid|id|token|key).*(?:session|respondent|blockgroup|request|visitor|client|correlation|interaction)/i,
    /^gen(?:erated)?.*(?:num|count|index)$/i,
  ].some((pattern) => pattern.test(raw) || pattern.test(normalized));
}

function canSafelyUseType(input, analyzedType) {
  if (input.choices?.length) return ["choice", "multi-choice", "number", "string"].includes(analyzedType);
  if (input.type === "file") return analyzedType === "file";
  return ["string", "number", "email", "url", "json"].includes(analyzedType);
}

function normalizeInputType(type) {
  const allowed = new Set(["string", "number", "email", "url", "choice", "multi-choice", "file", "json", "boolean"]);
  return allowed.has(type) ? type : "string";
}

function normalizePayloadType(type) {
  const allowed = new Set(["json", "query", "form", "multipart", "browser", "none", "unknown"]);
  return allowed.has(type) ? type : "unknown";
}

function normalizeVolatileHandling(handling) {
  const allowed = new Set(["omit", "regenerate_uuid", "fetch_from_preflight", "keep_recorded", "ask_user", "unknown"]);
  return allowed.has(handling) ? handling : "unknown";
}

function normalizeOutputSource(source) {
  const allowed = new Set(["json", "text", "html", "browser", "unknown"]);
  return allowed.has(source) ? source : "unknown";
}

function resolveLlmProvider(env) {
  const configured = String(env.SKILL_BUILDER_ANALYZER || env.SKILL_BUILDER_LLM_PROVIDER || "").trim().toLowerCase();
  if (["codex", "codex-cli", "codex-exec"].includes(configured)) return "codex";
  if (["nvidia", "nemotron"].includes(configured)) return "nvidia";
  if (["openai", "chatgpt", "chat", "chat-completions", "openai-chat"].includes(configured)) return "openai";
  if (["responses", "openai-responses"].includes(configured)) return "openai_responses";
  if (["1", "true", "on", "yes"].includes(String(env.SKILL_BUILDER_CODEX || "").toLowerCase())) return "codex";
  if (env.OPENAI_API_KEY) return "openai";
  if (env.NVIDIA_API_KEY) return "nvidia";
  return "openai";
}

function modelForProvider(provider, env) {
  if (provider === "codex") return env.SKILL_BUILDER_CODEX_MODEL || DEFAULT_CODEX_MODEL;
  if (provider === "nvidia") return env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL;
  return env.OPENAI_MODEL || DEFAULT_MODEL;
}

function apiKeyNameForProvider(provider) {
  if (provider === "codex") return "";
  return provider === "nvidia" ? "NVIDIA_API_KEY" : "OPENAI_API_KEY";
}

function numberFromEnv(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function valuePreview(value) {
  if (value === undefined || value === null || value === "") return "";
  return redactSensitiveText(String(value)).slice(0, 80);
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\b(?:\+?\d[\s-]?){8,}\b/g, "[redacted-number]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(authorization|password|secret|token|api[_-]?key|cookie)["']?\s*[:=]\s*["']?[^"',}\s]+/gi, "$1=[redacted]");
}

function cleanText(value) {
  return String(value || "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function slugLike(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "input";
}

function clampConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function isSafeHeaderName(name) {
  return !/cookie|authorization|token|secret|key|password/i.test(name);
}
