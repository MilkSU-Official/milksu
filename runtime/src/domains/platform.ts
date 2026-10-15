import { spawn } from 'node:child_process'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import {
  applyPendingRestore,
  beginLifespan,
  DiagnosticRecorder,
  exportBackup,
  exportDiagnostics,
  inspectLocalDataStatus,
  markCleanExit,
  stageBackupRestore,
  type DatabaseDescriptor,
  type DiagnosticEvent,
  type LifespanHandle,
  type LifespanStart,
} from '../appdata/index.ts'
import { extensionsPage, findChrome } from '../browsercap/chrome.ts'
import type { AppSettings } from '../config/settings-store.ts'
import { jevKeyFromSettings, judgeApprovalRisk, probeAgentModel } from '../decision/index.ts'
import {
  dataDirectory,
  modelCatalogCachePath,
  sessionIndexPath,
} from '../home.ts'
import { ModelCatalogService } from '../modelcatalog/index.ts'
import { SUPPORTED_DATABASE_VERSION } from '../modelusage/index.ts'
import { SecurityToolsService } from '../securitytools/index.ts'
import { SessionIndexStore, sessionIndexBytes } from '../sessionindex/index.ts'
import { ensureUserArtifactDirectory, userArtifactDirectory } from '../userartifact/index.ts'
import { DEVELOPMENT_HOST_VERSION } from '../plugin/types.ts'
import { agentResourceStoreFor } from './resources.ts'

type PlatformState = {
  sessionIndex: SessionIndexStore
  catalog: ModelCatalogService
  securityTools: SecurityToolsService
  diagnostics: DiagnosticRecorder
  lifespanStart: LifespanStart
  lifespanHandle: LifespanHandle
}

const states = new Map<string, PlatformState>()
const RESEARCH_DATABASE_VERSION = 4
const EVENT_STORE_DATABASE_VERSION = 1

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) return fallback
  return args[index] as T
}

function stateFor(ctx: HandlerContext): PlatformState {
  const existing = states.get(ctx.home)
  if (!existing) throw new Error('platform services are not ready')
  return existing
}

async function hostCall(ctx: HandlerContext, method: string, payload: unknown): Promise<unknown> {
  if (!ctx.hostCall) throw new Error('desktop runtime is not ready')
  return ctx.hostCall(method, payload)
}

function databaseDescriptors(): DatabaseDescriptor[] {
  return [
    { logicalName: 'EventStore', relativePath: 'data/runtime/events.sqlite3', supported: EVENT_STORE_DATABASE_VERSION },
    { logicalName: 'Coding Agent Usage', relativePath: 'data/stores/usage/model-usage.sqlite3', supported: SUPPORTED_DATABASE_VERSION },
    { logicalName: 'Research', relativePath: 'data/domain/research/research.sqlite3', supported: RESEARCH_DATABASE_VERSION },
  ]
}

export async function applyStartupRestore(home: string): Promise<void> {
  await applyPendingRestore(home)
}

const lifespans = new Map<string, { start: LifespanStart; handle: LifespanHandle }>()

export async function beginRuntimeLifespan(home: string): Promise<LifespanStart> {
  const { start, handle } = await beginLifespan(home, process.pid)
  lifespans.set(home, { start, handle })
  const existing = states.get(home)
  if (existing) {
    existing.lifespanStart = start
    existing.lifespanHandle = handle
  }
  return start
}

export async function bindPlatformServices(options: {
  home: string
  settings: NonNullable<HandlerContext['settings']>
  emit: HandlerContext['emit']
}): Promise<void> {
  const { home, settings, emit } = options
  const previous = states.get(home)
  const sessionIndex = previous?.sessionIndex ?? SessionIndexStore.open(sessionIndexPath(home))
  const catalog = previous?.catalog && previous.catalog.cachePath === modelCatalogCachePath(home)
    ? previous.catalog
    : await ModelCatalogService.open(dataDirectory(home), () => settings.getResolved())
  const securityTools = new SecurityToolsService(
    dataDirectory(home),
    settings,
    (snapshot) => emit('security-tool-setup', snapshot),
  )
  const life = lifespans.get(home)
  states.set(home, {
    sessionIndex,
    catalog,
    securityTools,
    diagnostics: previous?.diagnostics ?? new DiagnosticRecorder(),
    lifespanStart: life?.start ?? previous?.lifespanStart ?? {
      previousExit: 'none',
      consecutiveAbnormalExits: 0,
      startedAt: new Date().toISOString(),
    },
    lifespanHandle: life?.handle ?? previous?.lifespanHandle ?? { runId: '' },
  })
  void catalog.refresh().then((snapshot) => {
    emit('model-catalog-changed', snapshot)
  }).catch(() => {
    // keep the bundled or cached snapshot
  })
}

