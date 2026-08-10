// Explicit per-turn constraints for ordinary Coding prompts.
//
// This is intentionally not a general natural-language policy parser. It only
// recognizes an unambiguous user instruction that Agent tools must not run in
// this turn. Everything else continues to use the reviewed session policy.

const directiveBoundary = String.raw`(?:^|[。！？.!?\n，,;；])\s*`;
const noToolsChinesePattern = new RegExp(
  directiveBoundary
    + String.raw`(?:不要|请勿|禁止|无需|不需要|别|也不要)(?:再)?`
    + String.raw`(?:调用|使用|运行|执行)?(?:任何|任意)?\s*(?:Agent\s*)?工具`,
  "iu",
);
const noToolsEnglishPattern = new RegExp(
  directiveBoundary
    + String.raw`(?:do\s+not|don't|dont|never)\s+`
    + String.raw`(?:use|run|call|invoke)\s+(?:any\s+)?(?:agent\s+)?tools?\b`,
  "iu",
);
const withoutToolsEnglishPattern = new RegExp(
  directiveBoundary
    + String.raw`(?:answer|reply|respond|continue|proceed)?\s*`
    + String.raw`without\s+(?:using\s+)?(?:any\s+)?(?:agent\s+)?tools?\b`,
  "iu",
);
const currentFactChinesePattern = new RegExp(
  String.raw`(?:当前|目前|现在|最新).{0,8}`
    + String.raw`(?:仓库|实现|状态|结果|工作区|分支|提交|HEAD|差异|测试|验收|版本|代码)`
    + String.raw`|(?:刚刚|刚才|刚).{0,8}(?:完成|实现|验证|测试|提交|修改|推送)`
    + String.raw`|真实验收`,
  "iu",
);
const currentFactEnglishPattern = new RegExp(
  String.raw`\b(?:current|latest)\s+(?:repository|implementation|state|status|result|worktree|`
    + String.raw`branch|commit|head|diff|test|validation|version|code)\b`
    + String.raw`|\bjust\s+(?:completed|finished|implemented|verified|tested|committed|pushed)\b`,
  "iu",
);
const requestedLineCountPattern = new RegExp(
  String.raw`(?:只用|使用|回复|回答|reply|answer|respond).{0,12}?`
    + String.raw`([一二三四五六七八九十两1-9]|one|two|three|four|five|six|seven|eight|nine|ten)`
    + String.raw`\s*(?:行|lines?)`,
  "iu",
);

export const codingTurnContractMessageType = "milksu-turn-contract";

function directiveSurface(prompt) {
  return String(prompt ?? "")
    .slice(0, 1_000)
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\n]*`/gu, " ")
    .replace(/“[^”\n]*”/gu, " ")
    .replace(/"[^"\n]*"/gu, " ");
}

function requestedLineCount(surface) {
  const match = surface.match(requestedLineCountPattern);
  if (!match) return 1;
  const values = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const token = match[1].toLowerCase();
  const numeric = values[token] ?? Number(token);
  return Math.min(10, Math.max(1, Number.isFinite(numeric) ? numeric : 1));
}

export function parseExplicitCodingTurnContract(prompt) {
  const surface = directiveSurface(prompt);
  if (
    /^\s*\/goal(?:\s|$)/iu.test(surface)
    || /^\s*\[MilkSU product action:/u.test(surface)
  ) {
    return undefined;
  }
  if (
    noToolsChinesePattern.test(surface)
    || noToolsEnglishPattern.test(surface)
    || withoutToolsEnglishPattern.test(surface)
  ) {
    const contract = {
      toolAccess: "none",
      reason: "explicit_no_tools",
    };
    if (
      currentFactChinesePattern.test(surface)
      || currentFactEnglishPattern.test(surface)
    ) {
      contract.freshness = "unverified";
      contract.responseLineCount = requestedLineCount(surface);
      contract.responseLanguage = currentFactChinesePattern.test(surface)
        ? "zh"
        : "en";
    }
    return contract;
  }
  return undefined;
}

export function codingTurnContractGuidance(contract) {
  if (contract?.toolAccess !== "none") return "";
  return "The user explicitly prohibited Agent tools for this turn. Answer the current message "
    + "directly without inspecting files, running commands, invoking tools, continuing a paused "
    + "goal, or claiming new evidence. If the requested answer depends on current repository, "
    + "external, or newly completed state that is not already certain from the user's message, "
    + "say it was not verified in this turn; never fill that gap from a stale summary or inferred "
    + "result. The runtime has removed and independently blocked all Agent tools until this "
    + "response settles.";
}

export function codingTurnContractContext(contract) {
  if (contract?.toolAccess !== "none") return "";
  return `[MilkSU enforced turn contract — only for the immediately preceding user message]
