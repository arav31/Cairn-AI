export async function collectPlaywrightEvidence({ port, timeoutMs = 8000 } = {}) {
  let browser;
  const started = Date.now();
  try {
    const { chromium } = await import("playwright-core");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: timeoutMs });
    const context = browser.contexts()[0];
    const page = context?.pages().find((candidate) => !candidate.url().startsWith("about:")) || context?.pages()[0];
    if (!page) throw new Error("No Playwright page found for connected Chrome session.");

    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 3000) }).catch(() => {});
    const dom = await page.evaluate(playwrightDomSnapshot);
    const roleCounts = await collectRoleCounts(page);
    const accessibility = await collectAccessibilitySnapshot(page);

    return {
      enabled: true,
      ms: Date.now() - started,
      url: page.url(),
      title: await page.title().catch(() => dom.title || ""),
      roleCounts,
      accessibility,
      ...dom,
    };
  } catch (error) {
    return {
      enabled: false,
      ms: Date.now() - started,
      error: error.message,
    };
  } finally {
    browser?.disconnect?.();
  }
}

async function collectRoleCounts(page) {
  const roles = ["button", "radio", "checkbox", "combobox", "textbox", "spinbutton", "listbox", "option", "tab", "link"];
  const counts = {};
  for (const role of roles) {
    counts[role] = await page.getByRole(role).count().catch(() => 0);
  }
  return counts;
}

async function collectAccessibilitySnapshot(page) {
  try {
    const snapshot = await page.accessibility?.snapshot?.({ interestingOnly: true });
    return snapshot ? compactAccessibilityNode(snapshot) : null;
  } catch {
    return null;
  }
}

function compactAccessibilityNode(node, depth = 0) {
  if (!node || depth > 4) return null;
  const output = {
    role: node.role || "",
    name: compactText(node.name || "", 120),
  };
  if (node.value !== undefined) output.value = compactText(node.value, 80);
  if (node.checked !== undefined) output.checked = node.checked;
  if (node.selected !== undefined) output.selected = node.selected;
  const children = (node.children || []).map((child) => compactAccessibilityNode(child, depth + 1)).filter(Boolean);
  if (children.length) output.children = children.slice(0, 30);
  return output;
}

function playwrightDomSnapshot() {
  const CONTROL_SELECTOR = "input, select, textarea, button, a, [role='button'], [role='radio'], [role='checkbox'], [role='combobox'], [role='option'], [role='textbox'], [role='spinbutton'], [role='switch'], [contenteditable='true']";
  const compact = (value, limit = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  const cssEscape = (value) => {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\#.;?+*~':!^$[\]()=>|/@]/g, "\\$&");
  };
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const selectorFor = (element) => {
    if (!element || !element.tagName) return "";
    if (element.id) return "#" + cssEscape(element.id);
    if (element.getAttribute("name")) return `${element.tagName.toLowerCase()}[name="${String(element.getAttribute("name")).replace(/"/g, "\\\"")}"]`;
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(" > ");
  };
  const labelFor = (element) => {
    if (element.labels && element.labels.length) {
      return compact(Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" "), 160);
    }
    if (element.id) {
      const explicit = Array.from(document.querySelectorAll("label")).find((label) => label.htmlFor === element.id);
      if (explicit) return compact(explicit.innerText || explicit.textContent || "", 160);
    }
    const wrapping = element.closest("label");
    if (wrapping) return compact(wrapping.innerText || wrapping.textContent || "", 160);
    return compact(element.getAttribute("aria-label") || element.getAttribute("placeholder") || "", 160);
  };
  const labelledByText = (element) => compact(String(element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
    .filter(Boolean)
    .join(" "), 160);
  const textWithoutControls = (element) => {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll(CONTROL_SELECTOR).forEach((control) => control.remove());
    return compact(clone.innerText || clone.textContent || "", 200);
  };
  const groupFor = (element) => element.closest("fieldset, [role='radiogroup'], [role='group'], form, section, article, .form-group, .field, .question, .control-group") || element.parentElement;
  const promptFor = (element) => {
    const direct = compact(labelFor(element) || labelledByText(element), 160);
    if (direct) return direct;
    const group = groupFor(element);
    const legend = group?.querySelector?.("legend");
    if (legend) return compact(legend.innerText || legend.textContent || "", 160);
    const aria = compact(group?.getAttribute?.("aria-label") || labelledByText(group) || "", 160);
    if (aria) return aria;
    const heading = group ? Array.from(group.querySelectorAll("h1,h2,h3,h4,h5,h6,label,[aria-label]"))
      .map((item) => compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 160))
      .filter(Boolean)[0] : "";
    if (heading) return heading;
    return textWithoutControls(group);
  };
  const optionGroupFor = (element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === "select") {
      return Array.from(element.options).map((option) => ({
        label: compact(option.textContent || "", 120),
        value: option.value || compact(option.textContent || "", 120),
        selected: option.selected,
      }));
    }
    const role = element.getAttribute("role") || "";
    const type = (element.getAttribute("type") || "").toLowerCase();
    if (tag === "textarea" || (tag === "input" && !["radio", "checkbox", "button"].includes(type)) || role === "textbox" || role === "spinbutton") return [];
    const group = element.closest("[role='radiogroup'], [role='group'], fieldset") || element.parentElement;
    if (!group) return [];
    return Array.from(group.querySelectorAll(CONTROL_SELECTOR)).slice(0, 40).map((item) => ({
      label: compact(item.innerText || item.textContent || item.getAttribute("aria-label") || item.value || "", 120),
      value: item.value || item.getAttribute("data-value") || compact(item.innerText || item.textContent || item.getAttribute("aria-label") || "", 120),
      selected: Boolean(item.checked || item.selected || item.getAttribute("aria-pressed") === "true" || item.getAttribute("aria-checked") === "true" || item.getAttribute("aria-selected") === "true"),
      selector: selectorFor(item),
    })).filter((option) => option.label || option.value);
  };
  const valueFor = (element) => element.value || element.getAttribute("aria-valuetext") || element.getAttribute("aria-value") || element.getAttribute("data-value") || element.getAttribute("value") || "";

  const controls = Array.from(document.querySelectorAll(CONTROL_SELECTOR))
    .filter((element, index, all) => all.indexOf(element) === index && isVisible(element))
    .slice(0, 250)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      name: element.getAttribute("name") || "",
      id: element.id || "",
      selector: selectorFor(element),
      label: labelFor(element),
      promptText: promptFor(element),
      placeholder: element.getAttribute("placeholder") || "",
      text: compact(element.innerText || element.textContent || "", 160),
      value: valueFor(element),
      checked: Boolean(element.checked || element.getAttribute("aria-checked") === "true" || element.getAttribute("aria-pressed") === "true"),
      visible: true,
      options: optionGroupFor(element),
    }));

  const forms = Array.from(document.querySelectorAll("form, fieldset, [role='group'], [role='radiogroup']"))
    .filter(isVisible)
    .slice(0, 40)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      selector: selectorFor(element),
      promptText: promptFor(element),
      text: compact(textWithoutControls(element), 500),
      controlCount: element.querySelectorAll(CONTROL_SELECTOR).length,
    }));

  return {
    title: document.title,
    text: compact(document.body?.innerText || "", 5000),
    controls,
    forms,
  };
}

function compactText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
