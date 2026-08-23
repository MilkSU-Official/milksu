// Bounded no-progress brake on Pi's native tool_call hook.
//
// Provider APIs do not detect duplicate tool loops. Pi 0.84.1 lets an extension
// return `{ block: true, terminate: true }` from `tool_call`, or wait on the
// existing approval broker before allowing the call through. This module only
// inspects the current user prompt's tool sequence; it does not replace Pi's loop.

export const exactRepeatLimit = 10;
export const familyRepeatLimit = 25;
export const promptToolLimit = 150;
export const toolBudgetToolName = "milksu_tool_budget";

export const exactRepeatReason = "同一命令连续重复，已停止本轮。";
export const familyRepeatReason = "相近命令没有新进展，已停止本轮。";
export const promptToolLimitReason = "本轮已停止。";

function stableValue(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${key}:${stableValue(value[key])}`).join(",")}}`;
  }
  return "";
}

function bashCommand(input) {
  if (!input || typeof input !== "object") return "";
  return String(input.command ?? input.cmd ?? "").trim();
}

export function bashFamilyCommand(command) {
  let text = String(command ?? "").trim();
  if (!text) return "";
  text = text.replace(/^\s*cd\s+(?:'[^']*'|"[^"]*"|\S+)\s*&&\s*/i, "");
  text = text.replace(/\bhead\s+-n?\s*\d+/gi, "head N");
  text = text.replace(/\btail\s+-n?\s*\d+/gi, "tail N");
  text = text.replace(
    /(?:\s*\|\s*grep\s+-v(?:\s+E)?\s+(?:'[^']*'|"[^"]*"|\S+))+$/i,
    " | grep -v X",
  );
  return text.replace(/\s+/g, " ").trim();
}

export function toolCallSignature(toolName, input) {
  const name = String(toolName ?? "").trim().toLowerCase();
  if (name === "bash") return `bash\0${bashCommand(input)}`;
  return `${name}\0${stableValue(input)}`;
}

export function toolCallFamily(toolName, input) {
  const name = String(toolName ?? "").trim().toLowerCase();
  if (name === "bash") return `bash\0${bashFamilyCommand(bashCommand(input))}`;
  return toolCallSignature(name, input);
}

export function toolBudgetPrompt(count) {
  return `已经调用了 ${count} 次工具，要继续吗？`;
}

function trailingCount(history, match) {
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (!match(history[index])) break;
    count += 1;
  }
  return count;
}

export function inspectToolRepeat(history, toolName, input) {
  const signature = toolCallSignature(toolName, input);
  const family = toolCallFamily(toolName, input);
  if (!signature || signature.endsWith("\0")) return undefined;
  const exactCount = trailingCount(history, item => item.signature === signature) + 1;
  const familyCount = trailingCount(history, item => item.family === family) + 1;
  const promptCount = history.length + 1;
  if (exactCount >= exactRepeatLimit) {
    return { block: true, terminate: true, reason: exactRepeatReason };
  }
  if (familyCount >= familyRepeatLimit) {
    return { block: true, terminate: true, reason: familyRepeatReason };
  }
  if (promptCount > 0 && promptCount % promptToolLimit === 0) {
    return { ask: true, count: promptCount };
  }
  return undefined;
}

export function createToolRepeatGuard() {
  const history = [];
  return {
    reset() {
      history.length = 0;
    },
    inspect(toolName, input) {
      const decision = inspectToolRepeat(history, toolName, input);
      history.push({
        signature: toolCallSignature(toolName, input),
        family: toolCallFamily(toolName, input),
      });
      return decision;
    },
  };
}
