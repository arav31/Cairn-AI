const model = {
  state: null,
  events: [],
  network: [],
  interactions: [],
  stages: new Set()
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  const data = await response.json();
  await refreshState();
  return data;
}

async function refreshState() {
  const response = await fetch("/api/state");
  model.state = await response.json();
  render();
}

function selectedTarget() {
  return $("target-select").value;
}

function selectedInput() {
  const input = { name: $("name-input").value.trim() || "Marjorie Tan" };
  if (selectedTarget() === "meridian") {
    input.status = $("status-input").value;
  }
  return input;
}

function currentOperation() {
  if (!model.state) return null;
  return model.state.operations.find((operation) => operation.id === model.state.currentOperationId)
    || model.state.operations[model.state.operations.length - 1]
    || null;
}

function currentSkillId() {
  const operation = currentOperation();
  if (!operation || !model.state) return null;
  const skill = model.state.skills.find((item) => item.operationId === operation.id)
    || model.state.skills.find((item) => item.id === `skill.${operation.name}`);
  return skill ? skill.id : null;
}

function handleEvent(event) {
  model.events.unshift(event);
  model.events = model.events.slice(0, 100);
  if (event.type === "capture.request" || event.type === "capture.response") {
    model.network.unshift(event);
    model.network = model.network.slice(0, 40);
  }
  if (event.type.startsWith("interaction.")) {
    model.interactions.unshift(event);
    model.interactions = model.interactions.slice(0, 30);
  }
  if (event.type === "capture.recording_started") model.stages.add("record");
  if (event.type.startsWith("synth.")) model.stages.add("synth");
  if (event.type.startsWith("verify.")) model.stages.add("verify");
  if (event.type.startsWith("skill.")) model.stages.add("skill");
  if (event.type.startsWith("heal.") || event.type.startsWith("target.drift")) model.stages.add("repair");
  render();
  if ([
    "verify.result",
    "skill.registered",
    "marketplace.listing_updated",
    "invocation.completed",
    "invocation.blocked",
    "heal.repaired",
    "target.drift_induced",
    "target.drift_reset"
  ].includes(event.type)) {
    refreshState();
  }
}

function renderStages() {
  for (const item of $("stage-list").querySelectorAll("li")) {
    item.classList.toggle("active", model.stages.has(item.dataset.stage));
  }
}

function renderTargetState() {
  const targetState = model.state ? model.state.targetState : {};
  $("target-state").innerHTML = `
    <div><span>Civic detail route</span><strong>${escapeHtml(targetState.civicDetailPath || "/civic/detail")}</strong></div>
    <div><span>Runs</span><strong>${model.state ? model.state.runs.length : 0}</strong></div>
    <div><span>Skills</span><strong>${model.state ? model.state.skills.length : 0}</strong></div>
  `;
}

function renderFeeds() {
  $("network-feed").innerHTML = model.network.map((event) => `
    <article class="event-row">
      <time>${formatTime(event.ts)}</time>
      <strong>${escapeHtml(event.type.replace("capture.", ""))}</strong>
      <span>${escapeHtml(event.method || "")} ${escapeHtml(event.url || "")}</span>
      <small>${escapeHtml(event.status || event.format || "")}</small>
    </article>
  `).join("") || "<p class='empty'>No capture events yet.</p>";

  $("interaction-feed").innerHTML = model.interactions.map((event) => {
    const interaction = event.interaction || {};
    return `
      <article class="event-row">
        <time>${formatTime(event.ts)}</time>
        <strong>${escapeHtml(interaction.type)}</strong>
        <span>${escapeHtml(interaction.field || interaction.selector || "")}</span>
        <small>${escapeHtml(interaction.text || interaction.value || "")}</small>
      </article>
    `;
  }).join("") || "<p class='empty'>No interaction events yet.</p>";
}

