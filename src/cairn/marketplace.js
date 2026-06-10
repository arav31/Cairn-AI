const { createSkill } = require("./policy");
const { listPublishedApis, recordUsageEvent, upsertPublishedApi } = require("./database");
const { id, now, stableHash } = require("./utils");
const { checkBusinessRenewals, compareInsuranceQuotes, searchProperties } = require("../data/seed");

const STRIPE_ENV = {
  secretKey: "STRIPE_SECRET_KEY",
  webhookSecret: "STRIPE_WEBHOOK_SECRET",
  publicUrl: "CAIRN_PUBLIC_URL",
  insurancePrice: "STRIPE_PRICE_INSURANCE_COMPARE",
  propertyPrice: "STRIPE_PRICE_PROPERTY_SEARCH",
  businessRenewalsPrice: "STRIPE_PRICE_BUSINESS_RENEWALS",
  meterEventName: "STRIPE_METER_EVENT_NAME"
};

const STARTER_WORKFLOWS = [
  {
    target: "insurance",
    name: "compareInsurancePrices",
    title: "Compare Insurance Prices",
    category: "Insurance",
    publisher: "Cairn Verified",
    tagline: "Find insurance quote options from a recorded comparison workflow.",
    description: "Give this API a ZIP code and a few basic details. It returns ranked insurance quote options an agent can compare for you.",
    icon: "IN",
    accent: "green",
    scopes: ["insurance:quotes:read"],
    tags: ["insurance", "comparison", "quotes", "shopping"],
    priceCents: 3,
    tokenCost: 1,
    stripePriceEnv: STRIPE_ENV.insurancePrice,
    meterEventName: "cairn_insurance_comparison",
    healthScore: 98,
    uptimePct: 99.7,
    latencyMsP50: 680,
    callCount: 18420,
    installCount: 438,
    clients: ["ChatGPT", "Claude", "Cursor", "Codex", "Zapier", "n8n"],
    sampleInput: {
      coverageType: "auto",
      zipCode: "78701",
      driverAge: 35,
      vehicleYear: 2021
    },
    inputSchema: {
      type: "object",
      required: ["zipCode"],
      properties: {
        coverageType: {
          type: "string",
          description: "Kind of insurance to compare. Start with auto."
        },
        zipCode: {
          type: "string",
          description: "ZIP code where the policy will be priced."
        },
        driverAge: {
          type: "number",
          description: "Driver age for auto insurance quotes."
        },
        vehicleYear: {
          type: "number",
          description: "Vehicle year for auto insurance quotes."
        }
      }
    },
    outputSchema: {
      type: "object",
      required: ["coverageType", "zipCode", "quotes"],
      properties: {
        coverageType: { type: "string" },
        zipCode: { type: "string" },
        quotes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              provider: { type: "string" },
              monthlyPremium: { type: "number" },
              deductible: { type: "number" },
              coverage: { type: "string" },
              rank: { type: "number" }
            }
          }
        },
        notes: { type: "string" }
      }
    },
    exampleOutput: compareInsuranceQuotes({
      coverageType: "auto",
      zipCode: "78701",
      driverAge: 35,
      vehicleYear: 2021
    })
  },
  {
    target: "property",
    name: "searchProperties",
    title: "Search Properties",
    category: "Real estate",
    publisher: "Cairn Verified",
    tagline: "Find property matches from a recorded real estate search workflow.",
    description: "Give this API a location, budget, and bedroom count. It returns matching homes with prices, basics, and source URLs.",
    icon: "PR",
    accent: "blue",
    scopes: ["property:search:read"],
    tags: ["property", "real-estate", "housing", "search"],
    priceCents: 4,
    tokenCost: 1,
    stripePriceEnv: STRIPE_ENV.propertyPrice,
    meterEventName: "cairn_property_search",
    healthScore: 97,
    uptimePct: 99.6,
    latencyMsP50: 740,
    callCount: 22680,
    installCount: 512,
    clients: ["ChatGPT", "Claude", "Cursor", "Codex", "Airtable", "n8n"],
    sampleInput: {
      location: "Austin",
      maxPrice: 700000,
      bedrooms: 2
    },
    inputSchema: {
      type: "object",
      required: ["location"],
      properties: {
        location: {
          type: "string",
          description: "City, state, suburb, or neighborhood to search."
        },
        maxPrice: {
          type: "number",
          description: "Maximum purchase price."
        },
        bedrooms: {
          type: "number",
          description: "Minimum number of bedrooms."
        }
      }
    },
    outputSchema: {
      type: "object",
      required: ["location", "results"],
      properties: {
        location: { type: "string" },
        maxPrice: { type: "number" },
        bedrooms: { type: "number" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              address: { type: "string" },
              price: { type: "number" },
              bedrooms: { type: "number" },
              bathrooms: { type: "number" },
              url: { type: "string" }
            }
          }
        },
        notes: { type: "string" }
      }
    },
    exampleOutput: searchProperties({
      location: "Austin",
      maxPrice: 700000,
      bedrooms: 2
    })
  },
  {
    target: "business",
    name: "checkBusinessRenewals",
    title: "Business Renewals",
    category: "Business",
    publisher: "Cairn Verified",
    tagline: "Check renewal status, fees, and deadlines for business licenses.",
    description: "Give this API a business name, state, and license type. It returns renewal status, due dates, fees, and the next steps an agent can complete.",
    icon: "BR",
    accent: "plum",
    scopes: ["business:renewals:read"],
    tags: ["business", "renewals", "compliance"],
    priceCents: 5,
    tokenCost: 2,
    stripePriceEnv: STRIPE_ENV.businessRenewalsPrice,
    meterEventName: "cairn_business_renewals",
    healthScore: 96,
    uptimePct: 99.5,
    latencyMsP50: 820,
    callCount: 8420,
    installCount: 184,
    clients: ["ChatGPT", "Claude", "Codex", "Zapier", "n8n"],
    sampleInput: {
      businessName: "Northstar Textiles",
      state: "TX",
      licenseType: "general"
    },
    inputSchema: {
      type: "object",
      required: ["businessName", "state"],
      properties: {
        businessName: {
          type: "string",
          description: "Business or company name to check."
        },
        state: {
          type: "string",
          description: "US state where the license is registered."
        },
        licenseType: {
          type: "string",
          description: "Optional license category or permit type."
        }
      }
    },
    outputSchema: {
      type: "object",
      required: ["businessName", "state", "renewalStatus", "dueDate"],
      properties: {
        businessName: { type: "string" },
        state: { type: "string" },
        licenseType: { type: "string" },
        renewalStatus: { type: "string" },
        dueDate: { type: "string" },
        feeCents: { type: "number" },
        feeLabel: { type: "string" },
        requiredDocuments: {
          type: "array",
          items: { type: "string" }
        },
        sourceUrl: { type: "string" },
        nextSteps: {
          type: "array",
          items: { type: "string" }
        },
        notes: { type: "string" }
      }
    },
    exampleOutput: checkBusinessRenewals({
      businessName: "Northstar Textiles",
      state: "TX",
      licenseType: "general"
    })
  }
];

