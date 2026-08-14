const fallbackAssistantError = "Model request failed before producing a response";

function textContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(item => item.type === "text")
    .map(item => item.text)
    .join("");
}

function assistantError(errorMessage) {
  const value = String(errorMessage ?? "").trim();
  return value || fallbackAssistantError;
}

export function projectAssistantMessageEnd(message, { textStreamed = false } = {}) {
  const content = textContent(message);
  const stopReason = message?.stopReason ?? "stop";
  const hasToolCall = Array.isArray(message?.content)
    && message.content.some(item => item.type === "toolCall");
  const events = [];

  if (content || textStreamed) {
    events.push({
      type: stopReason === "toolUse" || hasToolCall
        ? "message_segment_done"
        : "message_done",
      data: {
        reason: stopReason,
        content,
      },
    });
  }

  if (stopReason === "error") {
    events.push({
      type: "error",
      data: { error: assistantError(message?.errorMessage) },
    });
  }

  return events;
}
