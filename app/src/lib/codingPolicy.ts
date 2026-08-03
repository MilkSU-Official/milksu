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
  imageGenConfigured = false,
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
          ? '每次 edit / write 前暂停并展示参数；只有本次明确批准后执行。'
          : '当前模式禁止修改文件。',
    },
    {
      id: 'command',
      label: '命令执行',
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: fullAuto
        ? '命令自动执行，不受项目沙箱限制；模型 Provider Key 不传给子进程。'
        : workspaceAuto
          ? '项目沙箱内可运行开发命令和后台工具，支持网络。'
        : ask
          ? '每次 bash 调用前展示完整命令并等待批准；仍受项目沙箱约束。'
          : '当前模式不提供 bash。',
    },
    {
      id: 'network',
      label: '网络',
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: mutating
        ? '允许开发命令访问网络。'
        : ask
          ? '网络只能通过已展示并单次批准的命令使用。'
          : '当前模式禁止网络命令。',
    },
    {
      id: 'imagegen',
      label: 'ImageGen',
      status: executionMode !== 'go' || approvalPolicy === 'read-only'
        ? 'blocked'
        : imageGenConfigured
          ? 'approval-required'
          : 'unavailable',
      detail: executionMode !== 'go' || approvalPolicy === 'read-only'
        ? '当前模式不提供付费 ImageGen 调用。'
        : imageGenConfigured
          ? '每次生成或参考图编辑都单独展示输入、输出、尺寸和费用后批准。'
          : '需要先在设置中配置并启用 OpenAI；Provider Key 不会进入 Agent、终端或工具输出。',
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
      detail: '仅在任务显式选择后加载；审批行为跟随当前 Coding 权限档位。',
    },
    {
      id: 'computer-use',
      label: 'Computer Use',
      status: 'unavailable',
      detail: '仅在用户显式启动 MilkSU 应用范围会话后可用；调用跟随当前 Coding 权限档位。',
    },
  ]
}
