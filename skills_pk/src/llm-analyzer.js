const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

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

  const evidence = buildRecordingEvidence(recording, candidates);
  const provider = status.provider;
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
    : await callOpenAiStructured({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
        model: options.model || env.OPENAI_MODEL || DEFAULT_MODEL,
        evidence,
        timeoutMs,
      });

  return {
    ...normalizeAnalysis(response, evidence),
    analyzer: provider === "nvidia" ? "nvidia-chat-completions-json-mode" : "openai-responses-structured-output",
    provider,
  };
}

function defaultLlmTimeoutMs(provider) {
  return provider === "nvidia" ? 120000 : 45000;
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
    analyzer: analysis.analyzer || "openai-responses-structured-output",
    provider: analysis.provider || "openai",
    summary: cleanText(analysis.summary),
    inferredGoal: cleanText(analysis.goal),
    confidence: clampConfidence(analysis.confidence),
    strategy: analysis.strategy,
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
      nearbyText: cleanText(field.nearbyText || ""),
      groupLabel: cleanText(field.groupLabel || ""),
      sectionText: cleanText(field.sectionText || "").slice(0, 300),
      source: field.source || "",
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
      nearbyText: cleanText(event.nearbyText || ""),
      groupLabel: cleanText(event.groupLabel || ""),
      sectionText: cleanText(event.sectionText || "").slice(0, 300),
      text: cleanText(event.text || ""),
      value: valuePreview(event.value),
      checked: Boolean(event.checked),
      options: (event.options || []).slice(0, 20).map((option) => ({
        label: cleanText(option.label || option.text || ""),
        value: valuePreview(option.value),
        selected: Boolean(option.selected),
      })),
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
    responseBodyPreview: redactSensitiveText(candidate.responseBodyPreview || "").slice(0, 500),
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
      query: queryShape(request.url),
      postDataShape: postDataShape(request.postData),
      postDataPreview: redactSensitiveText(request.postData || "").slice(0, 1200),
      responseBodyShape: postDataShape(request.responseBodyPreview),
      responseBodyPreview: redactSensitiveText(request.responseBodyPreview || "").slice(0, 1200),
      requestHeaderNames: Object.keys(request.requestHeaders || {}).filter(isSafeHeaderName).slice(0, 30),
      responseHeaderNames: Object.keys(request.responseHeaders || {}).filter(isSafeHeaderName).slice(0, 30),
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
            "Analyze this recording evidence and return one JSON object only.",
            "The JSON must match this schema shape. Use empty strings, empty arrays, false, or 0 when evidence is missing.",
            JSON.stringify(ANALYSIS_SCHEMA),
            "",
            "Recording evidence:",
            JSON.stringify(evidence),
          ].join("\n"),
        },
      ],
      response_format: { type: "json_object" },
      temperature: numberFromEnv(env.NVIDIA_TEMPERATURE, 1),
      top_p: numberFromEnv(env.NVIDIA_TOP_P, 0.95),
      max_tokens: numberFromEnv(env.NVIDIA_MAX_TOKENS, 16384),
    };

    if (env.NVIDIA_ENABLE_THINKING !== "0" && env.NVIDIA_ENABLE_THINKING !== "off") {
      body.chat_template_kwargs = { enable_thinking: true };
      body.reasoning_budget = numberFromEnv(env.NVIDIA_REASONING_BUDGET, 16384);
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
    throw new Error("NVIDIA analysis response did not contain message content JSON.");
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
  const configured = String(env.SKILL_BUILDER_LLM_PROVIDER || "").trim().toLowerCase();
  if (["nvidia", "nemotron"].includes(configured)) return "nvidia";
  if (["openai", "responses"].includes(configured)) return "openai";
  if (env.NVIDIA_API_KEY) return "nvidia";
  return "openai";
}

function modelForProvider(provider, env) {
  if (provider === "nvidia") return env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL;
  return env.OPENAI_MODEL || DEFAULT_MODEL;
}

function apiKeyNameForProvider(provider) {
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
