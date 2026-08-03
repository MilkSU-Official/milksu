// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingTerminalPanel from './CodingTerminalPanel.vue'
import type { CodingRuntimeStatus } from '@/codingEnvironmentTypes'

const terminalWrites = vi.hoisted(() => [] as string[])

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

const runtimeStatus: CodingRuntimeStatus = {
  defaultEngine: 'pi',
  running: true,
  sessionCount: 1,
  protocol: 'pi',
  workspace: '/Users/milksu/code/milksu',
  backgroundRecovery: {
    state: 'recovered',
  },
  backgroundTasks: [{
    id: 'bg-restart',
    kind: 'process',
    status: 'running',
    startedAt: Date.now() - 12_000,
    command: 'npm run dev',
    cwd: '/Users/milksu/code/milksu/app',
    pid: 4321,
    ports: [1420, 5173],
    logPath: '/runtime/bg-restart.log',
    logTail: 'Vite ready on http://127.0.0.1:1420\n',
    logTruncated: true,
  }],
}

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_coding_terminals') return []
  if (command === 'refresh_coding_background_tasks') return runtimeStatus
  throw new Error(`unexpected command ${command}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => true,
  invokeCommand: (...args: unknown[]) => invokeCommand(...args as [string, unknown?]),
  listenEvent: vi.fn(async () => () => undefined),
}))

const mountedApps: App[] = []

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
  terminalWrites.length = 0
  invokeCommand.mockClear()
})

async function mountPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(CodingTerminalPanel, {
    active: true,
    conversationId: 'conversation-restart',
    workspacePath: '/Users/milksu/code/milksu',
    executionMode: 'go',
    approvalPolicy: 'workspace-auto',
  })
  app.mount(host)
  mountedApps.push(app)
  await settle()
  return host
}

describe('CodingTerminalPanel', () => {
  it('does not present old PTY sessions as reconnectable after restart', async () => {
    await mountPanel()

    expect(invokeCommand).toHaveBeenCalledWith(
      'list_coding_terminals',
      { conversationId: 'conversation-restart' },
    )
    const terminalText = terminalWrites.join('')
    expect(terminalText).toContain('交互式 Shell 不跨 App 重启恢复')
    expect(terminalText).toContain('旧 PTY 已结束且不可重连')
    expect(terminalText).toContain('后台长任务请在“后台任务”中恢复')
  })

  it('shows recovered background task status, process metadata, ports, and log tail', async () => {
    const host = await mountPanel()
    const taskTab = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('后台任务'))
    expect(taskTab).toBeDefined()

    taskTab!.click()
    await settle()

    expect(invokeCommand).toHaveBeenCalledWith(
      'refresh_coding_background_tasks',
      expect.objectContaining({
        conversationId: 'conversation-restart',
        workspacePath: '/Users/milksu/code/milksu',
        executionMode: 'go',
        approvalPolicy: 'workspace-auto',
      }),
    )
    const text = host.textContent ?? ''
    expect(text).toContain('已从磁盘恢复持久任务')
    expect(text).toContain('npm run dev')
    expect(text).toContain('PID 4321')
    expect(text).toContain(':1420')
    expect(text).toContain(':5173')
    expect(text).toContain('Vite ready on http://127.0.0.1:1420')
    expect(text).toContain('仅显示日志末尾')
  })
})
