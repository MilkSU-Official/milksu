import type {
  CodingApprovalPolicy,
  CodingCapability,
  CodingExecutionMode,
} from '@/types'
import type { CodingComputerUseTarget } from '@/codingEnvironmentTypes'

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
      label: '文件读取',
      status: 'allowed',
      detail: 'Pi 文件与终端工具使用当前系统用户可读的路径。',
    },
    {
      id: 'workspace-write',
      label: '文件写入',
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: fullAuto
        ? 'Pi 文件与终端工具使用当前系统用户权限。'
        : workspaceAuto
          ? 'Pi 文件与终端工具直接执行；大范围递归删除仍需单独确认。'
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
          ? '使用 Pi 原生命令工具运行开发命令和后台工具，支持网络。'
        : ask
          ? '每次 bash 调用前展示完整命令并等待批准。'
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
        ? '当前模式不可用。'
        : imageGenConfigured
          ? '每次调用前确认输入与费用。'
          : '需在设置中配置 OpenAI。',
    },
    {
      id: 'credentials',
      label: '凭据',
      status: fullAuto ? 'allowed' : 'blocked',
      detail: fullAuto
        ? '可使用当前系统用户凭据。'
        : 'Provider Key 不进入模型上下文。',
    },
    {
      id: 'browser',
      label: '浏览器 / MCP',
      status: 'unavailable',
      detail: '任务显式选择后加载。',
    },
    {
      id: 'computer-use',
      label: 'Computer Use',
      status: 'unavailable',
      detail: '选择可见窗口并启动会话后可用。',
    },
  ]
}

export function describeActiveComputerUseCapability(
  executionMode: CodingExecutionMode,
  approvalPolicy: CodingApprovalPolicy,
  target: CodingComputerUseTarget,
): Pick<CodingCapability, 'status' | 'detail'> {
  const targetLabel = `${target.name} (${target.bundleId})，PID ${target.pid}，Window ${target.windowId}`
  if (executionMode !== 'go' || approvalPolicy === 'read-only') {
    return {
      status: 'blocked',
      detail: `已锁定 ${targetLabel}；需 Go 且非只读。`,
    }
  }
  return {
    status: approvalPolicy === 'ask' ? 'approval-required' : 'allowed',
    detail: approvalPolicy === 'ask'
      ? `已锁定 ${targetLabel}；操作前会确认。`
      : `已锁定 ${targetLabel}。`,
  }
}

export function describePendingComputerUseCapability(
  executionMode: CodingExecutionMode,
  approvalPolicy: CodingApprovalPolicy,
  target: CodingComputerUseTarget | null,
  state: {
    available: boolean
    permissionsReady: boolean
    attachedToOtherTask?: boolean
    problem?: string
  },
): Pick<CodingCapability, 'status' | 'detail'> {
  if (!state.available) {
    return {
      status: 'unavailable',
      detail: state.problem
        || '打包的 Cua Driver 不可用。用户已请求 Computer Use 时，使用 prepare_computer_use_driver 把 MilkSU 审阅过的 Driver 放到本机。',
    }
  }
  if (state.attachedToOtherTask) {
    return {
      status: 'unavailable',
      detail: '可见会话正由另一个任务使用。',
    }
  }
  if (!state.permissionsReady) {
    return {
      status: 'unavailable',
      detail: '需授权辅助功能与屏幕录制。',
    }
  }
  if (!target) {
    return {
      status: 'unavailable',
      detail: '请选择一个可见窗口。',
    }
  }
  const targetLabel = `${target.name} (${target.bundleId})，PID ${target.pid}，Window ${target.windowId}`
  if (executionMode !== 'go' || approvalPolicy === 'read-only') {
    return {
      status: 'blocked',
      detail: `已检测到 ${targetLabel}；需 Go 且非只读。`,
    }
  }
  return {
    status: 'approval-required',
    detail: `已检测到 ${targetLabel}；启动可见会话后锁定。`,
  }
}

export function computerUseTargetKey(target: Pick<CodingComputerUseTarget, 'pid' | 'windowId'>): string {
  return `${target.pid}:${target.windowId}`
}

export function selectedComputerUseTarget(
  targets: CodingComputerUseTarget[],
  selectedKey: string,
): CodingComputerUseTarget | null {
  return targets.find(target => computerUseTargetKey(target) === selectedKey) ?? null
}

export function nextComputerUseTargetKey(
  targets: CodingComputerUseTarget[],
  selectedKey: string,
  activeTarget?: CodingComputerUseTarget | null,
  host?: ComputerUseHostIdentity,
): string {
  if (selectedComputerUseTarget(targets, selectedKey)) return selectedKey
  if (activeTarget && selectedComputerUseTarget(targets, computerUseTargetKey(activeTarget))) {
    return computerUseTargetKey(activeTarget)
  }
  const firstExternalTarget = targets.find(target => !isSelfComputerUseTarget(target, host))
  return firstExternalTarget
    ? computerUseTargetKey(firstExternalTarget)
    : targets[0]
      ? computerUseTargetKey(targets[0])
      : ''
}

/** Host identity used to decide which visible window is "self". */
export type ComputerUseHostIdentity = {
  hostBundleId?: string
  hostPid?: number
}

/**
 * True when the target is the controlling MilkSU host process/app.
 * Uses exact host bundle id (and optional host pid) — never name/substring
 * matching — so Stable can still select identity-isolated MilkSU Beta.
 */
export function isSelfComputerUseTarget(
  target: Pick<CodingComputerUseTarget, 'name' | 'bundleId' | 'pid'>,
  host: ComputerUseHostIdentity = {},
): boolean {
  const hostBundleId = String(host.hostBundleId ?? '').trim().toLowerCase()
  const targetBundleId = target.bundleId.trim().toLowerCase()
  if (hostBundleId && targetBundleId && hostBundleId === targetBundleId) {
    return true
  }
  const hostPid = Number(host.hostPid)
  if (Number.isInteger(hostPid) && hostPid > 1 && target.pid === hostPid) {
    return true
  }
  return false
}

export function computerUseStartArgs(
  conversationId: string,
  target: CodingComputerUseTarget,
): {
  conversationId: string
  targetPid: number
  targetWindowId: number
} {
  return {
    conversationId,
    targetPid: target.pid,
    targetWindowId: target.windowId,
  }
}
