const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCivicRecording, buildMeridianRecording } = require("../src/cairn/recordings");
const { synthesize } = require("../src/cairn/synthesizer");

test("civic synthesis marks CSRF and ViewState as fresh tokens", async () => {
  const recording = buildCivicRecording({ name: "Marjorie Tan" });
  const operation = await synthesize(recording);
  const classes = Object.fromEntries(operation.parameters.map((parameter) => [parameter.name, parameter.class]));

  assert.equal(operation.name, "getCivicRecord");
  assert.equal(classes.name, "user_supplied");
  assert.equal(classes.record_id, "derived");
  assert.equal(classes.csrf, "session_fresh");
  assert.equal(classes.__VIEWSTATE, "session_fresh");
  assert.equal(operation.freshTokenExtractors.length, 2);
});

test("meridian synthesis creates a derived customer id edge", async () => {
  const recording = buildMeridianRecording({ name: "Marjorie Tan", status: "Active" });
  const operation = await synthesize(recording);

  assert.equal(operation.name, "getCustomerRecord");
  assert.equal(operation.flowGraph.edges.length, 1);
  assert.match(operation.flowGraph.edges[0].reason, /detail request/);
  assert.equal(operation.selectionRules[0].idField, "id");
});
