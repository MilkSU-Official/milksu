function lastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messages[index];
  }
  return undefined;
}

function textContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(item => item.type === "text")
    .map(item => String(item.text ?? ""))
    .join("");
}

function thinkingContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(item => item.type === "thinking" && !item.redacted)
    .map(item => String(item.thinking ?? ""))
    .join("");
}

export const reasoningOnlyRecoveryCustomType = "milksu-reasoning-only-recovery";

export function reasoningOnlyRecoveryPrompt(uiLocale) {
  if (String(uiLocale ?? "").trim() !== "en") {
    return "上一回合没有对用户可见的回复。根据已经完成的工作，只输出一段简短的最终答复。不要调用工具。";
  }
  return "The previous turn produced no user-visible reply. "
    + "Based on the work already completed, output only a short final answer. "
    + "Do not call tools.";
}

export function reasoningOnlyRecoveryMessage(uiLocale) {
  return {
    customType: reasoningOnlyRecoveryCustomType,
    content: reasoningOnlyRecoveryPrompt(uiLocale),
    display: false,
  };
}

export function shouldRecoverReasoningOnlyTurn({
  stopReason,
  text,
  thinking,
  hasToolCall,
} = {}) {
  if (String(stopReason ?? "stop") !== "stop") return false;
  if (hasToolCall) return false;
  if (String(text ?? "").trim()) return false;
  return Boolean(String(thinking ?? "").trim());
}

export function isReasoningOnlyFinal(message) {
  if (!message || message.role !== "assistant") return false;
  const content = Array.isArray(message.content) ? message.content : [];
  return shouldRecoverReasoningOnlyTurn({
    stopReason: message.stopReason ?? "stop",
    text: textContent(message),
    thinking: thinkingContent(message),
    hasToolCall: content.some(item => item.type === "toolCall"),
  });
}

export function summarizeReasoningOnlyFinal(message, extra = {}) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return {
    stopReason: message?.stopReason ?? "stop",
    reasoningChars: thinkingContent(message).length,
    contentChars: textContent(message).length,
    toolCallCount: content.filter(item => item.type === "toolCall").length,
    outputTokens: Number(message?.usage?.output ?? 0),
    reasoningTokens: Number(message?.usage?.reasoning ?? 0),
    provider: extra.provider ? String(extra.provider) : undefined,
    model: extra.model ? String(extra.model) : undefined,
  };
}

export function logReasoningOnlyFinal(summary) {
  process.stderr.write(`${JSON.stringify({
    type: "reasoning-only-final",
    ...summary,
  })}\n`);
}

export function createReasoningOnlyRecoveryExtension({
  isAborted,
  wasRecovered,
  markRecovered,
  applyNoTools,
  restoreTools,
  getUiLocale,
} = {}) {
  return (pi) => {
    pi.on("agent_end", async (event) => {
      if (isAborted?.()) {
        restoreTools?.();
        return;
      }
      if (wasRecovered?.()) {
        restoreTools?.();
        return;
      }
      const last = lastAssistantMessage(event?.messages);
      if (!isReasoningOnlyFinal(last)) return;
      markRecovered?.();
      applyNoTools?.();
      logReasoningOnlyFinal(summarizeReasoningOnlyFinal(last, {
        provider: last.provider,
        model: last.model,
      }));
      pi.sendMessage(reasoningOnlyRecoveryMessage(getUiLocale?.()), {
        deliverAs: "followUp",
        triggerTurn: true,
      });
    });
  };
}
