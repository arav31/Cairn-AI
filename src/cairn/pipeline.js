const { buildRecording } = require("./recordings");
const { synthesize } = require("./synthesizer");
const { verifyOperation, executeOperation } = require("./executor");
const { createSkill, evaluateInvocation, createInvocationLog } = require("./policy");
const { recordInvocationLog, upsertApi } = require("./database");
const { createApi, buildDemoOperation, DEMO_WORKFLOWS } = require("./apis");
const { repairAndVerify } = require("./repair");
const { id, now, sleep, stableHash } = require("./utils");

function createState() {
  return {
    runs: [],
    recordings: {},
    operations: {},
    skills: {},
    apis: {},
    apiStorage: {
      databaseConfigured: false,
      mode: "memory",
      source: "ephemeral",
      loadedCount: 0,
      demoSeeded: false,
      demoSeededCount: 0,
      apiCount: 0
    },
    accounts: {},
    agentApiKeys: {},
    workflowSubmissions: {},
    verificationRecords: {},
    repairJobs: {},
    invocationLogs: [],
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

// Turn a verified operation into the durable, owner-scoped API record agents
// call. Replaces the old marketplace-listing creation: one registration path
// that gives every recorded API a slug, schemas, readme, and owner.
function registerApi(state, operation, ownerAccountId, opts = {}) {
  const skill = createSkill(operation, ownerAccountId);
  state.skills[skill.id] = skill;
  const api = createApi(skill, operation, {
    ownerAccountId,
    sampleInput: opts.sampleInput,
    exampleOutput: opts.exampleOutput,
    tagline: opts.tagline
  });
  api.callCount = state.invocationLogs.filter((log) => log.skillId === skill.id).length;
  state.apis[skill.id] = api;
  return { skill, api };
}

// Seed deterministic demo APIs owned by an account (default "demo-user").
// Used for local exploration and tests; not marketplace supply.
async function seedDemoApis(state, ownerAccountId = "demo-user") {
  let count = 0;
  for (const workflow of DEMO_WORKFLOWS) {
    const operation = buildDemoOperation(workflow);
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
        durationMs: 240,
        error: null
      },
      updatedAt: now()
    };
    const { skill, api } = registerApi(state, operation, ownerAccountId, {
      sampleInput: workflow.sampleInput,
      exampleOutput: workflow.exampleOutput,
      tagline: workflow.tagline
    });
    await upsertApi({ operation, skill, api, verificationRecord: state.verificationRecords[operation.id] });
    count += 1;
  }
  return count;
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

async function recordSynthesizeVerify({ target, input, state, bus, baseUrl, owner = "demo-user" }) {
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
    const { skill, api } = registerApi(state, operation, owner, {
      sampleInput: recording.testInput,
      exampleOutput: recording.expectedOutput
    });
    await upsertApi({ operation, skill, api, verificationRecord: state.verificationRecords[operation.id] });
    bus.emit("skill.registered", {
      runId: run.id,
      skillId: skill.id,
      operationId: operation.id,
      scopes: skill.scopes
    });
    bus.emit("api.registered", {
      runId: run.id,
      api: { slug: api.slug, title: api.title, owner: api.ownerAccountId }
    });
    run.status = "verified";
  } else {
    run.status = "degraded";
  }
  run.completedAt = now();
  bus.emit("run.completed", { runId: run.id, status: run.status });
  return { run, recording, operation, verification };
}

async function invokeSkill({ skillId, input, caller, state, bus, baseUrl, apiSlug }) {
  const skill = state.skills[skillId];
  const decision = evaluateInvocation(skill, input, caller);
  if (!decision.allow) {
    const log = createInvocationLog({ skill, caller, input, decision, status: "blocked" });
    state.invocationLogs.unshift(log);
    await recordInvocationLog(log, apiSlug);
    bus.emit("invocation.blocked", { skillId, caller, reason: decision.reason, log });
    return { allowed: false, decision, log };
  }
  const operation = state.operations[skill.operationId];
  try {
    const output = await executeOperation(operation, input, { baseUrl });
    const log = createInvocationLog({ skill, caller, input, decision, status: "succeeded", output });
    state.invocationLogs.unshift(log);
    if (state.apis[skill.id]) state.apis[skill.id].callCount += 1;
    await recordInvocationLog(log, apiSlug);
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
    await recordInvocationLog(log, apiSlug);
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

async function repairLatest({ target, state, bus, baseUrl, owner }) {
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
    const existingSkill = state.skills[`skill.${repairedOperation.name}`];
    const ownerAccountId = owner || (existingSkill && existingSkill.owner) || "demo-user";
    const previous = state.verificationRecords[repairedOperation.id] || record;
    const { skill, api } = registerApi(state, repairedOperation, ownerAccountId, {
      sampleInput: previous.input,
      exampleOutput: previous.expectedOutput
    });
    await upsertApi({ operation: repairedOperation, skill, api, verificationRecord: state.verificationRecords[repairedOperation.id] });
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
  registerApi,
  seedDemoApis,
  invokeSkill,
  reverifyLatest,
  repairLatest
};
