const test = require("node:test");
const assert = require("node:assert/strict");
const { createSkill, evaluateInvocation } = require("../src/cairn/policy");

test("policy allows approved caller scope", () => {
  const skill = createSkill({
    id: "op_1",
    name: "getCivicRecord",
    title: "Get Civic Record",
    description: "Read a civic record.",
    version: "v1",
    requiredScopes: ["civic:record:read"],
    allowedDomains: ["/civic"],
    riskTier: "read"
  });

  const decision = evaluateInvocation(skill, { name: "Marjorie Tan" }, {
    id: "agent",
    scopes: ["civic:record:read"]
  });

  assert.equal(decision.allow, true);
});

test("policy blocks missing scopes before a target call can happen", () => {
  const skill = createSkill({
    id: "op_1",
    name: "getCivicRecord",
    title: "Get Civic Record",
    description: "Read a civic record.",
    version: "v1",
    requiredScopes: ["civic:record:read"],
    allowedDomains: ["/civic"],
    riskTier: "read"
  });

  const decision = evaluateInvocation(skill, { name: "Marjorie Tan" }, {
    id: "agent",
    scopes: []
  });

  assert.equal(decision.allow, false);
  assert.match(decision.reason, /missing_scope/);
});
