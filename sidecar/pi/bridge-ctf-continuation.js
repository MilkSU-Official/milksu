const continuationMessage = {
  customType: "milksu-ctf-truncation-continuation",
  content: "Continue the unfinished response from the exact point where it was truncated. "
    + "Preserve the current task and tool state; do not restart or summarize unless required by the task.",
  display: false,
};

function lastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messages[index];
  }
  return undefined;
}

export function createCTFTruncationContinuationExtension(sessionRole) {
  return (pi) => {
    if (!sessionRole) return;
    pi.on("agent_end", async (event) => {
      if (lastAssistantMessage(event?.messages)?.stopReason !== "length") return;
      pi.sendMessage(continuationMessage, {
        deliverAs: "followUp",
        triggerTurn: true,
      });
    });
  };
}
