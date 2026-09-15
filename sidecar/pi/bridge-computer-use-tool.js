import { Type } from "typebox";
import {
  createComputerUseExecutor,
  createCuaCliRunner,
  createPortalSocketRunner,
} from "../computer-use/computer-use-proxy.js";
import { resolvePackagedComputerUseDriver } from "./bridge-mcp.js";

export const computerUseToolName = "computer_use";

export function computerUseGuidance() {
  return [
    "Observe or click one visible desktop window after it is locked.",
    "List windows with milksu_workspace list_computer_use_windows.",
    "If several match, call milksu_ask; if one match is clear, lock_computer_use_window and continue.",
    "Do not ask the user to pick a window first.",
  ].join(" ");
}

function descriptorKey(descriptor) {
  return [
    descriptor.sessionId,
    descriptor.socketPath,
    descriptor.targetPid,
    descriptor.targetWindowId,
  ].join(":");
}

export function createComputerUseToolExtension(getPolicy) {
  let executor;
  let executorKey = "";

  async function executorFor(descriptor) {
    const key = descriptorKey(descriptor);
    if (executor && executorKey === key) return executor;
    const options = {
      sessionId: descriptor.sessionId,
      socketPath: descriptor.socketPath,
      targetName: descriptor.targetName,
      targetBundleId: descriptor.targetBundleId,
      targetPid: descriptor.targetPid,
      targetWindowId: descriptor.targetWindowId,
    };
    const runTool = process.platform === "linux"
      ? createPortalSocketRunner(descriptor.socketPath)
      : createCuaCliRunner({
          driverPath: await resolvePackagedComputerUseDriver(),
          socketPath: descriptor.socketPath,
        });
    executor = createComputerUseExecutor(options, runTool);
    executorKey = key;
    return executor;
  }

  return (pi) => {
    pi.registerTool({
      name: computerUseToolName,
      label: "Computer Use",
      description: computerUseGuidance(),
      parameters: Type.Object({
        action: Type.Union([
          Type.Literal("observe"),
          Type.Literal("click"),
          Type.Literal("type"),
          Type.Literal("key"),
          Type.Literal("scroll"),
        ]),
        element_index: Type.Optional(Type.Integer({ minimum: 0 })),
        element_token: Type.Optional(Type.String({ maxLength: 512 })),
        x: Type.Optional(Type.Number({ minimum: 0 })),
        y: Type.Optional(Type.Number({ minimum: 0 })),
        text: Type.Optional(Type.String({ maxLength: 4096 })),
        key: Type.Optional(Type.String({ maxLength: 40 })),
        modifiers: Type.Optional(Type.Array(Type.String(), { maxItems: 4 })),
        direction: Type.Optional(Type.Union([
          Type.Literal("up"),
          Type.Literal("down"),
          Type.Literal("left"),
          Type.Literal("right"),
        ])),
        amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
        by: Type.Optional(Type.Union([
          Type.Literal("line"),
          Type.Literal("page"),
        ])),
        include_screenshot: Type.Optional(Type.Boolean()),
        max_elements: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
        max_depth: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
        query: Type.Optional(Type.String({ maxLength: 200 })),
        delay_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 2000 })),
        delivery_mode: Type.Optional(Type.Union([
          Type.Literal("background"),
          Type.Literal("foreground"),
        ])),
      }),
      async execute(_toolCallId, params) {
        const policy = getPolicy?.() || {};
        if (policy.executionMode !== "go" || policy.approvalPolicy === "read-only") {
          throw new Error("Plan 或只读策略不能操作桌面窗口。");
        }
        const computerUse = policy.computerUse;
        if (!computerUse?.sessionId || !computerUse?.socketPath) {
          throw new Error(
            "No window is locked. Call milksu_workspace list_computer_use_windows, "
            + "use milksu_ask if several match, then lock_computer_use_window.",
          );
        }
        const result = await (await executorFor(computerUse)).execute(params);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      },
    });
  };
}
