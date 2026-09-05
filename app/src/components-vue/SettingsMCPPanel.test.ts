// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsMCPPanel from './SettingsMCPPanel.vue'
import type { AgentResourceCatalog } from '@/agentResourceTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function settle() {
  await nextTick()
  await nextTick()
}

async function mountPanel(catalog: AgentResourceCatalog, methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {}) {
  Object.defineProperty(window, 'milksu', {
    configurable: true,
    enumerable: true,
    writable: true,
    value: {
      invoke(method: string, args: unknown[]) {
        const fn = {
          ListAgentResourceCatalog: async () => catalog,
          ListSecurityTools: async () => [],
          ...methods,
        }[method]
        if (!fn) throw new Error(`unexpected method ${method}`)
        return Reflect.apply(fn, undefined, Array.isArray(args) ? args : [])
      },
      onEvent() {
        return () => {}
      },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(SettingsMCPPanel)
  app.mount(host)
  mountedApps.push(app)
  for (let index = 0; index < 8; index += 1) await settle()
  return host
}

describe('SettingsMCPPanel', () => {
  it('lists user MCP servers and can add a command server', async () => {
    let saved: unknown
    const host = await mountPanel({
      mcpServers: [{
        name: 'docs',
        enabled: true,
        transport: 'url',
        url: 'https://example.test/mcp',
        fileAccess: '不直接授予本机文件',
        networkAccess: '仅连接 https://example.test',
        scope: 'user',
        reviewReady: true,
      }],
      skills: [],
    }, {
      UpsertUserMCPServer: async (input: unknown) => {
        saved = input
        return { mcpServers: [], skills: [] }
      },
    })

    expect(host.textContent).toContain('docs')
    expect(host.textContent).toContain('远程 HTTP')
    const add = host.querySelector('[aria-label="添加 MCP 服务器"]') as HTMLButtonElement
    add.click()
    await settle()
    const name = host.querySelector('[aria-label="服务器名称"]') as HTMLInputElement
    const command = host.querySelector('[aria-label="启动命令"]') as HTMLInputElement
    name.value = 'github'
    name.dispatchEvent(new Event('input', { bubbles: true }))
    command.value = 'npx'
    command.dispatchEvent(new Event('input', { bubbles: true }))
    const save = [...host.querySelectorAll('button')].find(button => (
      (button.textContent ?? '').includes('保存')
    ))
    save?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(saved).toMatchObject({
      name: 'github',
      transport: 'command',
      command: 'npx',
      enabled: true,
    })
  })

  it('imports a Pi or Cursor mcp.json document', async () => {
    let imported = ''
    const host = await mountPanel({
      mcpServers: [],
      skills: [],
    }, {
      ImportUserMCPJSON: async (input: unknown) => {
        imported = String(input ?? '')
        return {
          mcpServers: [{
            name: 'github',
            enabled: true,
            transport: 'command',
            command: 'npx',
            fileAccess: '项目读写 + 私有运行目录',
            networkAccess: '任意出站网络',
            scope: 'user',
            reviewReady: true,
          }],
          skills: [],
        }
      },
    })
    const open = host.querySelector('[aria-label="导入 MCP JSON"]') as HTMLButtonElement
    open.click()
    await settle()
    const field = host.querySelector('[aria-label="MCP JSON"]') as HTMLTextAreaElement
    field.value = '{"mcpServers":{"github":{"command":"npx"}}}'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    const save = [...host.querySelectorAll('button')].find(button => (
      (button.textContent ?? '').includes('导入')
    ))
    save?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    for (let index = 0; index < 6; index += 1) await settle()
    expect(imported).toContain('github')
    expect(host.textContent).toContain('github')
  })

  it('lists built-in MCP rows and can restore this version default', async () => {
    let restored = ''
    const host = await mountPanel({
      mcpServers: [],
      skills: [],
      builtinMCP: [{
        name: 'ida-pro',
        enabled: true,
        customized: true,
        command: 'idalib-mcp',
      }],
    }, {
      ListSecurityTools: async () => [{
        id: 'ida-pro',
        name: 'IDA Pro',
        purpose: '交互式反汇编与二进制分析',
        status: 'ready',
        statusLabel: '可用',
        enabled: true,
        usableByAgent: true,
        connection: 'idalib MCP',
        runtime: '按需启动本地 MCP',
        capabilities: [],
        schema: [],
        setupSupported: true,
        codingSupported: true,
      }],
      RestoreBuiltinMCP: async (name: unknown) => {
        restored = String(name ?? '')
        return { mcpServers: [], skills: [], builtinMCP: [{ name: 'ida-pro', enabled: true, customized: false }] }
      },
    })
    expect(host.textContent).toContain('IDA Pro')
    expect(host.textContent).toContain('内置 MCP')
    const restore = [...host.querySelectorAll('button')].find(button => (
      (button.textContent ?? '').includes('恢复默认')
    ))
    restore?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(restored).toBe('ida-pro')
  })
})
