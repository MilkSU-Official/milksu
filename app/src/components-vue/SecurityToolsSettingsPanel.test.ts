// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SecurityToolsSettingsPanel from './SecurityToolsSettingsPanel.vue'
import type { SecurityToolSetupSnapshot, SecurityToolSnapshot } from '@/securityToolsTypes'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

const catalog: SecurityToolSnapshot[] = [
  {
    id: 'ida-pro', name: 'IDA Pro', purpose: '交互式反汇编与二进制分析',
    status: 'needs_setup', statusLabel: '可准备', enabled: true, usableByAgent: false,
    version: '9.1', connection: 'idalib MCP', runtime: '按需启动本地 MCP',
    capabilities: ['读取函数与反编译结果'], schema: ['decompile'],
    primaryAction: '准备 IDA MCP', setupSupported: true, codingSupported: true,
  },
  {
    id: 'capa', name: 'capa', purpose: '识别二进制能力与行为特征',
    status: 'ready', statusLabel: '可用', enabled: true, usableByAgent: true,
    version: 'v9.4.0', connection: '本地 CLI Adapter', runtime: '工作区内受限进程',
    capabilities: ['识别能力规则'], schema: ['capa_analyze(relativePath, format)'],
    setupSupported: true, codingSupported: true,
  },
]

let mounted: App | undefined

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function mountPanel() {
  const handlers = new Map<string, (value: SecurityToolSetupSnapshot) => void>()
  const calls: Array<[string, unknown[]]> = []
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    value: {
      invoke(method: string, args: unknown[]) {
        calls.push([method, args])
        if (method === 'ListSecurityTools') return Promise.resolve(catalog)
        if (method === 'GetSecurityToolSetup') return Promise.resolve({ toolId: args[0], state: 'idle', percent: 0, summary: '' })
        if (method === 'StartSecurityToolSetup') return Promise.resolve({
          toolId: args[0], state: 'running', percent: 15, summary: '正在准备 IDA Pro MCP',
          steps: [
            { id: 'detect', label: '检测 IDA Pro 与 uv', status: 'completed' },
            { id: 'install', label: '安装固定版本 MCP', status: 'running' },
          ],
        })
        if (method === 'SetSecurityToolEnabled') return Promise.resolve()
        if (method === 'CheckSecurityTool') return Promise.resolve(catalog.find(tool => tool.id === args[0]))
        if (method === 'PrepareSecurityToolCodingHandoff') return Promise.resolve({
          toolId: args[0],
          title: '配置 IDA Pro',
          prompt: '帮我准备 MilkSU 的 IDA Pro 本机能力，并运行最小健康检查。',
          visibleText: '检查并准备 IDA Pro，完成一次最小健康检查。',
          executionMode: 'go',
          approvalPolicy: 'full-auto',
        })
        throw new Error(`unexpected ${method}`)
      },
      onEvent(name: string, handler: (value: SecurityToolSetupSnapshot) => void) {
        handlers.set(name, handler)
        return () => handlers.delete(name)
      },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  mounted = createApp(SecurityToolsSettingsPanel)
  mounted.mount(host)
  return { calls, handlers }
}

afterEach(() => {
  mounted?.unmount()
  mounted = undefined
  document.body.innerHTML = ''
  Reflect.deleteProperty(window, 'milksu')
  vi.restoreAllMocks()
})

describe('SecurityToolsSettingsPanel', () => {
  it('renders real catalog status and explains model automatic selection', async () => {
    mountPanel()
    await settle()
    expect(document.body.textContent).toContain('不需要在每个任务里手动选择')
    expect(document.querySelector('[data-testid="security-tool-detail"]')?.textContent).toContain('idalib MCP')

    ;(document.querySelector('[data-testid="security-tool-capa"]') as HTMLButtonElement).click()
    await settle()
    expect(document.querySelector('[data-testid="security-tool-detail"]')?.textContent).toContain('已加入自动能力目录')
  })

  it('starts setup and renders backend progress instead of a local fake timer', async () => {
    const { calls, handlers } = mountPanel()
    await settle()
    const prepare = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('准备 IDA MCP'))
    prepare?.click()
    await settle()
    expect(calls.some(([method]) => method === 'StartSecurityToolSetup')).toBe(true)
    expect(document.body.textContent).toContain('安装固定版本 MCP')

    handlers.get('security-tool-setup')?.({
      toolId: 'ida-pro', state: 'running', percent: 70, summary: '正在准备 IDA Pro MCP',
      steps: [{ id: 'install', label: '安装固定版本 MCP', status: 'running', detail: '正在安装' }],
    })
    await settle()
    expect(document.body.textContent).toContain('70%')
    expect(document.body.textContent).toContain('正在安装')
  })

  it('hands an actionable setup task to Coding without starting backend setup', async () => {
    const { calls } = mountPanel()
    const handoff = vi.fn()
    mounted?.unmount()
    mounted = undefined
    document.body.innerHTML = ''

    const handlers = new Map<string, (value: SecurityToolSetupSnapshot) => void>()
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: {
        invoke(method: string, args: unknown[]) {
          calls.push([method, args])
          if (method === 'ListSecurityTools') return Promise.resolve(catalog)
          if (method === 'GetSecurityToolSetup') return Promise.resolve({ toolId: args[0], state: 'idle', percent: 0, summary: '' })
          if (method === 'PrepareSecurityToolCodingHandoff') return Promise.resolve({
            toolId: args[0], title: '配置 IDA Pro',
            prompt: '帮我准备 MilkSU 的 IDA Pro 本机能力，并运行最小健康检查。',
            visibleText: '检查并准备 IDA Pro，完成一次最小健康检查。',
            executionMode: 'go',
            approvalPolicy: 'full-auto',
          })
          throw new Error(`unexpected ${method}`)
        },
        onEvent(name: string, handler: (value: SecurityToolSetupSnapshot) => void) {
          handlers.set(name, handler)
          return () => handlers.delete(name)
        },
      },
    })
    const host = document.createElement('div')
    document.body.append(host)
    mounted = createApp(SecurityToolsSettingsPanel, { onCodingHandoff: handoff })
    mounted.mount(host)
    await settle()

    const openCoding = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('在 Coding 中配置'))
    openCoding?.click()
    await settle()

    expect(calls.some(([method]) => method === 'PrepareSecurityToolCodingHandoff')).toBe(true)
    expect(calls.some(([method]) => method === 'StartSecurityToolSetup')).toBe(false)
    expect(handoff).toHaveBeenCalledWith(expect.objectContaining({
      toolId: 'ida-pro',
      visibleText: '检查并准备 IDA Pro，完成一次最小健康检查。',
      executionMode: 'go',
      approvalPolicy: 'full-auto',
    }))
  })
})
