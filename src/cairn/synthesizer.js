const { id, now } = require("./utils");

function emit(bus, type, runId, payload) {
  if (bus) bus.emit(type, { runId, ...payload });
}

function openApiFor(operation) {
  const inputProperties = {};
  const required = [];
  for (const input of operation.inputs) {
    inputProperties[input.name] = { type: input.type, description: input.description };
    if (input.required) required.push(input.name);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: `${operation.title} API`,
      version: operation.version
    },
    paths: {
      [`/skills/${operation.name}/invoke`]: {
        post: {
          operationId: operation.name,
          summary: operation.description,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: inputProperties,
                  required
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Successful skill invocation",
              content: {
                "application/json": {
                  schema: operation.outputSchema
                }
              }
            }
          }
        }
      }
    }
  };
}

function synthesizeMeridian(recording, bus, runId) {
  const search = recording.networkEvents[0];
  const detail = recording.networkEvents[1];
  const operation = {
    id: id("op"),
    target: "meridian",
    version: "v1",
    name: "getCustomerRecord",
    title: "Get Customer Record",
    description: "Search Meridian CRM by customer name and return the selected customer detail record.",
    riskTier: "read",
    allowedDomains: ["/meridian/api"],
    requiredScopes: ["crm:customer:read"],
    inputs: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "Customer name to search for."
      },
      {
        name: "status",
        type: "string",
        required: false,
        description: "Optional customer status filter."
      }
    ],
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        status: { type: "string" }
      }
    },
    outputSchema: {
      type: "object",
      required: ["id", "full_name", "status", "email", "company"],
      properties: {
        id: { type: "string" },
        full_name: { type: "string" },
        status: { type: "string" },
        email: { type: "string" },
        company: { type: "string" },
        plan: { type: "string" },
        last_seen: { type: "string" }
      }
    },
    flowGraph: {
      nodes: [
        { id: search.id, label: "Search customers", method: search.method, url: "/meridian/api/customers", format: "json" },
        { id: detail.id, label: "Fetch detail", method: detail.method, url: "/meridian/api/customers/{id}", format: "json" }
      ],
      edges: [
        {
          from: search.id,
          to: detail.id,
          value: "customer.id",
          reason: "Search response id is reused by the detail request."
        }
      ]
    },
    parameters: [
      { name: "name", class: "user_supplied", source: "interaction.input[name]", handling: "required API input" },
      { name: "status", class: "user_supplied", source: "interaction.input[status]", handling: "optional API input" },
      { name: "id", class: "derived", source: "search response selected row", handling: "filled by selection rule" },
      { name: "session", class: "session_fresh", source: "auth state", handling: "kept outside agent visibility" }
    ],
    executionPlan: [
      {
        id: "search",
        method: "GET",
        url: "/meridian/api/customers",
        query: {
          name: "{{input.name}}",
          status: "{{input.status}}"
        },
        extract: "customers"
      },
      {
        id: "select",
        type: "selection",
        rule: {
          kind: "list-row",
          matchField: "full_name",
          matchInput: "name",
          idField: "id"
        }
      },
      {
        id: "detail",
        method: "GET",
        url: "/meridian/api/customers/{{derived.id}}",
        extract: "customer"
      }
    ],
    freshTokenExtractors: [],
    selectionRules: [
      {
        kind: "list-row",
        matchField: "full_name",
        matchInput: "name",
        idField: "id"
      }
    ],
    successPredicates: [{ type: "json_field_present", field: "id" }],
    createdAt: now()
  };
  operation.openapi = openApiFor(operation);
  return operation;
}

