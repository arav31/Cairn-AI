const { buildRecording } = require("./recordings");
const { synthesize } = require("./synthesizer");
const { verifyOperation, executeOperation } = require("./executor");
const { createSkill, evaluateInvocation, createInvocationLog } = require("./policy");
const { recordInvocationLog } = require("./database");
const { repairAndVerify } = require("./repair");
const { id, now, sleep } = require("./utils");

function createState() {
  return {
    runs: [],
    recordings: {},
    operations: {},
    skills: {},
    marketplaceListings: {},
    accounts: {},
    workflowSubmissions: {},
    verificationRecords: {},
    repairJobs: {},
    invocationLogs: [],
    tokenWallets: {},
    tokenLedger: [],
    currentOperationId: null,
    targetState: {
      civicDetailPath: "/civic/detail"
    }
  };
}

function latestOperation(state, target) {
  const operations = Object.values(state.operations)
    .filter((operation) => !target || operation.target === target)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return operations[0] || null;
}

function upsertSkillAndListing(state, operation) {
  const skill = createSkill(operation);
  state.skills[skill.id] = skill;
  state.marketplaceListings[skill.id] = {
    id: `listing.${skill.id}`,
    skillId: skill.id,
    title: skill.title,
    owner: skill.owner,
    visibility: "internal",
    qualityGate: "verified",
    verificationFreshness: "fresh",
    riskTier: skill.riskTier,
    scopes: skill.scopes,
    usageCount: state.invocationLogs.filter((log) => log.skillId === skill.id).length,
    pricingModel: skill.marketplace.pricingModel,
    billableUnit: skill.marketplace.billableUnit,
    stripeSellerAccount: skill.marketplace.stripeSellerAccount,
    agenticCommerceEnabled: skill.marketplace.agenticCommerceEnabled,
    updatedAt: now()
  };
  return skill;
}

async function emitRecording(recording, bus, runId) {
  bus.emit("capture.recording_started", {
    runId,
    recordingId: recording.id,
    target: recording.target,
    successMarker: recording.successMarker
  });
  for (const interaction of recording.interactions) {
    await sleep(140);
    bus.emit(`interaction.${interaction.type}`, {
      runId,
      recordingId: recording.id,
      interaction
    });
  }
  for (const event of recording.networkEvents) {
    await sleep(180);
    bus.emit("capture.request", {
      runId,
      recordingId: recording.id,
      requestId: event.id,
      method: event.method,
      url: event.url,
      format: event.format,
      request: event.request
    });
    await sleep(100);
    bus.emit("capture.response", {
      runId,
      recordingId: recording.id,
      requestId: event.id,
      status: event.status,
      format: event.format
    });
  }
}

async function recordSynthesizeVerify({ target, input, state, bus, baseUrl }) {
  const run = {
    id: id("run"),
    target,
    status: "recording",
    startedAt: now(),
    completedAt: null
  };
  state.runs.unshift(run);
  bus.emit("run.started", { runId: run.id, target, input });
  const recording = buildRecording(target, input);
  state.recordings[recording.id] = recording;
  await emitRecording(recording, bus, run.id);
  run.status = "synthesizing";
  const operation = await synthesize(recording, bus, run.id);
  state.operations[operation.id] = operation;
  state.currentOperationId = operation.id;
  run.status = "verifying";
  bus.emit("verify.started", {
    runId: run.id,
    operationId: operation.id,
    operationName: operation.name
  });
  const verification = await verifyOperation(operation, recording.testInput, recording.expectedOutput, {
    baseUrl,
    testInput: recording.testInput,
    expectedOutput: recording.expectedOutput
  });
  state.verificationRecords[operation.id] = {
    operationId: operation.id,
    target,
    input: recording.testInput,
    expectedOutput: recording.expectedOutput,
    latest: verification,
    updatedAt: now()
  };
  bus.emit("verify.result", {
    runId: run.id,
    operationId: operation.id,
    passed: verification.passed,
    durationMs: verification.durationMs,
    error: verification.error,
    output: verification.output
  });
  if (verification.passed) {
    const skill = upsertSkillAndListing(state, operation);
    bus.emit("skill.registered", {
      runId: run.id,
      skillId: skill.id,
      operationId: operation.id,
      scopes: skill.scopes
    });
    bus.emit("marketplace.listing_updated", {
      runId: run.id,
      listing: state.marketplaceListings[skill.id]
    });
    run.status = "verified";
  } else {
    run.status = "degraded";
  }
  run.completedAt = now();
  bus.emit("run.completed", { runId: run.id, status: run.status });
  return { run, recording, operation, verification };
}

