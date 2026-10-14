import { join } from 'node:path'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import { browserWorkspaceDirectory, dataDirectory } from '../home.ts'
import { ResearchNotFoundError } from '../research/types.ts'
import {
  browserUseRuntimeStatus,
  deriveEvidenceDirectory,
  Manager,
  matchCodingTab,
  validateResearchBrowserURL,
  type CodingBrowserStatus,
} from '../browsercap/index.ts'

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

const managers = new Map<string, Manager>()

export async function closeBrowserCap(home: string): Promise<void> {
  const manager = managers.get(home)
  if (!manager) return
  managers.delete(home)
  await manager.close()
}

export function codingBrowserDescriptor(home: string, conversationId: string) {
  return managers.get(home)?.codingDescriptor(conversationId)
}

export function matchBrowserTab(
  tabs: CodingBrowserStatus['tabs'],
  tabId: string,
  query: string,
) {
  return matchCodingTab(tabs ?? [], tabId, query)
}

async function managerFor(ctx: HandlerContext): Promise<Manager> {
  const existing = managers.get(ctx.home)
  if (existing) return existing
  if (!ctx.hostCall) throw new Error('浏览器服务不可用')
  const manager = await Manager.open(browserWorkspaceDirectory(ctx.home), ctx.hostCall)
  managers.set(ctx.home, manager)
  return manager
}

function requireHost(ctx: HandlerContext): void {
  if (!ctx.hostCall) throw new Error('desktop runtime is not ready')
}

function codingBrowserAllowed(ctx: HandlerContext): boolean {
  const enabled = ctx.settings?.get()?.coding_browser_enabled
  return enabled == null || enabled === true
}

function researchRunActive(ctx: HandlerContext, conversationId: string): boolean {
  const store = (ctx.research as { store?: { findActiveRun?: (id: string) => unknown } } | undefined)?.store
  if (!store?.findActiveRun) return false
  try {
    store.findActiveRun(conversationId)
    return true
  } catch (error) {
    if (error instanceof ResearchNotFoundError) return false
    if (error instanceof Error && /no rows/i.test(error.message)) return false
    return false
  }
}

async function requireBrowser(ctx: HandlerContext): Promise<Manager> {
  if (!codingBrowserAllowed(ctx)) {
    throw new Error('内置浏览器已在设置 → 权限与操控中停用')
  }
  return managerFor(ctx)
}

async function ensureResearchMode(ctx: HandlerContext, conversationId: string): Promise<void> {
  if (!researchRunActive(ctx, conversationId)) return
  const manager = await managerFor(ctx)
  await manager.setResearchMode(conversationId, true)
}

function disabledStatus(conversationId: string): CodingBrowserStatus {
  return {
    enabled: false,
    conversationId: String(conversationId ?? '').trim(),
    phase: 'disabled',
  }
}