const SUCCESS_FIELD_BY_TARGET = {
  insurance: "quotes",
  property: "results",
  business: "renewalStatus"
};

function operationFromWorkflow(workflow) {
  const version = workflow.version || "v1";
  const operation = {
    id: `op_${stableHash({ target: workflow.target, name: workflow.name, version })}`,
    target: workflow.target,
    version,
    name: workflow.name,
    title: workflow.title,
    description: workflow.description,
    riskTier: "read",
    allowedDomains: ["recorded-workflow"],
    requiredScopes: workflow.scopes,
    inputs: Object.entries(workflow.inputSchema.properties).map(([name, schema]) => ({
      name,
      type: schema.type,
      required: workflow.inputSchema.required.includes(name),
      description: schema.description
    })),
    inputSchema: workflow.inputSchema,
    outputSchema: workflow.outputSchema,
    flowGraph: {
      nodes: [
        { id: "recorded-workflow", label: "Run recorded workflow", method: "POST", url: "/api/tools/{slug}/invoke", format: "json" },
        { id: "normalize-output", label: "Return clean JSON", method: "RETURN", url: "agent", format: "json" }
      ],
      edges: [
        {
          from: "recorded-workflow",
          to: "normalize-output",
          value: "workflow_result",
          reason: "The recorded task result is normalized into an agent-friendly response."
        }
      ]
    },
    parameters: [
      ...Object.keys(workflow.inputSchema.properties).map((name) => ({
        name,
        class: workflow.inputSchema.required.includes(name) ? "user_supplied" : "constant",
        source: "agent input",
        handling: workflow.inputSchema.required.includes(name) ? "required API input" : "optional API input"
      })),
      {
        name: "payment",
        class: "session_fresh",
        source: "Stripe Checkout or Shared Payment Token",
        handling: "validated before paid invocation"
      }
    ],
    executionPlan: [
      {
        id: "authorizePayment",
        type: "payment_gate",
        provider: "stripe",
        accepts: ["checkout_session", "shared_payment_token", "cairn_tokens"]
      },
      {
        id: "runWorkflow",
        type: "recorded_workflow",
        target: workflow.target
      },
      {
        id: "recordUsage",
        type: "billing_meter",
        eventName: workflow.meterEventName
      }
    ],
    freshTokenExtractors: [],
    selectionRules: [],
    successPredicates: [{ type: "json_field_present", field: SUCCESS_FIELD_BY_TARGET[workflow.target] || "id" }],
    createdAt: now()
  };
  operation.openapi = singleToolOpenApi(operation);
  return operation;
}

