export function companionAssistantTurnError(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const row = messages[index];
    const message = row?.message && typeof row.message === "object" ? row.message : row;
    if (message?.role !== "assistant") continue;
    if (message.stopReason === "error") {
      return String(message.errorMessage ?? "").trim() || "companion model call failed";
    }
    const hasWork = Array.isArray(message.content)
      && message.content.some(block => (
        String(block?.text ?? "").trim()
        || block?.type === "toolCall"
        || String(block?.thinking ?? "").trim()
      ));
    if (!hasWork) {
      return String(message.errorMessage ?? "").trim() || "companion model returned no text";
    }
    return "";
  }
  return "";
}