registerOwnedHandlers({
  async StartCodingBrowser(ctx, args) {
    const conversationId = arg(args, 0, '')
    const initialUrl = arg(args, 1, '')
    const manager = await requireBrowser(ctx)
    if (researchRunActive(ctx, conversationId)) {
      throw new Error('Deep Research 运行期间不能替换浏览器')
    }
    const status = await manager.startCoding(conversationId, initialUrl)
    ctx.emit('coding-browser.ready', status)
    return status
  },
  async EnsureCodingBrowser(ctx, args) {
    const conversationId = arg(args, 0, '')
    const manager = await requireBrowser(ctx)
    const existing = manager.codingDescriptor(conversationId)
    const status = existing
      ? await manager.codingStatus(conversationId)
      : await manager.ensureCoding(conversationId)
    await ensureResearchMode(ctx, conversationId)
    if (!existing) ctx.emit('coding-browser.ready', status)
    return status
  },
  async GetCodingBrowserStatus(ctx, args) {
    const manager = await requireBrowser(ctx)
    return manager.codingStatus(arg(args, 0, ''))
  },
  async GetCodingBrowserOverview(ctx) {
    const manager = await requireBrowser(ctx)
    return manager.codingSessions()
  },
  async SetCodingBrowserViewport(ctx, args) {
    const manager = await requireBrowser(ctx)
    await manager.setCodingViewport(arg(args, 0, ''), {
      x: Number(arg(args, 1, 0)),
      y: Number(arg(args, 2, 0)),
      width: Number(arg(args, 3, 0)),
      height: Number(arg(args, 4, 0)),
      visible: Boolean(arg(args, 5, false)),
    })
    return null
  },
  async NavigateCodingBrowser(ctx, args) {
    const conversationId = arg(args, 0, '')
    let targetUrl = String(arg(args, 1, '')).trim()
    if (!targetUrl) throw new Error('请输入要打开的 http 或 https 地址')
    const manager = await requireBrowser(ctx)
    if (researchRunActive(ctx, conversationId)) {
      targetUrl = await validateResearchBrowserURL(targetUrl)
      await manager.createResearchCodingTab(conversationId, targetUrl)
      return null
    }
    await manager.navigateCoding(conversationId, targetUrl)
    return null
  },
  async CodingBrowserGoBack(ctx, args) {
    const manager = await requireBrowser(ctx)
    await manager.backCoding(arg(args, 0, ''))
    return null
  },
  async CodingBrowserGoForward(ctx, args) {
    const manager = await requireBrowser(ctx)
    await manager.forwardCoding(arg(args, 0, ''))
    return null
  },
  async ReloadCodingBrowser(ctx, args) {
    const manager = await requireBrowser(ctx)
    await manager.reloadCoding(arg(args, 0, ''))
    return null
  },
  async CreateCodingBrowserTab(ctx, args) {
    const manager = await requireBrowser(ctx)
    return manager.createCodingTab(arg(args, 0, ''), arg(args, 1, ''))
  },
  async ActivateCodingBrowserTab(ctx, args) {
    const manager = await requireBrowser(ctx)
    return manager.activateCodingTab(arg(args, 0, ''), arg(args, 1, ''))
  },
  async CloseCodingBrowserTab(ctx, args) {
    const manager = await requireBrowser(ctx)
    return manager.closeCodingTab(arg(args, 0, ''), arg(args, 1, ''))
  },
  async StopCodingBrowser(ctx, args) {
    const conversationId = arg(args, 0, '')
    const manager = await requireBrowser(ctx)
    if (researchRunActive(ctx, conversationId)) {
      throw new Error('cancel or finish Deep Research before stopping the Browser')
    }
    await ctx.engine.detachSession?.(conversationId)
    await manager.stopCoding(conversationId)
    return disabledStatus(conversationId)
  },
  async RevealCodingBrowserEvidence(ctx, args) {
    requireHost(ctx)
    const conversationId = arg(args, 0, '')
    const manager = await requireBrowser(ctx)
    const sessionId = manager.codingEvidenceSessionId(conversationId)
    const saved = await ctx.conversations.get(conversationId)
    const workspace = String(saved.workspacePath ?? '').trim()
      || joinDataAgentWorkspace(ctx.home)
    const directory = await deriveEvidenceDirectory({
      conversationId,
      sessionId,
      workspace,
    })
    await ctx.hostCall!('shell.openPath', { path: directory })
    return null
  },
  async GetBrowserUseRuntime() {
    return browserUseRuntimeStatus()
  },
  async GetBrowserUseStatus() {
    return browserUseRuntimeStatus()
  },
  async ListCodingBrowserTabs(ctx, args) {
    const manager = await requireBrowser(ctx)
    const status = await manager.codingStatus(arg(args, 0, ''))
    return { tabs: status.tabs ?? [], activeTabId: status.activeTabId ?? '' }
  },
  async FocusCodingBrowserTab(ctx, args) {
    const manager = await requireBrowser(ctx)
    const conversationId = arg(args, 0, '')
    const status = await manager.codingStatus(conversationId)
    const tab = matchCodingTab(status.tabs ?? [], arg(args, 1, ''), arg(args, 2, ''))
    return manager.activateCodingTab(conversationId, tab.id)
  },
  async OpenCodingBrowserURL(ctx, args) {
    const conversationId = arg(args, 0, '')
    const targetUrl = String(arg(args, 1, '')).trim()
    const manager = await requireBrowser(ctx)
    if (targetUrl) await manager.navigateCoding(conversationId, targetUrl)
    return manager.codingStatus(conversationId)
  },
  async RevealBrowserExtension(ctx) {
    requireHost(ctx)
    const manager = await managerFor(ctx)
    const info = await manager.startBridge()
    const extensionPath = info.extensionPath
    if (!extensionPath) throw new Error('browser extension directory is unavailable')
    await ctx.hostCall!('shell.openPath', { path: extensionPath })
    return null
  },
})

function joinDataAgentWorkspace(home: string): string {
  const root = dataDirectory(home).trim()
  if (!root) throw new Error('MilkSU 临时工作区不可用')
  return join(root, 'agent-workspace')
}
