import {
  browserUseMcpServerName,
  codingBrowserMcpServerName,
} from "./bridge-browser-policy.js";

const approvalPolicies = new Set([
  "read-only",
  "ask",
  "workspace-auto",
  "full-auto",
]);
const autoApprovedMcpServers = new Set([
  codingBrowserMcpServerName,
  "milksu-computer-use",
]);
const conversationGrantableMcpServers = new Set([
  codingBrowserMcpServerName,
  browserUseMcpServerName,
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

function normalizedApprovalPolicy(value) {
  const policy = String(value ?? "").trim();
  return approvalPolicies.has(policy) ? policy : "read-only";
}

export function codingCollaborationRequiresApproval(approvalPolicy) {
  return normalizedApprovalPolicy(approvalPolicy) === "ask";
}

export function resolveCodingMcpServer(input, policy = {}) {
  const explicit = String(input?.server ?? input?.connect ?? "").trim();
  if (explicit) return explicit;
  const selected = Array.isArray(policy?.mcpServers) ? policy.mcpServers : [];
  const tool = String(input?.tool ?? "").trim();
  if (tool.includes("browser_")) {
    const hasIsolated = Boolean(policy.codingBrowser)
      || selected.includes(codingBrowserMcpServerName);
    const hasUserBrowser = Boolean(policy.browserUse)
      || selected.includes(browserUseMcpServerName);
    if (hasIsolated && !hasUserBrowser) return codingBrowserMcpServerName;
    if (hasUserBrowser && !hasIsolated) return browserUseMcpServerName;
  }
  return selected.length === 1 ? selected[0] : "";
}

export function mcpConversationGrantKey(input, selectedServer = "") {
  if (!input || typeof input !== "object") return "";
  const action = String(input.action ?? "").trim();
  if (["auth-start", "auth-complete"].includes(action)) return "";
  const server = String(selectedServer || input.server || input.connect || "").trim();
  if (!server || hostedExternalMcpServers.has(server)) return "";
  return conversationGrantableMcpServers.has(server) ? `mcp:${server}` : "";
}

export function codingMcpOperationRequiresApproval(
  input,
  approvalPolicy,
  selectedServer = "",
) {
  if (!input || typeof input !== "object") return false;
  const action = String(input.action ?? "").trim();
  const tool = String(input.tool ?? "").trim();
  const operation = Boolean(
    tool
    || input.connect
    || ["auth-start", "auth-complete"].includes(action),
  );
  if (!operation) return false;

  // Authentication remains an explicit external-account decision. Do not
  // infer tool effects from verbs in arbitrary MCP tool names: the name is not
  // a reviewed authorization contract.
  if (["auth-start", "auth-complete"].includes(action)) return true;

  const policy = normalizedApprovalPolicy(approvalPolicy);
  if (policy === "ask" || policy === "read-only") return true;

  // Selecting an already configured server is not itself a remote effect.
  if (input.connect) return false;

  const server = String(selectedServer || input.server || "").trim();
  // Until the adapter forwards trusted MCP effect annotations, every hosted
  // account tool call remains visible. This is conservative but deterministic.
  if (hostedExternalMcpServers.has(server)) return true;
  if (policy === "full-auto") return false;
  return !autoApprovedMcpServers.has(server);
}
