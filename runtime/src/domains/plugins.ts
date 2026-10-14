import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import { dataDirectory } from '../home.ts'
import { PluginRegistry, findOfficialSource, materializeOfficial } from '../plugin/index.ts'
import { DEVELOPMENT_HOST_VERSION, type SurfaceSlot, type UIRequest } from '../plugin/types.ts'
import { findProjectRoot } from '../sidecar.ts'

function nativeHelperPath(): string {
  return String(process.env.MILKSU_NATIVE_HELPER ?? process.env.MILKSU_BACKEND_PATH ?? '').trim()
}

const registries = new Map<string, PluginRegistry>()

export function bindPluginRegistry(home: string, registry: PluginRegistry): void {
  registries.set(home, registry)
}

export function unbindPluginRegistry(home: string): void {
  registries.delete(home)
}

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

function requireSource(ctx: HandlerContext, method: string, allowed: 'renderer' | 'electron_host'): void {
  const source = String(ctx.invokeSource ?? '')
  if (source !== allowed) {
    throw new Error(`desktop method ${method} is unavailable to ${source || 'unknown'}`)
  }
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function resolveTypeScriptWorker(): { node: string; worker: string } {
  const sidecarDir = String(process.env.MILKSU_SIDECAR_DIR ?? '').trim()
  if (sidecarDir) {
    const node = join(sidecarDir, process.platform === 'win32' ? 'node.exe' : 'node')
    const worker = join(sidecarDir, 'plugin-worker.mjs')
    if (regularFile(node) && regularFile(worker)) return { node, worker }
  }
  try {
    const root = findProjectRoot()
    const worker = join(root, 'sidecar', 'plugin-runtime', 'worker.mjs')
    if (regularFile(worker)) return { node: process.execPath, worker }
  } catch {
    // packaged runtime without a checkout
  }
  const helper = nativeHelperPath()
  if (helper) {
    const sidecar = join(dirname(helper), 'milksu-sidecar')
    const node = join(sidecar, process.platform === 'win32' ? 'node.exe' : 'node')
    const worker = join(sidecar, 'plugin-worker.mjs')
    if (regularFile(node) && regularFile(worker)) return { node, worker }
  }
  return { node: '', worker: '' }
}

function developmentDirectory(): string {
  if (String(process.env.MILKSU_PLUGIN_DEV ?? '').trim() !== '1') return ''
  try {
    const root = findProjectRoot()
    const directory = join(root, 'plugins', 'dev')
    if (existsSync(directory)) return directory
  } catch {
    // packaged runtime without a checkout
  }
  return ''
}

function hostVersion(): string {
  return String(process.env.MILKSU_APP_VERSION ?? '').trim() || DEVELOPMENT_HOST_VERSION
}

async function registryFor(ctx: HandlerContext): Promise<PluginRegistry> {
  const existing = registries.get(ctx.home)
  if (existing) return existing
  const data = dataDirectory(ctx.home)
  const official = await materializeOfficial(data, findOfficialSource())
  const worker = resolveTypeScriptWorker()
  const registry = await PluginRegistry.open({
    officialDirectory: official,
    installedDirectory: join(data, 'services', 'plugins', 'installed'),
    developmentDirectory: developmentDirectory(),
    dataDirectory: data,
    developmentMode: String(process.env.MILKSU_PLUGIN_DEV ?? '').trim() === '1',
    hostVersion: hostVersion(),
    nodeExecutable: worker.node,
    typeScriptWorker: worker.worker,
    invokeLua: async (directory, entry, request) => {
      return ctx.invokeHelper('RunLuaPlugin', [directory, entry, request], 'electron_host')
    },
  })
  registries.set(ctx.home, registry)
  return registry
}

async function hostCall(ctx: HandlerContext, method: string, payload: unknown): Promise<unknown> {
  if (!ctx.hostCall) throw new Error('desktop runtime is not ready')
  return ctx.hostCall(method, payload)
}

async function emitPluginChanges(ctx: HandlerContext, plugins: unknown, theme = true): Promise<void> {
  ctx.emit('plugins-changed', plugins)
  ctx.emit('plugin-tools-changed', null)
  if (!theme) return
  try {
    ctx.emit('plugin-theme-changed', await (await registryFor(ctx)).activeTheme())
  } catch {
    // theme may be unavailable while plugins are in error
  }
}

async function chooseSurface(ctx: HandlerContext, id: string, slot: SurfaceSlot) {
  const path = String(await hostCall(ctx, 'dialog.openFile', {
    title: '选择插件表面图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  }) ?? '').trim()
  if (!path) return { canceled: true, theme: { tokens: {} } }
  const theme = await (await registryFor(ctx)).importSurfaceAsset(id, slot, path)
  ctx.emit('plugin-theme-changed', theme)
  return { canceled: false, theme }
}

registerOwnedHandlers({
  async ListPlugins(ctx) {
    requireSource(ctx, 'ListPlugins', 'renderer')
    return (await registryFor(ctx)).list()
  },
  async ListPetPluginPackages(ctx) {
    requireSource(ctx, 'ListPetPluginPackages', 'electron_host')
    return (await registryFor(ctx)).listPetPluginPackages()
  },
  async SetPluginEnabled(ctx, args) {
    requireSource(ctx, 'SetPluginEnabled', 'renderer')
    const registry = await registryFor(ctx)
    await registry.setEnabled(arg(args, 0, ''), Boolean(arg(args, 1, false)))
    const plugins = await registry.list()
    await emitPluginChanges(ctx, plugins)
    return plugins
  },
  async GetPluginSettingsScript(ctx, args) {
    requireSource(ctx, 'GetPluginSettingsScript', 'renderer')
    return (await registryFor(ctx)).settingsScript(arg(args, 0, ''))
  },
  async GetActivePluginTheme(ctx) {
    requireSource(ctx, 'GetActivePluginTheme', 'renderer')
    return (await registryFor(ctx)).activeTheme()
  },
  async CallPluginUI(ctx, args) {
    requireSource(ctx, 'CallPluginUI', 'renderer')
    const registry = await registryFor(ctx)
    const value = await registry.callUI(arg(args, 0, ''), arg<UIRequest>(args, 1, { action: '' }))
    try {
      ctx.emit('plugin-theme-changed', await registry.activeTheme())
    } catch {
      // UI calls that do not change theme still succeed
    }
    return value
  },
  async ChoosePluginBackground(ctx, args) {
    requireSource(ctx, 'ChoosePluginBackground', 'renderer')
    return chooseSurface(ctx, arg(args, 0, ''), 'content-wallpaper')
  },
  async ChoosePluginSurface(ctx, args) {
    requireSource(ctx, 'ChoosePluginSurface', 'renderer')
    return chooseSurface(ctx, arg(args, 0, ''), arg(args, 1, 'content-wallpaper') as SurfaceSlot)
  },
  async GetPluginSurfaceAsset(ctx, args) {
    requireSource(ctx, 'GetPluginSurfaceAsset', 'renderer')
    return (await registryFor(ctx)).surfaceAsset(
      arg(args, 0, ''),
      arg(args, 1, 'content-wallpaper') as SurfaceSlot,
      arg(args, 2, ''),
    )
  },
  async ChoosePluginPackage(ctx) {
    requireSource(ctx, 'ChoosePluginPackage', 'renderer')
    const path = String(await hostCall(ctx, 'dialog.openFile', {
      title: '安装 MilkSU 插件',
      filters: [{ name: 'MilkSU 插件', extensions: ['milksu-plugin'] }],
    }) ?? '').trim()
    if (!path) return {}
    return (await registryFor(ctx)).stagePackage(path)
  },
  async InstallStagedPlugin(ctx, args) {
    requireSource(ctx, 'InstallStagedPlugin', 'renderer')
    const plugins = await (await registryFor(ctx)).installStagedPackage(
      arg(args, 0, ''),
      Boolean(arg(args, 1, false)),
      Boolean(arg(args, 2, false)),
      Boolean(arg(args, 3, false)),
    )
    ctx.emit('plugins-changed', plugins)
    ctx.emit('plugin-tools-changed', null)
    return plugins
  },
  async DiscardStagedPlugin(ctx, args) {
    requireSource(ctx, 'DiscardStagedPlugin', 'renderer')
    await (await registryFor(ctx)).discardStagedPackage(arg(args, 0, ''))
    return null
  },
  async RollbackPlugin(ctx, args) {
    requireSource(ctx, 'RollbackPlugin', 'renderer')
    const plugins = await (await registryFor(ctx)).rollbackPlugin(arg(args, 0, ''))
    ctx.emit('plugins-changed', plugins)
    ctx.emit('plugin-tools-changed', null)
    return plugins
  },
  async UninstallPlugin(ctx, args) {
    requireSource(ctx, 'UninstallPlugin', 'renderer')
    const plugins = await (await registryFor(ctx)).uninstallPlugin(arg(args, 0, ''), Boolean(arg(args, 1, false)))
    ctx.emit('plugins-changed', plugins)
    ctx.emit('plugin-tools-changed', null)
    return plugins
  },
  async SetPluginExternalEnabled(ctx, args) {
    requireSource(ctx, 'SetPluginExternalEnabled', 'renderer')
    const registry = await registryFor(ctx)
    await registry.setExternalEnabled(arg(args, 0, ''), Boolean(arg(args, 1, false)))
    const plugins = await registry.list()
    ctx.emit('plugins-changed', plugins)
    ctx.emit('plugin-tools-changed', null)
    return plugins
  },
  async ListPluginPublishers(ctx) {
    requireSource(ctx, 'ListPluginPublishers', 'renderer')
    return (await registryFor(ctx)).trustedPublishers()
  },
  async RevokePluginPublisher(ctx, args) {
    requireSource(ctx, 'RevokePluginPublisher', 'renderer')
    const plugins = await (await registryFor(ctx)).revokePublisher(arg(args, 0, ''))
    ctx.emit('plugins-changed', plugins)
    ctx.emit('plugin-tools-changed', null)
    return plugins
  },
  async GetPluginMCPConfig(ctx) {
    requireSource(ctx, 'GetPluginMCPConfig', 'renderer')
    const command = nativeHelperPath()
    if (!command || !regularFile(command)) {
      return { available: false, args: [], configuration: {} }
    }
    const args = ['plugin-mcp']
    return {
      available: true,
      command,
      args,
      configuration: {
        mcpServers: {
          'milksu-plugins': {
            command,
            args,
            env: {
              MILKSU_APPDATA_DIR: ctx.home,
              MILKSU_HOME: ctx.home,
              MILKSU_APP_VERSION: hostVersion(),
            },
          },
        },
      },
    }
  },
})
