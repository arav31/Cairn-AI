const REAL_SKILL_ID = "term-plan-insurance-comparison";

const state = {
  skills: [],
  installedSkillIds: loadInstalledSkillIds(),
  activeSkillId: REAL_SKILL_ID,
  lastInputs: null,
  recordingSessionId: null,
};

const elements = {
  serverStatus: document.querySelector("#serverStatus"),
  skillsList: document.querySelector("#skillsList"),
  skillSearch: document.querySelector("#skillSearch"),
  refreshSkills: document.querySelector("#refreshSkills"),
  newSkillButton: document.querySelector("#newSkillButton"),
  registerSkillForm: document.querySelector("#registerSkillForm"),
  recordWebsiteLink: document.querySelector("#recordWebsiteLink"),
  recordDescription: document.querySelector("#recordDescription"),
  startRecording: document.querySelector("#startRecording"),
  finishRecording: document.querySelector("#finishRecording"),
  cancelRecording: document.querySelector("#cancelRecording"),
  installState: document.querySelector("#installState"),
  activeSkillTitle: document.querySelector("#activeSkillTitle"),
  progressText: document.querySelector("#progressText"),
  progressPercent: document.querySelector("#progressPercent"),
  progressFill: document.querySelector("#progressFill"),
  chatLog: document.querySelector("#chatLog"),
  quoteForm: document.querySelector("#quoteForm"),
  buySkill: document.querySelector("#buySkill"),
  runCompare: document.querySelector("#runCompare"),
  runCached: document.querySelector("#runCached"),
  results: document.querySelector("#results"),
};

init();

async function init() {
  addMessage(
    "agent",
    "Paste or select a marketplace skill. The real demo skill is Term Plan Insurance Comparison; once installed, I will ask the insurer quote questions and call the learned endpoints directly.",
  );
  bindEvents();
  updateInstallState();
  await loadSkills();
  setProgress(0, "Ready");
}

function bindEvents() {
  elements.refreshSkills.addEventListener("click", loadSkills);
  elements.skillSearch.addEventListener("input", renderSkills);
  elements.newSkillButton.addEventListener("click", toggleRegisterPanel);
  elements.registerSkillForm.addEventListener("submit", startSkillRecording);
  elements.finishRecording.addEventListener("click", finishSkillRecording);
  elements.cancelRecording.addEventListener("click", cancelSkillRecording);
  elements.buySkill.addEventListener("click", installActiveSkill);
  elements.quoteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runComparison(false);
  });
  elements.runCached.addEventListener("click", () => runComparison(true));
}

async function loadSkills() {
  setProgress(12, "Checking marketplace");
  try {
    const data = await getJson("/api/marketplace/skills");
    state.skills = data.skills || [];
    elements.serverStatus.textContent = "Online";
    elements.serverStatus.classList.add("live");
    renderSkills();
    updateInstallState();
  } catch (error) {
    elements.serverStatus.textContent = "Offline";
    addMessage("agent", `Marketplace server is not reachable: ${error.message}`);
  } finally {
    setProgress(isActiveSkillInstalled() ? 20 : 0, isActiveSkillInstalled() ? "Skill installed" : "Waiting for skill purchase");
  }
}

function renderSkills() {
  const query = elements.skillSearch.value.trim().toLowerCase();
  const skills = state.skills.filter((skill) => {
    const text = `${skill.name} ${skill.category} ${skill.description}`.toLowerCase();
    return text.includes(query);
  });

  elements.skillsList.innerHTML = skills
    .map((skill) => {
      const active = skill.id === state.activeSkillId ? " active" : "";
      const statusClass = skill.real || skill.recorded ? "live" : "mock";
      return `
        <article class="skill-card${active}" data-skill-id="${escapeHtml(skill.id)}">
          <div class="skill-card-header">
            <h3>${escapeHtml(skill.name)}</h3>
            <span class="status-pill ${statusClass}">${escapeHtml(skill.status)}</span>
          </div>
          <p>${escapeHtml(skill.description)}</p>
          <div class="skill-meta">
            <span>${escapeHtml(skill.category)}</span>
            <span>${escapeHtml(skill.price)}</span>
            <span>${skill.real ? "endpoint-backed" : skill.recorded ? "recorded" : "mock"}</span>
          </div>
        </article>
      `;
    })
    .join("");

  for (const card of elements.skillsList.querySelectorAll(".skill-card")) {
    card.addEventListener("click", () => {
      state.activeSkillId = card.dataset.skillId;
      const skill = state.skills.find((item) => item.id === state.activeSkillId);
      elements.activeSkillTitle.textContent = skill?.name || "Skill";
      renderSkills();
      updateInstallState();
      if (skill?.real) {
        addMessage("agent", "This is the learned insurance skill. Install it, answer the quote fields, and I will call the direct endpoints without opening a browser.");
      } else if (skill?.recorded) {
        addMessage("agent", "This recorded skill has learned questions and ranked endpoint candidates from the browser recording.");
        renderRecordedSkill(skill);
      } else {
        addMessage("agent", "This marketplace skill is a dummy listing for the demo. Only the term insurance comparison skill has a working endpoint adapter right now.");
      }
    });
  }
}

