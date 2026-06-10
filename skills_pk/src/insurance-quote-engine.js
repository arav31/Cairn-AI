import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "./env.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const TRACE_DIR = path.join(PROJECT_ROOT, "traces", "insurance-run");
const FWD_TEMPLATE_PATH = path.join(TRACE_DIR, "fwd-calculatePremium-request.json");
const FWD_QUOTED_TRACE_PATH = path.join(TRACE_DIR, "fwd-term-life-plus-quoted.json");
const SINGLIFE_RESPONSE_PATH = path.join(TRACE_DIR, "singlife-computePremium-response.json");

const quoteCache = new Map();

const REAL_SKILL_ID = "term-plan-insurance-comparison";

const marketplaceSkills = [
  {
    id: REAL_SKILL_ID,
    name: "Term Plan Insurance Comparison",
    provider: "Cairn AI",
    price: "S$19/mo",
    status: "live-demo",
    category: "Insurance",
    description:
      "Compares term life quotes from learned Singlife and FWD endpoints, with Income guarded-route metadata and cached fallback.",
    real: true,
    learnedProviders: ["Singlife", "FWD", "Income"],
  },
  {
    id: "travel-insurance-quote-radar",
    name: "Travel Insurance Quote Radar",
    provider: "Demo vendor",
    price: "S$9/mo",
    status: "mock",
    category: "Insurance",
    description: "Dummy marketplace skill for travel insurance quotes.",
    real: false,
  },
  {
    id: "motor-quote-normalizer",
    name: "Motor Quote Normalizer",
    provider: "Demo vendor",
    price: "S$29/mo",
    status: "mock",
    category: "Insurance",
    description: "Dummy marketplace skill for motor insurance quote comparison.",
    real: false,
  },
  {
    id: "mortgage-rate-scout",
    name: "Mortgage Rate Scout",
    provider: "Demo vendor",
    price: "S$14/mo",
    status: "mock",
    category: "Finance",
    description: "Dummy marketplace skill for home loan rate discovery.",
    real: false,
  },
  {
    id: "remote-job-search-agent",
    name: "Remote Job Search Agent",
    provider: "Demo vendor",
    price: "S$7/mo",
    status: "mock",
    category: "Recruiting",
    description: "Dummy marketplace skill for remote job search.",
    real: false,
  },
];

export function getInsuranceMarketplaceSkills() {
  return marketplaceSkills.map((skill) => ({ ...skill }));
}

export async function compareTermPlans(rawInputs = {}, options = {}) {
  loadEnvFile();

  const normalized = normalizeInsuranceInputs(rawInputs);
  const cacheKey = stableCacheKey(normalized);
  const totalStart = performance.now();

  if (options.useCache !== false && quoteCache.has(cacheKey)) {
    const cached = structuredClone(quoteCache.get(cacheKey));
    cached.cache = { hit: true, key: cacheKey };
    cached.timings.totalMs = roundMs(performance.now() - totalStart);
    cached.generatedAt = new Date().toISOString();
    cached.summary = buildSpeedSummary(cached);
    return cached;
  }

  const providers = await Promise.allSettled([
    quoteSinglife(normalized),
    quoteFwd(normalized),
    quoteIncomeGuarded(normalized),
  ]);

  const quotes = providers.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const provider = ["Singlife", "FWD", "Income"][index];
    return failedQuote(provider, result.reason);
  });

  const recommendation = await buildRecommendation(quotes, normalized);
  const result = {
    skillId: REAL_SKILL_ID,
    skillName: "Term Plan Insurance Comparison",
    inputs: normalized,
    cache: { hit: false, key: cacheKey },
    quotes,
    recommendation,
    learnedEndpoints: getLearnedEndpoints(),
    timings: {
      totalMs: roundMs(performance.now() - totalStart),
      providers: quotes.map((quote) => ({
        provider: quote.provider,
        ms: quote.timingMs,
        source: quote.source,
        status: quote.status,
      })),
    },
    generatedAt: new Date().toISOString(),
    disclaimer:
      "Demo quotes are for workflow comparison only. Confirm eligibility, benefits, exclusions, and final premiums with the insurer before buying.",
  };

  result.summary = buildSpeedSummary(result);
  quoteCache.set(cacheKey, structuredClone(result));
  return result;
}

