// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CodingTerminalPanel from './CodingTerminalPanel.vue'
import type { CodingRuntimeStatus } from '@/codingEnvironmentTypes'

const terminalWrites = vi.hoisted(() => [] as string[])
const desktopRuntimeEnabled = vi.hoisted(() => ({ value: true }))

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
    command: 'OPENAI_API_KEY=sk-command-secret-123456789 npm run dev',
    cwd: '/Users/milksu/code/milksu/app',
    pid: 4321,
    ports: [1420, 5173],
    logPath: '/runtime/bg-restart.log',
    logTail: 'Vite ready on http://127.0.0.1:1420 OPENAI_API_KEY=sk-bg-secret-123456789\n',
    logTruncated: true,
    error: 'last failure Bearer sk-bg-bearer-secret-123456789',
  }],
}

const invokeCommand = vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'list_coding_terminals') return []
  if (command === 'refresh_coding_background_tasks') return runtimeStatus
  throw new Error(`unexpected command ${command}`)
})

vi.mock('@/desktop', () => ({
  hasDesktopRuntime: () => desktopRuntimeEnabled.value,
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
  desktopRuntimeEnabled.value = true
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
  it('keeps the empty terminal concise after restart', async () => {
    const host = await mountPanel()

    expect(invokeCommand).toHaveBeenCalledWith(
      'list_coding_terminals',
      { conversationId: 'conversation-restart' },
    )
    const terminalText = terminalWrites.join('')
    expect(terminalText).toContain('暂无 Shell')
    expect(terminalText).not.toContain('交互式 Shell 不跨 App 重启恢复')
    expect(terminalText).not.toContain('旧 PTY 已结束且不可重连')
    expect(terminalText).not.toContain('后台长任务请在“后台任务”中恢复')
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('下一步')
    expect(text).toContain('新建 Shell')
    expect(host.querySelector('[aria-label="新建项目 Shell"]')).not.toBeNull()
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
    expect(text).toContain('1 运行中')
    expect(text).toContain('OPENAI_API_KEY=[credential redacted] npm run dev')
    expect(text).toContain('PID 4321')
    expect(text).toContain(':1420')
    expect(text).toContain(':5173')
    expect(text).toContain('Vite ready on http://127.0.0.1:1420')
    expect(text).toContain('OPENAI_API_KEY=[credential redacted]')
    expect(text).toContain('Bearer [credential redacted]')
    expect(text).not.toContain('sk-bg-secret')
    expect(text).not.toContain('sk-bg-bearer-secret')
    expect(text).not.toContain('sk-command-secret')
    expect(text).toContain('仅显示日志末尾')
  })

  it('does not pretend browser preview can run or recover terminal tasks', async () => {
    desktopRuntimeEnabled.value = false
    const host = await mountPanel()

    expect(invokeCommand).not.toHaveBeenCalledWith(
      'list_coding_terminals',
      expect.anything(),
    )
    expect(terminalWrites.join('')).toContain('请在桌面 App 中新建 Shell')

    const taskTab = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('后台任务'))
    expect(taskTab).toBeDefined()
    taskTab!.click()
    await settle()

    const text = host.textContent ?? ''
    expect(text).toContain('浏览器预览只能验证终端/后台任务面板文案和入口')
    expect(text).toContain('真实 Shell、后台命令、端口、日志和重启恢复需要 MilkSU 桌面运行时')
    expect(text).toContain('浏览器预览不能读取后台任务')
    expect(text).toContain('请在打包后的 MilkSU App 中验收真实命令、端口、日志和跨应用重启恢复')
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="后台任务命令"]')?.disabled).toBe(true)
    expect(invokeCommand).not.toHaveBeenCalledWith(
      'refresh_coding_background_tasks',
      expect.anything(),
    )
  })
})
