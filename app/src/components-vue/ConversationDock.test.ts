// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import ConversationDock from './ConversationDock.vue'
import type { Conversation } from '@/types'

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error('desktop runtime unavailable in component test')
  }),
  listenEvent: vi.fn(async () => () => undefined),
}))

const mountedApps: App[] = []

beforeAll(() => {
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
})

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  window.localStorage?.clear()
})

function sampleConversation(): Conversation {
  return {
    id: 'cve-research-cve-2023-46604',
    title: 'CVE-2023-46604 复现',
    createdAt: Date.now(),
    messages: [{
      id: 'm1',
      role: 'user',
      content: '开始复现。',
      timestamp: Date.now(),
    }],
    domainTaskContext: {
      kind: 'cve',
      cveId: 'CVE-2023-46604',
      title: 'ActiveMQ',
      sourceEvidenceState: '',
      sourceEvidenceCount: 0,
      assetMatchState: '',
      assetCount: 0,
      researchScope: 'local',
      safetyBoundary: '',
      roleLabel: 'CVE',
    },
  }
}

function composerEditor(host: HTMLElement) {
  const editor = host.querySelector<HTMLElement>('[aria-label="消息"]')
  if (!editor) throw new Error('missing message editor')
  return editor
}

describe('ConversationDock', () => {
  it('sends from the Coding composer without opening Coding or the right rail', async () => {
    const send = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(ConversationDock, {
      conversation: sampleConversation(),
      onSend: send,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.querySelector('[data-testid="conversation-dock"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="coding-agent-dock-surface"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="关闭对话"]')).toBeNull()
    expect(host.querySelector('[aria-label="打开右侧栏"]')).toBeNull()
    expect(host.querySelector('[aria-label="打开底部终端"]')).toBeNull()
    expect(host.querySelector('[aria-label="收起对话"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="进入 Coding"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="左上角缩放"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="选择本任务模型"]')).not.toBeNull()
    const dock = host.querySelector<HTMLElement>('[data-testid="conversation-dock"]')!
    expect(Number.parseFloat(dock.style.width)).toBeGreaterThanOrEqual(880)
    const editor = composerEditor(host)
    editor.replaceChildren(document.createTextNode('把影响写清楚'))
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await nextTick()
    expect(send).toHaveBeenCalledWith('把影响写清楚', '把影响写清楚', [], undefined, undefined)
  })

  it('lists related conversations and can start another one', async () => {
    const create = vi.fn()
    const select = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const current = sampleConversation()
    const extra: Conversation = {
      ...current,
      id: 'cve-extra',
      title: '第二轮',
      createdAt: Date.now() + 1,
    }
    const app = createApp(ConversationDock, {
      conversation: current,
      conversations: [current, extra],
      onCreate: create,
      onSelect: select,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.textContent).toContain('新对话')
    expect(host.textContent).toContain('第二轮')
    host.querySelector<HTMLButtonElement>('[aria-label="新对话"]')?.click()
    await nextTick()
    expect(create).toHaveBeenCalledTimes(1)
    const second = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('第二轮'))
    second?.click()
    await nextTick()
    expect(select).toHaveBeenCalledWith('cve-extra')
  })

  it('can expand into the full Coding surface', async () => {
    const expand = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(ConversationDock, {
      conversation: sampleConversation(),
      onExpand: expand,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    host.querySelector<HTMLButtonElement>('[aria-label="进入 Coding"]')?.click()
    await nextTick()
    expect(expand).toHaveBeenCalledTimes(1)
  })

  it('minimizes to the bottom-right and restores without overflowing', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(ConversationDock, {
      conversation: sampleConversation(),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    host.querySelector<HTMLButtonElement>('[aria-label="收起对话"]')?.click()
    await nextTick()
    const dock = host.querySelector<HTMLElement>('[data-testid="conversation-dock"]')!
    expect(dock.classList.contains('is-collapsed')).toBe(true)
    expect(dock.style.left).toBe(`${1280 - 256 - 20}px`)
    expect(dock.style.top).toBe(`${800 - 36 - 20}px`)
    host.querySelector<HTMLButtonElement>('[aria-label="展开对话"]')?.click()
    await nextTick()
    expect(dock.classList.contains('is-collapsed')).toBe(false)
    const left = Number.parseFloat(dock.style.left)
    const top = Number.parseFloat(dock.style.top)
    const width = Number.parseFloat(dock.style.width)
    const height = Number.parseFloat(dock.style.height)
    expect(left + width).toBeLessThanOrEqual(1280)
    expect(top + height).toBeLessThanOrEqual(800)
  })
})