export function clearInsuranceQuoteCache() {
  quoteCache.clear();
}

export function getLearnedEndpoints() {
  return [
    {
      provider: "Singlife",
      status: "direct-live",
      method: "POST",
      url: "https://directsales.singlife.com/QuoteBuy/directsales/computePremium",
      purpose: "Computes Simple Term premium from DOB, gender, smoker status, occupation, nationality, sum assured, and payment frequency.",
    },
    {
      provider: "FWD",
      status: "direct-live",
      method: "POST",
      url: "https://www.fwd.com.sg/gw/life/api/common/calculatePremium",
      purpose: "Computes Term Life Plus premium after the site's product configurator creates the quote payload.",
    },
    {
      provider: "Income",
      status: "guarded-cached",
      method: "POST/GET",
      url: "https://apili.income.com.sg/quot/api/getProducts",
      purpose:
        "Income quote and recommendation route observed from bundle/network evidence. The supplied pre-toggler URL is guarded, so this demo uses cached marketplace output unless a valid Income application/session is available.",
    },
  ];
}

function normalizeInsuranceInputs(raw) {
  const dob = parseDateInput(raw.dateOfBirth || raw.dob || "01/01/1990");
  const gender = normalizeChoice(raw.gender, {
    defaultValue: "male",
    map: {
      m: "male",
      male: "male",
      man: "male",
      f: "female",
      female: "female",
      woman: "female",
    },
  });
  const smoker = normalizeChoice(raw.smoker ?? raw.smokingStatus ?? "no", {
    defaultValue: "no",
    map: {
      y: "yes",
      yes: "yes",
      true: "yes",
      smoker: "yes",
      n: "no",
      no: "no",
      false: "no",
      "non-smoker": "no",
      nonsmoker: "no",
    },
  });
  const frequency = normalizeChoice(raw.premiumFrequency || raw.frequency || "yearly", {
    defaultValue: "yearly",
    map: {
      annual: "yearly",
      annually: "yearly",
      yearly: "yearly",
      year: "yearly",
      monthly: "monthly",
      month: "monthly",
      quarterly: "quarterly",
      "half-yearly": "half-yearly",
      halfyearly: "half-yearly",
    },
  });
  const termType = normalizeChoice(raw.termType || "renewable", {
    defaultValue: "renewable",
    map: {
      renewable: "renewable",
      renew: "renewable",
      fixed: "fixed",
      level: "fixed",
    },
  });

  const coverageAmount = clampNumber(raw.coverageAmount || raw.sumAssured || 500000, 150000, 5000000);
  return {
    dateOfBirth: dob.slash,
    dateOfBirthCompact: dob.compact,
    gender,
    smoker,
    coverageAmount,
    premiumFrequency: frequency,
    termType,
    occupation: String(raw.occupation || "Accountant / Accounts Staff").trim(),
    nationalityCode: String(raw.nationalityCode || "SG").trim().toUpperCase(),
    residencyCode: String(raw.residencyCode || "SG").trim().toUpperCase(),
    ageNextBirthday: calculateAgeNextBirthday(dob.date),
  };
}

function normalizeChoice(value, { defaultValue, map }) {
  const key = String(value ?? "").trim().toLowerCase();
  return map[key] || defaultValue;
}

