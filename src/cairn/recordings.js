const { id, now, redact } = require("./utils");
const {
  searchCustomers,
  searchCivicRecords,
  getCustomer,
  getCivicRecord
} = require("../data/seed");

function makeNetworkEvent(method, url, request, response, status = 200, format = "json") {
  return {
    id: id("req"),
    ts: now(),
    method,
    url,
    status,
    format,
    request: redact(request),
    response: redact(response)
  };
}

function buildMeridianRecording(input) {
  const name = input.name || "Marjorie Tan";
  const status = input.status || "Active";
  const results = searchCustomers(name, status);
  const selected = results[0] || searchCustomers(name)[0];
  const detail = selected ? getCustomer(selected.id) : null;
  return {
    id: id("rec"),
    target: "meridian",
    title: "Meridian CRM customer lookup",
    authState: { cookieJar: "[encrypted-demo-session]" },
    targetAllowlist: ["/meridian/api"],
    successMarker: "#customer-detail",
    testInput: { name, status },
    expectedOutput: detail,
    interactions: [
      { type: "input", field: "name", value: name, selector: "#meridian-search-name" },
      { type: "input", field: "status", value: status, selector: "#meridian-search-status" },
      { type: "click", selector: "[data-action='search']", text: "Search" },
      {
        type: "click",
        selector: `[data-customer-id='${selected ? selected.id : "none"}']`,
        text: selected ? selected.full_name : "",
        selectionContext: {
          kind: "list-row",
          matchField: "full_name",
          matchInput: "name",
          idAttribute: "data-customer-id"
        }
      }
    ],
    networkEvents: [
      makeNetworkEvent(
        "GET",
        `/meridian/api/customers?name=${encodeURIComponent(name)}&status=${encodeURIComponent(status)}`,
        { query: { name, status } },
        { customers: results },
        200,
        "json"
      ),
      makeNetworkEvent(
        "GET",
        `/meridian/api/customers/${selected ? selected.id : "none"}`,
        { params: { id: selected ? selected.id : "none" } },
        { customer: detail },
        detail ? 200 : 404,
        "json"
      )
    ]
  };
}

function buildCivicRecording(input) {
  const name = input.name || "Marjorie Tan";
  const results = searchCivicRecords(name);
  const selected = results[0];
  const detail = selected ? getCivicRecord(selected.record_id) : null;
  return {
    id: id("rec"),
    target: "civic",
    title: "Civic Records Portal record lookup",
    authState: { cookieJar: "[encrypted-demo-session]" },
    targetAllowlist: ["/civic"],
    successMarker: "#civic-detail",
    testInput: { name },
    expectedOutput: detail,
    interactions: [
      { type: "input", field: "name", value: name, selector: "#civic-search-name" },
      { type: "click", selector: "[data-action='search']", text: "Search" },
      {
        type: "click",
        selector: `[data-record-id='${selected ? selected.record_id : "none"}']`,
        text: selected ? selected.full_name : "",
        selectionContext: {
          kind: "table-row",
          matchColumn: "full_name",
          matchInput: "name",
          idAttribute: "data-record-id"
        }
      }
    ],
    networkEvents: [
      makeNetworkEvent(
        "GET",
        "/civic/search",
        {},
        { html: "<form><input name=\"csrf\" value=\"[redacted]\"><input name=\"__VIEWSTATE\" value=\"[redacted]\"></form>" },
        200,
        "html"
      ),
      makeNetworkEvent(
        "POST",
        "/civic/results",
        {
          form: {
            name,
            csrf: "[redacted]",
            __VIEWSTATE: "[redacted]"
          }
        },
        {
          html: `<table><tr data-record-id="${selected ? selected.record_id : "none"}"><td>${selected ? selected.full_name : ""}</td></tr></table><input name="csrf" value="[redacted]"><input name="__VIEWSTATE" value="[redacted]">`
        },
        200,
        "html"
      ),
      makeNetworkEvent(
        "POST",
        "/civic/detail",
        {
          form: {
            record_id: selected ? selected.record_id : "none",
            csrf: "[redacted]",
            __VIEWSTATE: "[redacted]"
          }
        },
        {
          html: detail
            ? `<section id="civic-detail"><dl><dt>record id</dt><dd>${detail.record_id}</dd><dt>full name</dt><dd>${detail.full_name}</dd></dl></section>`
            : ""
        },
        detail ? 200 : 404,
        "html"
      )
    ]
  };
}

function buildRecording(target, input) {
  if (target === "civic") return buildCivicRecording(input || {});
  return buildMeridianRecording(input || {});
}

module.exports = {
  buildRecording,
  buildMeridianRecording,
  buildCivicRecording
};