async function installActiveSkill() {
  const skill = state.skills.find((item) => item.id === state.activeSkillId);
  if (!skill) return;

  setProgress(30, "Buying marketplace skill");
  try {
    const data = await postJson("/api/marketplace/install", { skillId: skill.id });
    if (skill.real || skill.recorded) {
      state.installedSkillIds.add(skill.id);
      saveInstalledSkillIds();
    }
    updateInstallState();
    addMessage("agent", data.message);
    setProgress(skill.real ? 45 : 20, skill.real ? "Ready for quote questions" : skill.recorded ? "Recorded skill ready" : "Mock skill installed");
    if (skill.recorded) renderRecordedSkill(skill);
  } catch (error) {
    addMessage("agent", `Install failed: ${error.message}`);
    setProgress(0, "Install failed");
  }
}

async function runComparison(forceCached) {
  const skill = state.skills.find((item) => item.id === state.activeSkillId);
  if (!skill?.real) {
    if (skill?.recorded) {
      addMessage("agent", "This recorded skill is learned and summarized. Generic endpoint execution is not enabled yet, so I am showing the learned questions and endpoint candidates.");
      renderRecordedSkill(skill);
    } else {
      addMessage("agent", "Select the Term Plan Insurance Comparison skill first. The other listings are marketplace placeholders.");
    }
    return;
  }
  if (!isActiveSkillInstalled()) {
    addMessage("agent", "Buy the insurance comparison skill first, then I can run the endpoint workflow.");
    return;
  }

  const inputs = readFormInputs();
  state.lastInputs = inputs;
  addMessage(
    "user",
    `Compare term plans for ${money(inputs.coverageAmount)} cover, ${inputs.gender}, smoker: ${inputs.smoker}, DOB ${inputs.dateOfBirth}.`,
  );

  elements.runCompare.disabled = true;
  elements.runCached.disabled = true;
  elements.results.innerHTML = "";

  try {
    setProgress(35, "Collecting website-like quote inputs");
    await pause(180);
    setProgress(58, forceCached ? "Checking cached skill route" : "Calling learned endpoints");
    await pause(180);
    setProgress(78, "Normalizing quote outputs");

    const started = performance.now();
    const result = await postJson("/api/insurance/compare", { ...inputs, useCache: true });
    result.clientRoundTripMs = Math.round(performance.now() - started);
    setProgress(100, result.cache?.hit ? "Answered from cache" : "Endpoint comparison complete");
    addMessage("agent", result.summary);
    renderResults(result);
  } catch (error) {
    setProgress(0, "Comparison failed");
    addMessage("agent", `Comparison failed: ${error.message}`);
  } finally {
    elements.runCompare.disabled = false;
    elements.runCached.disabled = false;
  }
}

function readFormInputs() {
  const form = new FormData(elements.quoteForm);
  return {
    dateOfBirth: String(form.get("dateOfBirth") || "01/01/1990"),
    gender: String(form.get("gender") || "male"),
    smoker: String(form.get("smoker") || "no"),
    coverageAmount: Number(form.get("coverageAmount") || 500000),
    occupation: String(form.get("occupation") || "Accountant / Accounts Staff"),
    premiumFrequency: String(form.get("premiumFrequency") || "yearly"),
    termType: String(form.get("termType") || "renewable"),
  };
}

function renderResults(result) {
  const quotes = result.quotes || [];
  elements.results.innerHTML = `
    <section class="recommendation">
      <h3>${escapeHtml(result.recommendation?.headline || "Comparison complete")}</h3>
      <p>${escapeHtml(result.recommendation?.details || "")}</p>
      <p class="small-note">
        Server time: ${escapeHtml(String(result.timings?.totalMs ?? "-"))} ms.
        Browser-to-server round trip: ${escapeHtml(String(result.clientRoundTripMs ?? "-"))} ms.
        Cache: ${result.cache?.hit ? "hit" : "miss"}.
      </p>
      <p class="small-note">${escapeHtml(result.disclaimer || "")}</p>
    </section>

    <section class="quote-grid">
      ${quotes.map(renderQuoteCard).join("")}
    </section>

    <section class="endpoint-table">
      <h3>Learned endpoints used by this skill</h3>
      <p>This is the saved route knowledge the chatbot uses after the first Codex learning pass.</p>
      ${(result.learnedEndpoints || []).map(renderEndpointRow).join("")}
    </section>
  `;
}