function clampNumber(value, min, max) {
  const parsed = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function parseDateInput(value) {
  const raw = String(value).trim();
  let day;
  let month;
  let year;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const slash = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{4})$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (slash) {
    day = Number(slash[1]);
    month = Number(slash[2]);
    year = Number(slash[3]);
  } else {
    day = 1;
    month = 1;
    year = 1990;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return parseDateInput("01/01/1990");
  }

  return {
    date,
    slash: `${pad2(day)}/${pad2(month)}/${year}`,
    compact: `${pad2(day)}${pad2(month)}${year}`,
  };
}

function calculateAgeNextBirthday(dob) {
  const today = new Date();
  let age = today.getFullYear() - dob.getUTCFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), dob.getUTCMonth(), dob.getUTCDate());
  if (today < birthdayThisYear) age -= 1;
  return age + 1;
}

async function quoteSinglife(inputs) {
  const start = performance.now();
  const sumAssured = Math.min(inputs.coverageAmount, 500000);
  const payload = {
    proposalType: "LA",
    lifeprofiles: [
      {
        name: "",
        gender: inputs.gender === "female" ? "F" : "M",
        smoker: inputs.smoker === "yes" ? "Y" : "N",
        dob: inputs.dateOfBirthCompact,
        age: inputs.ageNextBirthday,
        occupationName: inputs.occupation,
        relationshipName: "",
        relationshipId: "",
        type: "life-assured",
      },
    ],
    isBIStacking: false,
    coverages: [
      {
        id: "simpleTermPlan",
        type: "P",
        attributes: {
          sumAssured,
          planPremiumMode: singlifePremiumMode(inputs.premiumFrequency),
          nationalityCode: inputs.nationalityCode,
          residencyCodeLifeAssured: inputs.residencyCode,
          assuredNationalityCode: inputs.nationalityCode,
          isLifeAssuredPR: "No",
          residencyCodeAssured: inputs.residencyCode,
          sourceOfFunds: "Cash",
          currency: "SGD",
          isAssuredPR: "No",
          promoCodeSummary: "",
        },
      },
    ],
    document: [],
    backdate: "",
    psqsversion: "",
    deviceos: "",
    firmClntnum: "",
    sourceOfBusiness: "",
    loginId: "QnB",
    transactionId: crypto.randomUUID(),
  };

  try {
    const csrf = await getSinglifeCsrfToken();
    const response = await postJson(
      "https://directsales.singlife.com/QuoteBuy/directsales/computePremium",
      payload,
      {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-xsrf-token": csrf.token,
        ...(csrf.cookie ? { cookie: csrf.cookie } : {}),
        "access-control-allow-origin": "*",
        "user-agent": browserUserAgent(),
      },
    );
    return parseSinglifeQuote(response.json, inputs, payload, response.ms, "direct-api");
  } catch (error) {
    const fallback = readJsonMaybe(SINGLIFE_RESPONSE_PATH);
    if (fallback) {
      return {
        ...parseSinglifeQuote(fallback, inputs, payload, roundMs(performance.now() - start), "cached-fallback"),
        warning: `Live Singlife call failed, served learned fallback: ${shortError(error)}`,
      };
    }
    throw error;
  }
}

async function getSinglifeCsrfToken() {
  try {
    const response = await fetchWithTimeout(
      "https://directsales.singlife.com/QuoteBuy/directsales/security/csrf-token",
      { headers: { accept: "application/json, text/plain, */*" } },
      8000,
    );
    const text = await response.text();
    const cookie = response.headers.getSetCookie
      ? response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ")
      : extractCookiesFromMergedHeader(response.headers.get("set-cookie"));
    try {
      const json = JSON.parse(text);
      return {
        token: json.token || json.csrfToken || json.data || text.trim() || crypto.randomUUID(),
        cookie,
      };
    } catch {
      return { token: text.trim() || crypto.randomUUID(), cookie };
    }
  } catch {
    return { token: crypto.randomUUID(), cookie: "" };
  }
}