function singleToolOpenApi(operation) {
  return {
    openapi: "3.1.0",
    info: {
      title: `${operation.title} API`,
      version: operation.version
    },
    paths: {
      [`/api/tools/{namespace}/{slug}/invoke`]: {
        post: {
          operationId: operation.name,
          summary: operation.description,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["input"],
                  properties: {
                    input: operation.inputSchema,
                    payment: {
                      type: "object",
                      description: "Stripe Checkout authorization or Shared Payment Token."
                    },
                    sharedPaymentToken: {
                      type: "string",
                      description: "Stripe Shared Payment Token from an agent."
                    },
                    paymentMethod: {
                      type: "string",
                      description: "Use tokens to spend a Cairn token balance instead of direct payment."
                    },
                    tokenAccountId: {
                      type: "string",
                      description: "Token wallet account to debit when paymentMethod is tokens."
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": { description: "Workflow completed." },
            "402": { description: "Payment required before invocation." }
          }
        }
      }
    }
  };
}

function createListing(skill, operation, workflow) {
  const slug = workflow.slug || `${workflow.category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/${workflow.name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "")}`;
  const priceCents = workflow.priceCents;
  return {
    id: `listing.${slug}`,
    slug,
    skillId: skill.id,
    operationId: operation.id,
    operationName: operation.name,
    operationVersion: operation.version,
    title: operation.title,
    tagline: workflow.tagline,
    description: workflow.description,
    category: workflow.category,
    publisher: workflow.publisher,
    icon: workflow.icon,
    accent: workflow.accent,
    visibility: "public_preview",
    qualityGate: "verified",
    verificationFreshness: "fresh",
    riskTier: skill.riskTier,
    scopes: skill.scopes,
    allowedDomains: skill.allowedDomains,
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    exampleOutput: workflow.exampleOutput,
    openapiPath: `/api/tools/${slug}/openapi.json`,
    invokePath: `/api/tools/${slug}/invoke`,
    quotePath: `/api/tools/${slug}/quote`,
    checkoutPath: `/api/tools/${slug}/checkout`,
    readmePath: `/api/tools/${slug}/readme.md`,
    verificationPath: `/api/tools/${slug}/verification`,
    mcpToolName: operation.name,
    pricing: {
      enabled: priceCents > 0,
      priceCents,
      currency: "usd",
      billingUnit: "successful_call",
      tokenCost: workflow.tokenCost,
      stripeMode: process.env.STRIPE_SECRET_KEY ? "configured" : "stub_until_keys_configured",
      stripePriceEnv: workflow.stripePriceEnv,
      stripePriceId: process.env[workflow.stripePriceEnv] || null,
      stripeMeterEventName: process.env[STRIPE_ENV.meterEventName] || workflow.meterEventName,
      acceptsSharedPaymentToken: true
    },
    stats: {
      healthScore: workflow.healthScore,
      uptimePct: workflow.uptimePct,
      latencyMsP50: workflow.latencyMsP50,
      callCount: workflow.callCount,
      installCount: workflow.installCount
    },
    clients: workflow.clients,
    tags: workflow.tags,
    sampleInput: workflow.sampleInput,
    readme: readmeForTool({ workflow, slug, operation }),
    updatedAt: now()
  };
}

function readmeForTool({ workflow, slug, operation }) {
  const sample = JSON.stringify({ input: workflow.sampleInput, demo: true }, null, 2);
  const paidSample = JSON.stringify({
    input: workflow.sampleInput,
    sharedPaymentToken: "spt_from_agent"
  }, null, 2);
  const tokenSample = JSON.stringify({
    input: workflow.sampleInput,
    paymentMethod: "tokens",
    tokenAccountId: "demo-user"
  }, null, 2);
  const tokenLabel = workflow.tokenCost === 1 ? "1 Cairn token" : `${workflow.tokenCost} Cairn tokens`;
  return `# ${workflow.title}

${workflow.tagline}

## What it does

${workflow.description}

## Endpoint

\`POST /api/tools/${slug}/invoke\`

## Input

\`\`\`json
${JSON.stringify(operation.inputSchema, null, 2)}
\`\`\`

## Try it in demo mode

\`\`\`bash
curl -X POST /api/tools/${slug}/invoke \\
  -H "Content-Type: application/json" \\
  -d '${sample.replace(/\n/g, "")}'
\`\`\`

## Pay and run

1. Ask for a quote: \`POST /api/tools/${slug}/quote\`
2. Authorize payment: \`POST /api/tools/${slug}/checkout\`
3. Call the API with either the returned payment object or a Stripe Shared Payment Token.

\`\`\`json
${paidSample}
\`\`\`

## Use tokens instead

This API costs ${tokenLabel}. Buy tokens once, then spend them across any marketplace API.

1. Check a wallet: \`GET /api/tokens/wallet?accountId=demo-user\`
2. Buy a pack: \`POST /api/tokens/checkout\`
3. Invoke with \`paymentMethod: "tokens"\`

\`\`\`json
${tokenSample}
\`\`\`

## MCP

Call \`${operation.name}\` through \`POST /mcp\` using \`tools/call\`.

## Stripe setup

Set \`${STRIPE_ENV.secretKey}\` to create real Checkout Sessions. Optionally set \`${workflow.stripePriceEnv}\` for a prebuilt Stripe Price. If no price ID is set, Cairn creates a one-time Checkout line item from the listing price. Set \`${STRIPE_ENV.meterEventName}\` and pass a Stripe customer ID to record usage with Stripe Billing Meter Events.
`;
}

function publicTool(listing, operation) {
  return {
    id: listing.slug,
    name: operation.name,
    title: listing.title,
    description: listing.tagline,
    category: listing.category,
    publisher: listing.publisher,
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    pricing: listing.pricing,
    tokenCost: listing.pricing.tokenCost,
    health: listing.stats,
    endpoints: {
      invoke: listing.invokePath,
      quote: listing.quotePath,
      checkout: listing.checkoutPath,
      openapi: listing.openapiPath,
      readme: listing.readmePath,
      verification: listing.verificationPath
    }
  };
}

function findListing(state, slugOrName) {
  const needle = decodeURIComponent(slugOrName || "");
  return Object.values(state.marketplaceListings).find((listing) => (
    listing.slug === needle ||
    listing.skillId === needle ||
    listing.operationName === needle ||
    listing.id === needle
  ));
}

function createQuote(listing, input = {}) {
  const quantity = 1;
  const subtotal = listing.pricing.priceCents * quantity;
  return {
    id: id("quote"),
    toolId: listing.slug,
    title: listing.title,
    currency: listing.pricing.currency,
    quantity,
    subtotal,
    total: subtotal,
    billingUnit: listing.pricing.billingUnit,
    tokenCost: listing.pricing.tokenCost,
    inputHash: stableHash(input),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    paymentRequired: listing.pricing.enabled,
    paymentMethods: ["stripe_checkout", "stripe_shared_payment_token", "cairn_tokens"],
    stripe: {
      mode: process.env.STRIPE_SECRET_KEY ? "configured" : "stub_until_keys_configured",
      priceId: listing.pricing.stripePriceId,
      sharedPaymentTokenSupported: true,
      meterEventName: listing.pricing.stripeMeterEventName
    }
  };
}

function formBody(entries) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) {
      body.set(key, String(value));
    }
  }
  return body;
}

