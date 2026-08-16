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

export function codingTurnContractGuidance(contract) {
  if (contract?.toolAccess !== "none") return "";
  return "This product-owned projection is tool-free. Answer the current message directly without "
    + "inspecting files, running commands, invoking tools, or continuing a paused goal. Do not claim "
    + "fresh evidence that is unavailable in the supplied context.";
}

export function codingTurnContractContext(contract) {
  if (contract?.toolAccess !== "none") return "";
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
