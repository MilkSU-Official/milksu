// One-turn tool policy supplied by a trusted product caller.
//
// Ordinary user prompts never enter this module. Pi and the selected model own
// natural-language intent. MilkSU only uses this typed boundary for internal
// projections that must be tool-free by construction.

export const codingTurnContractMessageType = "milksu-turn-contract";

export function normalizeCodingTurnContract(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  if (value.toolAccess !== "none") return undefined;
  return {
    toolAccess: "none",
    reason: value.reason === "text_projection"
      ? "text_projection"
      : "typed_product_request",
  };
}

export function codingTurnContractGuidance(contract, uiLocale) {
  if (contract?.toolAccess !== "none") return "";
  if (String(uiLocale ?? "").trim() !== "en") {
    return "这是产品持有的投影，本回合不能用工具。直接回答当前消息，不要查文件、跑命令、调用工具或继续暂停的目标。不要声称有当前上下文里没有的新证据。";
  }
  return "This product-owned projection is tool-free. Answer the current message directly without "
    + "inspecting files, running commands, invoking tools, or continuing a paused goal. Do not claim "
    + "fresh evidence that is unavailable in the supplied context.";
}

export function codingTurnContractContext(contract, uiLocale) {
  if (contract?.toolAccess !== "none") return "";
  if (String(uiLocale ?? "").trim() !== "en") {
    return `[MilkSU 本回合策略 — 只对紧挨着的上一条产品请求有效]
本回合没有 Agent 工具、仓库读取、命令、浏览器或其他新观察。只用已提供的上下文，不要继续暂停的 Goal。本策略在答复落地后失效。`;
  }
  return `[MilkSU typed turn policy — only for the immediately preceding product request]
No Agent tool, repository read, command, browser, or other fresh observation is available in this
turn. Use only the supplied context and do not continue a paused Goal. This policy expires after the
response settles.`;
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
