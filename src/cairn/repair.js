const { id, now } = require("./utils");
const { verifyOperation } = require("./executor");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextVersion(version) {
  const numeric = Number(String(version || "v1").replace(/^v/, ""));
  return `v${Number.isFinite(numeric) ? numeric + 1 : 2}`;
}

function classifyFailure(verification) {
  if (!verification || !verification.error) return "unknown";
  return verification.error.code || "unknown";
}

async function proposeRepair(operation, verification, context, bus, runId) {
  const failure = classifyFailure(verification);
  if (bus) {
    bus.emit("heal.drift_detected", {
      runId,
      operationId: operation.id,
      failure,
      message: verification && verification.error ? verification.error.message : "verification failed"
    });
  }

  if (operation.target !== "civic" || failure !== "changed_route") {
    return {
      id: id("repair"),
      status: "needs_human",
      confidence: 0.31,
      reason: "Only Civic changed-route repair is implemented in the pilot adapter.",
      proposedOperation: null
    };
  }

  const proposedOperation = clone(operation);
  proposedOperation.id = id("op");
  proposedOperation.version = nextVersion(operation.version);
  proposedOperation.createdAt = now();
  proposedOperation.repairedFrom = operation.id;
  proposedOperation.repairStrategy = "repair_agent_trace_diff";

  for (const step of proposedOperation.executionPlan) {
    if (step.id === "detail") {
      step.url = "/civic/record";
    }
  }
  for (const node of proposedOperation.flowGraph.nodes) {
    if (node.label === "Submit selected detail") {
      node.url = "/civic/record";
    }
  }
  proposedOperation.openapi.info.version = proposedOperation.version;

  const proposal = {
    id: id("repair"),
    status: "proposed",
    confidence: 0.92,
    requiresHumanApproval: false,
    reason: "Fresh repair trace found the detail POST moved from /civic/detail to /civic/record within the same allowed domain.",
    proposedOperation
  };

  if (bus) {
    bus.emit("heal.proposed", {
      runId,
      repairId: proposal.id,
      confidence: proposal.confidence,
      reason: proposal.reason,
      changedUrl: "/civic/record"
    });
  }
  return proposal;
}

async function repairAndVerify(operation, verification, context, bus, runId) {
  const proposal = await proposeRepair(operation, verification, context, bus, runId);
  if (!proposal.proposedOperation) {
    if (bus) {
      bus.emit("heal.needs_human", {
        runId,
        repairId: proposal.id,
        reason: proposal.reason
      });
    }
    return { proposal, verification: null, published: false };
  }
  const repairVerification = await verifyOperation(
    proposal.proposedOperation,
    context.testInput,
    context.expectedOutput,
    context
  );
  if (bus) {
    bus.emit("heal.verified", {
      runId,
      repairId: proposal.id,
      passed: repairVerification.passed,
      version: proposal.proposedOperation.version
    });
  }
  return {
    proposal,
    verification: repairVerification,
    published: repairVerification.passed && !proposal.requiresHumanApproval
  };
}

module.exports = {
  classifyFailure,
  proposeRepair,
  repairAndVerify
};
