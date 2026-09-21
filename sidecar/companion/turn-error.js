export function unwrapCompanionMessage(row) {
  if (row?.message && typeof row.message === "object") return row.message;
  return row;
}

function toolCallIdsFromAssistant(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .filter(block => block?.type === "toolCall")
    .map(block => String(block.id ?? "").trim())
    .filter(Boolean);
}

/**
 * Same failure mode the main chat hits when toolCalls never got toolResults:
 * the next model call rejects with a broken tool history. Detect before prompt
 * so the phone can offer "开新对话" instead of raw provider text.
 */
export function companionToolHistoryBroken(messages) {
  if (!Array.isArray(messages)) return false;
  const pending = new Set();
  for (const row of messages) {
    const message = unwrapCompanionMessage(row);
    const role = message?.role;
    if (role === "assistant") {
      for (const id of toolCallIdsFromAssistant(message)) pending.add(id);
      continue;
    }
    if (role === "toolResult" || role === "tool") {
      const id = String(message.toolCallId ?? message.tool_call_id ?? "").trim();
      if (id) pending.delete(id);
      continue;
    }
    if (role === "user" && pending.size > 0) return true;
  }
  return pending.size > 0;
}

export function companionAssistantTurnError(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = unwrapCompanionMessage(messages[index]);
    if (message?.role !== "assistant") continue;
    if (message.stopReason === "error") {
      return String(message.errorMessage ?? "").trim() || "companion model call failed";
    }
    // toolUse / unfinished tool rounds still have visible work for the phone UI.
    if (message.stopReason === "toolUse") return "";
    if (assistantHasVisibleWork(message)) return "";
    return String(message.errorMessage ?? "").trim() || "companion model returned no text";
  }
  return "";
}

function assistantHasVisibleWork(message) {
  if (!Array.isArray(message?.content)) return false;
  return message.content.some(block => {
    if (!block || typeof block !== "object") return false;
    if (String(block.text ?? "").trim()) return true;
    if (block.type === "toolCall") return true;
    if (block.type === "thinking" || String(block.thinking ?? "").trim()) return true;
    return false;
  });
}

