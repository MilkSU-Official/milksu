import { join } from 'node:path'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import { dataDirectory } from '../home.ts'
import {
  Manager,
  parsePermissionKind,
  publicStatus,
  publicTarget,
  type LinuxDesktopInfo,
  type ManagerOptions,
  type Permissions,
  type SigningStatus,
  type Status,
  type Target,
} from '../computercap/index.ts'

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

const managers = new Map<string, Manager>()
const overrides = new Map<string, ManagerOptions>()

export function bindComputerUse(home: string, options: ManagerOptions): void {
  overrides.set(home, options)
  const existing = managers.get(home)
  if (existing) {
    managers.delete(home)
    void existing.close()
  }
}

export async function closeComputerUse(home: string): Promise<void> {
  const manager = managers.get(home)
  if (manager) {
    managers.delete(home)
    overrides.delete(home)
    await manager.close()
  }
  const portal = portals.get(home)
  if (portal) {
    portals.delete(home)
    await portal.stop()
  }
}

export function computerUseDescriptor(home: string, conversationId: string) {
  return managers.get(home)?.descriptor(conversationId)
}

function desktopHostPid(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number.parseInt(String(env.MILKSU_DESKTOP_HOST_PID ?? '').trim(), 10)
  return Number.isInteger(value) && value > 1 ? value : 0
}

function asPermissions(value: unknown): Permissions {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    accessibility: Boolean(raw.accessibility),
    screenRecording: Boolean(raw.screenRecording),
  }
}

function asSigning(value: unknown): SigningStatus {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    bundleId: String(raw.bundleId ?? ''),
    executablePath: raw.executablePath ? String(raw.executablePath) : undefined,
    signature: raw.signature ? String(raw.signature) : undefined,
    teamIdentifier: raw.teamIdentifier ? String(raw.teamIdentifier) : undefined,
    stableIdentity: Boolean(raw.stableIdentity),
    problem: raw.problem ? String(raw.problem) : undefined,
  }
}

function asTargets(value: unknown): Target[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      name: String(raw.name ?? ''),
      bundleId: String(raw.bundleId ?? ''),
      pid: Number(raw.pid ?? 0),
      windowId: Number(raw.windowId ?? 0),
      windowTitle: raw.windowTitle ? String(raw.windowTitle) : undefined,
      executablePath: raw.executablePath ? String(raw.executablePath) : undefined,
    }
  })
}

const portals = new Map<string, { start(path: string): Promise<void>; stop(): Promise<void> }>()

async function portalFor(home: string) {
  let server = portals.get(home)
  if (server) return server
  const { PortalServer } = await import('../computercap/portal.ts')
  server = new PortalServer()
  portals.set(home, server)
  return server
}

function productionOptions(ctx: HandlerContext): ManagerOptions {
  return {
    home: ctx.home,
    sidecarDir: String(process.env.MILKSU_SIDECAR_DIR ?? '').trim(),
    grantDirectory: join(dataDirectory(ctx.home), 'services', 'computer-use', 'task-authorizations'),
    targetPid: desktopHostPid(),
    hostBundleId: String(process.env.MILKSU_DESKTOP_APP_ID ?? '').trim(),
    permissionProbe: async () => {
      try {
        if (!ctx.hostCall) return { accessibility: false, screenRecording: false }
        return asPermissions(await ctx.hostCall('computerUse.permissions', { prompt: false }))
      } catch {
        return { accessibility: false, screenRecording: false }
      }
    },
    permissionOpen: async (kind) => {
      if (!ctx.hostCall) return
      await ctx.hostCall('computerUse.openPermissions', { permission: kind })
    },
    signingProbe: async () => {
      try {
        const { probeSigning } = await import('../native/signing.ts')
        return asSigning(await probeSigning())
      } catch {
        return { bundleId: '', signature: 'unknown', stableIdentity: false }
      }
    },
    targetProvider: async () => {
      const { listPlatformWindows } = await import('../native/windows.ts')
      return asTargets(await listPlatformWindows())
    },
    hostExecutable: async (pid) => {
      const { hostExecutable } = await import('../native/windows.ts')
      return hostExecutable(pid)
    },
    linuxPortal: async () => {
      const { probeLinuxDesktop } = await import('../native/linux-desktop.ts')
      return probeLinuxDesktop().available
    },
    linuxDesktop: async () => {
      try {
        const { probeLinuxDesktop } = await import('../native/linux-desktop.ts')
        return probeLinuxDesktop() as LinuxDesktopInfo
      } catch {
        return { available: false }
      }
    },
    startPortal: async (socketPath) => {
      await (await portalFor(ctx.home)).start(socketPath)
    },
    stopPortal: async () => {
      await (await portalFor(ctx.home)).stop()
    },
  }
}

