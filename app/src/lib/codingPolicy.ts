import type {
  CodingApprovalPolicy,
  CodingCapability,
  CodingExecutionMode,
} from '@/types'
import type { CodingComputerUseTarget } from '@/codingEnvironmentTypes'
import { t } from '@/lib/uiLocale'

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
      label: t('文件读取', 'File read'),
      status: 'allowed',
      detail: t('读取当前用户可读的文件。', 'Read files the current user can access.'),
    },
    {
      id: 'workspace-write',
      label: t('文件写入', 'File write'),
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: fullAuto
        ? t('使用当前系统用户权限。', 'Uses the current system user permissions.')
        : workspaceAuto
          ? t('大范围递归删除仍需单独确认。', 'Large recursive deletes still need a separate confirmation.')
        : ask
          ? t('每次改文件前会询问。', 'Asks before each file change.')
          : t('当前模式禁止修改文件。', 'This mode cannot modify files.'),
    },
    {
      id: 'command',
      label: t('命令执行', 'Command execution'),
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: fullAuto
        ? t('命令自动执行。', 'Commands run automatically.')
        : workspaceAuto
          ? t('可运行开发命令。', 'Development commands can run.')
        : ask
          ? t('每次运行命令前会询问。', 'Asks before each command.')
          : t('当前模式不能运行命令。', 'This mode cannot run commands.'),
    },
    {
      id: 'network',
      label: t('网络', 'Network'),
      status: mutating ? 'allowed' : ask ? 'approval-required' : 'blocked',
      detail: mutating
        ? t('允许开发命令访问网络。', 'Development commands may use the network.')
        : ask
          ? t('网络只能通过已展示并单次批准的命令使用。', 'Network is only available through a shown, one-time approved command.')
          : t('当前模式禁止网络命令。', 'This mode cannot run network commands.'),
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
        ? t('当前模式不可用。', 'Unavailable in this mode.')
        : imageGenConfigured
          ? t('每次调用前确认输入与费用。', 'Confirms the input and cost before each call.')
          : t('需在设置中配置 OpenAI。', 'Configure OpenAI in Settings.'),
    },
    {
      id: 'credentials',
      label: t('凭据', 'Credentials'),
      status: fullAuto ? 'allowed' : 'blocked',
      detail: fullAuto
        ? t('可使用当前系统用户凭据。', 'May use the current system user credentials.')
        : t('当前模式不使用本机凭据。', 'This mode does not use local credentials.'),
    },
    {
      id: 'browser',
      label: t('浏览器 / MCP', 'Browser / MCP'),
      status: 'unavailable',
      detail: t('选择后可用。', 'Available after you select it.'),
    },
    {
      id: 'computer-use',
      label: 'Computer Use',
      status: 'unavailable',
      detail: t('选择窗口后可用。', 'Available after you select a window.'),
    },
  ]
}

export function describeActiveComputerUseCapability(
  executionMode: CodingExecutionMode,
  approvalPolicy: CodingApprovalPolicy,
  target: CodingComputerUseTarget,
): Pick<CodingCapability, 'status' | 'detail'> {
  const targetLabel = t(`${target.name}（${target.bundleId}）`, `${target.name} (${target.bundleId})`)
  if (executionMode !== 'go' || approvalPolicy === 'read-only') {
    return {
      status: 'blocked',
      detail: t(`已锁定 ${targetLabel}；当前模式不能操作外部 App。`, `Locked to ${targetLabel}; this mode cannot control an external app.`),
    }
  }
  return {
    status: approvalPolicy === 'ask' ? 'approval-required' : 'allowed',
    detail: approvalPolicy === 'ask'
      ? t(`已锁定 ${targetLabel}；操作前会确认。`, `Locked to ${targetLabel}; confirms before acting.`)
      : t(`已锁定 ${targetLabel}。`, `Locked to ${targetLabel}.`),
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
        || t('Computer Use 当前不可用。', 'Computer Use is currently unavailable.'),
    }
  }
  if (state.attachedToOtherTask) {
    return {
      status: 'unavailable',
      detail: t('可见会话正由另一个任务使用。', 'The visible session is in use by another task.'),
    }
  }
  if (!state.permissionsReady) {
    return {
      status: 'unavailable',
      detail: t('需授权辅助功能与屏幕录制。', 'Accessibility and Screen Recording permission are required.'),
    }
  }
  if (!target) {
    return {
      status: 'unavailable',
      detail: t('选择窗口', 'Select a window'),
    }
  }
  const targetLabel = t(`${target.name}（${target.bundleId}）`, `${target.name} (${target.bundleId})`)
  if (executionMode !== 'go' || approvalPolicy === 'read-only') {
    return {
      status: 'blocked',
      detail: t(`已检测到 ${targetLabel}；当前模式不能操作外部 App。`, `Detected ${targetLabel}; this mode cannot control an external app.`),
    }
  }
  return {
    status: 'approval-required',
    detail: t(`已检测到 ${targetLabel}；启动后锁定。`, `Detected ${targetLabel}; it will lock after start.`),
  }
}

export function isEmulatorComputerUseTarget(
  target: Pick<CodingComputerUseTarget, 'name' | 'bundleId' | 'windowTitle'>,
): boolean {
  const blob = `${target.name} ${target.bundleId} ${target.windowTitle ?? ''}`.toLowerCase()
  return /qemu|emulator|android/.test(blob)
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
  prefer?: (target: CodingComputerUseTarget) => boolean,
): string {
  if (selectedComputerUseTarget(targets, selectedKey)) return selectedKey
  if (activeTarget && selectedComputerUseTarget(targets, computerUseTargetKey(activeTarget))) {
    return computerUseTargetKey(activeTarget)
  }
  if (prefer) {
    const preferred = targets.find(target => prefer(target) && !isSelfComputerUseTarget(target, host))
    if (preferred) return computerUseTargetKey(preferred)
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
