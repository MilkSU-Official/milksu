// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import SecurityToolsSettingsPreview from './SecurityToolsSettingsPreview.vue'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub

let mountedApp: App | undefined

async function mountPreview() {
  const host = document.createElement('div')
  document.body.append(host)
  mountedApp = createApp(SecurityToolsSettingsPreview)
  mountedApp.mount(host)
  await nextTick()
}

afterEach(() => {
  mountedApp?.unmount()
  mountedApp = undefined
  document.body.innerHTML = ''
})

describe('SecurityToolsSettingsPreview', () => {
  it('renders the selected master-detail design with a restrained reviewed catalog', async () => {
    await mountPreview()

    const workbench = document.querySelector('[data-testid="security-tool-workbench"]')
    expect(workbench).not.toBeNull()
    expect(workbench?.textContent).toContain('IDA Pro')
    expect(workbench?.textContent).toContain('Burp Suite')
    expect(workbench?.textContent).toContain('capa')
    expect(workbench?.textContent).toContain('CodeQL')
    expect(workbench?.textContent).toContain('Shannon')
    expect(document.querySelector('[data-testid="security-tool-detail"]')?.textContent).toContain('idalib MCP')
    expect(document.body.textContent).toContain('不会开放二进制补丁或任意脚本执行')
  })

  it('switches tools and keeps unavailable integrations visibly disabled', async () => {
    await mountPreview()

    const shannon = document.querySelector('[data-testid="security-tool-shannon"]') as HTMLButtonElement
    shannon.click()
    await nextTick()

    const detail = document.querySelector('[data-testid="security-tool-detail"]')
    expect(detail?.textContent).toContain('受管 Worker')
    expect(detail?.textContent).toContain('仅允许本地或明确授权目标')
    expect(detail?.querySelector('[aria-label="启用Shannon"]')?.hasAttribute('data-disabled')).toBe(true)
  })

  it('reveals the reviewed schema without crowding the default detail view', async () => {
    await mountPreview()

    expect(document.querySelector('[aria-label="MCP Schema 摘要"]')).toBeNull()
    const schemaButton = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('查看 MCP Schema'))
    schemaButton?.click()
    await nextTick()

    expect(document.querySelector('[aria-label="MCP Schema 摘要"]')?.textContent).toContain('read.functions')
  })
})
