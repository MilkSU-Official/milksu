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
          ? '文件与命令写入限制在项目内；显式准备协作后也可写已注册 worktree；允许正常 Git 操作，文件工具保护 .milksu。'
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
      detail: '仅在用户显式选择可见 App / 窗口并启动会话后可用；需要操作 GUI 时必须先停下引导启用，不能用 Shell、截图目录、SQLite、IPC 或私有协议绕过可见会话 Scope。',
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
      detail: `已锁定 ${targetLabel}；当前 Plan 或只读策略不会操作可见 App。切换到普通 Go 后才会按所选权限档执行。`,
    }
  }
  return {
    status: approvalPolicy === 'ask' ? 'approval-required' : 'allowed',
    detail: approvalPolicy === 'ask'
      ? `已锁定 ${targetLabel}；请求批准档会逐次确认观察和操作。`
      : `已锁定 ${targetLabel}；当前权限档会自动执行观察和操作。`,
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
      detail: state.problem || 'Computer Use 当前不可用；可先用 Browser 或产物预览验收。',
    }
  }
  if (state.attachedToOtherTask) {
    return {
      status: 'unavailable',
      detail: '可见 App 会话正由另一个 Coding 任务使用；先回到该任务停止后再切换。',
    }
  }
  if (!state.permissionsReady) {
    return {
      status: 'unavailable',
      detail: '需要先授权 macOS 辅助功能与屏幕录制；App 管理权限不能替代 Computer Use。',
    }
  }
  if (!target) {
    return {
      status: 'unavailable',
      detail: '系统权限已具备；打开目标 App 窗口后，在 Browser/App 面板选择可见窗口。',
    }
  }
  const targetLabel = `${target.name} (${target.bundleId})，PID ${target.pid}，Window ${target.windowId}`
  if (executionMode !== 'go' || approvalPolicy === 'read-only') {
    return {
      status: 'blocked',
      detail: `已检测到 ${targetLabel}，但当前 Plan 或只读策略不会操作可见 App；切到 Go 后再启动会话。`,
    }
  }
  return {
    status: 'approval-required',
    detail: `已检测到 ${targetLabel}；打开 Browser/App 面板点击“启动可见会话”后才会锁定 Scope 并按当前权限档操作。`,
  }
}

export function computerUseTargetKey(target: Pick<CodingComputerUseTarget, 'pid' | 'windowId'>): string {
  return `${target.pid}:${target.windowId}`
}

const browserBundleIDs = [
  'com.apple.safari',
  'com.brave.browser',
  'com.google.chrome',
  'com.microsoft.edgemac',
  'com.operasoftware.opera',
  'com.vivaldi.vivaldi',
  'company.thebrowser.browser',
  'org.chromium.chromium',
  'org.mozilla.firefox',
]
const browserNames = new Set([
  'arc',
  'brave browser',
  'chromium',
  'firefox',
  'google chrome',
  'microsoft edge',
  'opera',
  'safari',
  'vivaldi',
])

export function isUserBrowserTarget(
  target: Pick<CodingComputerUseTarget, 'name' | 'bundleId'>,
): boolean {
  const bundleID = target.bundleId.trim().toLocaleLowerCase()
  const name = target.name.trim().toLocaleLowerCase()
  return browserBundleIDs.some(candidate => (
    bundleID === candidate || bundleID.startsWith(`${candidate}.`)
  )) || browserNames.has(name)
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