export async function markRuntimeCleanExit(home: string): Promise<void> {
  const state = states.get(home)
  if (!state?.lifespanHandle.runId) return
  try {
    await markCleanExit(home, state.lifespanHandle)
  } catch {
    // shutdown still proceeds if the marker was already closed
  }
}

export function securityToolsFor(home: string): SecurityToolsService | undefined {
  return states.get(home)?.securityTools
}

registerOwnedHandlers({
  async GetSessionIndexStatus(ctx) {
    const store = stateFor(ctx).sessionIndex
    const status = store.status()
    return { ...status, bytes: sessionIndexBytes(store.path) }
  },
  async RefreshSessionIndex(ctx) {
    const conversations = await ctx.conversations.list()
    return stateFor(ctx).sessionIndex.refresh(conversations)
  },
  async GetModelCatalog(ctx) {
    return stateFor(ctx).catalog.current()
  },
  async GetImageGenCatalog(ctx) {
    return stateFor(ctx).catalog.imageCatalog()
  },
  async GetLocalDataStatus(ctx) {
    return inspectLocalDataStatus(ctx.home, databaseDescriptors())
  },
  async GetUserArtifactDirectoryStatus() {
    return { directory: userArtifactDirectory() }
  },
  async ExportLocalDataBackup(ctx) {
    const destination = String(await hostCall(ctx, 'dialog.save', {
      title: '导出 MilkSU 本地数据备份',
      defaultPath: `MilkSU-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ Name: 'MilkSU 备份', Extensions: ['zip'] }],
    }) ?? '').trim()
    if (!destination) return { cancelled: true }
    return exportBackup(ctx.home, destination)
  },
  async ScheduleLocalDataRestore(ctx) {
    const source = String(await hostCall(ctx, 'dialog.openFile', {
      title: '从 MilkSU 安全备份恢复',
      filters: [{ Name: 'MilkSU 备份', Extensions: ['zip'] }],
    }) ?? '').trim()
    if (!source) return { cancelled: true }
    const { validateBackup } = await import('../appdata/backup.ts')
    const validation = await validateBackup(source)
    const confirmButton = '恢复并在重启后应用'
    const selection = String(await hostCall(ctx, 'dialog.message', {
      type: 'warning',
      title: '确认恢复本地数据',
      message: `将恢复 ${validation.fileCount} 个文件。当前数据会先保存为可回滚快照；API 凭据、浏览器配对和 PI 认证保持不变。恢复会在下次启动 MilkSU 时应用。`,
      buttons: [confirmButton, '取消'],
      defaultButton: 1,
      cancelButton: 1,
    }) ?? '')
    if (selection !== confirmButton) return { cancelled: true }
    return stageBackupRestore(ctx.home, source)
  },
  async ExportLocalDiagnostics(ctx, args) {
    const destination = String(await hostCall(ctx, 'dialog.save', {
      title: '导出 MilkSU 诊断包',
      defaultPath: `MilkSU-diagnostics-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ Name: 'MilkSU 诊断包', Extensions: ['zip'] }],
    }) ?? '').trim()
    if (!destination) return { cancelled: true }
    const settings = ctx.settings?.get()
    const providers = Object.entries(settings?.providers ?? {})
      .filter(([, configured]) => configured.enabled || configured.has_api_key)
      .map(([name]) => name)
    const conversations = await ctx.conversations.list()
    return exportDiagnostics(ctx.home, destination, {
      appVersion: String(process.env.MILKSU_APP_VERSION ?? '').trim() || DEVELOPMENT_HOST_VERSION,
      runtime: {
        defaultEngine: String(settings?.default_kernel ?? 'pi'),
        running: ctx.engine.liveSessionCount() > 0,
        sessionCount: conversations.length,
        protocol: 'jsonl',
        backgroundTaskCount: ctx.engine.backgroundTaskCount(),
      },
      settings: {
        activeProvider: String(settings?.active_provider ?? ''),
        activeModel: String(settings?.active_model ?? ''),
        relayEnabled: Boolean(settings?.relay?.enabled),
        modelVerified: Boolean(settings?.model_verification),
        configuredProviders: providers,
      },
      lifespan: stateFor(ctx).lifespanStart,
      events: stateFor(ctx).diagnostics.snapshot(),
      rendererEvents: Array.isArray(arg(args, 0, [])) ? arg(args, 0, []) as DiagnosticEvent[] : [],
    })
  },
  async RevealLocalDataDirectory(ctx) {
    await hostCall(ctx, 'shell.openPath', { path: ctx.home })
    return null
  },
  async RevealUserArtifactDirectory(ctx) {
    const root = await ensureUserArtifactDirectory(userArtifactDirectory())
    await hostCall(ctx, 'shell.openPath', { path: root })
    return null
  },
  async GetStartupRecoveryStatus(ctx) {
    return stateFor(ctx).lifespanStart
  },
  async ListSecurityTools(ctx) {
    return stateFor(ctx).securityTools.list()
  },
  async SetSecurityToolEnabled(ctx, args) {
    await stateFor(ctx).securityTools.setEnabled(String(arg(args, 0, '')), Boolean(arg(args, 1, false)))
    return null
  },
  async StartSecurityToolSetup(ctx, args) {
    return stateFor(ctx).securityTools.startSetup(String(arg(args, 0, '')))
  },
  async GetSecurityToolSetup(ctx, args) {
    return stateFor(ctx).securityTools.setupStatus(String(arg(args, 0, '')))
  },
  async CheckSecurityTool(ctx, args) {
    return stateFor(ctx).securityTools.check(String(arg(args, 0, '')))
  },
  async PrepareSecurityToolCodingHandoff(ctx, args) {
    const handoff = await stateFor(ctx).securityTools.codingHandoff(String(arg(args, 0, '')))
    const store = agentResourceStoreFor(ctx.home) ?? ctx.agentResources
    if (store) handoff.workspacePath = await store.ensureConfigWorkspace()
    return handoff
  },
  async TestAgentModel(ctx, args) {
    if (!ctx.settings) throw new Error('settings store is unavailable')
    const submitted = arg<AppSettings>(args, 0, {})
    const resolved = ctx.settings.resolveSubmitted(submitted)
    const result = await probeAgentModel(resolved)
    await ctx.settings.recordModelVerification(result.provider, result.model)
    return result
  },
  async JudgeApprovalRisk(ctx, args) {
    const command = String(arg(args, 0, '')).trim()
    if (!command) throw new Error('command is required')
    const resolved = ctx.settings?.getResolved() ?? {}
    return judgeApprovalRisk(command, jevKeyFromSettings(resolved))
  },
  async OpenSourceURL(ctx, args) {
    let parsed: URL
    try {
      parsed = new URL(String(arg(args, 0, '')).trim())
    } catch {
      throw new Error('source must be an http(s) URL without credentials')
    }
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host || parsed.username || parsed.password) {
      throw new Error('source must be an http(s) URL without credentials')
    }
    await hostCall(ctx, 'shell.openExternal', { url: parsed.toString() })
    return null
  },
  async OpenChromeExtensionManager() {
    const executable = findChrome()
    const child = spawn(executable, [extensionsPage(executable)], { detached: true, stdio: 'ignore' })
    child.unref()
    return null
  },
  async OpenPlaywrightBrowserExtension(ctx) {
    await hostCall(ctx, 'shell.openExternal', {
      url: 'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm',
    })
    return null
  },
})
