const { parseDefinitionList, parseHidden, parseRows, stableHash, toQuery } = require("./utils");
const { compareInsuranceQuotes, searchProperties } = require("../data/seed");

class ExecutionError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.details = details || {};
  }
}

function assertInput(operation, input) {
  for (const required of operation.inputSchema.required || []) {
    if (!input || input[required] == null || input[required] === "") {
      throw new ExecutionError(`Missing required input: ${required}`, "invalid_input", { required });
    }
  }
}

async function requestJson(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new ExecutionError("Target returned invalid JSON", "changed_response_schema", { path, text });
  }
  if (!response.ok) {
    throw new ExecutionError(`Target returned ${response.status}`, classifyStatus(response.status), {
      path,
      status: response.status,
      body: json
    });
  }
  return json;
}

async function requestText(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  if (!response.ok) {
    throw new ExecutionError(`Target returned ${response.status}`, classifyStatus(response.status), {
      path,
      status: response.status,
      body: text
    });
  }
  return text;
}

function classifyStatus(status) {
  if (status === 401 || status === 403) return "auth_expired";
  if (status === 404 || status === 410) return "changed_route";
  if (status === 409 || status === 422) return "stale_token";
  return "target_error";
}

function selectByName(rowsOrRecords, name, field) {
  const needle = String(name || "").trim().toLowerCase();
  return rowsOrRecords.find((record) => String(record[field] || "").trim().toLowerCase().includes(needle));
}

async function executeMeridian(operation, input, context) {
  const baseUrl = context.baseUrl;
  const searchPath = `/meridian/api/customers?${toQuery({ name: input.name, status: input.status })}`;
  const search = await requestJson(baseUrl, searchPath);
  const selected = selectByName(search.customers || [], input.name, "full_name");
  if (!selected) {
    throw new ExecutionError("No matching customer row found", "selector_failure", { input });
  }
  const detail = await requestJson(baseUrl, `/meridian/api/customers/${encodeURIComponent(selected.id)}`);
  if (!detail.customer || !detail.customer.id) {
    throw new ExecutionError("Customer detail response did not match the expected schema", "changed_response_schema");
  }
  return detail.customer;
}

async function executeCivic(operation, input, context) {
  const baseUrl = context.baseUrl;
  const loadStep = operation.executionPlan.find((step) => step.id === "loadSearch");
  const searchStep = operation.executionPlan.find((step) => step.id === "submitSearch");
  const detailStep = operation.executionPlan.find((step) => step.id === "detail");
  const searchPage = await requestText(baseUrl, loadStep.url);
  const firstCsrf = parseHidden(searchPage, "csrf");
  const firstViewState = parseHidden(searchPage, "__VIEWSTATE");
  if (!firstCsrf || !firstViewState) {
    throw new ExecutionError("Could not extract fresh tokens from search form", "extractor_failure");
  }
  const resultForm = new URLSearchParams({
    name: input.name,
    csrf: firstCsrf,
    __VIEWSTATE: firstViewState
  });
  const resultsPage = await requestText(baseUrl, searchStep.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: resultForm.toString()
  });
  const rows = parseRows(resultsPage).map((row) => ({
    record_id: row.id,
    full_name: row.cells[0],
    status: row.cells[1]
  }));
  const selected = selectByName(rows, input.name, "full_name");
  if (!selected) {
    throw new ExecutionError("No matching civic row found", "selector_failure", { input });
  }
  const secondCsrf = parseHidden(resultsPage, "csrf");
  const secondViewState = parseHidden(resultsPage, "__VIEWSTATE");
  if (!secondCsrf || !secondViewState) {
    throw new ExecutionError("Could not extract fresh tokens from results page", "extractor_failure");
  }
  const detailForm = new URLSearchParams({
    record_id: selected.record_id,
    csrf: secondCsrf,
    __VIEWSTATE: secondViewState
  });
  const detailPage = await requestText(baseUrl, detailStep.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: detailForm.toString()
  });
  const detail = parseDefinitionList(detailPage);
  if (!detail.record_id || !detail.full_name) {
    throw new ExecutionError("Detail page did not match the expected schema", "changed_response_schema");
  }
  return detail;
}

async function executeOperation(operation, input, context) {
  assertInput(operation, input);
  if (operation.target === "insurance") {
    return compareInsuranceQuotes(input);
  }
  if (operation.target === "property") {
    return searchProperties(input);
  }
  if (operation.target === "civic") {
    return executeCivic(operation, input, context);
  }
  return executeMeridian(operation, input, context);
}

function outputMatchesExpected(output, expected) {
  if (!expected) return Boolean(output);
  for (const [key, value] of Object.entries(expected)) {
    if (String(output[key]) !== String(value)) {
      return false;
    }
  }
  return true;
}

async function verifyOperation(operation, input, expectedOutput, context) {
  const started = Date.now();
  try {
    const output = await executeOperation(operation, input, context);
    const passed = outputMatchesExpected(output, expectedOutput);
    return {
      passed,
      status: passed ? "passed" : "failed",
      output,
      outputHash: stableHash(output),
      expectedHash: expectedOutput ? stableHash(expectedOutput) : null,
      durationMs: Date.now() - started,
      error: passed ? null : { code: "expected_output_mismatch" }
    };
  } catch (error) {
    return {
      passed: false,
      status: "failed",
      output: null,
      outputHash: null,
      expectedHash: expectedOutput ? stableHash(expectedOutput) : null,
      durationMs: Date.now() - started,
      error: {
        code: error.code || "execution_error",
        message: error.message,
        details: error.details || {}
      }
    };
  }
}

module.exports = {
  ExecutionError,
  executeOperation,
  verifyOperation,
  classifyStatus
};
