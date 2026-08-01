import type {
  CodingApprovalPolicy,
  CodingCapability,
  CodingExecutionMode,
} from '@/types'

export const DEFAULT_CODING_EXECUTION_MODE: CodingExecutionMode = 'go'
export const DEFAULT_CODING_APPROVAL_POLICY: CodingApprovalPolicy = 'workspace-auto'

export function normalizeCodingExecutionMode(value: unknown): CodingExecutionMode {
  return value === 'plan' || value === 'go'
    ? value
    : DEFAULT_CODING_EXECUTION_MODE
}

export function normalizeCodingApprovalPolicy(value: unknown): CodingApprovalPolicy {
  return value === 'read-only' || value === 'ask' || value === 'workspace-auto'
    ? value
    : DEFAULT_CODING_APPROVAL_POLICY
}

export function previewCodingCapabilities(
  executionMode: CodingExecutionMode,
  approvalPolicy: CodingApprovalPolicy,
): CodingCapability[] {
  const workspaceAuto = executionMode === 'go' && approvalPolicy === 'workspace-auto'
  const ask = executionMode === 'go' && approvalPolicy === 'ask'
  return [
    {
      id: 'workspace-read',
      label: '工作区读取',
      status: 'allowed',
      detail: '仅限当前项目目录。',
    },
    {
      id: 'workspace-write',
      label: '工作区写入',
      status: workspaceAuto ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: workspaceAuto
        ? 'edit / write 限制在项目内；.git 与 .milksu 受保护。'
        : ask
          ? 'Sidecar 暂无桌面同步审批通道，因此当前按只读执行。'
          : '当前模式禁止修改文件。',
    },
    {
      id: 'command',
      label: '命令执行',
      status: workspaceAuto ? 'allowed' : 'blocked',
      detail: workspaceAuto
        ? '仅固定的无网络 build / test / lint / smoke 命令。'
        : '当前模式不提供 bash。',
    },
    {
      id: 'network',
      label: '网络',
      status: 'blocked',
      detail: '不会由 Workspace Auto 自动批准。',
    },
    {
      id: 'credentials',
      label: '凭据',
      status: 'blocked',
      detail: 'Provider Key 不进入模型上下文。',
    },
    {
      id: 'browser',
      label: '浏览器 / MCP',
      status: 'unavailable',
      detail: '尚未接入，未来仍需显式批准。',
    },
    {
      id: 'computer-use',
      label: 'Computer Use',
      status: 'unavailable',
      detail: '尚未接入，不会被自动启用。',
    },
  ]
}
