// 决策层主模型兜底的侧车一侧。后端发来 decision_query（轻量问答，不另开
// 内核、不在当轮顺口识别），这里用这条会话自己的主模型 completeSimple
// 打一次，按原样回 decision_answer；成功回 text，失败回 error，都由后端的
// 全局决策层解析。
export async function answerDecisionQuery(command, { emitEvent, complete, readText } = {}) {
  const id = String(command?.id ?? "").trim();
  if (!id || typeof emitEvent !== "function") return;
  if (typeof complete !== "function") {
    emitEvent("decision_answer", { id, error: "model completer is not wired" });
    return;
  }
  try {
    const message = await complete({
      systemPrompt: String(command?.systemPrompt ?? ""),
      messages: [{
        role: "user",
        content: [{ type: "text", text: String(command?.prompt ?? "") }],
        timestamp: Date.now(),
      }],
    });
    const text = typeof readText === "function" ? readText(message) : "";
    emitEvent("decision_answer", { id, text });
  } catch (error) {
    emitEvent("decision_answer", {
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
