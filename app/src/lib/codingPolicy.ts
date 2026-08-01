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
  return value === 'read-only'
    || value === 'ask'
    || value === 'workspace-auto'
    || value === 'full-auto'
    ? value
    : DEFAULT_CODING_APPROVAL_POLICY
}

export function previewCodingCapabilities(
  executionMode: CodingExecutionMode,
  approvalPolicy: CodingApprovalPolicy,
): CodingCapability[] {
  const workspaceAuto = executionMode === 'go' && approvalPolicy === 'workspace-auto'
  const fullAuto = executionMode === 'go' && approvalPolicy === 'full-auto'
  const ask = executionMode === 'go' && approvalPolicy === 'ask'
  const mutating = workspaceAuto || fullAuto
  return [
    {
      id: 'workspace-read',
      label: '工作区读取',
      status: 'allowed',
      detail: fullAuto
        ? '文件工具读取项目；终端可访问当前系统用户可读的路径。'
        : '文件与终端读取限制在当前项目和系统开发工具。',
    },
    {
      id: 'workspace-write',
      label: '工作区写入',
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: fullAuto
        ? '终端具有当前系统用户权限；文件工具仍以项目为默认边界。'
        : workspaceAuto
          ? '文件与命令写入限制在项目内；允许正常 Git 操作，文件工具保护 .milksu。'
        : ask
          ? 'Sidecar 暂无桌面同步审批通道，因此当前按只读执行。'
          : '当前模式禁止修改文件。',
    },
    {
      id: 'command',
      label: '命令执行',
      status: mutating ? 'allowed' : 'blocked',
      detail: fullAuto
        ? '命令自动执行，不受项目沙箱限制；模型 Provider Key 不传给子进程。'
        : workspaceAuto
          ? '项目沙箱内可运行开发命令和后台工具，支持网络。'
        : '当前模式不提供 bash。',
    },
    {
      id: 'network',
      label: '网络',
      status: mutating ? 'allowed' : 'blocked',
      detail: mutating ? '允许开发命令访问网络。' : '当前模式禁止网络命令。',
    },
    {
      id: 'credentials',
      label: '凭据',
      status: fullAuto ? 'allowed' : 'blocked',
      detail: fullAuto
        ? '终端可使用当前系统用户的凭据；模型 Provider Key 仍不进入子进程。'
        : 'Provider Key 不进入模型上下文，项目自动也不能读取用户凭据目录。',
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
