const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "goal", "confidence", "strategy", "inputs", "actions", "outputs", "risks"],
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
    risks: {
      type: "array",
      items: { type: "string" },
    },
  },
};

export function llmAnalysisStatus(env = process.env) {
  if (env.SKILL_BUILDER_LLM === "off" || env.SKILL_BUILDER_LLM === "0") {
    return {
      enabled: false,
      reason: "disabled by SKILL_BUILDER_LLM",
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
    };
  }
  if (!env.OPENAI_API_KEY) {
    return {
      enabled: false,
      reason: "OPENAI_API_KEY is not set",
      model: env.OPENAI_MODEL || DEFAULT_MODEL,
    };
  }
  return {
    enabled: true,
    reason: "OPENAI_API_KEY is set",
    model: env.OPENAI_MODEL || DEFAULT_MODEL,
  };
}

export async function analyzeRecordingWithLlm(recording, candidates = [], options = {}) {
  const env = options.env || process.env;
  const status = llmAnalysisStatus(env);
  if (!status.enabled) return null;

  const evidence = buildRecordingEvidence(recording, candidates);
  const model = options.model || env.OPENAI_MODEL || DEFAULT_MODEL;
  const response = await callOpenAiStructured({
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model,
    evidence,
    timeoutMs: Number(env.SKILL_BUILDER_LLM_TIMEOUT_MS || options.timeoutMs || 30000),
  });

  return normalizeAnalysis(response, evidence);
}

export function buildRecordingEvidence(recording, candidates = []) {
  const page = recording.pageFields || {};
  return {
    sourceUrl: recording.url || "",
    finalUrl: page.url || recording.url || "",
    title: cleanText(page.title || ""),
    userGoal: cleanText(recording.goal || ""),
    pageText: redactSensitiveText(cleanText(page.text || "").slice(0, 4000)),
    fields: summarizeFields(page.fields || []),
    events: summarizeEvents(page.events || []),
    candidateRequests: summarizeCandidates(candidates),
    requestShapes: summarizeRequestShapes(recording.requests || [], candidates),
  };
}

export function applyLlmAnalysisToSkill(skill, analysis) {
  if (!analysis) return skill;

  const improved = structuredClone(skill);
  improved.description = enhancedDescription(improved.description, analysis);
  improved.learning = {
    ...(improved.learning || {}),
    analyzer: "openai-responses-structured-output",
    summary: cleanText(analysis.summary),
    inferredGoal: cleanText(analysis.goal),
    confidence: clampConfidence(analysis.confidence),
    strategy: analysis.strategy,
    outputs: analysis.outputs,
    risks: analysis.risks,
  };

  if (Array.isArray(improved.inputs)) {
    improved.inputs = improved.inputs.map((input) => improveInput(input, analysis.inputs || []));
  }

  if (Array.isArray(improved.outputs) && analysis.outputs?.length) {
    improved.outputs = improved.outputs.map((output, index) => ({
      ...output,
      label: analysis.outputs[index]?.label || analysis.outputs[0]?.label || output.label,
    }));
  }

  return improved;
}

export function orderCandidatesByAnalysis(candidates, analysis) {
  const candidateId = analysis?.strategy?.candidateId;
  if (!candidateId) return candidates;
  return [
    ...candidates.filter((candidate) => candidate.id === candidateId),
    ...candidates.filter((candidate) => candidate.id !== candidateId),
  ];
}

function summarizeFields(fields) {
  return fields
    .filter((field) => field && field.visible !== false)
    .slice(0, 80)
    .map((field) => ({
      tag: field.tag || "",
      type: field.type || "",
      name: field.name || "",
      id: field.id || "",
      label: cleanText(field.label || ""),
      placeholder: cleanText(field.placeholder || ""),
      value: valuePreview(field.value),
      checked: Boolean(field.checked),
      multiple: Boolean(field.multiple),
      options: (field.options || []).slice(0, 60).map((option) => ({
        label: cleanText(option.label || option.text || ""),
        value: valuePreview(option.value),
        selected: Boolean(option.selected),
      })),
    }));
}

