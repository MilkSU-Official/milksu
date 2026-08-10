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
const hostedExternalMcpServers = new Set([
  "atlassian",
  "github",
  "gitlab",
  "jira",
  "linear",
  "notion",
  "slack",
]);
const readOnlyMcpToolPattern = /(?:^|[_-])(?:describe|fetch|find|get|health|inspect|list|lookup|query|read|resolve|search|status|view)(?:[_-]|$)/iu;
const hostedPublicationToolPattern = /(?:^|[_-])(?:create|merge|open|publish|submit)[_-](?:draft[_-])?(?:merge[_-]request|pull[_-]request|release)(?:[_-]|$)/iu;
const externalAccountWriteToolPattern = /(?:^|[_-])(?:add|archive|assign|close|comment|create|delete|edit|invite|merge|move|open|post|publish|remove|reopen|resolve|send|submit|transition|unarchive|update|write)(?:[_-]|$)/iu;

function normalizedApprovalPolicy(value) {
  const policy = String(value ?? "").trim();
  return approvalPolicies.has(policy) ? policy : "read-only";
}

function normalizedMcpToolName(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2");
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
  const action = String(input.action ?? "").trim();
  const tool = normalizedMcpToolName(input.tool);
  const operation = Boolean(
    tool
    || input.connect
    || ["auth-start", "auth-complete"].includes(action),
  );
  if (!operation) return false;

  // These effects remain an independent user decision under every permission
  // tier. Full Access can widen local execution authority, but it must not turn
  // an MCP OAuth grant or hosted publication into an ambient side effect.
  if (
    ["auth-start", "auth-complete"].includes(action)
    || hostedPublicationToolPattern.test(tool)
    || (
      hostedExternalMcpServers.has(String(selectedServer || input.server || "").trim())
      && externalAccountWriteToolPattern.test(tool)
    )
  ) {
    return true;
  }

  const policy = normalizedApprovalPolicy(approvalPolicy);
  if (policy === "full-auto") return false;
  if (policy === "workspace-auto") {
    if (input.connect) return false;
    const server = String(selectedServer || input.server || "").trim();
    if (autoApprovedMcpServers.has(server)) return false;
    return !readOnlyMcpToolPattern.test(tool);
  }
  return true;
}
