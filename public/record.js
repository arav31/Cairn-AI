/* Record a workflow: submit a recording or kick off a sandbox demo. */

const $ = (id) => document.getElementById(id);

function setStatus(id, message, tone = "ok") {
  const node = $(id);
  node.textContent = message || "";
  node.dataset.tone = tone;
}

async function ensureSession() {
  const session = getSession();
  if (session.agentKey) return true;
  const accountId = session.accountId || "demo-user";
  const result = await cairnFetch("/api/accounts", {
    method: "POST",
    body: { accountId },
    auth: false
  });
  if (result.ok) {
    applyAgentAuth(result.payload);
    return true;
  }
  return false;
}

async function submitRecording(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));

  if (!(await ensureSession())) {
    setStatus("record-status", "Open Settings to enter your agent key before recording.", "warn");
    return;
  }

  const result = await cairnFetch("/api/workflows/recordings", {
    method: "POST",
    body: {
      title: data.title,
      targetUrl: data.targetUrl || null,
      goal: data.goal,
      artifacts: []
    }
  });

  if (result.status === 401) {
    setStatus("record-status", "Your session expired. Open Settings to re-enter your agent key.", "warn");
    return;
  }
  if (result.ok) {
    setStatus(
      "record-status",
      "Recording received. Cairn is compiling it into your API — it'll appear in My APIs as Verifying, then go Active once it passes end-to-end checks.",
      "ok"
    );
    form.reset();
  } else {
    setStatus("record-status", "Something went wrong. Please try again.", "warn");
  }
}

async function runDemo(target) {
  if (!(await ensureSession())) {
    setStatus("demo-status", "Open Settings to enter your agent key before recording.", "warn");
    return;
  }
  const label = target === "civic" ? "Civic Records" : "Meridian CRM";
  setStatus("demo-status", `Starting the ${label} sandbox recording…`, "muted");
  const result = await cairnFetch("/api/demo/record", {
    method: "POST",
    body: { target }
  });
  if (result.ok) {
    setStatus(
      "demo-status",
      `${label} recording started. It'll appear in My APIs in a second or two.`,
      "ok"
    );
  } else {
    setStatus("demo-status", "Could not start the sandbox demo. Make sure demo APIs are enabled.", "warn");
  }
}

function init() {
  $("record-form").addEventListener("submit", submitRecording);
  $("demo-meridian").addEventListener("click", () => runDemo("meridian"));
  $("demo-civic").addEventListener("click", () => runDemo("civic"));
  ensureSession();
}

init();