function renderRecordedSkill(skill) {
  const questions = skill.questions || skill.analysis?.userQuestions || [];
  const endpoints = skill.importantEndpoints || skill.analysis?.importantEndpoints || [];
  const replayPlan = skill.replayPlan || skill.analysis?.replayPlan || {};
  elements.results.innerHTML = `
    <section class="recommendation">
      <h3>${escapeHtml(skill.name || "Recorded skill")}</h3>
      <p>${escapeHtml(skill.description || skill.goal || "")}</p>
      <p class="small-note">
        Source: ${escapeHtml(skill.source || "")}.
        Confidence: ${escapeHtml(String(skill.confidence ?? "-"))}.
        Strategy: ${escapeHtml(replayPlan.strategy || "manual_review")}.
      </p>
    </section>

    <section class="endpoint-table">
      <h3>Questions learned from the website</h3>
      ${questions.length ? questions.map(renderQuestionRow).join("") : "<p class=\"small-note\">No visible user questions were inferred from the recording.</p>"}
    </section>

    <section class="endpoint-table">
      <h3>Endpoint candidates from the recording</h3>
      ${endpoints.length ? endpoints.map(renderRecordedEndpointRow).join("") : "<p class=\"small-note\">No reusable endpoint candidate was found. This skill may need browser replay.</p>"}
    </section>
  `;
}

function renderQuestionRow(question) {
  const options = question.options?.length ? ` Options: ${question.options.map(escapeHtml).join(", ")}` : "";
  return `
    <div class="endpoint-row">
      <div>
        <strong>${escapeHtml(question.label || question.question)}</strong><br />
        <p class="small-note">${escapeHtml(question.question || "")}${options}</p>
        <p class="small-note">${escapeHtml(question.sourceEvidence || "")}</p>
      </div>
      <span>${escapeHtml(question.inputType || "text")}</span>
    </div>
  `;
}

function renderRecordedEndpointRow(endpoint) {
  return `
    <div class="endpoint-row">
      <div>
        <strong>${escapeHtml(endpoint.purpose || "Candidate endpoint")}</strong><br />
        <code>${escapeHtml(endpoint.method || "GET")} ${escapeHtml(endpoint.url || "")}</code>
        <p class="small-note">${escapeHtml(endpoint.whyRelevant || "")}</p>
        <p class="small-note">${escapeHtml(endpoint.requestShape || "")}</p>
      </div>
      <span>${escapeHtml(String(endpoint.confidence ?? "-"))}</span>
    </div>
  `;
}

function renderQuoteCard(quote) {
  const hasPrice = Number.isFinite(Number(quote.yearlyPremium));
  return `
    <article class="quote-card ${quote.status === "error" ? "error" : ""}">
      <div class="quote-head">
        <div>
          <h3>${escapeHtml(quote.provider)}</h3>
          <p>${escapeHtml(quote.planName || "")}</p>
        </div>
        <span class="quote-tag">${escapeHtml(quote.source || "")}</span>
      </div>
      <div class="price">
        ${hasPrice ? money(quote.yearlyPremium) : "Unavailable"}
        <span>/ year</span>
      </div>
      <div class="quote-details">
        <div><strong>Monthly:</strong> ${hasPrice ? money(quote.monthlyPremium) : "-"}</div>
        <div><strong>Cover:</strong> ${quote.sumAssured ? money(quote.sumAssured) : "-"}</div>
        <div><strong>Endpoint:</strong> ${escapeHtml(quote.endpoint || "-")}</div>
        <div><strong>Time:</strong> ${escapeHtml(String(quote.timingMs ?? "-"))} ms</div>
        <div><strong>Note:</strong> ${escapeHtml(quote.warning || quote.discountNote || "-")}</div>
      </div>
    </article>
  `;
}

function renderEndpointRow(endpoint) {
  return `
    <div class="endpoint-row">
      <div>
        <strong>${escapeHtml(endpoint.provider)}</strong><br />
        <code>${escapeHtml(endpoint.method)} ${escapeHtml(endpoint.url)}</code>
        <p class="small-note">${escapeHtml(endpoint.purpose)}</p>
      </div>
      <span>${escapeHtml(endpoint.status)}</span>
    </div>
  `;
}

