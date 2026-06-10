export function applyComputedInputs(skill, inputs, now = new Date()) {
  const context = { ...inputs };
  for (const [name, spec] of Object.entries(skill.computed || {})) {
    context[name] = computeValue(spec, context, now);
  }
  return context;
}

export function renderTemplate(value, context) {
  if (Array.isArray(value)) {
    return value
      .map((item) => renderTemplate(item, context))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    if (value.$when && !truthy(context[value.$when])) return undefined;
    if (Object.keys(value).length === 1 && typeof value.$value === "string") {
      return resolveExpression(value.$value, context);
    }

    const output = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "$when") continue;
      const rendered = renderTemplate(child, context);
      if (rendered !== undefined) output[key] = rendered;
    }
    return output;
  }

  if (typeof value !== "string") return value;
  return renderString(value, context);
}

export function renderString(value, context) {
  const exact = value.match(/^{{\s*([\w.-]+)\s*}}$/);
  if (exact) return resolveName(exact[1], context);
  return value.replace(/{{\s*([\w.-]+)\s*}}/g, (_, name) => {
    const resolved = resolveName(name, context);
    return resolved === undefined || resolved === null ? "" : String(resolved);
  });
}

function resolveExpression(expression, context) {
  const exact = expression.match(/^{{\s*([\w.-]+)\s*}}$/);
  if (!exact) return renderString(expression, context);
  return resolveName(exact[1], context);
}

function resolveName(name, context) {
  return name.split(".").reduce((current, key) => current?.[key], context);
}

function computeValue(spec, context, now) {
  switch (spec.fn) {
    case "uuid":
      return crypto.randomUUID();
    case "count":
      return countValue(context[spec.input]);
    case "dateFormat":
      return formatDate(context[spec.input], spec.format);
    case "ageNextBirthday":
      return ageNextBirthday(context[spec.input], now);
    default:
      throw new Error(`Unknown computed function: ${spec.fn}`);
  }
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  if (value === undefined || value === null || value === "") return 0;
  return 1;
}

function formatDate(value, format) {
  const date = parseDate(value);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());

  switch (format) {
    case "DD-MM-YYYY":
      return `${dd}-${mm}-${yyyy}`;
    case "DDMMYYYY":
      return `${dd}${mm}${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    default:
      throw new Error(`Unsupported date format: ${format}`);
  }
}

function ageNextBirthday(value, now) {
  const dob = parseDate(value);
  let age = now.getFullYear() - dob.getFullYear();
  if (dob.getMonth() < now.getMonth()) age += 1;
  if (dob.getMonth() === now.getMonth() && dob.getDate() < now.getDate()) age += 1;
  return age;
}

function parseDate(value) {
  if (value instanceof Date) return value;
  if (typeof value !== "string") throw new Error(`Expected date string, got ${typeof value}`);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Expected date in YYYY-MM-DD format: ${value}`);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function truthy(value) {
  if (value === undefined || value === null) return false;
  if (value === "") return false;
  if (value === false) return false;
  return true;
}
