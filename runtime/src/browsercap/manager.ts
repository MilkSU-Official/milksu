import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { loopbackEndpointPort, normalizeCodingConversationId, originTarget } from './origin.ts'
import { PairingBridge, type BridgeInfo, type SharedPage } from './pairing.ts'
import {
  createCodingHost,
  type CodingHost,
  type CodingHostTabList,
  type CodingViewport,
  type HostCall,
} from './host.ts'
import type { CodingBrowserTab } from './tabs.ts'

export type CodingBrowserPage = {
  id: string
  title: string
  url: string
  type: string
}

export type CodingBrowserStatus = {
  enabled: boolean
  conversationId: string
  sessionId?: string
  phase: string
  initialUrl?: string
  profileLabel?: string
  startedAt?: string
  browserBinary?: string
  pages?: CodingBrowserPage[]
  tabs?: CodingBrowserTab[]
  activeTabId?: string
}

export type CodingBrowserDescriptor = {
  sessionId: string
  cdpEndpoint: string
}

type ManagedSession = {
  id: string
  conversationId: string
  phase: string
  initialUrl: string
  profileLabel: string
  startedAt: string
  browserBinary: string
  port: number
  hosted: boolean
}

export class Manager {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly pairing: PairingBridge
  private readonly host: CodingHost | undefined
  readonly root: string

  constructor(root: string, host?: CodingHost) {
    this.root = root
    this.host = host
    this.pairing = new PairingBridge(root)
  }

  static async open(root: string, hostCall?: HostCall): Promise<Manager> {
    await mkdir(root, { recursive: true, mode: 0o700 })
    const host = hostCall ? createCodingHost(hostCall) : undefined
    const manager = new Manager(root, host)
    await manager.pairing.open()
    return manager
  }

  async startCoding(conversationId: string, initialUrl: string): Promise<CodingBrowserStatus> {
    const id = normalizeCodingConversationId(conversationId)
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    const existing = this.codingSessionId(id)
    if (existing) await this.stop(existing)
    initialUrl = String(initialUrl ?? '').trim()
    let profileLabel = '浏览器'
    if (initialUrl) profileLabel = originTarget(initialUrl)
    const sessionId = `browser_${randomUUID()}`
    const profilePath = join(this.root, 'profiles', sessionId)
    await mkdir(profilePath, { recursive: true, mode: 0o700 })
    let hosted
    try {
      hosted = await this.host.start({ sessionId, initialUrl, profilePath })
    } catch (error) {
      throw new Error(`start Chromium WebContents: ${error instanceof Error ? error.message : error}`)
    }
    let port: number
    try {
      port = loopbackEndpointPort(hosted.cdpEndpoint)
    } catch (error) {
      await this.host.stop(sessionId)
      throw error
    }
    this.sessions.set(sessionId, {
      id: sessionId,
      conversationId: id,
      phase: 'ready',
      initialUrl,
      profileLabel,
      startedAt: new Date().toISOString(),
      browserBinary: hosted.name,
      port,
      hosted: true,
    })
    return this.codingStatus(id)
  }

  async ensureCoding(conversationId: string): Promise<CodingBrowserStatus> {
    const id = normalizeCodingConversationId(conversationId)
    if (this.codingSessionId(id)) return this.codingStatus(id)
    return this.startCoding(id, '')
  }

  async codingStatus(conversationId: string): Promise<CodingBrowserStatus> {
    const id = normalizeCodingConversationId(conversationId)
    const sessionId = this.codingSessionId(id)
    if (!sessionId) {
      return { enabled: false, conversationId: id, phase: 'disabled' }
    }
    const session = this.sessions.get(sessionId)
    if (!session) {
      return { enabled: false, conversationId: id, sessionId, phase: 'stopped' }
    }
    const status: CodingBrowserStatus = {
      enabled: true,
      conversationId: id,
      sessionId: session.id,
      phase: session.phase,
      initialUrl: session.initialUrl || undefined,
      profileLabel: session.profileLabel || undefined,
      startedAt: session.startedAt,
      browserBinary: session.browserBinary || undefined,
    }
    const pages = await this.pages(sessionId)
    if (pages) status.pages = pages
    if (this.host) {
      try {
        const tabs = await this.host.listTabs(sessionId)
        status.tabs = tabs.tabs
        status.activeTabId = tabs.activeTabId
      } catch {
        // UI status stays available even if the tab list round-trip fails
      }
    }
    return status
  }

  codingDescriptor(conversationId: string): CodingBrowserDescriptor | undefined {
    let id: string
    try {
      id = normalizeCodingConversationId(conversationId)
    } catch {
      return undefined
    }
    const sessionId = this.codingSessionId(id)
    if (!sessionId) return undefined
    const session = this.sessions.get(sessionId)
    if (!session || session.port <= 0 || session.port > 65535) return undefined
    return { sessionId: session.id, cdpEndpoint: `http://127.0.0.1:${session.port}` }
  }

  async stopCoding(conversationId: string): Promise<void> {
    const id = normalizeCodingConversationId(conversationId)
    const sessionId = this.codingSessionId(id)
    if (!sessionId) return
    await this.stop(sessionId)
  }

  async setCodingViewport(conversationId: string, viewport: CodingViewport): Promise<void> {
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    const sessionId = this.requireSession(conversationId)
    await this.host.setViewport(sessionId, viewport)
  }

