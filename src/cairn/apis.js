const { isDatabaseConfigured, listApis } = require("./database");
const { openApiFor } = require("./synthesizer");
const { now, stableHash } = require("./utils");
const { checkBusinessRenewals, compareInsuranceQuotes, searchProperties } = require("../data/seed");

// A private API record is the durable, reusable artifact a recorded workflow
// becomes. It is owned by an account, has a stable typed contract, and carries
// no pricing, catalog, or marketplace metadata.

function apiSlugFor(ownerAccountId, operationName) {
  return `${ownerAccountId}/${operationName}`;
}

function readmeForApi(api, operation) {
  const sample = JSON.stringify({ input: api.sampleInput || {} }, null, 2).replace(/\n/g, "");
  return `# ${api.title}

${api.tagline}

## What it does

${api.description}

## Endpoint

\`POST ${api.invokePath}\`

This API is private to your account. Only your agent keys can call it.

## Auth

Create an account once and Cairn returns an \`agentKey\`. Store it and send it as \`Authorization: Bearer <agentKey>\`.

\`\`\`bash
curl -X POST /api/accounts -H "Content-Type: application/json" -d '{"accountId":"${api.ownerAccountId}"}'
\`\`\`

## Call it

\`\`\`bash
curl -X POST ${api.invokePath} \\
  -H "Authorization: Bearer $CAIRN_AGENT_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${sample}'
\`\`\`

## Input

\`\`\`json
${JSON.stringify(operation.inputSchema, null, 2)}
\`\`\`

## MCP

Call \`${operation.name}\` through \`POST /mcp\` with \`tools/call\` and your agent key.
`;
}

function createApi(skill, operation, opts = {}) {
  const ownerAccountId = opts.ownerAccountId;
  const slug = opts.slug || apiSlugFor(ownerAccountId, operation.name);
  const api = {
    id: `api.${slug}`,
    slug,
    ownerAccountId,
    skillId: skill.id,
    operationId: operation.id,
    operationName: operation.name,
    operationVersion: operation.version,
    title: operation.title,
    tagline: opts.tagline || operation.description,
    description: operation.description,
    target: operation.target,
    visibility: "private",
    qualityGate: "verified",
    verificationFreshness: "fresh",
    riskTier: skill.riskTier,
    scopes: skill.scopes,
    allowedDomains: skill.allowedDomains,
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    sampleInput: opts.sampleInput || {},
    exampleOutput: opts.exampleOutput || null,
    openapiPath: `/api/tools/${slug}/openapi.json`,
    invokePath: `/api/tools/${slug}/invoke`,
    readmePath: `/api/tools/${slug}/readme.md`,
    verificationPath: `/api/tools/${slug}/verification`,
    mcpToolName: operation.name,
    callCount: 0,
    createdAt: now(),
    updatedAt: now()
  };
  api.readme = readmeForApi(api, operation);
  return api;
}

function publicApi(api, operation) {
  return {
    id: api.slug,
    slug: api.slug,
    name: operation.name,
    title: api.title,
    description: api.tagline,
    target: api.target,
    riskTier: api.riskTier,
    scopes: api.scopes,
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    sampleInput: api.sampleInput,
    callCount: api.callCount || 0,
    createdAt: api.createdAt,
    mcpToolName: api.mcpToolName,
    endpoints: {
      invoke: api.invokePath,
      openapi: api.openapiPath,
      readme: api.readmePath,
      verification: api.verificationPath,
      mcp: "/mcp"
    }
  };
}

const BEARER_SCHEME = {
  agentBearerAuth: {
    type: "http",
    scheme: "bearer",
    description: "Account-scoped Cairn agent key returned once from POST /api/accounts."
  }
};

function invokePathItem(api, operation) {
  return {
    post: {
      operationId: operation.name,
      summary: api.tagline,
      security: [{ agentBearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["input"],
              properties: { input: operation.inputSchema }
            }
          }
        }
      },
      responses: {
        "200": {
          description: "Workflow completed.",
          content: { "application/json": { schema: operation.outputSchema } }
        },
        "401": { description: "Agent bearer key is missing or invalid." },
        "403": { description: "Caller lacks the required scope." },
        "404": { description: "No API with this slug belongs to the calling account." }
      }
    }
  };
}

