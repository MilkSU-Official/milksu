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

export function envToolGuidance() {
  return [
    "The bound target is owned by the environment broker.",
    "Use env_status, env_start, env_reset, and env_stop to manage the lease.",
    "Work on the lease address (127.0.0.1 port or emulator serial).",
    "Android lab devices are MilkSU-Lab emulators; use adb -s <lease serial>.",
    "env_start only works when this job already has a bound package; the user starts unbound packages from the environment strip.",
  ].join(" ");
}

export function createEnvExtension(conversationId, sessionRole, getPolicy, requestAction) {
  return (pi) => {
    if (!isResearchSessionRole(sessionRole)) return;
    for (const name of envToolNames) {
      pi.registerTool({
        name,
        label: name.replace("env_", "env."),
        description: name === "env_status"
          ? "Read the bound lab/CVE environment lease: state, address, surface."
          : name === "env_start"
            ? "Start the package already bound to this job. Cannot pick an arbitrary image or compose file."
            : name === "env_reset"
              ? "Stop and start the bound environment."
              : "Stop the bound environment and drop its address from scope.",
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