function publicBaseUrl(value) {
  return String(value || "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
}

async function createStripeCheckoutSession(listing, quote, buyer = {}) {
  const publicUrl = publicBaseUrl(buyer.returnBaseUrl || process.env[STRIPE_ENV.publicUrl]);
  const lineItem = listing.pricing.stripePriceId
    ? {
        "line_items[0][price]": listing.pricing.stripePriceId,
        "line_items[0][quantity]": 1
      }
    : {
        "line_items[0][price_data][currency]": quote.currency,
        "line_items[0][price_data][unit_amount]": quote.total,
        "line_items[0][price_data][product_data][name]": listing.title,
        "line_items[0][price_data][product_data][description]": listing.tagline,
        "line_items[0][quantity]": 1
      };
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: formBody({
      mode: "payment",
      success_url: `${publicUrl}/?checkout=success&tool=${encodeURIComponent(listing.slug)}`,
      cancel_url: `${publicUrl}/?checkout=cancelled&tool=${encodeURIComponent(listing.slug)}`,
      "metadata[tool_id]": listing.slug,
      "metadata[quote_id]": quote.id,
      "metadata[input_hash]": quote.inputHash,
      "metadata[account_id]": buyer.accountId || buyer.account || "",
      ...lineItem
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    return {
      error: "stripe_checkout_failed",
      statusCode: response.status,
      stripe: payload
    };
  }
  return payload;
}

async function createCheckout(listing, quote, buyer = {}) {
  if (process.env.STRIPE_SECRET_KEY) {
    const session = await createStripeCheckoutSession(listing, quote, buyer);
    if (!session.error) {
      return {
        id: session.id,
        status: "requires_payment",
        mode: "stripe_checkout",
        toolId: listing.slug,
        quoteId: quote.id,
        accountId: buyer.accountId || buyer.account || null,
        buyerAgent: buyer.agent || "unknown-agent",
        amount: quote.total,
        currency: quote.currency,
        checkoutUrl: session.url,
        payment: {
          status: "pending",
          provider: "stripe",
          checkoutSessionId: session.id
        }
      };
    }
    return {
      id: id("checkout"),
      status: "stripe_error",
      mode: "stripe_checkout",
      toolId: listing.slug,
      quoteId: quote.id,
      accountId: buyer.accountId || buyer.account || null,
      error: session
    };
  }

  return {
    id: id("checkout"),
    status: "test_authorized",
    mode: "stub",
    toolId: listing.slug,
    quoteId: quote.id,
    accountId: buyer.accountId || buyer.account || null,
    buyerAgent: buyer.agent || "unknown-agent",
    amount: quote.total,
    currency: quote.currency,
    payment: {
      status: "authorized",
      provider: "stripe",
      sharedPaymentToken: buyer.sharedPaymentToken || "spt_test_cairn_stub",
      note: "Set STRIPE_SECRET_KEY to create real Checkout Sessions. Agents can also pass a Stripe Shared Payment Token."
    }
  };
}

function hasPaymentAuthorization(listing, body) {
  if (!listing.pricing.enabled) return true;
  if (body.demo === true) return true;
  if (body.paymentToken) return true;
  if (body.sharedPaymentToken) return true;
  if (body.payment && body.payment.sharedPaymentToken) return true;
  return Boolean(body.payment && ["authorized", "paid", "succeeded"].includes(body.payment.status));
}

async function recordUsage(listing, details = {}) {
  const eventName = listing.pricing.stripeMeterEventName;
  const customerId = details.stripeCustomerId || details.customerId;
  const identifier = details.identifier || id("usage");
  const localUsageRecorded = await recordUsageEvent({
    id: identifier,
    accountId: details.accountId,
    listingSlug: listing.slug,
    invocationId: details.invocationId || details.identifier,
    paymentMethod: details.paymentMethod || "direct",
    tokenCost: details.tokenCost || 0,
    stripeCustomerId: customerId,
    metadata: {
      value: details.value || 1,
      stripeMeterEventName: eventName,
      ...details
    }
  });
  if (!process.env.STRIPE_SECRET_KEY || !eventName || !customerId) {
    return {
      mode: "stub",
      recorded: false,
      localUsageRecorded,
      reason: "Set STRIPE_SECRET_KEY, STRIPE_METER_EVENT_NAME, and pass stripeCustomerId to record Stripe meter events."
    };
  }
  const response = await fetch("https://api.stripe.com/v1/billing/meter_events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": identifier
    },
    body: formBody({
      event_name: eventName,
      identifier,
      "payload[value]": details.value || 1,
      "payload[stripe_customer_id]": customerId,
      "payload[tool_id]": listing.slug
    })
  });
  const payload = await response.json();
  return {
    mode: "stripe_meter_event",
    recorded: response.ok,
    localUsageRecorded,
    statusCode: response.status,
    stripe: payload
  };
}