function singleApiOpenApi(api, operation) {
  return {
    openapi: "3.1.0",
    info: { title: `${operation.title} API`, version: operation.version },
    components: { securitySchemes: BEARER_SCHEME },
    paths: { [api.invokePath]: invokePathItem(api, operation) }
  };
}

function openApiDocument(apis, state) {
  const paths = {};
  for (const api of apis) {
    const operation = state.operations[api.operationId];
    if (!operation) continue;
    paths[api.invokePath] = invokePathItem(api, operation);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Cairn Private Workflow APIs",
      version: "0.3.0",
      description: "Durable, private APIs you recorded once and reuse forever. Every call is account-scoped with a Cairn agent key."
    },
    components: { securitySchemes: BEARER_SCHEME },
    paths
  };
}

function listApisForAccount(state, accountId) {
  return Object.values(state.apis).filter((api) => api.ownerAccountId === accountId);
}

function matchesApi(api, needle) {
  return (
    api.slug === needle ||
    api.skillId === needle ||
    api.operationName === needle ||
    api.id === needle
  );
}

function findApi(state, slugOrName) {
  const needle = decodeURIComponent(slugOrName || "");
  return Object.values(state.apis).find((api) => matchesApi(api, needle));
}

// Owner-scoped lookup. Returns undefined when the API does not exist OR is not
// owned by this account, so callers cannot probe another account's API names.
function findOwnedApi(state, slugOrName, accountId) {
  const needle = decodeURIComponent(slugOrName || "");
  return listApisForAccount(state, accountId).find((api) => matchesApi(api, needle));
}

function hydrateApi(state, loaded) {
  if (!loaded || !loaded.operation || !loaded.skill || !loaded.api) {
    return false;
  }
  state.operations[loaded.operation.id] = loaded.operation;
  state.skills[loaded.skill.id] = loaded.skill;
  state.apis[loaded.skill.id] = loaded.api;
  if (loaded.verificationRecord) {
    state.verificationRecords[loaded.operation.id] = loaded.verificationRecord;
  }
  state.currentOperationId = loaded.operation.id;
  return true;
}

async function hydrateApisFromDatabase(state) {
  const loadedApis = await listApis();
  state.apis = {};
  for (const loaded of loadedApis) {
    hydrateApi(state, loaded);
  }
  return loadedApis.length;
}

async function bootstrapApis(state) {
  const databaseConfigured = isDatabaseConfigured();
  const loadedCount = await hydrateApisFromDatabase(state);
  state.apiStorage = {
    databaseConfigured,
    mode: databaseConfigured ? "postgres" : "memory",
    source: databaseConfigured ? "database" : "ephemeral",
    loadedCount,
    demoSeeded: false,
    demoSeededCount: 0,
    apiCount: Object.values(state.apis).length
  };
  return state.apiStorage;
}

// Demo workflows used to populate a "demo-user" dashboard for local exploration
// and tests. These execute via deterministic fixtures (see executor.js) so they
// run without a live sandbox. They are no longer marketplace supply: opt-in via
// CAIRN_ENABLE_DEMO_APIS or createApp({ seedDemoApis: true }).
const SUCCESS_FIELD_BY_TARGET = {
  insurance: "quotes",
  property: "results",
  business: "renewalStatus"
};