function renderGraph(operation) {
  if (!operation) {
    $("graph").innerHTML = "<p class='empty'>Record a task to generate a flow graph.</p>";
    return;
  }
  const nodes = operation.flowGraph.nodes.map((node) => `
    <article class="graph-node">
      <strong>${escapeHtml(node.label)}</strong>
      <span>${escapeHtml(node.method)} ${escapeHtml(node.url)}</span>
      <small>${escapeHtml(node.format)}</small>
    </article>
  `).join("");
  const edges = operation.flowGraph.edges.map((edge) => `
    <article class="graph-edge">
      <strong>${escapeHtml(edge.value)}</strong>
      <span>${escapeHtml(edge.reason)}</span>
    </article>
  `).join("");
  $("graph").innerHTML = `<div class="graph-nodes">${nodes}</div><div class="graph-edges">${edges}</div>`;
}

function renderParameters(operation) {
  if (!operation) {
    $("parameter-table").innerHTML = "<tr><td colspan='3'>No parameters classified yet.</td></tr>";
    return;
  }
  $("parameter-table").innerHTML = operation.parameters.map((parameter) => `
    <tr>
      <td>${escapeHtml(parameter.name)}</td>
      <td><span class="class-pill ${escapeHtml(parameter.class)}">${escapeHtml(parameter.class)}</span></td>
      <td>${escapeHtml(parameter.handling)}</td>
    </tr>
  `).join("");
}

function renderVerification(operation) {
  if (!model.state || !operation) {
    $("verification-panel").innerHTML = "<p class='empty'>No verification run yet.</p>";
    return;
  }
  const record = model.state.verificationRecords.find((item) => item.operationId === operation.id);
  if (!record) {
    $("verification-panel").innerHTML = "<p class='empty'>No verification record yet.</p>";
    return;
  }
  const latest = record.latest;
  $("verification-panel").innerHTML = `
    <div class="result-banner ${latest.passed ? "pass" : "fail"}">${latest.passed ? "Passed" : "Failed"}</div>
    <dl>
      <dt>Operation</dt><dd>${escapeHtml(operation.name)} ${escapeHtml(operation.version)}</dd>
      <dt>Duration</dt><dd>${escapeHtml(latest.durationMs)} ms</dd>
      <dt>Output hash</dt><dd>${escapeHtml(latest.outputHash || "none")}</dd>
      <dt>Error</dt><dd>${escapeHtml(latest.error ? latest.error.code : "none")}</dd>
    </dl>
  `;
}

function renderApi(operation) {
  if (!operation) {
    $("api-card").innerHTML = "<p class='empty'>No API synthesized yet.</p>";
    return;
  }
  $("api-card").innerHTML = `
    <h3>${escapeHtml(operation.name)} <span>${escapeHtml(operation.version)}</span></h3>
    <p>${escapeHtml(operation.description)}</p>
    <pre>${escapeHtml(pretty({
      inputSchema: operation.inputSchema,
      outputSchema: operation.outputSchema,
      executionPlan: operation.executionPlan
    }))}</pre>
  `;
}

function renderSkills() {
  const skills = model.state ? model.state.skills : [];
  $("skills-list").innerHTML = skills.map((skill) => `
    <article class="list-item">
      <strong>${escapeHtml(skill.title)}</strong>
      <span>${escapeHtml(skill.approvalStatus)} / ${escapeHtml(skill.riskTier)}</span>
      <small>${escapeHtml(skill.scopes.join(", "))}</small>
    </article>
  `).join("") || "<p class='empty'>No approved skills yet.</p>";
}

function renderMarketplace() {
  const listings = model.state ? model.state.marketplaceListings : [];
  $("marketplace-list").innerHTML = listings.map((listing) => `
    <article class="list-item">
      <strong>${escapeHtml(listing.title)}</strong>
      <span>${escapeHtml(listing.visibility)} / ${escapeHtml(listing.qualityGate)}</span>
      <small>Pricing: ${escapeHtml(listing.pricingModel)} / Usage: ${escapeHtml(listing.usageCount)}</small>
    </article>
  `).join("") || "<p class='empty'>No marketplace listings yet.</p>";
}

