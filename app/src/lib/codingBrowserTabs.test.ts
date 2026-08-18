import { describe, expect, it } from 'vitest'
import {
  codingBrowserAddressFromStatus,
  codingBrowserViewportSyncKey,
} from './codingBrowserTabs'

describe('codingBrowserTabs', () => {
  it('treats a tab switch as a new viewport even when the rectangle is unchanged', () => {
    const geometry = {
      conversationId: 'conversation-1',
      x: 10,
      y: 20,
      width: 400,
      height: 600,
      visible: true,
    }
    expect(codingBrowserViewportSyncKey(geometry, 'tab-a')).not.toBe(
      codingBrowserViewportSyncKey(geometry, 'tab-b'),
    )
  })

  it('uses the active tab address instead of falling back to the first tab', () => {
    expect(codingBrowserAddressFromStatus({
      tabs: [
        { id: 'one', title: 'Example', url: 'https://example.com/', active: false },
        { id: 'two', title: 'New Tab', url: 'about:blank', active: true },
      ],
    })).toBe('')
    expect(codingBrowserAddressFromStatus({
      tabs: [
        { id: 'one', title: 'Example', url: 'https://example.com/', active: true },
        { id: 'two', title: 'Bilibili', url: 'https://www.bilibili.com/', active: false },
      ],
    })).toBe('https://example.com/')
  })
})
