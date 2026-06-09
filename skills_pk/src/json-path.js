export function getPath(input, pathExpression) {
  if (!pathExpression || pathExpression === "$") return input;
  const path = pathExpression.startsWith("$.") ? pathExpression.slice(2) : pathExpression;
  const parts = [];
  path.replace(/([^[.\]]+)|\[(\d+)\]/g, (_, key, index) => {
    parts.push(key ?? Number(index));
  });
  return parts.reduce((current, part) => current?.[part], input);
}

export function flattenScalars(input, prefix = "$") {
  const rows = [];
  if (input === null || typeof input !== "object") {
    rows.push({ path: prefix, value: input });
    return rows;
  }

  if (Array.isArray(input)) {
    input.forEach((value, index) => {
      rows.push(...flattenScalars(value, `${prefix}[${index}]`));
    });
    return rows;
  }

  for (const [key, value] of Object.entries(input)) {
    rows.push(...flattenScalars(value, `${prefix}.${key}`));
  }
  return rows;
}