function updateInstallState() {
  const skill = state.skills.find((item) => item.id === state.activeSkillId);
  const installed = isActiveSkillInstalled();
  const runnable = skill?.real || skill?.recorded;
  elements.installState.textContent = installed ? "Installed" : "Not installed";
  elements.installState.classList.toggle("live", installed);
  elements.buySkill.disabled = installed || !runnable;
  elements.runCompare.disabled = !installed || !runnable;
  elements.runCached.disabled = !installed || !skill?.real;
  elements.runCompare.textContent = skill?.recorded ? "Show learned skill" : "Compare quotes";
}

function toggleRegisterPanel() {
  elements.registerSkillForm.hidden = !elements.registerSkillForm.hidden;
  if (!elements.registerSkillForm.hidden) {
    elements.recordWebsiteLink.focus();
    addMessage("agent", "Send me the website link and what the skill should do. I will open Chrome and record your workflow.");
  }
}

async function startSkillRecording(event) {
  event.preventDefault();
  const websiteLink = elements.recordWebsiteLink.value.trim();
  const description = elements.recordDescription.value.trim();
  if (!websiteLink || !description) {
    addMessage("agent", "Website link and description are both required before I can record a skill.");
    return;
  }

  elements.startRecording.disabled = true;
  elements.finishRecording.disabled = true;
  elements.cancelRecording.disabled = false;
  setProgress(18, "Starting browser recorder");
  addMessage("user", `Register a new skill for ${websiteLink}: ${description}`);

  try {
    const result = await postJson("/api/skills/record/start", { websiteLink, description });
    state.recordingSessionId = result.sessionId;
    elements.finishRecording.disabled = false;
    setProgress(45, "Recording skill in Chrome");
    addMessage("agent", result.message || "I am recording the skill. Complete the workflow in Chrome, then click Finish recording here.");
  } catch (error) {
    elements.startRecording.disabled = false;
    setProgress(0, "Recording failed to start");
    addMessage("agent", `Recording failed to start: ${error.message}`);
  }
}

async function finishSkillRecording() {
  if (!state.recordingSessionId) return;
  elements.finishRecording.disabled = true;
  setProgress(72, "Analyzing recording with NVIDIA Nemotron 3");
  addMessage("agent", "I am reading the recorded actions, visible page fields, network requests, and response snippets. Nemotron will turn that into clean skill questions and endpoint candidates.");

  try {
    const result = await postJson("/api/skills/record/finish", { sessionId: state.recordingSessionId });
    state.recordingSessionId = null;
    elements.startRecording.disabled = false;
    elements.cancelRecording.disabled = false;
    setProgress(100, "Skill registered");
    addMessage("agent", result.message);
    await loadSkills();
    state.activeSkillId = result.skill.id;
    state.installedSkillIds.add(result.skill.id);
    saveInstalledSkillIds();
    elements.activeSkillTitle.textContent = result.skill.name;
    renderSkills();
    updateInstallState();
    renderRecordedSkill(result.skill);
  } catch (error) {
    elements.startRecording.disabled = false;
    setProgress(0, "Analysis failed");
    addMessage("agent", `Recording analysis failed: ${error.message}`);
  }
}

async function cancelSkillRecording() {
  elements.registerSkillForm.hidden = true;
  if (!state.recordingSessionId) return;
  try {
    await postJson("/api/skills/record/cancel", { sessionId: state.recordingSessionId });
  } catch {
    // best effort
  }
  state.recordingSessionId = null;
  elements.startRecording.disabled = false;
  elements.finishRecording.disabled = true;
  setProgress(0, "Recording cancelled");
  addMessage("agent", "Recording cancelled.");
}

function setProgress(percent, text) {
  elements.progressFill.style.width = `${percent}%`;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressText.textContent = text;
}

function addMessage(role, text) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = text;
  elements.chatLog.appendChild(node);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function isActiveSkillInstalled() {
  return state.installedSkillIds.has(state.activeSkillId);
}

function loadInstalledSkillIds() {
  const ids = new Set();
  try {
    for (const id of JSON.parse(localStorage.getItem("cairn-installed-skills") || "[]")) ids.add(id);
  } catch {
    // ignore
  }
  if (localStorage.getItem("cairn-installed-term-skill") === "1") ids.add(REAL_SKILL_ID);
  return ids;
}

function saveInstalledSkillIds() {
  localStorage.setItem("cairn-installed-skills", JSON.stringify([...state.installedSkillIds]));
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${response.status} ${response.statusText}`);
  return data;
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function money(value) {
  return `S$${Number(value || 0).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
