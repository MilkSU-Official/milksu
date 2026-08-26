const fallbackAssistantError = "Model request failed before producing a response";

// Keep in sync with Pi's overflow detection intent: these failures are recovered
// by AgentSession auto-compaction (compact + optional retry) after message_end.
// Projecting them as terminal engine.error finishes the UI turn too early.
const CONTEXT_OVERFLOW_PATTERNS = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length/i,
  /input \(\d+ tokens\) is longer than the model'?s context length/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /range of input length should be/i,
  /context[_ ]length[_ ]exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
  /上下文(?:窗口|过长|长度|已满)/i,
];

const NON_OVERFLOW_PATTERNS = [
  /^(Throttling error|Service unavailable):/i,
  /rate limit/i,
  /too many requests/i,
];

// Intermediate provider failures that Pi may still recover from inside the same
// agent turn (retry / source fallback). Emitting engine.error would finishRun
// the desktop turn before agent_settled.
const RETRYABLE_PROVIDER_PATTERNS = [
  /\b408\b/,
  /\b429\b/,
  /\b5\d\d\b/,
  /rate.?limit/i,
  /too many requests/i,
  /throttl/i,
  /service unavailable/i,
  /temporar(?:il)?y unavailable/i,
  /timeout|timed out/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed/i,
  /\bconnection error\b/i,
  /overloaded|capacity/i,
];

function textContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(item => item.type === "text")
    .map(item => item.text)
    .join("");
}

export function thinkingContent(message) {
  if (!Array.isArray(message?.content)) return "";
  return message.content
    .filter(item => item.type === "thinking" && !item.redacted)
    .map(item => String(item.thinking ?? ""))
    .filter(Boolean)
    .join("\n");
}

function assistantError(errorMessage) {
  const value = String(errorMessage ?? "").trim();
  return value || fallbackAssistantError;
}

/**
 * True when the assistant error is a context-window overflow that Pi recovers
 * via auto-compaction. Callers must not treat these as terminal turn failures.
 */
export function isRecoverableContextOverflowError(errorMessage) {
  const value = String(errorMessage ?? "").trim();
  if (!value) return false;
  if (NON_OVERFLOW_PATTERNS.some(pattern => pattern.test(value))) return false;
  return CONTEXT_OVERFLOW_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * True when the provider error is typically retried inside the same Pi turn.
 * Desktop must not finishRun on these; wait for agent_settled / turn_settled.
 */
export function isRetryableProviderError(errorMessage) {
  const value = String(errorMessage ?? "").trim();
  if (!value) return false;
  // Overflow has its own recovery path; do not double-classify.
  if (isRecoverableContextOverflowError(value)) return false;
  return RETRYABLE_PROVIDER_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Whether projecting this assistant error as engine.error would end the UI turn
 * before Pi finishes recovery (compact/retry/fallback).
 */
export function shouldDeferTerminalAssistantError(errorMessage) {
  return isRecoverableContextOverflowError(errorMessage)
    || isRetryableProviderError(errorMessage);
}

export function projectAssistantMessageEnd(message, {
  textStreamed = false,
  thinkingStreamed = false,
} = {}) {
  const content = textContent(message);
  const thinking = thinkingContent(message);
  const stopReason = message?.stopReason ?? "stop";
  const hasToolCall = Array.isArray(message?.content)
    && message.content.some(item => item.type === "toolCall");
  const events = [];

  if (thinking.trim() && !thinkingStreamed) {
    events.push({
      type: "thinking_done",
      data: { content: thinking },
    });
  }

  if (content.trim()) {
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
    const error = assistantError(message?.errorMessage);
    // Overflow / retryable: Pi may still compact, retry, or fall back after
    // message_end. Emitting engine.error finishes the desktop turn too early.
    if (!shouldDeferTerminalAssistantError(error)) {
      events.push({
        type: "error",
        data: { error },
      });
    }
  }

  return events;
}