function parseSinglifeQuote(json, inputs, payload, timingMs, source) {
  const coverage = json?.data?.coverages?.[0];
  const attrs = coverage?.attributes || {};
  const modalKey = {
    monthly: "monthlyPremium",
    quarterly: "quarterlyPremium",
    "half-yearly": "halfYearlyPremium",
    yearly: "annualPremium",
  }[inputs.premiumFrequency] || "annualPremium";

  return {
    provider: "Singlife",
    planName: coverage?.name || "Singlife Simple Term",
    source,
    status: source === "direct-api" ? "live" : "cached",
    endpoint: "POST /QuoteBuy/directsales/computePremium",
    timingMs: roundMs(timingMs),
    currency: "SGD",
    sumAssured: Number(attrs.sumAssured || payload.coverages[0].attributes.sumAssured),
    requestedSumAssured: inputs.coverageAmount,
    monthlyPremium: numberOrNull(attrs.monthlyPremium),
    yearlyPremium: numberOrNull(attrs.annualPremium || attrs.annualisedPremium),
    selectedPremium: numberOrNull(attrs[modalKey] || attrs.annualPremium),
    premiumFrequency: inputs.premiumFrequency,
    discountNote: attrs.discountEligible ? "Discount eligible" : "No discount returned by endpoint",
    benefitHighlights: [
      "Simple term life cover",
      "Learned public quote flow caps the captured direct quote at S$500,000 sum assured",
      "Riders were not selected in the learned route",
    ],
    rawImportant: {
      productCode: coverage?.productCode || coverage?.code || "CQG",
      expiryAge: attrs.expiryAge,
      sumAssuredMin: attrs.sumAssuredMin,
      sumAssuredMax: attrs.sumAssuredMax,
    },
  };
}

async function quoteFwd(inputs) {
  const start = performance.now();
  const template = readJsonMaybe(FWD_TEMPLATE_PATH);
  if (!template) {
    return parseFwdQuote(loadFwdFallbackResponse(), inputs, null, roundMs(performance.now() - start), "cached-fallback");
  }

  const payload = structuredClone(template);
  payload.policyEffectiveDate = todaySlash();
  payload.productId = "TLP";
  payload.productName = "Term Life Plus Insurance";

  const life = payload.insuredLives?.[0];
  if (life?.insuredDetails) {
    life.insuredDetails.dob = inputs.dateOfBirth;
    life.insuredDetails.gender = inputs.gender === "female" ? "Female" : "Male";
    life.insuredDetails.smoker = inputs.smoker === "yes" ? "Yes" : "No";
    life.insuredDetails.occupation = inputs.occupation;
  }
  if (life?.selectedPlan) {
    life.selectedPlan.planType = inputs.termType;
    if (Array.isArray(life.selectedPlan.eligibleComponents)) {
      for (const component of life.selectedPlan.eligibleComponents) {
        if (typeof component.sumAssured === "number") {
          component.sumAssured = inputs.coverageAmount;
        }
      }
    }
  }

  try {
    const response = await postJson(
      "https://www.fwd.com.sg/gw/life/api/common/calculatePremium",
      payload,
      {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        referer: "https://www.fwd.com.sg/life-insurance/term-life-plus/",
        "user-agent": browserUserAgent(),
      },
      20000,
    );
    return parseFwdQuote(response.json, inputs, payload, response.ms, "direct-api");
  } catch (error) {
    return {
      ...parseFwdQuote(loadFwdFallbackResponse(), inputs, payload, roundMs(performance.now() - start), "cached-fallback"),
      warning: `Live FWD call failed, served learned fallback: ${shortError(error)}`,
    };
  }
}

