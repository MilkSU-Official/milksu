import { Type } from "typebox";
import { isResearchSessionRole } from "./bridge-workspace.js";

export const envToolNames = Object.freeze([
  "env_status",
  "env_start",
  "env_reset",
  "env_stop",
]);

const envMutating = new Set(["env_start", "env_reset", "env_stop"]);

export function envActionBlocked(action, policy = {}) {
  if (!envToolNames.includes(action)) {
    return "MilkSU rejected an unknown environment action.";
  }
  if (!envMutating.has(action)) return "";
  if (policy.executionMode !== "go" || policy.approvalPolicy === "read-only") {
    return "Plan 或只读策略不能改环境。先 env_status。";
  }
  return "";
}

// Each env tool states its own bound and what it returns. The lease address and
// emulator serial reach the model through env_status output rather than a
// per-turn system prompt restating the same catalog.
const envToolDescriptions = Object.freeze({
  env_status: "Read the bound lab/CVE environment lease owned by the MilkSU environment broker: state, address, surface. Work on the address it returns, a 127.0.0.1 port or an emulator serial; MilkSU-Lab Android devices are reached with adb -s <lease serial>.",
  env_start: "Start the package already bound to this job. Cannot pick an arbitrary image or compose file, and cannot start an unbound package; the user binds those from the environment strip.",
  env_reset: "Stop and start the bound environment, returning its new lease address.",
  env_stop: "Stop the bound environment and drop its address from scope.",
});

export function createEnvExtension(conversationId, sessionRole, getPolicy, requestAction) {
  return (pi) => {
    if (!isResearchSessionRole(sessionRole)) return;
    for (const name of envToolNames) {
      pi.registerTool({
        name,
        label: name.replace("env_", "env."),
        description: envToolDescriptions[name],
        parameters: Type.Object({}),
        async execute() {
          const blocked = envActionBlocked(name, getPolicy?.());
          if (blocked) throw new Error(blocked);
          const result = await requestAction({
            conversationId,
            action: name,
            input: {},
          });
          return {
            content: [{ type: "text", text: result || `${name} completed` }],
          };
        },
      });
    }
  };
}
