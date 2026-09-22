export function companionReplyReviewInstructions(locale, replyStyle = "markdown") {
  const chat = replyStyle === "chat";
  if (locale === "en") {
    const lines = [
      "Review the draft before it is shown.",
      "If it recites old work the user did not ask to hear, or session ids and hashes they did not ask for, rewrite it shorter.",
      "A greeting stays one or two sentences.",
      "Otherwise keep the meaning.",
      "Return only the reply text.",
    ];
    if (chat) lines.push("Keep blank lines. Do not merge short lines into the long paragraph.");
    return lines.join(" ");
  }
  const lines = [
    "在发出前审这一稿。",
    "如果草稿在复述用户没让你说的旧任务，或念出用户没要的会话 id、哈希，就改写成更短的回复。",
    "打招呼只留一两句。",
    "其余保持原意。",
    "只输出用户该看到的正文。",
  ];
  if (chat) lines.push("空行留着，短句不要并进长段。");
  return lines.join("");
}

export function assistantVisibleText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("");
}

export function applyReviewedAssistantText(message, text) {
  if (!message || typeof message !== "object") return false;
  const next = String(text ?? "");
  if (!Array.isArray(message.content)) {
    message.content = [{ type: "text", text: next }];
    return true;
  }
  let wrote = false;
  message.content = message.content.filter(block => {
    if (block?.type !== "text") return true;
    if (!wrote) {
      block.text = next;
      wrote = true;
      return true;
    }
    return false;
  });
  if (!wrote) message.content.push({ type: "text", text: next });
  return true;
}

export function rewriteLastAssistantReply(roots, text) {
  const targets = [];
  for (const root of roots ?? []) {
    const messages = [];
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (value.role === "assistant") messages.push(value);
      if (value.message && value.message !== value) visit(value.message);
    };
    if (Array.isArray(root)) root.forEach(visit);
    else visit(root);
    const last = messages.at(-1);
    if (last && !targets.includes(last)) targets.push(last);
  }
  if (!targets.length) return false;
  for (const message of targets) applyReviewedAssistantText(message, text);
  return true;
}

export async function reviewCompanionDraft({
  draft,
  userText,
  locale,
  replyStyle,
  complete,
} = {}) {
  const original = String(draft ?? "").trim();
  if (!original || typeof complete !== "function") return String(draft ?? "");
  const language = locale === "en" ? "en" : "zh";
  const asked = String(userText ?? "");
  const body = language === "en"
    ? `The user just said:\n${asked}\n\nDraft:\n${original}`
    : `用户刚才说：\n${asked}\n\n草稿：\n${original}`;
  try {
    const message = await complete({
      systemPrompt: companionReplyReviewInstructions(language, replyStyle),
      messages: [{
        role: "user",
        content: [{ type: "text", text: body }],
        timestamp: Date.now(),
      }],
    });
    if (message?.stopReason === "error" || message?.stopReason === "aborted") return original;
    const reviewed = assistantVisibleText(message).trim();
    return reviewed || original;
  } catch {
    return original;
  }
}