function parseFwdQuote(json, inputs, payload, timingMs, source) {
  const selectedPlan = json?.data?.insuredLives?.[0]?.selectedPlan || payload?.insuredLives?.[0]?.selectedPlan || {};
  const component =
    selectedPlan.eligibleComponents?.find((item) => item.selected && !item.isHidden && premiumNumber(item, "yearlyPremium", "premium_afterMarketingDis_afterLoading") > 0) ||
    selectedPlan.eligibleComponents?.find((item) => item.selected && !item.isHidden) ||
    selectedPlan.eligibleComponents?.[0] ||
    {};

  const monthlyAfter = premiumNumber(component, "monthlyPremium", "premium_afterMarketingDis_afterLoading");
  const yearlyAfter = premiumNumber(component, "yearlyPremium", "premium_afterMarketingDis_afterLoading");
  const monthlyBefore = premiumNumber(component, "monthlyPremium", "premium_beforeMarketingDis_afterLoading");
  const yearlyBefore = premiumNumber(component, "yearlyPremium", "premium_beforeMarketingDis_afterLoading");

  return {
    provider: "FWD",
    planName: selectedPlan.planName || "Term Life Plus Insurance",
    source,
    status: source === "direct-api" ? "live" : "cached",
    endpoint: "POST /gw/life/api/common/calculatePremium",
    timingMs: roundMs(timingMs),
    currency: "SGD",
    sumAssured: Number(component.sumAssured || inputs.coverageAmount),
    requestedSumAssured: inputs.coverageAmount,
    monthlyPremium: monthlyAfter,
    yearlyPremium: yearlyAfter,
    beforeDiscountMonthlyPremium: monthlyBefore,
    beforeDiscountYearlyPremium: yearlyBefore,
    selectedPremium: inputs.premiumFrequency === "monthly" ? monthlyAfter : yearlyAfter,
    premiumFrequency: inputs.premiumFrequency,
    discountNote:
      monthlyBefore && monthlyAfter && monthlyBefore > monthlyAfter
        ? `Marketing discount applied: S$${formatMoney(monthlyBefore)} -> S$${formatMoney(monthlyAfter)} monthly`
        : "No discount returned by endpoint",
    benefitHighlights: [
      selectedPlan.planLabel || "Renewable Term",
      selectedPlan.planDescription || "Term life coverage with online quote pricing",
      "Optional riders were not selected in the learned route",
    ],
    rawImportant: {
      productId: json?.data?.productId || "TLP",
      planCode: selectedPlan.planCode,
      componentCode: component.comCode,
      policyEffectiveDate: json?.data?.policyEffectiveDate || payload?.policyEffectiveDate,
    },
  };
}

async function quoteIncomeGuarded(inputs) {
  const start = performance.now();
  const scale = inputs.coverageAmount / 500000;
  await Promise.resolve();
  return {
    provider: "Income",
    planName: "Income term life route",
    source: "guarded-cached",
    status: "cached",
    endpoint: "GET/POST /quot/api/getProducts and /quot/api/productLookup",
    timingMs: roundMs(performance.now() - start),
    currency: "SGD",
    sumAssured: inputs.coverageAmount,
    requestedSumAssured: inputs.coverageAmount,
    monthlyPremium: roundMoney(24.1 * scale),
    yearlyPremium: roundMoney(289.2 * scale),
    selectedPremium: inputs.premiumFrequency === "monthly" ? roundMoney(24.1 * scale) : roundMoney(289.2 * scale),
    premiumFrequency: inputs.premiumFrequency,
    discountNote: "Cached because the supplied Income pre-toggler URL is guarded without an application/session.",
    benefitHighlights: [
      "Income bundle exposed quote endpoints, but the supplied pre-toggler route did not open a public quote application",
      "Use this as marketplace cached metadata until a valid Income quote session is learned",
      "Displayed premium is a demo placeholder, not a live Income price",
    ],
    rawImportant: {
      observedEndpoints: [
        "https://lifeinsurance.income.com.sg/api/ciam/generateToken",
        "https://apili.income.com.sg/quot/api/getProducts",
        "https://apili.income.com.sg/quot/api/productLookup",
        "https://lifeinsurance.income.com.sg/api/quot/saveQuotationResults",
      ],
      suppliedUrl: "https://lifeinsurance.income.com.sg/pre-toggler",
    },
  };
}

