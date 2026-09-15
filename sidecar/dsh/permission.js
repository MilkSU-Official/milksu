export function dshPermissionResult(approved) {
  if (!approved) {
    return { outcome: { outcome: "cancelled" } };
  }
  return {
    outcome: {
      outcome: "selected",
      optionId: "allow-once",
    },
  };
}

export function dshNormalizeApprovalPolicy(value) {
  const policy = String(value ?? "").trim();
  if (policy === "read-only" || policy === "ask" || policy === "workspace-auto" || policy === "full-auto") {
    return policy;
  }
  return "ask";
}

export function dshPermissionLooksDangerous(toolCall) {
  const text = JSON.stringify(toolCall ?? "").toLowerCase();
  if (!text) return false;
  if (/\brm\s+-[a-z]*r[a-z]*f\b|\brm\s+-fr\b/.test(text)) return true;
  if (/\bunlink\b|\brmdir\b/.test(text) && /\.\.|\/users\/|\/home\/|c:\\\\/.test(text)) {
    return true;
  }
  if (/"action"\s*:\s*"(delete|remove|unlink)"/.test(text) && /\.\.\//.test(text)) {
    return true;
  }
  return false;
}

export function dshPermissionLooksExternalOrPaid(toolCall) {
  const text = JSON.stringify(toolCall ?? "").toLowerCase();
  return /imagegen|image_gen|auth-start|auth-complete|"server"\s*:\s*"(github|gitlab|atlassian|slack|notion|linear|jira)"/.test(text);
}

export function dshPermissionLooksGrantable(toolCall) {
  const text = JSON.stringify(toolCall ?? "");
  return /playwright-mcp|mcp__playwright|browser_|milksu-playwright|milksu_workspace|milksu-computer-use|computer_use/i.test(text);
}

export function dshPresetForApprovalPolicy(value) {
  const policy = dshNormalizeApprovalPolicy(value);
  if (policy === "read-only") return "read-only";
  // Official preset "auto" is danger-full-access + approval never and
  // bypasses ACP permission. MilkSU Full Access still confines the
  // conversation workspace and irreversible deletes.
  return "workspace-write";
}

export function dshShouldAutoAllowPermission(approvalPolicy, toolCall) {
  const policy = dshNormalizeApprovalPolicy(approvalPolicy);
  if (policy !== "workspace-auto" && policy !== "full-auto") return false;
  if (dshPermissionLooksDangerous(toolCall)) return false;
  if (dshPermissionLooksExternalOrPaid(toolCall)) return false;
  if (policy === "workspace-auto") return dshPermissionLooksGrantable(toolCall);
  return true;
}
