import { compressSemanticMemories } from "../companion/context-assembly.js";

export const USER_MEMORY_CUSTOM_TYPE = "milksu.user-memory";
export const USER_MEMORY_TOKEN_BUDGET = 2_000;
export const COMPANION_RELAY_PREFIX = "看板娘转达 / Companion relay:\n";

const PROBE_PREFIXES = ["milksu_text_projection_", "milksu_model_probe_"];

export function tracksUserMemory(conversationId) {
  const id = String(conversationId ?? "").trim();
  if (!id) return false;
  return !PROBE_PREFIXES.some(prefix => id.startsWith(prefix));
}

export function isCompanionRelay(text) {
  return String(text ?? "").startsWith(COMPANION_RELAY_PREFIX);
}

export function userMemoryBody(memories, budget = USER_MEMORY_TOKEN_BUDGET) {
  let packed;
  try {
    packed = compressSemanticMemories(memories, budget);
  } catch {
    return "";
  }
  return (packed?.items ?? []).map(item => String(item?.text ?? "").trim()).filter(Boolean).join("\n");
}

export function withUserMemoryMessages(messages, memories, { locale } = {}) {
  const source = Array.isArray(messages) ? messages : [];
  const kept = source.filter(message => message?.customType !== USER_MEMORY_CUSTOM_TYPE);
  const body = userMemoryBody(memories);
  if (!body) return kept;
  const label = locale === "en" ? "User memory" : "用户记忆";
  return [{
    role: "custom",
    customType: USER_MEMORY_CUSTOM_TYPE,
    content: [{ type: "text", text: `${label}\n${body}` }],
    display: false,
    details: {},
    timestamp: new Date().toISOString(),
  }, ...kept];
}

export function applyUserMemorySnapshot(state, memories, revision) {
  const currentRevision = Number.isFinite(state?.revision) ? state.revision : -1;
  const currentMemories = Array.isArray(state?.memories) ? state.memories : [];
  if (!Array.isArray(memories)) {
    return { memories: currentMemories, revision: currentRevision, applied: false };
  }
  const nextRevision = Number(revision);
  if (!Number.isFinite(nextRevision) || nextRevision < currentRevision) {
    return { memories: currentMemories, revision: currentRevision, applied: false };
  }
  return { memories, revision: nextRevision, applied: true };
}

export function lastAssistantText(session) {
  const messages = session?.messages;
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const content = message.content;
    if (typeof content === "string") return content.trim();
    if (!Array.isArray(content)) return "";
    return content.map(block => String(block?.text ?? "")).join("").trim();
  }
  return "";
}
