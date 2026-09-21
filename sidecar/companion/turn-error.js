export function unwrapCompanionMessage(row) {
  if (row?.message && typeof row.message === "object") return row.message;
  return row;
}

/** In-flight Pi HTTP abort (AbortCompanionTurn / StopCompanion / recover). */
export function companionRequestAborted(reason) {
  return /abort\s*error|request aborted|this operation was aborted|the operation was aborted|operation was aborted/i
    .test(String(reason ?? ""));
}

function toolCallIdsFromAssistant(message) {
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return [];
  return message.content
    .filter(block => block?.type === "toolCall")
    .map(block => ({
      id: String(block.id ?? "").trim(),
      name: String(block.name ?? "tool").trim() || "tool",
    }))
    .filter(item => item.id);
}

/**
 * Pending toolCall ids that never received a matching toolResult.
 * Same failure mode the main chat hits when abort/timeout interrupts a tool
 * batch: Pi can leave assistant(toolCall) without toolResult, and the next
 * provider call rejects with a broken tool history.
 */
export function companionPendingToolCalls(messages) {
  if (!Array.isArray(messages)) return [];
  const pending = new Map();
  for (const row of messages) {
    const message = unwrapCompanionMessage(row);
    const role = message?.role;
    if (role === "assistant") {
      for (const call of toolCallIdsFromAssistant(message)) {
        pending.set(call.id, call);
      }
      continue;
    }
    if (role === "toolResult" || role === "tool") {
      const id = String(message.toolCallId ?? message.tool_call_id ?? "").trim();
      if (id) pending.delete(id);
    }
  }
  return [...pending.values()];
}

export function companionToolHistoryBroken(messages) {
  return companionPendingToolCalls(messages).length > 0;
}

/**
 * Synthetic error toolResults for dangling toolCalls — same pattern Pi uses
 * for truncated tool batches (`createErrorToolResult` / failToolCallsFromTruncatedMessage).
 * Prefer this over archiving / forcing 「开新对话」.
 */
export function companionSyntheticToolResult(call, reason = "companion tool interrupted") {
  const toolName = String(call?.name ?? "tool").trim() || "tool";
  const toolCallId = String(call?.id ?? "").trim();
  const text = String(reason || "companion tool interrupted").trim() || "companion tool interrupted";
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    details: { repaired: true, reason: text },
    isError: true,
    timestamp: Date.now(),
  };
}

/**
 * Returns a new message list with synthetic toolResults appended for every
 * orphan toolCall. Does not mutate the input array.
 */
export function repairCompanionToolHistory(messages, reason = "companion tool interrupted") {
  const source = Array.isArray(messages) ? messages : [];
  const pending = companionPendingToolCalls(source);
  if (!pending.length) {
    return { messages: source, repaired: [], repairedCount: 0 };
  }
  const repairs = pending.map(call => companionSyntheticToolResult(call, reason));
  return {
    messages: [...source, ...repairs],
    repaired: repairs,
    repairedCount: repairs.length,
  };
}

export function companionAssistantTurnError(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = unwrapCompanionMessage(messages[index]);
    if (message?.role !== "assistant") continue;
    const contentText = Array.isArray(message.content)
      ? message.content.map(block => String(block?.text ?? "")).join("\n")
      : "";
    if (
      companionRequestAborted(message.errorMessage)
      || companionRequestAborted(message.stopReason)
      || companionRequestAborted(contentText)
    ) {
      // AbortCompanionTurn / recover teardown. Phone maps this to 「这一轮已取消」.
      return "";
    }
    if (message.stopReason === "error") {
      return String(message.errorMessage ?? "").trim() || "companion model call failed";
    }
    // User / AbortCompanionTurn stop — not an empty-reply failure; transcript is repaired.
    if (message.stopReason === "aborted") return "";
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
