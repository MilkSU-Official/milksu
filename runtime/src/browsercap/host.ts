import type { CodingBrowserTab } from './tabs.ts'

export type CodingViewport = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}

export type CodingHostStartRequest = {
  sessionId: string
  initialUrl: string
  profilePath: string
}

export type CodingHostSession = {
  name: string
  cdpEndpoint: string
}

export type CodingHostTabList = {
  activeTabId: string
  tabs: CodingBrowserTab[]
}

export type HostCall = (method: string, payload?: unknown) => Promise<unknown>

export type CodingHost = {
  start(request: CodingHostStartRequest): Promise<CodingHostSession>
  setViewport(sessionId: string, viewport: CodingViewport): Promise<void>
  navigate(sessionId: string, url: string): Promise<void>
  back(sessionId: string): Promise<void>
  forward(sessionId: string): Promise<void>
  reload(sessionId: string): Promise<void>
  listTabs(sessionId: string): Promise<CodingHostTabList>
  createTab(sessionId: string, url: string): Promise<CodingHostTabList>
  createResearchTab(sessionId: string, url: string): Promise<CodingHostTabList>
  activateTab(sessionId: string, tabId: string): Promise<CodingHostTabList>
  closeTab(sessionId: string, tabId: string): Promise<CodingHostTabList>
  closeAllTabs(sessionId: string): Promise<CodingHostTabList>
  stop(sessionId: string): Promise<void>
  setResearchMode(sessionId: string, enabled: boolean): Promise<void>
  close(): Promise<void>
}

export function createCodingHost(hostCall: HostCall): CodingHost {
  const call = async (method: string, sessionId: string, extra?: Record<string, unknown>): Promise<void> => {
    await hostCall(method, { sessionId: sessionId.trim(), ...extra })
  }
  const list = async (
    method: string,
    sessionId: string,
    extra?: Record<string, unknown>,
  ): Promise<CodingHostTabList> => {
    return asTabList(await hostCall(method, { sessionId: sessionId.trim(), ...extra }))
  }
  return {
    async start(request) {
      return asHostSession(await hostCall('browser.start', request))
    },
    async setViewport(sessionId, viewport) {
      await call('browser.setViewport', sessionId, { viewport })
    },
    async navigate(sessionId, url) {
      await call('browser.navigate', sessionId, { url })
    },
    async back(sessionId) {
      await call('browser.back', sessionId)
    },
    async forward(sessionId) {
      await call('browser.forward', sessionId)
    },
    async reload(sessionId) {
      await call('browser.reload', sessionId)
    },
    listTabs(sessionId) {
      return list('browser.listTabs', sessionId)
    },
    createTab(sessionId, url) {
      return list('browser.createTab', sessionId, { url })
    },
    createResearchTab(sessionId, url) {
      return list('browser.createResearchTab', sessionId, { url })
    },
    activateTab(sessionId, tabId) {
      return list('browser.activateTab', sessionId, { tabId })
    },
    closeTab(sessionId, tabId) {
      return list('browser.closeTab', sessionId, { tabId })
    },
    closeAllTabs(sessionId) {
      return list('browser.closeAllTabs', sessionId)
    },
    async stop(sessionId) {
      await call('browser.stop', sessionId)
    },
    async setResearchMode(sessionId, enabled) {
      await call('browser.setResearchMode', sessionId, { enabled })
    },
    async close() {
      await hostCall('browser.closeAll', {})
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asHostSession(value: unknown): CodingHostSession {
  const record = asRecord(value)
  return {
    name: String(record.name ?? ''),
    cdpEndpoint: String(record.cdpEndpoint ?? ''),
  }
}

function asTabList(value: unknown): CodingHostTabList {
  const record = asRecord(value)
  const tabs = Array.isArray(record.tabs)
    ? record.tabs.map((item) => {
      const tab = asRecord(item)
      return {
        id: String(tab.id ?? ''),
        title: String(tab.title ?? ''),
        url: String(tab.url ?? ''),
        active: tab.active === true,
      }
    })
    : []
  return { activeTabId: String(record.activeTabId ?? ''), tabs }
}