function hydratePublishedApi(state, published) {
  if (!published || !published.operation || !published.skill || !published.listing) {
    return false;
  }
  state.operations[published.operation.id] = published.operation;
  state.skills[published.skill.id] = published.skill;
  state.marketplaceListings[published.skill.id] = published.listing;
  if (published.verificationRecord) {
    state.verificationRecords[published.operation.id] = published.verificationRecord;
  }
  state.currentOperationId = published.operation.id;
  return true;
}

async function hydrateMarketplaceFromDatabase(state) {
  const publishedApis = await listPublishedApis();
  for (const published of publishedApis) {
    hydratePublishedApi(state, published);
  }
  return publishedApis.length;
}

async function bootstrapMarketplace(state) {
  for (const workflow of STARTER_WORKFLOWS) {
    const operation = operationFromWorkflow(workflow);
    state.operations[operation.id] = operation;
    state.currentOperationId = operation.id;
    state.verificationRecords[operation.id] = {
      operationId: operation.id,
      target: operation.target,
      input: workflow.sampleInput,
      expectedOutput: workflow.exampleOutput,
      latest: {
        passed: true,
        status: "passed",
        output: workflow.exampleOutput,
        outputHash: stableHash(workflow.exampleOutput),
        expectedHash: stableHash(workflow.exampleOutput),
        durationMs: workflow.latencyMsP50,
        error: null
      },
      updatedAt: now()
    };
    const skill = createSkill(operation);
    skill.owner = workflow.publisher;
    skill.marketplace.pricingModel = "per_call";
    skill.marketplace.agenticCommerceEnabled = true;
    state.skills[skill.id] = skill;
    const listing = createListing(skill, operation, workflow);
    state.marketplaceListings[skill.id] = listing;
    await upsertPublishedApi({
      operation,
      skill,
      listing,
      verificationRecord: state.verificationRecords[operation.id]
    });
  }
  await hydrateMarketplaceFromDatabase(state);
}

