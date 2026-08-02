export const codingGoalToolNames = ["goal_complete", "goal_blocked"];

export const codingReadOnlyToolNames = [
  "read",
  "grep",
  "find",
  "ls",
  "bg_status",
  "milksu_progress",
  "lsp_diagnostics",
  ...codingGoalToolNames,
];

export const codingWorkspaceAutoToolNames = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "bg_task",
  "bg_status",
  "milksu_progress",
  "lsp_diagnostics",
  "lsp_fix",
  ...codingGoalToolNames,
];

// A Coding session must construct the full reviewed tool catalog up front.
// Pi's setActiveTools() can narrow or restore tools that already exist, but it
// cannot add definitions that were omitted when createAgentSession() ran.
export const codingSessionToolNames = [
  ...new Set([...codingWorkspaceAutoToolNames, "milksu_archify"]),
];

export function normalizeCodingPolicy(
  executionMode = "go",
  approvalPolicy = "workspace-auto",
) {
  const normalizedExecutionMode = executionMode === "go" ? "go" : "plan";
  const normalizedApprovalPolicy = [
    "read-only",
    "ask",
    "workspace-auto",
    "full-auto",
  ].includes(approvalPolicy)
    ? approvalPolicy
    : "read-only";
  const effectfulToolsAvailable = normalizedExecutionMode === "go"
    && ["ask", "workspace-auto", "full-auto"].includes(normalizedApprovalPolicy);
  const workspaceWritesAllowed = normalizedExecutionMode === "go"
    && ["workspace-auto", "full-auto"].includes(normalizedApprovalPolicy);
  const fullAccess = normalizedExecutionMode === "go"
    && normalizedApprovalPolicy === "full-auto";
  const approvalChannelAvailable = normalizedExecutionMode === "go"
    && normalizedApprovalPolicy === "ask";
  const activeTools = effectfulToolsAvailable
    ? codingWorkspaceAutoToolNames
    : codingReadOnlyToolNames;

  return {
    executionMode: normalizedExecutionMode,
    approvalPolicy: normalizedApprovalPolicy,
    approvalChannelAvailable,
    activeTools: [...activeTools],
    capabilities: [
      {
        id: "workspace-read",
        label: "工作区读取",
        status: "allowed",
        detail: fullAccess
          ? "文件工具读取项目；终端可访问当前系统用户可读的路径。"
          : "文件与终端读取限制在当前项目和系统开发工具。",
      },
      {
        id: "workspace-write",
        label: "工作区写入",
        status: workspaceWritesAllowed
          ? "allowed"
          : normalizedApprovalPolicy === "ask" && normalizedExecutionMode === "go"
            ? "approval-required"
            : "blocked",
        detail: fullAccess
          ? "终端具有当前系统用户权限；文件工具仍以项目为默认边界。"
          : workspaceWritesAllowed
            ? "文件与命令写入限制在项目内；允许正常 Git 操作，文件工具保护 .milksu。"
          : normalizedApprovalPolicy === "ask" && normalizedExecutionMode === "go"
            ? "每次 edit / write 前暂停并在桌面展示参数；只有本次明确批准后执行。"
            : "Plan 或 Read-only 策略禁止 edit / write。",
      },
      {
        id: "command",
        label: "命令执行",
        status: workspaceWritesAllowed
          ? "allowed"
          : approvalChannelAvailable
            ? "approval-required"
            : "blocked",
        detail: fullAccess
          ? "命令自动执行，不受项目沙箱限制；模型 Provider Key 不传给子进程。"
          : workspaceWritesAllowed
            ? "项目沙箱内可运行开发命令和后台工具，支持网络。"
          : approvalChannelAvailable
            ? "每次 bash 调用前展示完整命令并等待批准；仍受项目沙箱约束。"
            : "Plan 与 Read-only 不提供 bash。",
      },
      {
        id: "network",
        label: "网络",
        status: workspaceWritesAllowed
          ? "allowed"
          : approvalChannelAvailable
            ? "approval-required"
            : "blocked",
        detail: workspaceWritesAllowed
          ? "允许开发命令访问网络。"
          : approvalChannelAvailable
            ? "网络只能通过已展示并单次批准的命令使用。"
            : "当前模式禁止网络命令。",
      },
      {
        id: "credentials",
        label: "凭据",
        status: fullAccess ? "allowed" : "blocked",
        detail: fullAccess
          ? "终端可使用当前系统用户的凭据；模型 Provider Key 仍不进入子进程。"
          : "Provider Key 不进入模型上下文，项目自动也不能读取用户凭据目录。",
      },
      {
        id: "browser",
        label: "浏览器 / MCP",
        status: "unavailable",
        detail: "尚未接入 Coding Agent；未来接入仍需逐次显式批准。",
      },
      {
        id: "computer-use",
        label: "Computer Use",
        status: "unavailable",
        detail: "只有用户显式启动应用范围会话后可用；所有调用仍逐次批准。",
      },
      {
        id: "collaboration",
        label: "多 Agent 协作",
        status: "unavailable",
        detail: "只有用户显式准备独立 Git worktree 后可用；每次委托仍单独批准。",
      },
    ],
  };
}
