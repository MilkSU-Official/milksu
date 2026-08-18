import { Type } from "typebox";

export const computerUseDriverToolName = "prepare_computer_use_driver";

export function computerUseDriverGuidance() {
  return [
    "If the packaged Cua Driver is missing, call prepare_computer_use_driver before asking the user to pick a window.",
    "That tool copies or builds the MilkSU-reviewed driver into the local sidecar path.",
    "Do not run Cua's public installer, install.ps1, install.sh, or start a system-wide Cua daemon.",
    "Do not scan the user message for keywords; use this typed tool when Computer Use cannot start because the driver is unavailable.",
  ].join(" ");
}

export function createComputerUseDriverExtension(conversationId, getPolicy, requestAction) {
  return (pi) => {
    pi.registerTool({
      name: computerUseDriverToolName,
      label: "Prepare Computer Use driver",
      description:
        "Check or prepare the MilkSU-reviewed Computer Use driver on this machine. "
        + "Use when the packaged sidecar driver is missing. Never install Cua from cua.ai or install.ps1.",
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("status"),
          Type.Literal("prepare"),
        ]),
      }),
      async execute(_toolCallId, params) {
        const action = params.action === "prepare"
          ? "prepare_computer_use_driver"
          : "computer_use_driver_status";
        const policy = getPolicy?.() || {};
        if (
          action === "prepare_computer_use_driver"
          && (policy.executionMode !== "go" || policy.approvalPolicy === "read-only")
        ) {
          throw new Error("Plan 或只读策略不能准备 Computer Use Driver。先查看 status。");
        }
        const result = await requestAction({
          conversationId,
          action,
          input: { action },
        });
        return {
          content: [{ type: "text", text: result || `${action} completed` }],
        };
      },
    });
  };
}