function openApiDocument(listings, state) {
  const paths = {};
  for (const listing of listings) {
    const operation = state.operations[listing.operationId];
    paths[listing.invokePath] = {
      post: {
        operationId: operation.name,
        summary: listing.tagline,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  input: operation.inputSchema,
                  payment: {
                    type: "object",
                    description: "Stripe Checkout authorization or Shared Payment Token metadata."
                  },
                  sharedPaymentToken: {
                    type: "string",
                    description: "Stripe Shared Payment Token from an agent."
                  },
                  paymentMethod: {
                    type: "string",
                    description: "Set to tokens to spend a Cairn token balance."
                  },
                  tokenAccountId: {
                    type: "string",
                    description: "Wallet account to debit when using tokens."
                  }
                },
                required: ["input"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Tool call completed." },
          "402": { description: "Payment authorization required." },
          "403": { description: "Caller lacks required scope." }
        }
      }
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Cairn Agent Workflow API Marketplace",
      version: "0.3.0"
    },
    paths
  };
}

function integrationSnippet(baseUrl, listing) {
  return {
    curl: `curl -X POST ${baseUrl}${listing.invokePath} -H "Content-Type: application/json" -d '{"input":${JSON.stringify(listing.sampleInput)},"demo":true}'`,
    package: {
      installFromGitHub: "npm install github:arav31/Cairn-AI",
      futureNpmPackage: "npm install @cairn/ai",
      cli: "npx cairn help"
    },
    sdk: `const { CairnClient } = require("cairn");\nconst cairn = new CairnClient({ baseUrl: "${baseUrl}", accountId: "demo-user" });\nawait cairn.createAccount();\nawait cairn.buyTokens("starter");\nconst result = await cairn.invoke("${listing.slug}", { input: ${JSON.stringify(listing.sampleInput)}, paymentMethod: "tokens" });`,
    mcp: {
      endpoint: `${baseUrl}/mcp`,
      tool: listing.mcpToolName
    },
    openapi: `${baseUrl}${listing.openapiPath}`,
    readme: `${baseUrl}${listing.readmePath}`,
    chatgpt: {
      type: "custom_action_or_mcp_connector",
      discovery: `${baseUrl}/.well-known/cairn.json`
    }
  };
}

