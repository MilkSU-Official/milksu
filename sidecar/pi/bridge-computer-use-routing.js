export const computerUseMcpServerName = "milksu-computer-use";
export const computerUseMcpToolName = "milksu_computer_use_computer_use";

export function isComputerUseMcpToolName(value) {
  const normalized = String(value ?? "").trim().replaceAll("-", "_");
  return normalized === "computer_use"
    || normalized === computerUseMcpToolName
    || normalized.endsWith("_computer_use");
}

// There is no routing essay here. When a session has Computer Use, the proxy
// tool description states the injected target and that the model cannot change
// it. When it does not, the model opens the scope picker through
// milksu_workspace show_panel computer-use and the user grants one window.
