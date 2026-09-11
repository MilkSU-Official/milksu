export const codingAskToolName = "milksu_ask";
export const askOtherChoiceId = "other";
export const askOtherChoicePrefix = "other:";

export function encodeAskOtherChoice(text) {
  return `${askOtherChoicePrefix}${String(text ?? "").trim()}`;
}

export function decodeAskOtherChoice(choice) {
  const raw = String(choice ?? "");
  if (!raw.startsWith(askOtherChoicePrefix)) return "";
  return raw.slice(askOtherChoicePrefix.length).trim();
}

export function resolveAskChoice(options, choice, approved = true) {
  if (!approved) return null;
  const other = decodeAskOtherChoice(choice);
  if (other) return { id: askOtherChoiceId, label: other };
  const selected = String(choice ?? "").trim();
  if (!selected) return null;
  const list = Array.isArray(options) ? options : [];
  return list.find(item => item?.id === selected) ?? null;
}

export function formatAskSelection(picked) {
  if (!picked) return "The user dismissed the question.";
  if (picked.id === askOtherChoiceId) {
    return `The user entered: "${String(picked.label ?? "").trim()}"`;
  }
  return `The user selected "${picked.label}" (${picked.id}).`;
}

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
    if (!id || id === askOtherChoiceId) id = `option-${options.length + 1}`;
    while (used.has(id) || id === askOtherChoiceId) id = `${id}-${options.length + 1}`;
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