function integrationGuide(baseUrl, listing = null) {
  const selected = listing || null;
  const sampleInput = selected ? selected.sampleInput : {
    coverageType: "auto",
    zipCode: "78701",
    driverAge: 35,
    vehicleYear: 2021
  };
  const toolId = selected ? selected.slug : "insurance/compare-insurance-prices";
  const toolName = selected ? selected.operationName : "compareInsurancePrices";
  return {
    package: {
      currentInstall: "npm install github:arav31/Cairn-AI",
      futureInstall: "npm install @cairn/ai",
      cliBinary: "cairn",
      nodeVersion: ">=18"
    },
    environment: {
      CAIRN_BASE_URL: baseUrl,
      CAIRN_ACCOUNT_ID: "demo-user"
    },
    accountAndCredits: {
      createAccount: {
        method: "POST",
        url: `${baseUrl}/api/accounts`,
        body: { accountId: "demo-user" }
      },
      buyCredits: {
        method: "POST",
        url: `${baseUrl}/api/tokens/checkout`,
        body: { accountId: "demo-user", packId: "starter" }
      },
      wallet: `${baseUrl}/api/tokens/wallet?accountId=demo-user`
    },
    invokeWithCredits: {
      method: "POST",
      url: `${baseUrl}/api/tools/${toolId}/invoke`,
      body: {
        input: sampleInput,
        paymentMethod: "tokens",
        tokenAccountId: "demo-user"
      },
      debitRule: "Tokens are reserved before the run and deducted only after the workflow returns a successful result."
    },
    sdk: {
      commonjs: [
        'const { CairnClient } = require("cairn");',
        `const cairn = new CairnClient({ baseUrl: "${baseUrl}", accountId: "demo-user" });`,
        "await cairn.createAccount();",
        'await cairn.buyTokens("starter");',
        `const result = await cairn.invoke("${toolId}", {`,
        `  input: ${JSON.stringify(sampleInput)},`,
        '  paymentMethod: "tokens"',
        "});"
      ].join("\n")
    },
    cli: {
      createAccount: `npx cairn account create --account demo-user --base-url ${baseUrl}`,
      buyCredits: `npx cairn buy-tokens --pack starter --account demo-user --base-url ${baseUrl}`,
      invoke: `npx cairn invoke --tool ${toolId} --account demo-user --base-url ${baseUrl} --input '${JSON.stringify(sampleInput)}'`
    },
    rest: {
      discovery: `${baseUrl}/.well-known/cairn.json`,
      catalog: `${baseUrl}/api/catalog`,
      openapi: `${baseUrl}/openapi.json`,
      mcp: `${baseUrl}/mcp`,
      selectedToolReadme: selected ? `${baseUrl}${selected.readmePath}` : null,
      selectedToolOpenAPI: selected ? `${baseUrl}${selected.openapiPath}` : null,
      selectedToolVerification: selected ? `${baseUrl}${selected.verificationPath}` : null
    },
    mcp: {
      endpoint: `${baseUrl}/mcp`,
      tool: toolName,
      call: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: toolName,
          arguments: sampleInput,
          paymentMethod: "tokens",
          tokenAccountId: "demo-user"
        }
      }
    },
    futureIntegrationWork: [
      "Publish the SDK under a stable npm package name.",
      "Add API keys and account-scoped auth instead of plain account IDs.",
      "Add OAuth/OIDC helpers for enterprise agent runtimes.",
      "Generate typed clients from each listing OpenAPI schema.",
      "Emit webhooks for completed workflow runs and credit debits.",
      "Add hosted MCP connection templates for ChatGPT, Claude, Cursor, Zapier, and n8n."
    ]
  };
}

