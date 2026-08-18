import type { CodingBrowserStatus, CodingBrowserTab } from '@/codingEnvironmentTypes'

export function codingBrowserViewportSyncKey(
  geometry: {
    conversationId: string
    x: number
    y: number
    width: number
    height: number
    visible: boolean
  },
  activeTabId = '',
): string {
  return JSON.stringify({ ...geometry, activeTabId })
}

export function codingBrowserAddressFromStatus(
  status: Pick<CodingBrowserStatus, 'tabs' | 'pages'> | null | undefined,
): string {
  const activeTab = status?.tabs?.find(tab => tab.active)
  if (activeTab) return visibleBrowserAddress(activeTab)
  if (status?.tabs?.[0]) return visibleBrowserAddress(status.tabs[0])
  const pageURL = status?.pages?.[0]?.url?.trim() ?? ''
  return pageURL === 'about:blank' ? '' : pageURL
}

function visibleBrowserAddress(tab: Pick<CodingBrowserTab, 'url'>): string {
  const url = String(tab.url ?? '').trim()
  return !url || url === 'about:blank' ? '' : url
}