function failedQuote(provider, error) {
  return {
    provider,
    planName: "Unavailable",
    source: "failed",
    status: "error",
    endpoint: "",
    timingMs: 0,
    currency: "SGD",
    sumAssured: null,
    requestedSumAssured: null,
    monthlyPremium: null,
    yearlyPremium: null,
    selectedPremium: null,
    discountNote: "",
    benefitHighlights: [],
    warning: shortError(error),
  };
}

async function buildRecommendation(quotes, inputs) {
  const usableQuotes = quotes.filter((quote) => Number.isFinite(quote.yearlyPremium));
  if (usableQuotes.length === 0) {
    return {
      source: "deterministic",
      headline: "No comparable quote was returned.",
      details: "All provider calls failed or returned non-price metadata.",
      bestProvider: null,
    };
  }

  const deterministic = deterministicRecommendation(usableQuotes, inputs);
  const llm = await llmRecommendation(usableQuotes, inputs, deterministic);
  return llm || deterministic;
}

function deterministicRecommendation(quotes, inputs) {
  const sorted = [...quotes].sort((a, b) => a.yearlyPremium - b.yearlyPremium);
  const best = sorted[0];
  const liveCount = quotes.filter((quote) => quote.source === "direct-api").length;
  return {
    source: "deterministic",
    headline: `${best.provider} is currently the lowest comparable quote returned by this demo.`,
    details:
      `For ${formatCurrency(inputs.coverageAmount)} cover, ${best.provider} returned ` +
      `${formatCurrency(best.yearlyPremium)} per year (${formatCurrency(best.monthlyPremium)} per month). ` +
      `${liveCount} provider endpoint(s) were called live; cached routes were used where a site was guarded or unavailable.`,
    bestProvider: best.provider,
    ranking: sorted.map((quote) => ({
      provider: quote.provider,
      yearlyPremium: quote.yearlyPremium,
      source: quote.source,
    })),
  };
}

async function llmRecommendation(quotes, inputs, fallback) {
  if (!/^(1|true|yes)$/i.test(process.env.INSURANCE_USE_LLM || "")) {
    return null;
  }

  const provider = (process.env.INSURANCE_LLM_PROVIDER || process.env.SKILL_BUILDER_LLM_PROVIDER || "").toLowerCase();
  const openAiKey = process.env.OPENAI_API_KEY;
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const useNvidia = provider === "nvidia" || (!openAiKey && nvidiaKey);
  const apiKey = useNvidia ? nvidiaKey : openAiKey;
  if (!apiKey) return null;

  const baseUrl = useNvidia
    ? process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"
    : process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = useNvidia
    ? process.env.NVIDIA_MODEL || "nvidia/nemotron-3-ultra-550b-a55b"
    : process.env.OPENAI_MODEL || "gpt-5.4-mini";

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You compare insurance quote results for a demo. Return compact JSON only with keys headline, details, bestProvider. Mention if data is cached or guarded. Do not give financial advice.",
      },
      {
        role: "user",
        content: JSON.stringify({
          inputs,
          quotes: quotes.map((quote) => ({
            provider: quote.provider,
            planName: quote.planName,
            yearlyPremium: quote.yearlyPremium,
            monthlyPremium: quote.monthlyPremium,
            source: quote.source,
            status: quote.status,
            discountNote: quote.discountNote,
          })),
          fallback,
        }),
      },
    ],
    max_tokens: Number(process.env.OPENAI_MAX_TOKENS || process.env.NVIDIA_MAX_TOKENS || 700),
  };

  if (useNvidia) {
    body.temperature = Number(process.env.NVIDIA_TEMPERATURE || 0.2);
    body.top_p = Number(process.env.NVIDIA_TOP_P || 0.9);
  }

  try {
    const response = await postJson(`${baseUrl.replace(/\/$/, "")}/chat/completions`, body, {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    }, 25000);
    const content = response.json?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonObject(content);
    if (!parsed?.headline) return null;
    return {
      source: useNvidia ? "nvidia-llm" : "openai-llm",
      headline: String(parsed.headline),
      details: String(parsed.details || fallback.details),
      bestProvider: parsed.bestProvider || fallback.bestProvider,
      ranking: fallback.ranking,
    };
  } catch {
    return null;
  }
}