function stripeConfig() {
  return {
    mode: process.env.STRIPE_SECRET_KEY ? "configured" : "stub",
    requiredEnv: [
      STRIPE_ENV.secretKey,
      STRIPE_ENV.webhookSecret,
      STRIPE_ENV.publicUrl
    ],
    optionalEnv: [
      STRIPE_ENV.insurancePrice,
      STRIPE_ENV.propertyPrice,
      STRIPE_ENV.businessRenewalsPrice,
      STRIPE_ENV.meterEventName
    ],
    supports: {
      checkoutSessions: true,
      sharedPaymentTokens: true,
      billingMeterEvents: true,
      mcpPayments: true
    },
    setupSteps: [
      "Create a Stripe account and get a test secret key.",
      "Set STRIPE_SECRET_KEY and CAIRN_PUBLIC_URL.",
      "Optionally create Stripe Prices and set STRIPE_PRICE_INSURANCE_COMPARE, STRIPE_PRICE_PROPERTY_SEARCH, or STRIPE_PRICE_BUSINESS_RENEWALS.",
      "Create a Billing Meter, set STRIPE_METER_EVENT_NAME, and pass stripeCustomerId when invoking if you want usage-based invoices.",
      "Configure STRIPE_WEBHOOK_SECRET before trusting Stripe webhooks in production."
    ]
  };
}

module.exports = {
  bootstrapMarketplace,
  createCheckout,
  createListing,
  createQuote,
  findListing,
  hasPaymentAuthorization,
  hydrateMarketplaceFromDatabase,
  integrationGuide,
  integrationSnippet,
  openApiDocument,
  publicTool,
  recordUsage,
  stripeConfig
};