  async navigateCoding(conversationId: string, targetUrl: string): Promise<void> {
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    const sessionId = this.requireSession(conversationId)
    const origin = originTarget(targetUrl)
    await this.host.navigate(sessionId, targetUrl)
    const session = this.sessions.get(sessionId)
    if (session) {
      session.initialUrl = targetUrl
      session.profileLabel = origin
    }
  }

  async backCoding(conversationId: string): Promise<void> {
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    await this.host.back(this.requireSession(conversationId))
  }

  async forwardCoding(conversationId: string): Promise<void> {
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    await this.host.forward(this.requireSession(conversationId))
  }

  async reloadCoding(conversationId: string): Promise<void> {
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    await this.host.reload(this.requireSession(conversationId))
  }

  createCodingTab(conversationId: string, targetUrl: string): Promise<CodingBrowserStatus> {
    return this.mutateTabs(conversationId, (sessionId) => this.host!.createTab(sessionId, String(targetUrl ?? '').trim()))
  }

  createResearchCodingTab(conversationId: string, targetUrl: string): Promise<CodingBrowserStatus> {
    if (!this.host) throw new Error('Research Browser host is unavailable')
    return this.mutateTabs(conversationId, (sessionId) => this.host!.createResearchTab(sessionId, String(targetUrl ?? '').trim()))
  }

  activateCodingTab(conversationId: string, tabId: string): Promise<CodingBrowserStatus> {
    return this.mutateTabs(conversationId, (sessionId) => this.host!.activateTab(sessionId, String(tabId ?? '').trim()))
  }

  closeCodingTab(conversationId: string, tabId: string): Promise<CodingBrowserStatus> {
    return this.mutateTabs(conversationId, (sessionId) => this.host!.closeTab(sessionId, String(tabId ?? '').trim()))
  }

  closeAllCodingTabs(conversationId: string): Promise<CodingBrowserStatus> {
    return this.mutateTabs(conversationId, (sessionId) => this.host!.closeAllTabs(sessionId))
  }

  codingEvidenceSessionId(conversationId: string): string {
    const id = normalizeCodingConversationId(conversationId)
    const sessionId = this.codingSessionId(id)
    if (!sessionId) throw new Error('当前会话没有活跃的浏览器')
    return sessionId
  }

  codingSessions(): CodingBrowserStatus[] {
    const result: CodingBrowserStatus[] = []
    for (const session of this.sessions.values()) {
      if (!session.conversationId) continue
      result.push({
        enabled: true,
        conversationId: session.conversationId,
        sessionId: session.id,
        phase: session.phase,
        initialUrl: session.initialUrl || undefined,
        profileLabel: session.profileLabel || undefined,
        startedAt: session.startedAt,
        browserBinary: session.browserBinary || undefined,
      })
    }
    result.sort((left, right) => String(left.startedAt ?? '').localeCompare(String(right.startedAt ?? '')))
    return result
  }

  startBridge(): Promise<BridgeInfo> {
    return this.pairing.start()
  }

  sharedPages(): SharedPage[] {
    return this.pairing.pages()
  }

  bridgeInfo(): BridgeInfo {
    return this.pairing.info()
  }

  authorizeBridge(token: string): boolean {
    return this.pairing.authorize(token)
  }

  async setResearchMode(conversationId: string, enabled: boolean): Promise<void> {
    const descriptor = this.codingDescriptor(conversationId)
    if (!descriptor || !this.host) return
    await this.host.setResearchMode(descriptor.sessionId, enabled)
  }

  async close(): Promise<void> {
    const ids = [...this.sessions.keys()]
    for (const id of ids) {
      try {
        await this.stop(id)
      } catch {
        this.sessions.delete(id)
      }
    }
    if (this.host) {
      try {
        await this.host.close()
      } catch {
        // host may already be gone
      }
    }
    await this.pairing.close()
  }

  private async mutateTabs(
    conversationId: string,
    mutate: (sessionId: string) => Promise<CodingHostTabList>,
  ): Promise<CodingBrowserStatus> {
    if (!this.host) throw new Error('Chromium desktop host is unavailable in this build')
    const sessionId = this.requireSession(conversationId)
    await mutate(sessionId)
    return this.codingStatus(conversationId)
  }

  private requireSession(conversationId: string): string {
    const sessionId = this.codingSessionId(normalizeCodingConversationId(conversationId))
    if (!sessionId) throw new Error('当前会话没有活跃的内嵌浏览器')
    return sessionId
  }

  private codingSessionId(conversationId: string): string {
    for (const session of this.sessions.values()) {
      if (session.conversationId === conversationId) return session.id
    }
    return ''
  }

  private async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.hosted) {
      if (!this.host) throw new Error('Chromium desktop host disappeared')
      await this.host.stop(sessionId)
    }
    this.sessions.delete(sessionId)
  }

  private async pages(sessionId: string): Promise<CodingBrowserPage[] | undefined> {
    const session = this.sessions.get(sessionId)
    if (!session || session.port <= 0) return undefined
    try {
      const response = await fetch(`http://127.0.0.1:${session.port}/json/list`, {
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) return undefined
      const raw = await response.json() as Array<{
        id?: string
        title?: string
        url?: string
        type?: string
        webSocketDebuggerUrl?: string
      }>
      if (!Array.isArray(raw)) return undefined
      return raw
        .filter((item) => item.type === 'page' && item.webSocketDebuggerUrl)
        .map((item) => ({
          id: String(item.id ?? ''),
          title: String(item.title ?? ''),
          url: String(item.url ?? ''),
          type: String(item.type ?? ''),
        }))
    } catch {
      return undefined
    }
  }
}
