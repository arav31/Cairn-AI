const { now, stableHash } = require("./utils");

function createSkill(operation) {
  return {
    id: `skill.${operation.name}`,
    operationId: operation.id,
    operationVersion: operation.version,
    title: operation.title,
    description: operation.description,
    owner: "Integration Operations",
    scopes: operation.requiredScopes,
    allowedDomains: operation.allowedDomains,
    maxFrequencyPerMinute: operation.riskTier === "read" ? 30 : 5,
    riskTier: operation.riskTier,
    approvalStatus: "approved",
    currentVerifiedVersion: operation.version,
    rollbackVersion: null,
    marketplace: {
      visibility: "internal",
      pricingModel: "disabled_for_pilot",
      billableUnit: "invocation",
      usageMeterId: null,
      stripeSellerAccount: null,
      agenticCommerceEnabled: false
    },
    updatedAt: now()
  };
}

function evaluateInvocation(skill, input, caller) {
  if (!skill) {
    return { allow: false, reason: "skill_not_registered" };
  }
  if (skill.approvalStatus !== "approved") {
    return { allow: false, reason: "skill_not_approved" };
  }
  if (!caller || !Array.isArray(caller.scopes)) {
    return { allow: false, reason: "caller_missing_scopes" };
  }
  const missing = skill.scopes.filter((scope) => !caller.scopes.includes(scope));
  if (missing.length > 0) {
    return { allow: false, reason: `missing_scope:${missing.join(",")}` };
  }
  for (const [key, value] of Object.entries(input || {})) {
    if (typeof value === "string" && value.length > 128) {
      return { allow: false, reason: `input_too_long:${key}` };
    }
  }
  return { allow: true, reason: "approved" };
}

function createInvocationLog({ skill, caller, input, decision, status, output, error }) {
  return {
    id: `inv_${stableHash({ skill: skill && skill.id, caller, input, at: now() })}`,
    ts: now(),
    callerId: caller && caller.id ? caller.id : "unknown",
    skillId: skill ? skill.id : "unknown",
    operationVersion: skill ? skill.operationVersion : "unknown",
    inputHash: stableHash(input || {}),
    policyDecision: decision,
    status,
    outputHash: output ? stableHash(output) : null,
    error: error || null
  };
}

module.exports = {
  createSkill,
  evaluateInvocation,
  createInvocationLog
};
