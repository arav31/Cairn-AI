const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCivicRecording } = require("../src/cairn/recordings");
const { synthesize } = require("../src/cairn/synthesizer");
const { verifyOperation } = require("../src/cairn/executor");
const { repairAndVerify } = require("../src/cairn/repair");
const { getCivicRecord, searchCivicRecords } = require("../src/data/seed");

function response(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function makeMockCivicTarget() {
  const tokens = new Set();
  let detailPath = "/civic/detail";
  let seq = 0;
  const tokenPair = () => {
    seq += 1;
    const csrf = `csrf_${seq}`;
    const viewState = `vs_${seq}`;
    tokens.add(csrf);
    tokens.add(viewState);
    return { csrf, viewState };
  };
  const consume = (csrf, viewState) => {
    const valid = tokens.has(csrf) && tokens.has(viewState);
    if (valid) {
      tokens.delete(csrf);
      tokens.delete(viewState);
    }
    return valid;
  };
  const fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/civic/search") {
      const { csrf, viewState } = tokenPair();
      return response(`<form><input name="csrf" value="${csrf}"><input name="__VIEWSTATE" value="${viewState}"></form>`);
    }
    if (parsed.pathname === "/civic/results") {
      const body = Object.fromEntries(new URLSearchParams(options.body));
      if (!consume(body.csrf, body.__VIEWSTATE)) return response("stale", 422);
      const { csrf, viewState } = tokenPair();
      const rows = searchCivicRecords(body.name).map((record) => (
        `<tr data-record-id="${record.record_id}"><td>${record.full_name}</td><td>${record.status}</td></tr>`
      )).join("");
      return response(`<input name="csrf" value="${csrf}"><input name="__VIEWSTATE" value="${viewState}"><table>${rows}</table>`);
    }
    if (parsed.pathname === "/civic/detail" || parsed.pathname === "/civic/record") {
      if (parsed.pathname !== detailPath) return response("route changed", parsed.pathname === "/civic/detail" ? 410 : 404);
      const body = Object.fromEntries(new URLSearchParams(options.body));
      if (!consume(body.csrf, body.__VIEWSTATE)) return response("stale", 422);
      const record = getCivicRecord(body.record_id);
      if (!record) return response("missing", 404);
      return response(`<section id="civic-detail"><dl><dt>record id</dt><dd>${record.record_id}</dd><dt>full name</dt><dd>${record.full_name}</dd><dt>status</dt><dd>${record.status}</dd><dt>dob</dt><dd>${record.dob}</dd><dt>case officer</dt><dd>${record.case_officer}</dd><dt>last updated</dt><dd>${record.last_updated}</dd><dt>notes</dt><dd>${record.notes}</dd></dl></section>`);
    }
    return response("not found", 404);
  };
  return {
    fetch,
    drift() {
      detailPath = "/civic/record";
    }
  };
}

test("civic executor lifts fresh tokens and repair publishes a changed route candidate", async () => {
  const target = makeMockCivicTarget();
  const originalFetch = global.fetch;
  global.fetch = target.fetch;
  try {
    const recording = buildCivicRecording({ name: "Marjorie Tan" });
    const operation = await synthesize(recording);
    const context = {
      baseUrl: "http://mock.local",
      testInput: recording.testInput,
      expectedOutput: recording.expectedOutput
    };

    const firstVerification = await verifyOperation(
      operation,
      recording.testInput,
      recording.expectedOutput,
      context
    );
    assert.equal(firstVerification.passed, true);

    target.drift();
    const driftedVerification = await verifyOperation(
      operation,
      recording.testInput,
      recording.expectedOutput,
      context
    );
    assert.equal(driftedVerification.passed, false);
    assert.equal(driftedVerification.error.code, "changed_route");

    const repair = await repairAndVerify(operation, driftedVerification, context);
    assert.equal(repair.published, true);
    assert.equal(repair.verification.passed, true);
    assert.equal(
      repair.proposal.proposedOperation.executionPlan.find((step) => step.id === "detail").url,
      "/civic/record"
    );
  } finally {
    global.fetch = originalFetch;
  }
});
