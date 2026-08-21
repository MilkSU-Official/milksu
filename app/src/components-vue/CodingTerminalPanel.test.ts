// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingTerminalPanel from './CodingTerminalPanel.vue'
import type {
  CodingTerminalSession,
} from '@/codingEnvironmentTypes'

const terminalWrites = vi.hoisted(() => [] as string[])
const desktopRuntimeEnabled = vi.hoisted(() => ({ value: true }))
const listedTerminalSessions = vi.hoisted(() => ({
  value: [] as CodingTerminalSession[],
}))
const startedTerminalSessions = vi.hoisted(() => ({
  value: [] as CodingTerminalSession[],
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100
    rows = 28
    options = { disableStdin: false }
    loadAddon() {}
    open() {}
    onData() {
      return { dispose() {} }
    }
    reset() {}
    clear() {}
    write(data: string) {
      terminalWrites.push(data)
    }
    focus() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))

function terminalSession(
  id: string,
  startedAt: number,
): CodingTerminalSession {
  return {
    id,
    conversationId: 'conversation-restart',
    workspace: '/Users/milksu/code/milksu',
    shell: '/bin/zsh',
    status: 'running',
    pid: 4200 + startedAt,
    columns: 100,
    rows: 28,
    startedAt,
  }
}

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_coding_terminals') return listedTerminalSessions.value
  if (command === 'start_coding_terminal') {
    return startedTerminalSessions.value.shift()
      ?? terminalSession('term-auto', 1)
  }
  if (command === 'close_coding_terminal') return undefined
  throw new Error(`unexpected command ${command}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => desktopRuntimeEnabled.value,
  invokeCommand: (...args: unknown[]) => invokeCommand(...args as [string, unknown?]),
  listenEvent: vi.fn(async () => () => undefined),
}))

const mountedApps: App[] = []

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  terminalWrites.length = 0
  desktopRuntimeEnabled.value = true
  listedTerminalSessions.value = []
  startedTerminalSessions.value = []
  invokeCommand.mockClear()
})

async function mountPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingTerminalPanel, {
    active: true,
    conversationId: 'conversation-restart',
    workspacePath: '/Users/milksu/code/milksu',
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return host
}

describe('CodingTerminalPanel', () => {
  it('starts the first project terminal automatically when the dock opens', async () => {
    const host = await mountPanel()

    expect(invokeCommand).toHaveBeenCalledWith(
      'list_coding_terminals',
      { conversationId: 'conversation-restart' },
    )
    expect(invokeCommand).toHaveBeenCalledWith(
      'start_coding_terminal',
      expect.objectContaining({
        conversationId: 'conversation-restart',
        workspacePath: '/Users/milksu/code/milksu',
      }),
    )
    const terminalText = terminalWrites.join('')
    expect(terminalText).not.toContain('暂无 Shell')
    expect(terminalText).not.toContain('交互式 Shell 不跨 App 重启恢复')
    expect(terminalText).not.toContain('旧 PTY 已结束且不可重连')
    expect(terminalText).not.toContain('后台长任务请在“后台任务”中恢复')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('下一步')
    expect(text).toContain('milksu')
    expect(host.querySelector('[aria-label="新建项目 Shell"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="关闭底部面板"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="停止当前 Shell"]')).toBeNull()
    expect(host.textContent).not.toContain('后台任务')
  })

  it('appends new terminal tabs to the right without renumbering existing tabs', async () => {
    listedTerminalSessions.value = [
      terminalSession('term-three', 30),
      terminalSession('term-one', 10),
      terminalSession('term-two', 20),
    ]
    startedTerminalSessions.value = [terminalSession('term-four', 40)]
    const host = await mountPanel()

    const tabIds = () => [...host.querySelectorAll<HTMLElement>('[data-terminal-id]')]
      .map(tab => tab.dataset.terminalId)
    const tabLabels = () => [...host.querySelectorAll<HTMLElement>('[data-terminal-id]')]
      .map(tab => tab.getAttribute('aria-label'))
    expect(tabIds()).toEqual(['term-one', 'term-two', 'term-three'])
    expect(tabLabels()).toEqual(['milksu', 'milksu 2', 'milksu 3'])

    host.querySelector<HTMLButtonElement>('[data-terminal-id="term-three"]')!.click()
    host.querySelector<HTMLButtonElement>('[aria-label="新建项目 Shell"]')!.click()
    await settle()

    expect(tabIds()).toEqual(['term-one', 'term-two', 'term-three', 'term-four'])
    expect(tabLabels()).toEqual(['milksu', 'milksu 2', 'milksu 3', 'milksu 4'])
    expect(
      host.querySelector('[data-terminal-id="term-four"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('closes an individual terminal tab and keeps the remaining tab active', async () => {
    listedTerminalSessions.value = [
      terminalSession('term-one', 10),
      terminalSession('term-two', 20),
    ]
    const host = await mountPanel()

    host.querySelector<HTMLButtonElement>('[aria-label="关闭 milksu"]')!.click()
    await settle()

    expect(invokeCommand).toHaveBeenCalledWith(
      'close_coding_terminal',
      {
        conversationId: 'conversation-restart',
        terminalId: 'term-one',
      },
    )
    expect(host.querySelector('[data-terminal-id="term-one"]')).toBeNull()
    expect(
      host.querySelector('[data-terminal-id="term-two"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('restarts a stopped terminal from the visible restart control', async () => {
    const stopped = terminalSession('term-stopped', 10)
    stopped.status = 'stopped'
    stopped.exitCode = 1
    listedTerminalSessions.value = [stopped]
    startedTerminalSessions.value = [terminalSession('term-restarted', 20)]
    const host = await mountPanel()

    expect(host.querySelector('[aria-label="重新启动当前 Shell"]')).not.toBeNull()
    host.querySelector<HTMLButtonElement>('[aria-label="重新启动当前 Shell"]')!.click()
    await settle()

    expect(invokeCommand).toHaveBeenCalledWith(
      'close_coding_terminal',
      {
        conversationId: 'conversation-restart',
        terminalId: 'term-stopped',
      },
    )
    expect(invokeCommand).toHaveBeenCalledWith(
      'start_coding_terminal',
      expect.objectContaining({ conversationId: 'conversation-restart' }),
    )
    expect(host.querySelector('[data-terminal-id="term-stopped"]')).toBeNull()
    expect(
      host.querySelector('[data-terminal-id="term-restarted"]')?.getAttribute('aria-label'),
    ).toBe('milksu')
  })

  it('does not expose a stop-current-shell control or a background-task pane', async () => {
    listedTerminalSessions.value = [terminalSession('term-one', 10)]
    const host = await mountPanel()

    expect(host.querySelector('[aria-label="停止当前 Shell"]')).toBeNull()
    expect(host.querySelector('[aria-label="刷新后台任务"]')).toBeNull()
    expect(host.querySelector('[aria-label="后台任务命令"]')).toBeNull()
    expect(host.textContent).not.toContain('后台任务')
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'stop_coding_terminal',
      expect.anything(),
    )
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'refresh_coding_background_tasks',
      expect.anything(),
    )
  })

  it('does not pretend browser preview can run a project shell', async () => {
    desktopRuntimeEnabled.value = false
    const host = await mountPanel()

    expect(invokeCommand).not.toHaveBeenCalledWith(
      'list_coding_terminals',
      expect.anything(),
    )
    expect(terminalWrites.join('')).toContain('请在桌面 App 中新建 Shell')
    expect(host.textContent).toContain('真实 Shell 仅在 MilkSU 桌面 App 中可用')
    expect(host.textContent).not.toContain('后台任务')
    expect(host.querySelector('[aria-label="新建项目 Shell"]')?.hasAttribute('disabled')).toBe(true)
  })
})