function summarizeEvents(events) {
  return events
    .filter((event) => event && ["input", "change", "click"].includes(event.type))
    .slice(-120)
    .map((event) => ({
      type: event.type,
      selector: event.selector || "",
      tag: event.tag || "",
      inputType: event.inputType || "",
      id: event.id || "",
      name: event.name || "",
      label: cleanText(event.label || ""),
      text: cleanText(event.text || ""),
      value: valuePreview(event.value),
      checked: Boolean(event.checked),
      url: event.url || "",
    }));
}

function summarizeCandidates(candidates) {
  return candidates.slice(0, 25).map((candidate, index) => ({
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
    postDataPreview: redactSensitiveText(candidate.postDataPreview || "").slice(0, 300),
  }));
}

function summarizeRequestShapes(requests, candidates) {
  const candidateIds = new Set(candidates.slice(0, 25).map((candidate) => candidate.id));
  return requests
    .filter((request) => candidateIds.has(request.id))
    .slice(0, 25)
    .map((request) => ({
      id: request.id || "",
      method: request.method || "",
      url: request.url || "",
      postDataShape: postDataShape(request.postData),
      requestHeaderNames: Object.keys(request.requestHeaders || {}).filter(isSafeHeaderName).slice(0, 30),
      responseHeaderNames: Object.keys(request.responseHeaders || {}).filter(isSafeHeaderName).slice(0, 30),
    }));
}

function postDataShape(postData) {
  if (!postData) return "";
  try {
    return JSON.stringify(shapeOf(JSON.parse(postData))).slice(0, 2000);
  } catch {
    return redactSensitiveText(String(postData)).slice(0, 1000);
  }
}

function shapeOf(value, depth = 0) {
  if (depth > 4) return typeof value;
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];
  if (!value || typeof value !== "object") return typeof value;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 60)) {
    output[key] = shapeOf(child, depth + 1);
  }
  return output;
}

async function callOpenAiStructured({ apiKey, baseUrl, model, evidence, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model,
      store: false,
      temperature: 0.1,
      max_output_tokens: 1800,
      instructions: [
        "You analyze one recorded website workflow and return JSON only.",
        "Use only the evidence supplied. Do not invent endpoints, selectors, fields, buttons, prices, or outputs.",
        "Infer the website's purpose from page text, visible fields, clicks, final URL, and network request shapes.",
        "Prefer direct_api or query_api only when a candidate request clearly represents the final user goal.",
        "Use browser_result_url when the final URL query appears to carry the result state.",
        "Use browser_replay when the workflow depends on visible UI interactions and no reusable endpoint is clear.",
        "Write input questions as a user would see them on the website. Avoid raw JSON paths or UUIDs.",
        "Do not include private user-entered values in your answer.",
      ].join(" "),
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

function normalizeAnalysis(analysis, evidence) {
  return {
    summary: cleanText(analysis.summary || ""),
    goal: cleanText(analysis.goal || evidence.userGoal || ""),
    confidence: clampConfidence(analysis.confidence),
    strategy: {
      kind: analysis.strategy?.kind || "manual_review",
      candidateId: analysis.strategy?.candidateId || "",
      rationale: cleanText(analysis.strategy?.rationale || ""),
      finalUrlUseful: Boolean(analysis.strategy?.finalUrlUseful),
    },
    inputs: Array.isArray(analysis.inputs) ? analysis.inputs.map(normalizeInputAnalysis) : [],
    actions: Array.isArray(analysis.actions) ? analysis.actions.map(normalizeActionAnalysis) : [],
    outputs: Array.isArray(analysis.outputs) ? analysis.outputs.map(normalizeOutputAnalysis) : [],
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
  return parts.join(" ");
}

function looksLikeGoodQuestion(question) {
  if (!question || question.length < 2 || question.length > 120) return false;
  if (/^\$\.|uuid|blockGroupUuid|value for/i.test(question)) return false;
  return true;
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
