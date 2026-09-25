/**
 * 模型调用失败时，pi 把结果记在消息上：`stopReason: "error"` + `errorMessage`。
 *
 * 侧车以前在 `message_end` 里**只取 usage** ✗ ⇒ 失败被整条丢掉 ⇒ 引擎收不到、界面也收不到
 * ⇒ 读者只看到"空回合"（真事：tokenflux 回 `429 status code (no body)`，用户看到"它不说话"✗）。
 *
 * 这里只做一件事：把"这一轮失败了"和"为什么"取出来 —— 判定与文案都留给下游
 * （引擎的 `error` 事件 ⇒ 渲染层的 `agentEngineErrorBubble`，它已经会按 429/401 分类并给建议 ✓）。
 */
export function assistantFailureText(message) {
  if (!message || typeof message !== "object") return "";
  const stop = String(message.stopReason ?? "").trim().toLowerCase();
  const detail = String(message.errorMessage ?? message.error ?? "").trim();
  // 没有错误详情、也不是 error 收尾 ⇒ 正常回合，什么都不发 ✓。
  if (!detail && stop !== "error") return "";
  // 有 error 收尾但没详情：也要说一声，别让读者对着空白猜 ✗。
  return detail || "the model call failed without a message";
}
