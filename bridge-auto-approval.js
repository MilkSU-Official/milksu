const approvalPolicies = new Set([
  "read-only",
  "ask",
  "workspace-auto",
  "full-auto",
]);
const autoApprovedMcpServers = new Set([
  "milksu-playwright",
  "milksu-computer-use",
]);
const readOnlyMcpToolPattern = /(?:^|[_-])(?:describe|fetch|find|get|health|inspect|list|lookup|query|read|resolve|search|status|view)(?:[_-]|$)/iu;

function normalizedApprovalPolicy(value) {
  const policy = String(value ?? "").trim();
  return approvalPolicies.has(policy) ? policy : "read-only";
}

export function codingCollaborationRequiresApproval(approvalPolicy) {
  return normalizedApprovalPolicy(approvalPolicy) === "ask";
}

export function codingMcpOperationRequiresApproval(
  input,
  approvalPolicy,
  selectedServer = "",
) {
  if (!input || typeof input !== "object") return false;
  const operation = Boolean(
    input.tool
    || input.connect
    || ["auth-start", "auth-complete"].includes(String(input.action ?? "")),
  );
  if (!operation) return false;

  const policy = normalizedApprovalPolicy(approvalPolicy);
  if (policy === "full-auto") return false;
  if (policy === "workspace-auto") {
    if (["auth-start", "auth-complete"].includes(String(input.action ?? ""))) {
      return true;
    }
    if (input.connect) return false;
    const server = String(selectedServer || input.server || "").trim();
    if (autoApprovedMcpServers.has(server)) return false;
    return !readOnlyMcpToolPattern.test(String(input.tool ?? "").trim());
  }
  return true;
}
