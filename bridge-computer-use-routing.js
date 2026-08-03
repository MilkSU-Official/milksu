export function computerUseRoutingGuidance(policy) {
  if (!policy || policy.ctf) return "";
  if (policy.computerUse) {
    return " Computer Use is active for one user-selected visible app/window. "
      + `The immutable target is ${policy.computerUse.targetName} `
      + `(${policy.computerUse.targetBundleId}), PID ${policy.computerUse.targetPid}, `
      + `window ${policy.computerUse.targetWindowId}. Use the computer_use tool for visible UI observation `
      + "and operation; do not switch to another app, desktop, PID, or window.";
  }
  return " Computer Use is not active. For tasks that require reading or operating a visible desktop "
    + "app UI, stop and tell the user to enable a visible Computer Use session or choose a non-UI "
    + "alternative. Do not use bash, shell scripts, AppleScript, Accessibility probes, screenshot "
    + "directories, app data directories, SQLite state, Electron IPC, private app protocols, or network "
    + "reverse engineering as a substitute for UI control, even in Full Access.";
}
