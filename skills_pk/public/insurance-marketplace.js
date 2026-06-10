const REAL_SKILL_ID = "term-plan-insurance-comparison";

const state = {
  skills: [],
  installed: localStorage.getItem("cairn-installed-term-skill") === "1",
  activeSkillId: REAL_SKILL_ID,
  lastInputs: null,
};

const elements = {
  serverStatus: document.querySelector("#serverStatus"),
  skillsList: document.querySelector("#skillsList"),
  skillSearch: document.querySelector("#skillSearch"),
  refreshSkills: document.querySelector("#refreshSkills"),
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
  } catch (error) {
    elements.serverStatus.textContent = "Offline";
    addMessage("agent", `Marketplace server is not reachable: ${error.message}`);
  } finally {
    setProgress(state.installed ? 20 : 0, state.installed ? "Skill installed" : "Waiting for skill purchase");
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
      const statusClass = skill.real ? "live" : "mock";
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
            <span>${skill.real ? "endpoint-backed" : "mock"}</span>
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
    if (skill.real) {
      state.installed = true;
      localStorage.setItem("cairn-installed-term-skill", "1");
    }
    updateInstallState();
    addMessage("agent", data.message);
    setProgress(skill.real ? 45 : 20, skill.real ? "Ready for quote questions" : "Mock skill installed");
  } catch (error) {
    addMessage("agent", `Install failed: ${error.message}`);
    setProgress(0, "Install failed");
  }
}

async function runComparison(forceCached) {
  const skill = state.skills.find((item) => item.id === state.activeSkillId);
  if (!skill?.real) {
    addMessage("agent", "Select the Term Plan Insurance Comparison skill first. The other listings are marketplace placeholders.");
    return;
  }
  if (!state.installed) {
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
  const isReal = !skill || skill.id === REAL_SKILL_ID;
  elements.installState.textContent = state.installed && isReal ? "Installed" : "Not installed";
  elements.installState.classList.toggle("live", state.installed && isReal);
  elements.buySkill.disabled = state.installed && isReal;
  elements.runCompare.disabled = !state.installed || !isReal;
  elements.runCached.disabled = !state.installed || !isReal;
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