function renderAudit() {
  const logs = model.state ? model.state.invocationLogs : [];
  $("audit-log").innerHTML = logs.map((log) => `
    <article class="event-row">
      <time>${formatTime(log.ts)}</time>
      <strong>${escapeHtml(log.status)}</strong>
      <span>${escapeHtml(log.skillId)}</span>
      <small>${escapeHtml(log.policyDecision.reason)}</small>
    </article>
  `).join("") || "<p class='empty'>No invocations yet.</p>";
}

function render() {
  if (!model.state) return;
  const operation = currentOperation();
  $("status-label").classList.toggle("hidden", selectedTarget() !== "meridian");
  renderStages();
  renderTargetState();
  renderFeeds();
  renderGraph(operation);
  renderParameters(operation);
  renderVerification(operation);
  renderApi(operation);
  renderSkills();
  renderMarketplace();
  renderAudit();
}

function bind() {
  $("open-meridian").addEventListener("click", () => {
    $("target-frame").src = "/meridian";
    $("frame-label").textContent = "Meridian CRM";
    $("target-select").value = "meridian";
    render();
  });
  $("open-civic").addEventListener("click", () => {
    $("target-frame").src = "/civic/login";
    $("frame-label").textContent = "Civic Portal";
    $("target-select").value = "civic";
    render();
  });
  $("target-select").addEventListener("change", () => {
    if (selectedTarget() === "civic") {
      $("target-frame").src = "/civic/login";
      $("frame-label").textContent = "Civic Portal";
    } else {
      $("target-frame").src = "/meridian";
      $("frame-label").textContent = "Meridian CRM";
    }
    render();
  });
  $("record-button").addEventListener("click", () => api("/api/demo/record", { target: selectedTarget(), input: selectedInput() }));
  $("verify-button").addEventListener("click", () => api("/api/demo/reverify", { target: selectedTarget() }));
  $("drift-button").addEventListener("click", () => api("/api/demo/drift-civic"));
  $("reset-button").addEventListener("click", () => api("/api/demo/reset-drift"));
  $("repair-button").addEventListener("click", () => api("/api/demo/repair", { target: "civic" }));
  $("invoke-button").addEventListener("click", () => {
    const skillId = currentSkillId();
    if (!skillId) return;
    return api("/api/invoke", {
      skillId,
      input: selectedInput(),
      caller: { id: "demo-agent", scopes: ["crm:customer:read", "civic:record:read"] }
    });
  });
  $("blocked-button").addEventListener("click", () => {
    const skillId = currentSkillId() || "skill.getCivicRecord";
    return api("/api/invoke", {
      skillId,
      input: selectedInput(),
      caller: { id: "overreaching-agent", scopes: [] }
    });
  });
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.onmessage = (message) => handleEvent(JSON.parse(message.data));
  const eventTypes = [
    "run.started",
    "run.completed",
    "run.failed",
    "capture.recording_started",
    "capture.request",
    "capture.response",
    "interaction.input",
    "interaction.click",
    "synth.started",
    "synth.request_node",
    "synth.dependency_added",
    "synth.parameter_classified",
    "synth.api_ready",
    "verify.started",
    "verify.result",
    "skill.registered",
    "marketplace.listing_updated",
    "invocation.completed",
    "invocation.blocked",
    "invocation.failed",
    "target.drift_induced",
    "target.drift_reset",
    "heal.drift_detected",
    "heal.proposed",
    "heal.verified",
    "heal.repaired",
    "heal.needs_human"
  ];
  for (const type of eventTypes) {
    source.addEventListener(type, (message) => handleEvent(JSON.parse(message.data)));
  }
}

bind();
connectEvents();
refreshState();