function buildSpeedSummary(result) {
  if (result.cache?.hit) {
    return `Answered from local skill cache in ${result.timings.totalMs} ms. No browser automation was used.`;
  }
  const live = result.quotes.filter((quote) => quote.source === "direct-api");
  const cached = result.quotes.filter((quote) => quote.source !== "direct-api");
  return `Called ${live.length} learned endpoint(s) directly and used ${cached.length} cached/guarded adapter(s) in ${result.timings.totalMs} ms. No browser automation was used.`;
}

function stableCacheKey(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

async function postJson(url, body, headers = {}, timeoutMs = 15000) {
  const start = performance.now();
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
  }
  return {
    json: text ? JSON.parse(text) : null,
    text,
    status: response.status,
    ms: roundMs(performance.now() - start),
  };
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

function loadFwdFallbackResponse() {
  try {
    const trace = readJsonMaybe(FWD_QUOTED_TRACE_PATH);
    const responseEvent = trace?.events?.find(
      (event) =>
        event.type === "response" &&
        event.url === "https://www.fwd.com.sg/gw/life/api/common/calculatePremium" &&
        typeof event.body === "string",
    );
    if (responseEvent?.body) return JSON.parse(responseEvent.body);
  } catch {
    // fall through to compact fallback
  }
  return {
    status: "success",
    data: {
      productName: "Term Life Plus Insurance",
      productId: "TLP",
      policyEffectiveDate: "10/06/2026",
      insuredLives: [
        {
          selectedPlan: {
            planCode: "DT7",
            planName: "Renewable Term Life Plus insurance",
            planType: "renewable",
            planLabel: "Renewable Term",
            planDescription: "Start with a low premium and enjoy the flexibility to renew each year.",
            eligibleComponents: [
              {
                selected: true,
                isHidden: false,
                comCode: "DT07",
                sumAssured: 1000000,
                premiums: {
                  monthlyPremium: {
                    afterGST: {
                      premium_beforeMarketingDis_afterLoading: "38.68",
                      premium_afterMarketingDis_afterLoading: "19.34",
                    },
                  },
                  yearlyPremium: {
                    afterGST: {
                      premium_beforeMarketingDis_afterLoading: "441.00",
                      premium_afterMarketingDis_afterLoading: "220.50",
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function readJsonMaybe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function singlifePremiumMode(frequency) {
  return {
    yearly: "AP",
    "half-yearly": "HP",
    quarterly: "QP",
    monthly: "MP",
  }[frequency] || "AP";
}

function premiumNumber(component, cadence, key) {
  return numberOrNull(component?.premiums?.[cadence]?.afterGST?.[key]);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? roundMoney(number) : null;
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function roundMs(value) {
  return Math.round(Number(value));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function todaySlash() {
  const today = new Date();
  return `${pad2(today.getDate())}/${pad2(today.getMonth() + 1)}/${today.getFullYear()}`;
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value) {
  if (!Number.isFinite(Number(value))) return "unavailable";
  return `S$${formatMoney(value)}`;
}

function browserUserAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
}

function extractCookiesFromMergedHeader(header) {
  if (!header) return "";
  return header
    .split(/,\s*(?=[A-Za-z0-9_-]+=)/)
    .map((item) => item.split(";")[0])
    .join("; ");
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function shortError(error) {
  return error?.message ? String(error.message).slice(0, 220) : String(error).slice(0, 220);
}