function managerFor(ctx: HandlerContext): Manager {
  const existing = managers.get(ctx.home)
  if (existing) return existing
  const manager = new Manager({ ...productionOptions(ctx), ...overrides.get(ctx.home) })
  managers.set(ctx.home, manager)
  return manager
}

function statusError(error: unknown, fallback: Status): Status {
  const extra = error && typeof error === 'object' && 'status' in error
    ? (error as { status?: Status }).status
    : undefined
  const status = extra ?? fallback
  status.problem = error instanceof Error ? error.message : String(error)
  return publicStatus(status)
}

registerOwnedHandlers({
  async GetCodingComputerUseStatus(ctx) {
    return managerFor(ctx).status()
  },
  async GetComputerUseStatus(ctx, args) {
    const conversationId = String(arg(args, 0, '')).trim()
    const manager = managerFor(ctx)
    if (conversationId) return manager.statusForConversation(conversationId)
    return manager.status()
  },
  async ListCodingComputerUseTargets(ctx) {
    return (await managerFor(ctx).targets()).map((target) => publicTarget(target))
  },
  async PrepareCodingComputerUseDriver(ctx, args) {
    const result = await managerFor(ctx).prepare({ allowBuild: Boolean(arg(args, 0, false)) })
    if (!result.ready) throw new Error(result.problem || 'Computer Use driver is unavailable')
    return result
  },
  async ActivateCodingComputerUse(ctx, args) {
    const conversationId = String(arg(args, 0, '')).trim()
    const manager = managerFor(ctx)
    try {
      const restored = await manager.restore(conversationId)
      return restored.status
    } catch (error) {
      return statusError(error, await manager.statusForConversation(conversationId))
    }
  },
  async RequestCodingComputerUsePermissions(ctx, args) {
    const kind = parsePermissionKind(String(arg(args, 0, '')))
    return managerFor(ctx).requestPermission(kind)
  },
  async StartCodingComputerUse(ctx, args) {
    return managerFor(ctx).start(
      String(arg(args, 0, '')),
      { pid: Number(arg(args, 1, 0)), windowId: Number(arg(args, 2, 0)) },
    )
  },
  async GrantComputerUseTarget(ctx, args) {
    return managerFor(ctx).start(
      String(arg(args, 0, '')),
      { pid: Number(arg(args, 1, 0)), windowId: Number(arg(args, 2, 0)) },
    )
  },
  async StopCodingComputerUse(ctx, args) {
    const conversationId = String(arg(args, 0, '')).trim()
    const manager = managerFor(ctx)
    if (!manager.ownsConversation(conversationId)) {
      const status = await manager.statusForConversation(conversationId)
      if (!status.authorized) {
        throw Object.assign(new Error('Computer Use session does not belong to this Coding task'), { status })
      }
      return manager.stop(conversationId)
    }
    await ctx.engine.detachSession(conversationId)
    return manager.stop(conversationId)
  },
  async RevokeComputerUseTarget(ctx, args) {
    const conversationId = String(arg(args, 0, '')).trim()
    const manager = managerFor(ctx)
    if (manager.ownsConversation(conversationId)) {
      await ctx.engine.detachSession(conversationId)
    }
    return manager.stop(conversationId)
  },
})