No Agent tool, repository read, command, browser, or other fresh observation is available in this
turn. First follow the response format requested by the user. For each requested fact that depends
on current repository state, external state, or work that was "just completed", the entire
corresponding answer field or line may only state the equivalent of "本回合未核验，无法确认". It must
not include any implementation detail, count, test result, worktree status, or completion claim.
Preserve the requested field or line count. For example, when two requested lines both need fresh
facts, answer exactly:
第一行：本回合未核验，无法确认。
第二行：本回合未核验，无法确认。
Adding a disclaimer such as "截至最后验证时点" does not permit repeating an older value or compacted
summary. Do not continue a paused Goal. This temporary contract expires after this response
settles.`;
}

export function filterCodingTurnContractMessages(messages, contract) {
  let currentIndex = -1;
  if (contract?.toolAccess === "none") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (
        message?.role === "custom"
        && message.customType === codingTurnContractMessageType
      ) {
        currentIndex = index;
        break;
      }
    }
  }
  return messages.filter((message, index) => (
    message?.role !== "custom"
    || message.customType !== codingTurnContractMessageType
    || index === currentIndex
  ));
}

export function codingTurnContractBlocksTool(contract) {
  return contract?.toolAccess === "none";
}

export function codingTurnContractRequiresFreshnessGuard(contract) {
  return contract?.toolAccess === "none"
    && contract.freshness === "unverified";
}

export function codingTurnContractFallbackResponse(contract) {
  if (!codingTurnContractRequiresFreshnessGuard(contract)) return "";
  const count = Math.min(10, Math.max(1, contract.responseLineCount ?? 1));
  const language = contract.responseLanguage === "en" ? "en" : "zh";
  if (count === 1) {
    return language === "en"
      ? "Not verified in this turn; unable to confirm."
      : "本回合未核验，无法确认。";
  }
  const chineseOrdinals = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return Array.from({ length: count }, (_, index) => (
    language === "en"
      ? `Line ${index + 1}: Not verified in this turn; unable to confirm.`
      : `第${chineseOrdinals[index]}行：本回合未核验，无法确认。`
  )).join("\n");
}

export function enforceCodingTurnContractMessage(message, contract) {
  const fallback = codingTurnContractFallbackResponse(contract);
  const hasToolCall = Array.isArray(message?.content)
    && message.content.some((item) => item?.type === "toolCall");
  if (
    !fallback
    || message?.role !== "assistant"
    || message.stopReason === "error"
    || message.stopReason === "toolUse"
    || hasToolCall
  ) {
    return undefined;
  }
  return {
    ...message,
    content: [{ type: "text", text: fallback }],
  };
}

export async function withCodingTurnContract(options, action) {
  const {
    contracts,
    conversationId,
    contract,
    getActiveTools,
    setActiveTools,
    onApplied,
    onRestored,
  } = options;
  if (!contract || contract.toolAccess !== "none") return action();

  const previousTools = [...getActiveTools()];
  contracts.set(conversationId, contract);
  try {
    setActiveTools([]);
    onApplied?.([]);
    return await action();
  } finally {
    contracts.delete(conversationId);
    setActiveTools(previousTools);
    onRestored?.(previousTools);
  }
}