async function invokeSkill({ skillId, input, caller, state, bus, baseUrl, listingSlug }) {
  const skill = state.skills[skillId];
  const decision = evaluateInvocation(skill, input, caller);
  if (!decision.allow) {
    const log = createInvocationLog({ skill, caller, input, decision, status: "blocked" });
    state.invocationLogs.unshift(log);
    await recordInvocationLog(log, listingSlug);
    bus.emit("invocation.blocked", { skillId, caller, reason: decision.reason, log });
    return { allowed: false, decision, log };
  }
  const operation = state.operations[skill.operationId];
  try {
    const output = await executeOperation(operation, input, { baseUrl });
    const log = createInvocationLog({ skill, caller, input, decision, status: "succeeded", output });
    state.invocationLogs.unshift(log);
    state.marketplaceListings[skill.id].usageCount += 1;
    await recordInvocationLog(log, listingSlug);
    bus.emit("invocation.completed", { skillId, caller, output, log });
    return { allowed: true, decision, output, log };
  } catch (error) {
    const log = createInvocationLog({
      skill,
      caller,
      input,
      decision,
      status: "failed",
      error: { code: error.code || "execution_error", message: error.message }
    });
    state.invocationLogs.unshift(log);
    await recordInvocationLog(log, listingSlug);
    bus.emit("invocation.failed", { skillId, caller, error: log.error, log });
    return { allowed: true, decision, error: log.error, log };
  }
}

async function reverifyLatest({ target, state, bus, baseUrl }) {
  const operation = latestOperation(state, target);
  if (!operation) {
    return { error: "no_operation" };
  }
  const record = state.verificationRecords[operation.id];
  const runId = id("verify");
  bus.emit("verify.started", {
    runId,
    operationId: operation.id,
    operationName: operation.name
  });
  const verification = await verifyOperation(operation, record.input, record.expectedOutput, {
    baseUrl,
    testInput: record.input,
    expectedOutput: record.expectedOutput
  });
  record.latest = verification;
  record.updatedAt = now();
  bus.emit("verify.result", {
    runId,
    operationId: operation.id,
    passed: verification.passed,
    durationMs: verification.durationMs,
    error: verification.error,
    output: verification.output
  });
  return { operation, verification, record, runId };
}

async function repairLatest({ target, state, bus, baseUrl }) {
  const verificationResult = await reverifyLatest({ target, state, bus, baseUrl });
  if (verificationResult.error) return verificationResult;
  if (verificationResult.verification.passed) {
    return { ...verificationResult, repaired: false, reason: "operation_still_valid" };
  }
  const { operation, verification, record, runId } = verificationResult;
  const repair = await repairAndVerify(operation, verification, {
    baseUrl,
    testInput: record.input,
    expectedOutput: record.expectedOutput
  }, bus, runId);
  state.repairJobs[repair.proposal.id] = {
    id: repair.proposal.id,
    operationId: operation.id,
    status: repair.published ? "published" : "needs_human",
    confidence: repair.proposal.confidence,
    reason: repair.proposal.reason,
    createdAt: now()
  };
  if (repair.published) {
    const repairedOperation = repair.proposal.proposedOperation;
    state.operations[repairedOperation.id] = repairedOperation;
    state.currentOperationId = repairedOperation.id;
    state.verificationRecords[repairedOperation.id] = {
      operationId: repairedOperation.id,
      target: repairedOperation.target,
      input: record.input,
      expectedOutput: record.expectedOutput,
      latest: repair.verification,
      updatedAt: now()
    };
    const skill = upsertSkillAndListing(state, repairedOperation);
    bus.emit("heal.repaired", {
      runId,
      repairId: repair.proposal.id,
      operationId: repairedOperation.id,
      skillId: skill.id,
      version: repairedOperation.version
    });
  }
  return { operation, verification, repair, repaired: repair.published };
}

module.exports = {
  createState,
  latestOperation,
  recordSynthesizeVerify,
  invokeSkill,
  reverifyLatest,
  repairLatest
};