function synthesizeCivic(recording, bus, runId) {
  const [searchPage, results, detail] = recording.networkEvents;
  const operation = {
    id: id("op"),
    target: "civic",
    version: "v1",
    name: "getCivicRecord",
    title: "Get Civic Record",
    description: "Search the Civic Records Portal by name, select the matching row, and return normalized detail fields.",
    riskTier: "read",
    allowedDomains: ["/civic"],
    requiredScopes: ["civic:record:read"],
    inputs: [
      {
        name: "name",
        type: "string",
        required: true,
        description: "Person name to search for."
      }
    ],
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" }
      }
    },
    outputSchema: {
      type: "object",
      required: ["record_id", "full_name", "status", "dob", "case_officer", "last_updated"],
      properties: {
        record_id: { type: "string" },
        full_name: { type: "string" },
        status: { type: "string" },
        dob: { type: "string" },
        case_officer: { type: "string" },
        last_updated: { type: "string" },
        notes: { type: "string" }
      }
    },
    flowGraph: {
      nodes: [
        { id: searchPage.id, label: "Load search form", method: "GET", url: "/civic/search", format: "html" },
        { id: results.id, label: "Submit search", method: "POST", url: "/civic/results", format: "html" },
        { id: detail.id, label: "Submit selected detail", method: "POST", url: "/civic/detail", format: "html" }
      ],
      edges: [
        {
          from: searchPage.id,
          to: results.id,
          value: "csrf + __VIEWSTATE",
          reason: "Fresh hidden fields from the form are required by the search POST."
        },
        {
          from: results.id,
          to: detail.id,
          value: "record_id + fresh hidden fields",
          reason: "The selected row id and fresh hidden fields are required by the detail POST."
        }
      ]
    },
    parameters: [
      { name: "name", class: "user_supplied", source: "interaction.input[name]", handling: "required API input" },
      { name: "record_id", class: "derived", source: "selected results row", handling: "filled by row selection rule" },
      { name: "csrf", class: "session_fresh", source: "hidden input in previous response", handling: "extracted every run" },
      { name: "__VIEWSTATE", class: "session_fresh", source: "hidden input in previous response", handling: "extracted every run" }
    ],
    executionPlan: [
      {
        id: "loadSearch",
        method: "GET",
        url: "/civic/search",
        extractFresh: ["csrf", "__VIEWSTATE"]
      },
      {
        id: "submitSearch",
        method: "POST",
        url: "/civic/results",
        form: {
          name: "{{input.name}}",
          csrf: "{{fresh.csrf}}",
          __VIEWSTATE: "{{fresh.__VIEWSTATE}}"
        },
        extractFresh: ["csrf", "__VIEWSTATE"],
        extractRows: true
      },
      {
        id: "select",
        type: "selection",
        rule: {
          kind: "table-row",
          matchColumn: "full_name",
          matchInput: "name",
          idAttribute: "data-record-id"
        }
      },
      {
        id: "detail",
        method: "POST",
        url: "/civic/detail",
        form: {
          record_id: "{{derived.record_id}}",
          csrf: "{{fresh.csrf}}",
          __VIEWSTATE: "{{fresh.__VIEWSTATE}}"
        },
        extract: "definition-list"
      }
    ],
    freshTokenExtractors: [
      { name: "csrf", selector: "input[name='csrf']", source: "previous_html_response" },
      { name: "__VIEWSTATE", selector: "input[name='__VIEWSTATE']", source: "previous_html_response" }
    ],
    selectionRules: [
      {
        kind: "table-row",
        matchColumn: "full_name",
        matchInput: "name",
        idAttribute: "data-record-id"
      }
    ],
    successPredicates: [{ type: "html_selector", selector: "#civic-detail" }],
    createdAt: now()
  };
  operation.openapi = openApiFor(operation);
  return operation;
}

async function synthesize(recording, bus, runId) {
  emit(bus, "synth.started", runId, { target: recording.target });
  for (const event of recording.networkEvents) {
    emit(bus, "synth.request_node", runId, {
      requestId: event.id,
      method: event.method,
      url: event.url,
      format: event.format
    });
  }
  const operation = recording.target === "civic"
    ? synthesizeCivic(recording, bus, runId)
    : synthesizeMeridian(recording, bus, runId);
  for (const edge of operation.flowGraph.edges) {
    emit(bus, "synth.dependency_added", runId, edge);
  }
  for (const parameter of operation.parameters) {
    emit(bus, "synth.parameter_classified", runId, parameter);
  }
  emit(bus, "synth.api_ready", runId, {
    operationId: operation.id,
    name: operation.name,
    inputSchema: operation.inputSchema,
    outputSchema: operation.outputSchema,
    executionPlan: operation.executionPlan
  });
  return operation;
}

module.exports = {
  synthesize,
  openApiFor
};
