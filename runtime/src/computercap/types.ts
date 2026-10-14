export const DRIVER_VERSION = '0.29.1'
export const DEFAULT_HOST_BUNDLE_ID = 'com.milksu.app'
export const LINUX_PORTAL_BUNDLE_ID = 'org.freedesktop.portal.Desktop'
export const LINUX_COMPUTER_USE_PROBLEM =
  'Computer Use 在当前 Linux 桌面上不可用。GNOME Wayland 可走系统桌面共享授权；Hyprland 仍不可用。不会走 xinput 摘键鼠。'
export const MISSING_DRIVER_PROBLEM =
  '打包的 Cua Driver 不可用。用户已请求 Computer Use 时，使用 prepare_computer_use_driver 把 MilkSU 审阅过的 Driver 放到本机；不要运行 Cua 官方安装脚本，也不要回退到系统级全局控制。'

export type PermissionKind = 'accessibility' | 'screen-recording'

export type Permissions = {
  accessibility: boolean
  screenRecording: boolean
}

export type SigningStatus = {
  bundleId: string
  executablePath?: string
  signature?: string
  teamIdentifier?: string
  stableIdentity: boolean
  problem?: string
}

export type Target = {
  name: string
  bundleId: string
  pid: number
  windowId: number
  windowTitle?: string
  executablePath?: string
}

export type TargetSelection = {
  pid: number
  windowId: number
}

export type Status = {
  available: boolean
  enabled: boolean
  authorized: boolean
  conversationId?: string
  sessionId?: string
  phase: string
  startedAt?: string
  driverVersion?: string
  target: Target
  grantedTarget?: Target
  permissions: Permissions
  signing: SigningStatus
  problem?: string
}

export type Descriptor = {
  sessionId: string
  socketPath: string
  targetBundleId: string
  targetName: string
  targetPid: number
  targetWindowId: number
}

export type PrepareOptions = {
  allowBuild?: boolean
}

export type PrepareResult = {
  ready: boolean
  source?: string
  path?: string
  version: string
  problem?: string
  recipe?: string
  nextStep?: string
}

export type LinuxDesktopInfo = {
  available: boolean
  problem?: string
}

export type Grant = {
  conversationId: string
  target: Target
  grantedAt: string
}

export function permissionsReady(value: Permissions): boolean {
  return Boolean(value.accessibility && value.screenRecording)
}

export function parsePermissionKind(value: string): PermissionKind {
  const kind = String(value ?? '').trim()
  if (kind === 'accessibility' || kind === 'screen-recording') return kind
  throw new Error(`unsupported Computer Use permission ${JSON.stringify(value)}`)
}

export function publicTarget(target: Target): Target {
  const next: Target = {
    name: target.name,
    bundleId: target.bundleId,
    pid: target.pid,
    windowId: target.windowId,
  }
  if (target.windowTitle) next.windowTitle = target.windowTitle
  return next
}

export function publicStatus(status: Status): Status {
  return {
    ...status,
    target: publicTarget(status.target),
    grantedTarget: status.grantedTarget ? publicTarget(status.grantedTarget) : undefined,
  }
}

export function linuxPortalDesktopTarget(): Target {
  return {
    name: 'Desktop',
    bundleId: LINUX_PORTAL_BUNDLE_ID,
    pid: 2,
    windowId: 1,
    windowTitle: 'Desktop',
  }
}

export function linuxPortalSigning(): SigningStatus {
  return {
    bundleId: DEFAULT_HOST_BUNDLE_ID,
    signature: 'linux-portal',
    stableIdentity: true,
  }
}
