export const codingAskToolName = "milksu_ask";

export function normalizeAskOptions(value) {
  const raw = Array.isArray(value) ? value : [];
  const options = [];
  const used = new Set();
  for (const item of raw) {
    if (options.length >= 6) break;
    const record = item && typeof item === "object" ? item : { label: item };
    const label = String(record.label ?? record.text ?? "").trim().slice(0, 80);
    if (!label) continue;
    let id = String(record.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    if (!id) id = `option-${options.length + 1}`;
    while (used.has(id)) id = `${id}-${options.length + 1}`;
    used.add(id);
    const detail = String(record.detail ?? record.description ?? "").trim().slice(0, 160);
    options.push(detail ? { id, label, detail } : { id, label });
  }
  return options;
}

export function formatAskToolInput(question, options) {
  const lines = [String(question ?? "").trim(), ...options.map((item) => (
    item.detail ? `${item.label} — ${item.detail}` : item.label
  ))];
  return lines.filter(Boolean).join("\n");
}