const DEMO_WORKFLOWS = [
  {
    target: "insurance",
    name: "compareInsurancePrices",
    title: "Compare Insurance Prices",
    tagline: "Find insurance quote options from a recorded comparison workflow.",
    description: "Give this API a ZIP code and a few basic details. It returns ranked insurance quote options an agent can compare for you.",
    scopes: ["insurance:quotes:read"],
    sampleInput: { coverageType: "auto", zipCode: "78701", driverAge: 35, vehicleYear: 2021 },
    inputSchema: {
      type: "object",
      required: ["zipCode"],
      properties: {
        coverageType: { type: "string", description: "Kind of insurance to compare. Start with auto." },
        zipCode: { type: "string", description: "ZIP code where the policy will be priced." },
        driverAge: { type: "number", description: "Driver age for auto insurance quotes." },
        vehicleYear: { type: "number", description: "Vehicle year for auto insurance quotes." }
      }
    },
    outputSchema: {
      type: "object",
      required: ["coverageType", "zipCode", "quotes"],
      properties: {
        coverageType: { type: "string" },
        zipCode: { type: "string" },
        quotes: { type: "array", items: { type: "object" } },
        notes: { type: "string" }
      }
    },
    exampleOutput: compareInsuranceQuotes({ coverageType: "auto", zipCode: "78701", driverAge: 35, vehicleYear: 2021 })
  },
  {
    target: "property",
    name: "searchProperties",
    title: "Search Properties",
    tagline: "Find property matches from a recorded real estate search workflow.",
    description: "Give this API a location, budget, and bedroom count. It returns matching homes with prices, basics, and source URLs.",
    scopes: ["property:search:read"],
    sampleInput: { location: "Austin", maxPrice: 700000, bedrooms: 2 },
    inputSchema: {
      type: "object",
      required: ["location"],
      properties: {
        location: { type: "string", description: "City, state, suburb, or neighborhood to search." },
        maxPrice: { type: "number", description: "Maximum purchase price." },
        bedrooms: { type: "number", description: "Minimum number of bedrooms." }
      }
    },
    outputSchema: {
      type: "object",
      required: ["location", "results"],
      properties: {
        location: { type: "string" },
        maxPrice: { type: "number" },
        bedrooms: { type: "number" },
        results: { type: "array", items: { type: "object" } },
        notes: { type: "string" }
      }
    },
    exampleOutput: searchProperties({ location: "Austin", maxPrice: 700000, bedrooms: 2 })
  },
  {
    target: "business",
    name: "checkBusinessRenewals",
    title: "Business Renewals",
    tagline: "Check renewal status, fees, and deadlines for business licenses.",
    description: "Give this API a business name, state, and license type. It returns renewal status, due dates, fees, and the next steps an agent can complete.",
    scopes: ["business:renewals:read"],
    sampleInput: { businessName: "Northstar Textiles", state: "TX", licenseType: "general" },
    inputSchema: {
      type: "object",
      required: ["businessName", "state"],
      properties: {
        businessName: { type: "string", description: "Business or company name to check." },
        state: { type: "string", description: "US state where the license is registered." },
        licenseType: { type: "string", description: "Optional license category or permit type." }
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
        sourceUrl: { type: "string" },
        nextSteps: { type: "array", items: { type: "string" } },
        notes: { type: "string" }
      }
    },
    exampleOutput: checkBusinessRenewals({ businessName: "Northstar Textiles", state: "TX", licenseType: "general" })
  }
];

function buildDemoOperation(workflow) {
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
      required: (workflow.inputSchema.required || []).includes(name),
      description: schema.description
    })),
    inputSchema: workflow.inputSchema,
    outputSchema: workflow.outputSchema,
    flowGraph: {
      nodes: [
        { id: "recorded-workflow", label: "Run recorded workflow", method: "POST", url: "/api/tools/{slug}/invoke", format: "json" },
        { id: "normalize-output", label: "Return clean JSON", method: "RETURN", url: "agent", format: "json" }
      ],
      edges: []
    },
    parameters: Object.keys(workflow.inputSchema.properties).map((name) => ({
      name,
      class: (workflow.inputSchema.required || []).includes(name) ? "user_supplied" : "constant",
      source: "agent input",
      handling: (workflow.inputSchema.required || []).includes(name) ? "required API input" : "optional API input"
    })),
    executionPlan: [{ id: "runWorkflow", type: "recorded_workflow", target: workflow.target }],
    freshTokenExtractors: [],
    selectionRules: [],
    successPredicates: [{ type: "json_field_present", field: SUCCESS_FIELD_BY_TARGET[workflow.target] || "id" }],
    createdAt: now()
  };
  operation.openapi = openApiFor(operation);
  return operation;
}

module.exports = {
  apiSlugFor,
  bootstrapApis,
  buildDemoOperation,
  createApi,
  DEMO_WORKFLOWS,
  findApi,
  findOwnedApi,
  hydrateApisFromDatabase,
  listApisForAccount,
  openApiDocument,
  publicApi,
  readmeForApi,
  singleApiOpenApi
};
