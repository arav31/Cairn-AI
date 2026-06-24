const test = require("node:test");
const assert = require("node:assert/strict");
const { createState, seedDemoApis, registerApi } = require("../src/cairn/pipeline");
const {
  bootstrapApis,
  findApi,
  findOwnedApi,
  listApisForAccount,
  openApiDocument,
  publicApi,
  singleApiOpenApi
} = require("../src/cairn/apis");

test("bootstrap seeds no APIs by default", async () => {
  const state = createState();
  const storage = await bootstrapApis(state);

  assert.equal(Object.keys(state.apis).length, 0);
  assert.equal(storage.demoSeeded, false);
  assert.equal(storage.apiCount, 0);
});

test("demo APIs are private, owned, and carry no pricing", async () => {
  const state = createState();
  await bootstrapApis(state);
  const count = await seedDemoApis(state, "demo-user");

  assert.equal(count, 3);
  assert.equal(listApisForAccount(state, "demo-user").length, 3);

  const insurance = findOwnedApi(state, "demo-user/compareInsurancePrices", "demo-user");
  assert.ok(insurance);
  assert.equal(insurance.ownerAccountId, "demo-user");
  assert.equal(insurance.visibility, "private");
  assert.equal(insurance.slug, "demo-user/compareInsurancePrices");
  assert.equal("pricing" in insurance, false);
  assert.equal("tokenCost" in insurance, false);

  const pub = publicApi(insurance, state.operations[insurance.operationId]);
  assert.equal(pub.endpoints.invoke, "/api/tools/demo-user/compareInsurancePrices/invoke");
  assert.equal(pub.mcpToolName, "compareInsurancePrices");
  assert.equal("pricing" in pub, false);
});

test("APIs are owner-scoped with no cross-account access", async () => {
  const state = createState();
  await seedDemoApis(state, "owner-a");

  assert.equal(listApisForAccount(state, "owner-a").length, 3);
  assert.equal(listApisForAccount(state, "owner-b").length, 0);
  assert.ok(findApi(state, "owner-a/compareInsurancePrices"));
  assert.equal(findOwnedApi(state, "owner-a/compareInsurancePrices", "owner-b"), undefined);
});

test("generated OpenAPI is payment-free and bearer-secured", async () => {
  const state = createState();
  await seedDemoApis(state, "demo-user");
  const api = findOwnedApi(state, "demo-user/compareInsurancePrices", "demo-user");
  const single = singleApiOpenApi(api, state.operations[api.operationId]);
  const doc = openApiDocument(listApisForAccount(state, "demo-user"), state);

  const serialized = JSON.stringify(single) + JSON.stringify(doc);
  assert.equal(/payment|sharedPaymentToken|tokenAccountId|"402"/.test(serialized), false);
  assert.ok(single.components.securitySchemes.agentBearerAuth);
  assert.ok(single.paths["/api/tools/demo-user/compareInsurancePrices/invoke"]);
  assert.ok(doc.paths["/api/tools/demo-user/compareInsurancePrices/invoke"]);
});

test("registerApi builds a complete reusable record owned by the account", () => {
  const state = createState();
  const operation = {
    id: "op_x",
    name: "getThing",
    title: "Get Thing",
    description: "Returns a thing.",
    version: "v1",
    riskTier: "read",
    target: "thing",
    allowedDomains: ["/x"],
    requiredScopes: ["x:read"],
    inputs: [{ name: "q", type: "string", required: true, description: "query" }],
    inputSchema: { type: "object", required: ["q"], properties: { q: { type: "string" } } },
    outputSchema: { type: "object", properties: { id: { type: "string" } } }
  };
  state.operations[operation.id] = operation;

  const { skill, api } = registerApi(state, operation, "acct_z");

  assert.equal(skill.owner, "acct_z");
  assert.equal(api.slug, "acct_z/getThing");
  assert.equal(api.ownerAccountId, "acct_z");
  assert.deepEqual(api.scopes, ["x:read"]);
  assert.ok(api.invokePath.endsWith("/invoke"));
  assert.ok(/Get Thing/.test(api.readme));
  assert.equal(state.apis[skill.id], api);
});
